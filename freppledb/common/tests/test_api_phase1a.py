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

"""Phase 1A modernization tests: live task-progress websocket (ws/tasks/)."""

import asyncio
import json
import os

from django.test import TransactionTestCase


class Phase1ATaskProgressTest(TransactionTestCase):
    """The ws/tasks/ consumer relays channel-layer task updates to the browser,
    and a Task save broadcasts onto that group. Uses TransactionTestCase so the
    threaded DB write in the broadcast test sees committed fixture data."""

    fixtures = ["demo"]

    def test_ws_tasks_relays_group_message(self):
        # This verifies the consumer's group->client RELAY (auth is covered by
        # test_ws_tasks_rejects_unauthenticated + the Phase 0 jwt-auth tests).
        # We authenticate by injecting an active user into the consumer scope
        # rather than through the middleware's threaded get_user, which is
        # unreliable in later TransactionTestCase methods. The admin user is read
        # on the main thread (which always sees the loaded fixtures).
        from types import SimpleNamespace

        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        from channels.testing import WebsocketCommunicator
        from freppledb.asgi import TaskProgressConsumer

        # The consumer only inspects user.is_active, so a zero-DB stand-in keeps
        # this focused on the relay and free of fixture/connection flakiness.
        active_user = SimpleNamespace(
            is_active=True, is_authenticated=True, username="admin"
        )
        consumer_app = TaskProgressConsumer.as_asgi()

        async def auth_app(scope, receive, send):
            scope = dict(scope)
            scope["user"] = active_user
            scope["database"] = "default"
            return await consumer_app(scope, receive, send)

        async def run():
            c = WebsocketCommunicator(auth_app, "/ws/tasks/")
            connected, detail = await c.connect()
            if not connected:
                return {"connected": False, "detail": detail}
            # A worker progress event, injected via the channel layer.
            await get_channel_layer().group_send(
                "tasks.default",
                {
                    "type": "task.update",
                    "task": {"id": 7, "name": "runplan", "status": "42%"},
                },
            )
            msg = json.loads(await c.receive_from(timeout=5))
            await c.disconnect()
            return msg

        msg = async_to_sync(run)()
        self.assertEqual(msg.get("status"), "42%", msg)
        self.assertEqual(msg.get("id"), 7, msg)

    def test_ws_tasks_rejects_unauthenticated(self):
        from asgiref.sync import async_to_sync
        from channels.testing import WebsocketCommunicator
        from freppledb.asgi import application

        async def run():
            c = WebsocketCommunicator(application, "/ws/tasks/")
            connected, detail = await c.connect()
            await c.disconnect()
            return connected, detail

        connected, detail = async_to_sync(run)()
        self.assertFalse(connected)
        self.assertEqual(detail, 4401)

    def test_ws_tasks_rejects_inactive_user(self):
        # An authenticated-but-deactivated user must be refused (the consumer
        # gates on user.is_active). Inject the user into scope to focus on the
        # is_active gate, like the relay test above.
        from types import SimpleNamespace

        from asgiref.sync import async_to_sync
        from channels.testing import WebsocketCommunicator
        from freppledb.asgi import TaskProgressConsumer

        inactive_user = SimpleNamespace(
            is_active=False, is_authenticated=True, username="ghost"
        )
        consumer_app = TaskProgressConsumer.as_asgi()

        async def auth_app(scope, receive, send):
            scope = dict(scope)
            scope["user"] = inactive_user
            scope["database"] = "default"
            return await consumer_app(scope, receive, send)

        async def run():
            c = WebsocketCommunicator(auth_app, "/ws/tasks/")
            connected, detail = await c.connect()
            await c.disconnect()
            return connected, detail

        connected, detail = async_to_sync(run)()
        self.assertFalse(connected)
        self.assertEqual(detail, 4401)

    def test_task_save_broadcasts_progress(self):
        # The post_save -> group_send path runs through database_sync_to_async on
        # a separate thread, which only reaches a subscriber over a cross-process
        # layer, so this only runs when Redis is configured (the deployment layer).
        if not os.environ.get("REDIS_HOST"):
            self.skipTest("needs a cross-process channel layer (Redis)")
        from asgiref.sync import async_to_sync
        from channels.db import database_sync_to_async
        from channels.layers import get_channel_layer
        from django.utils import timezone
        from freppledb.execute.models import Task

        def _make():
            Task.objects.using("default").create(
                name="runplan", submitted=timezone.now(), status="33%"
            )

        async def run():
            layer = get_channel_layer()
            chan = await layer.new_channel()
            await layer.group_add("tasks.default", chan)
            await database_sync_to_async(_make)()
            msg = await asyncio.wait_for(layer.receive(chan), timeout=5)
            await layer.group_discard("tasks.default", chan)
            return msg

        msg = async_to_sync(run)()
        self.assertEqual(msg["type"], "task.update")
        self.assertEqual(msg["task"]["status"], "33%")


class Phase1ALogTailTest(TransactionTestCase):
    """The ws/tasks/<id>/log/ live log-tail consumer (asgi.py)."""

    def test_stream_logfile_tails_and_finishes(self):
        # Pure tailing logic: no DB, no channels - deterministic.
        import tempfile

        from asgiref.sync import async_to_sync
        from freppledb.asgi import stream_logfile

        f = tempfile.NamedTemporaryFile(suffix=".log", delete=False, mode="w")
        f.write("first line\n")
        f.flush()
        f.close()

        async def run():
            out = []

            async def send_json(m):
                out.append(m)

            async def is_finished():
                return True

            await asyncio.wait_for(
                stream_logfile(f.name, is_finished, send_json, poll=0.01), timeout=3
            )
            return out

        try:
            out = async_to_sync(run)()
        finally:
            os.unlink(f.name)
        self.assertEqual(out[0], {"log": "first line\n"}, out)
        self.assertIn({"done": True}, out)

    def test_ws_log_streams_injected_path(self):
        import tempfile
        from types import SimpleNamespace

        from asgiref.sync import async_to_sync
        from channels.testing import WebsocketCommunicator
        from freppledb.asgi import TaskLogConsumer

        f = tempfile.NamedTemporaryFile(suffix=".log", delete=False, mode="w")
        f.write("hello from worker\n")
        f.flush()
        f.close()

        active_user = SimpleNamespace(
            is_active=True, is_authenticated=True, username="admin"
        )
        consumer_app = TaskLogConsumer.as_asgi()

        async def auth_app(scope, receive, send):
            scope = dict(scope)
            scope["user"] = active_user
            scope["database"] = "default"
            scope["url_route"] = {"kwargs": {"taskid": "1"}}
            scope["logpath_override"] = f.name
            scope["finished_override"] = True
            scope["logpoll_override"] = 0.01
            return await consumer_app(scope, receive, send)

        async def run():
            c = WebsocketCommunicator(auth_app, "/ws/tasks/1/log/")
            connected, detail = await c.connect()
            msgs = []
            if connected:
                for _ in range(5):
                    try:
                        msgs.append(json.loads(await c.receive_from(timeout=3)))
                    except Exception:
                        break
                    if msgs[-1].get("done"):
                        break
            await c.disconnect()
            return connected, detail, msgs

        try:
            connected, detail, msgs = async_to_sync(run)()
        finally:
            os.unlink(f.name)
        self.assertTrue(connected, detail)
        self.assertEqual(msgs[0].get("log"), "hello from worker\n", msgs)
        self.assertTrue(any(m.get("done") for m in msgs), msgs)

    def test_ws_log_rejects_unauthenticated(self):
        from asgiref.sync import async_to_sync
        from channels.testing import WebsocketCommunicator
        from freppledb.asgi import application

        async def run():
            c = WebsocketCommunicator(application, "/ws/tasks/1/log/")
            connected, detail = await c.connect()
            await c.disconnect()
            return connected, detail

        connected, detail = async_to_sync(run)()
        self.assertFalse(connected)
        self.assertEqual(detail, 4401)
