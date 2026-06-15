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
JSON output API for plan/forecast reports (Phase 0 modernization).

frePPLe's report engine (GridReport/GridPivot) already streams its grid data as
JSON when called with ?format=json: it builds the data with a single raw-SQL
statement and a chunked cursor, then streams it via StreamingHttpResponse
(see freppledb/common/report.py). That path uses NO DRF serializer, which is
exactly what we want for the output endpoints (serializer cost avoided).

Rather than re-implement any of that, JSONStreamView simply forces format=json
and delegates to the report's own class-based view. The report's dispatch()
runs its normal setup (permission checks, time-bucket and filter handling,
scenario database selection via request.database) and streams the JSON. This
keeps the API a thin, drift-free wrapper over the canonical query path.

Wire a report as a JSON endpoint with, e.g.:

    JSONStreamView.as_view(report_class=InventoryReport)
"""

from django.views import View


class JSONStreamView(View):
    """Expose a GridReport/GridPivot as a streaming-JSON REST endpoint.

    Set the ``report_class`` attribute (typically via ``as_view(report_class=...)``)
    to any GridReport subclass. Query parameters supported by the report -
    filters (``?filters=``, ``field__op=``), time buckets (``?buckets=``,
    ``?startdate=``, ``?enddate=``) and pagination (``?page=``, ``?rows=``) -
    pass straight through.
    """

    # The GridReport / GridPivot subclass to render. Required.
    report_class = None

    # Reuse the report's HTTP method support.
    http_method_names = ["get", "head", "options"]

    def dispatch(self, request, *args, **kwargs):
        if self.report_class is None:
            raise ValueError("JSONStreamView requires a report_class")
        # Force JSON output, then hand off to the report's own view. The report
        # performs permission checks and streams the raw-SQL result itself.
        if request.GET.get("format") != "json":
            request.GET = request.GET.copy()
            request.GET["format"] = "json"
        return self.report_class.as_view()(request, *args, **kwargs)
