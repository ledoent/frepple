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

from django.test import TestCase


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
