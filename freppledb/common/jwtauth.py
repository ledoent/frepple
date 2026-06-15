#
# Copyright (C) 2026 by frePPLe bv
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

"""
Shared JWT + scenario helpers (Phase 0 modernization).

The HTTP middleware (common/middleware.py), the ASGI middleware (asgi.py) and
the token-minting helper (common/auth.py) each duplicated the same secret
resolution and JWT decode logic. This module is the single source of truth so
that REST and websocket auth never diverge, and so the ASGI layer can pick the
scenario database from the URL/header (instead of the FREPPLE_DATABASE env var).
"""

import re

import jwt
from django.conf import settings
from django.db import DEFAULT_DB_ALIAS

from freppledb.common.utils import get_databases


def resolve_jwt_secrets(database):
    """Ordered list of HS256 secrets to try when decoding a token for a scenario.

    Matches the historical order: a global AUTH_SECRET_KEY (if configured), then
    the scenario's SECRET_WEBTOKEN_KEY (falling back to the Django SECRET_KEY).
    """
    secrets = []
    auth_secret = getattr(settings, "AUTH_SECRET_KEY", None)
    if auth_secret:
        secrets.append(auth_secret)
    secrets.append(
        get_databases()[database].get("SECRET_WEBTOKEN_KEY", settings.SECRET_KEY)
    )
    return secrets


def encode_jwt(database, secret=None, **payload):
    """Mint an HS256 token for a scenario, signed with its web-token secret."""
    if not secret:
        secret = get_databases()[database].get(
            "SECRET_WEBTOKEN_KEY", settings.SECRET_KEY
        )
    token = jwt.encode(payload, secret, algorithm="HS256")
    return token.decode("ascii") if not isinstance(token, str) else token


def decode_jwt(token, database):
    """Return the decoded JWT payload, or None if no secret validates it.

    Re-raises jwt.ExpiredSignatureError (a valid-but-expired token) so callers
    can redirect to the login page, matching the previous middleware behaviour.
    """
    expired = None
    for secret in resolve_jwt_secrets(database):
        if not secret:
            continue
        try:
            return jwt.decode(token, secret, algorithms=["HS256"])
        except jwt.exceptions.ExpiredSignatureError as e:
            expired = e
        except jwt.exceptions.InvalidTokenError:
            pass
    if expired:
        raise expired
    return None


def _scenario_regexp(database):
    """The compiled ^/<database>/ prefix matcher (reused from the HTTP middleware
    when available, compiled on demand otherwise - e.g. in ASGI processes)."""
    regexp = get_databases()[database].get("regexp")
    if regexp is None:
        regexp = re.compile("^/%s/" % database)
    return regexp


def extract_scenario(path, headers=None, default=DEFAULT_DB_ALIAS):
    """Resolve the scenario database for a request and strip its URL prefix.

    Order: an ``X-Frepple-Scenario`` header (handy for websocket clients that
    cannot set a path prefix), then a ``/<database>/...`` URL prefix, then the
    given ``default`` (typically the FREPPLE_DATABASE env var, so existing
    single-scenario deployments keep working).

    Returns ``(database, stripped_path)``; the prefix is removed from the path so
    downstream routing stays scenario-agnostic, mirroring the WSGI middleware.
    """
    dbs = get_databases()

    # 1. Header (bytes tuples in ASGI scope, or a plain mapping).
    if headers:
        items = headers.items() if hasattr(headers, "items") else headers
        for k, v in items:
            name = k.decode("ascii") if isinstance(k, bytes) else k
            if name.lower() == "x-frepple-scenario":
                val = v.decode("ascii") if isinstance(v, bytes) else v
                if val in dbs:
                    return val, path
                break

    # 2. URL path prefix /<database>/...
    if path:
        for db in dbs:
            if _scenario_regexp(db).match(path):
                return db, path[len("/%s" % db) :]

    return default, path
