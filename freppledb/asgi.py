#
# Copyright (C) 2023 by frePPLe bv
#
# Permission is hereby granted, free of charge, to any person obtaining
# a copy of this software and associated documentation files (the
# "Software"), to deal in the Software without restriction, including
# without limitation the rights to use, copy, modify, merge, publish,
# distribute, sublicense, and/or sell copies of the Software, and to
# permit persons to whom the Software is furnished to do so, subject to
# the following conditions:
#
# The above copyright notice and this permission notice shall be
# included in all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
# EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
# MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
# NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
# LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
# OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
# WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
#

import base64
from importlib import import_module
import json
import logging
import os
import sys
from urllib.parse import parse_qs

from django.conf import settings
from django.contrib.auth import authenticate
from django.db import DEFAULT_DB_ALIAS
from django.urls import re_path

from django.contrib.auth.models import AnonymousUser
from freppledb.common.models import User, APIKey
from freppledb.common.jwtauth import decode_jwt, extract_scenario

from channels.auth import AuthMiddleware
from channels.db import database_sync_to_async
from channels.generic.http import AsyncHttpConsumer
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.middleware import BaseMiddleware
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from channels.sessions import CookieMiddleware, SessionMiddleware

from .urls import svcpatterns

# Assure frePPLe is found in the Python path.
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

os.environ["LC_ALL"] = "en_US.UTF-8"
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "freppledb.settings")

logger = logging.getLogger(__name__)

serviceRegistry = {}

connected = set()


def registerService(key):
    def inner(func):
        if callable(func):
            serviceRegistry[key] = func
        else:
            logger.warning("Warning: Only functions can be registered as a service")
        return func

    return inner


# Adding urls for each installed application.
for app in settings.INSTALLED_APPS:
    try:
        mod = import_module("%s.services" % app)
    except ModuleNotFoundError as e:
        # Skip if the app simply has no services module, or if the engine module
        # ("frepple") isn't importable in this process. The latter lets asgi.py be
        # imported in a plain Django/test/schema context (where the embedded C++
        # interpreter is absent) instead of only inside the worker; the engine-only
        # services it would have registered are meaningless there anyway.
        if e.name != "frepple" and not (e.name or "").endswith(".services"):
            raise e


class WebsocketService(AsyncWebsocketConsumer):
    """
    Minimal authenticated websocket endpoint (Phase 0 beachhead).

    Authentication and scenario routing are handled by the middleware stack
    (TokenMiddleware sets scope["database"] from the URL/header and scope["user"]
    from the JWT/session). This consumer only refuses unauthenticated connections
    and echoes messages tagged with the resolved scenario, so a client can confirm
    which database it is bound to. Phase 1A grows this into live task/log streaming.
    """

    async def connect(self):
        # is_active is a plain attribute on AnonymousUser (unlike is_authenticated,
        # which is a property that reads truthy on the class), so it reliably
        # rejects both anonymous and inactive users.
        user = self.scope.get("user")
        if not user or not getattr(user, "is_active", False):
            await self.close(code=4401)
            return
        connected.add(self)
        await self.accept(subprotocol=self.scope.get("jwt_subprotocol"))

    async def disconnect(self, close_code):
        connected.discard(self)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            payload = json.loads(text_data) if text_data else {}
        except (TypeError, ValueError):
            payload = {}
        await self.send(
            text_data=json.dumps(
                {
                    "message": payload.get("message"),
                    "database": self.scope.get("database"),
                    "user": getattr(self.scope.get("user"), "username", None),
                }
            )
        )


class TaskProgressConsumer(AsyncWebsocketConsumer):
    """
    Live task progress for the Execute screen (Phase 1A).

    Subscribes to the scenario's ``tasks.<database>`` channel-layer group and
    relays the messages that ``Task`` post-save broadcasts (status/progress,
    started/finished), so the UI advances from server pushes instead of polling.
    Authentication + scenario routing are handled by the middleware stack.
    """

    async def connect(self):
        user = self.scope.get("user")
        if not user or not getattr(user, "is_active", False):
            await self.close(code=4401)
            return
        if self.channel_layer is None:
            # No channel layer configured: nothing to subscribe to.
            await self.close(code=1011)
            return
        self.group = "tasks.%s" % self.scope.get("database", DEFAULT_DB_ALIAS)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept(subprotocol=self.scope.get("jwt_subprotocol"))

    async def disconnect(self, close_code):
        group = getattr(self, "group", None)
        if group and self.channel_layer is not None:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def task_update(self, event):
        # Handler for {"type": "task.update", "task": {...}} group messages.
        await self.send(text_data=json.dumps(event["task"]))


class HTTPNotFound(AsyncHttpConsumer):
    async def handle(self, body):
        self.scope["response_headers"].append((b"Content-Type", b"text/plain"))
        await self.send_response(
            400, b"Not found", headers=self.scope["response_headers"]
        )


@database_sync_to_async
def get_user(username=None, email=None, password=None, database=DEFAULT_DB_ALIAS):
    try:
        if username:
            if password:
                return authenticate(username=username, password=password)
            else:
                return User.objects.using(database).get(username=username)
        elif email:
            return User.objects.using(database).get(email=email)
        else:
            return AnonymousUser()
    except Exception:
        return AnonymousUser()


@database_sync_to_async
def get_user_by_apikey(key, database=DEFAULT_DB_ALIAS):
    try:
        user = APIKey.findKey(key).user
        user.switchDatabase(database)
        return user
    except Exception:
        return AnonymousUser()


def _extract_credentials(scope, headers):
    """
    Find the request credentials across all carriers frePPLe clients use.

    Returns ``(scheme, credentials, subprotocol)`` where ``scheme`` is
    "bearer"/"basic"/None. Besides the HTTP ``Authorization`` header, browser
    websocket clients (which cannot set request headers) may pass the JWT either
    as a ``Sec-WebSocket-Protocol`` subprotocol (``["bearer", "<jwt>"]``, parsed
    into ``scope["subprotocols"]``) or as a ``?token=`` query parameter. When the
    subprotocol carrier is used, the negotiated subprotocol is returned so the
    consumer can echo it back in the handshake.
    """
    # 1. Authorization header (HTTP / API clients).
    for k, v in headers:
        if k == b"authorization":
            parts = v.decode("ascii").split()
            if len(parts) == 2:
                return parts[0].lower(), parts[1], None
            break

    # 2. Websocket subprotocol carrier: ["bearer", "<jwt>"].
    subs = [
        s.decode("ascii") if isinstance(s, bytes) else s
        for s in (scope.get("subprotocols") or [])
    ]
    if len(subs) >= 2 and subs[0].strip().lower() == "bearer":
        return "bearer", subs[1].strip(), "bearer"

    # 3. Websocket query-string carrier: ?token=<jwt>.
    qs = scope.get("query_string", b"")
    if qs:
        token = parse_qs(qs.decode("ascii")).get("token", [None])[0]
        if token:
            return "bearer", token, None

    return None, None, None


class TokenMiddleware(BaseMiddleware):
    """
    - resolves the scenario database from the URL prefix / X-Frepple-Scenario
      header (falling back to the FREPPLE_DATABASE env var for single-scenario
      deployments) and strips the prefix from the path, mirroring the WSGI
      MultiDBMiddleware
    - adds the resolved user to the scope from a JWT/API-key/basic credential
    """

    def __init__(self, app):
        self.database = os.environ.get("FREPPLE_DATABASE", DEFAULT_DB_ALIAS)
        super().__init__(app)

    async def __call__(self, scope, receive, send):
        headers = scope.get("headers") or []
        database, path = extract_scenario(
            scope.get("path", ""), headers, default=self.database
        )
        scope["database"] = database
        if "path" in scope:
            scope["path"] = path
        try:
            scheme, credentials, subprotocol = _extract_credentials(scope, headers)
            if scheme == "bearer" and credentials:
                if subprotocol:
                    scope["jwt_subprotocol"] = subprotocol
                # JWT webtoken or API-key authentication.
                try:
                    decoded = decode_jwt(credentials, database)
                except Exception:
                    # Expired/invalid token: treat as unauthenticated.
                    decoded = None
                if decoded and "user" in decoded:
                    scope["user"] = await get_user(
                        username=decoded["user"], database=database
                    )
                elif decoded and "email" in decoded:
                    scope["user"] = await get_user(
                        email=decoded["email"], database=database
                    )
                elif not decoded:
                    # Not a JWT for any scenario secret: try API-key auth.
                    try:
                        scope["user"] = await get_user_by_apikey(
                            credentials, database=database
                        )
                    except Exception:
                        pass
            elif scheme == "basic" and credentials:
                args = base64.b64decode(credentials).decode("iso-8859-1").split(":", 1)
                scope["user"] = await get_user(
                    username=args[0], password=args[1], database=database
                )
        except Exception:
            pass
        return await super().__call__(scope, receive, send)


class AuthAndPermissionMiddleware(AuthMiddleware):
    """
    Populates user permissions.
    """

    async def __call__(self, scope, receive, send):
        usr = scope.get("user", None)
        if not usr:
            scope["user"] = AnonymousUser
        elif usr.is_authenticated and not usr.is_superuser:
            await database_sync_to_async(usr.get_all_permissions)()
        return await super().__call__(scope, receive, send)


class AuthenticatedMiddleware(BaseMiddleware):
    """
    Disallows any unauthenticated connection with the service.
    A django session or a JWT token are required.
    """

    async def __call__(self, scope, receive, send):
        scope["response_headers"] = [
            (b"Access-Control-Allow-Methods", b"GET, POST, OPTIONS"),
            (b"Server", b"frepple"),
            (b"Access-Control-Allow-Credentials", b"true"),
            (
                b"Access-Control-Allow-Headers",
                b"authorization, content-type, x-requested-with",
            ),
        ]
        for hdr in scope["headers"]:
            if hdr[0] == b"origin":
                scope["response_headers"].append(
                    (b"Access-Control-Allow-Origin", hdr[1])
                )
                break
        if scope["method"] == "OPTIONS":
            await send(
                {
                    "type": "http.response.start",
                    "status": 204,
                    "headers": scope["response_headers"],
                }
            )
            return await send(
                {
                    "type": "http.response.body",
                    "body": b"OK",
                    "more_body": False,
                }
            )
        if (
            "user" not in scope
            or not scope["user"].is_authenticated
            or not scope["user"].is_active
        ):
            scope["response_headers"].append((b"Content-Type", b"text/plain"))
            await send(
                {
                    "type": "http.response.start",
                    "status": 401,
                    "headers": scope["response_headers"],
                }
            )
            return await send(
                {
                    "type": "http.response.body",
                    "body": b"Unauthenticated",
                    "more_body": False,
                }
            )
        try:
            return await super().__call__(scope, receive, send)
        except Exception as e:
            print("Error:", e)
            scope["response_headers"].append((b"Content-Type", b"text/plain"))
            await send(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": scope["response_headers"],
                }
            )
            return await send(
                {
                    "type": "http.response.body",
                    "body": b"Server error",
                    "more_body": False,
                }
            )


application = ProtocolTypeRouter(
    {
        "http": CookieMiddleware(
            SessionMiddleware(
                TokenMiddleware(
                    AuthAndPermissionMiddleware(
                        AuthenticatedMiddleware(
                            URLRouter(
                                svcpatterns + [re_path(r".*", HTTPNotFound.as_asgi())]
                            )
                        )
                    )
                )
            )
        ),
        # Websockets reuse the same cookie/session + token + permission stack as
        # HTTP (so same-origin browser clients authenticate by session cookie and
        # token clients by JWT), but the per-connection auth gate lives in the
        # consumer's connect() rather than AuthenticatedMiddleware (which is
        # HTTP-only: it inspects scope["method"] and writes an HTTP 401 response).
        "websocket": AllowedHostsOriginValidator(
            CookieMiddleware(
                SessionMiddleware(
                    TokenMiddleware(
                        AuthAndPermissionMiddleware(
                            URLRouter(
                                [
                                    re_path(
                                        r"^ws/tasks/$",
                                        TaskProgressConsumer.as_asgi(),
                                    ),
                                    re_path(r"^ws/$", WebsocketService.as_asgi()),
                                ]
                            )
                        )
                    )
                )
            )
        ),
    }
)
