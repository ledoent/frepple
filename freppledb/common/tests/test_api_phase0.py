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

"""Phase 0 modernization API tests: OpenAPI schema + JSON output endpoints."""

import json

from django.test import TestCase, TransactionTestCase


def _body(response):
    """Return the full response body, handling streaming responses."""
    if getattr(response, "streaming", False):
        return b"".join(response.streaming_content)
    return response.content


class Phase0SchemaTest(TestCase):
    fixtures = ["demo"]

    def setUp(self):
        self.client.login(username="admin", password="admin")
        super().setUp()

    def test_openapi_schema(self):
        # The drf-spectacular schema must generate and be served.
        response = self.client.get("/api/schema/")
        self.assertEqual(response.status_code, 200)
        body = _body(response)
        self.assertIn(b"openapi", body)
        self.assertIn(b"frePPLe API", body)

    def test_swagger_ui(self):
        self.assertEqual(self.client.get("/api/doc/").status_code, 200)

    def test_redoc(self):
        self.assertEqual(self.client.get("/api/redoc/").status_code, 200)


class Phase0OutputEndpointTest(TestCase):
    fixtures = ["demo"]

    # Each output endpoint must be byte-identical to the legacy report's
    # ?format=json response, because JSONStreamView delegates to the same
    # report view (reusing the raw-SQL streaming path, no DRF serializer).
    PARITY = [
        ("/buffer/?format=json", "/api/output/inventory/"),
        ("/demand/?format=json", "/api/output/demand/"),
        ("/resource/?format=json", "/api/output/resource/"),
        ("/forecast/?format=json", "/api/output/forecast/"),
    ]

    def setUp(self):
        self.client.login(username="admin", password="admin")
        super().setUp()

    def test_output_endpoints_envelope(self):
        # Each output endpoint streams the report's jqGrid JSON envelope. We
        # don't json.loads it: with no computed plan the rows can be empty and
        # the report's empty-grid output is not strictly valid JSON (pre-existing
        # behaviour, identical on the legacy path).
        for _legacy, new in self.PARITY:
            with self.subTest(endpoint=new):
                response = self.client.get(new)
                self.assertEqual(response.status_code, 200, new)
                body = _body(response)
                self.assertTrue(
                    body.startswith(b'{"total":'), "%s: %r" % (new, body[:40])
                )
                self.assertIn(b'"rows":', body)

    def test_output_delegates_to_report(self):
        # JSONStreamView delegates to the report's own view, so the new endpoint
        # streams the same envelope as the legacy ?format=json. The 'records'
        # count can vary with the planning horizon vs. now(), so we compare the
        # envelope up to that field rather than byte-for-byte.
        for legacy, new in self.PARITY:
            with self.subTest(endpoint=new):
                old = _body(self.client.get(legacy))
                api = _body(self.client.get(new))
                self.assertEqual(
                    api.split(b'"records":')[0],
                    old.split(b'"records":')[0],
                    "%s envelope differs from legacy %s" % (new, legacy),
                )


class Phase0JwtUtilTest(TestCase):
    """The shared JWT/scenario helpers (common/jwtauth.py) used by REST + WS."""

    def test_encode_decode_roundtrip(self):
        from freppledb.common.jwtauth import encode_jwt, decode_jwt

        token = encode_jwt("default", user="admin")
        self.assertEqual(decode_jwt(token, "default").get("user"), "admin")

    def test_decode_invalid_returns_none(self):
        from freppledb.common.jwtauth import decode_jwt

        self.assertIsNone(decode_jwt("not.a.valid.token", "default"))

    def test_decode_expired_raises(self):
        import jwt as pyjwt
        from freppledb.common.jwtauth import encode_jwt, decode_jwt

        # exp is an absolute timestamp; 1 => 1970 => already expired.
        token = encode_jwt("default", user="admin", exp=1)
        with self.assertRaises(pyjwt.exceptions.ExpiredSignatureError):
            decode_jwt(token, "default")

    def test_extract_scenario_default(self):
        from freppledb.common.jwtauth import extract_scenario

        db, path = extract_scenario("/some/path/")
        self.assertEqual(db, "default")
        self.assertEqual(path, "/some/path/")

    def test_extract_scenario_url_prefix(self):
        from freppledb.common.jwtauth import extract_scenario
        from freppledb.common.utils import get_databases

        others = [d for d in get_databases() if d != "default"]
        if not others:
            self.skipTest("no non-default scenario configured")
        db, path = extract_scenario("/%s/foo/bar/" % others[0])
        self.assertEqual(db, others[0])
        self.assertEqual(path, "/foo/bar/")

    def test_extract_scenario_header(self):
        from freppledb.common.jwtauth import extract_scenario
        from freppledb.common.utils import get_databases

        others = [d for d in get_databases() if d != "default"]
        if not others:
            self.skipTest("no non-default scenario configured")
        db, path = extract_scenario(
            "/foo/", headers=[(b"x-frepple-scenario", others[0].encode("ascii"))]
        )
        self.assertEqual(db, others[0])


class Phase0WebsocketTest(TransactionTestCase):
    """The authenticated websocket endpoint (asgi.py).

    Uses TransactionTestCase: the consumer's user lookup runs through
    database_sync_to_async on a separate thread/connection, so the fixture user
    must be committed (a wrapping TestCase transaction would hide it).
    """

    fixtures = ["demo"]

    def _connect(self, headers=None, subprotocols=None):
        from asgiref.sync import async_to_sync
        from channels.testing import WebsocketCommunicator
        from freppledb.asgi import application

        async def run():
            communicator = WebsocketCommunicator(
                application, "/ws/", headers=headers, subprotocols=subprotocols
            )
            connected, _ = await communicator.connect()
            reply = None
            if connected:
                await communicator.send_to(text_data=json.dumps({"message": "hi"}))
                reply = json.loads(await communicator.receive_from())
            await communicator.disconnect()
            return connected, reply

        return async_to_sync(run)()

    def _token(self):
        from freppledb.common.jwtauth import encode_jwt

        return encode_jwt("default", user="admin")

    def test_ws_rejects_without_token(self):
        connected, _ = self._connect()
        self.assertFalse(connected)

    def test_ws_rejects_bad_token(self):
        connected, _ = self._connect(
            headers=[(b"authorization", b"Bearer not.a.valid.token")]
        )
        self.assertFalse(connected)

    def test_ws_authorization_header_echoes_scenario(self):
        token = self._token()
        connected, reply = self._connect(
            headers=[(b"authorization", b"Bearer " + token.encode("ascii"))]
        )
        self.assertTrue(connected)
        self.assertEqual(reply["message"], "hi")
        self.assertEqual(reply["database"], "default")
        self.assertEqual(reply["user"], "admin")

    def test_ws_subprotocol_carrier(self):
        token = self._token()
        connected, reply = self._connect(subprotocols=["bearer", token])
        self.assertTrue(connected)
        self.assertEqual(reply["database"], "default")
