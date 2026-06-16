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

import json

from django.http import StreamingHttpResponse
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


class PivotJSONStreamView(JSONStreamView):
    """
    GridPivot OUTPUT enriched for the SPA (Phase 1B forecast, Phase 3 inventory…).

    The bare pivot stream's per-bucket arrays are not self-describing: the client
    needs the measure (crosses) order to map array slots to named measures, and
    each bucket's start/end dates. Those come from the report's ``crosses`` and
    ``getBuckets()`` - so this wraps the report's own ``{total,page,records,rows}``
    object unchanged under ``data`` and prepends a ``measures`` + ``buckets``
    header. The wrapped ``data`` is byte-identical to the legacy ``?format=json``
    stream, so any report (forecast, inventory, …) can opt in without changing the
    underlying values.
    """

    def dispatch(self, request, *args, **kwargs):
        if self.report_class is None:
            raise ValueError("PivotJSONStreamView requires a report_class")
        rc = self.report_class

        # Run the report view FIRST — it carries the auth/permission gate. Only a
        # streaming (authorized) response gets the metadata wrapper; a denial is
        # passed through untouched, before we spend any query on measures/buckets.
        if request.GET.get("format") != "json":
            request.GET = request.GET.copy()
            request.GET["format"] = "json"
        inner = rc.as_view()(request, *args, **kwargs)
        if not getattr(inner, "streaming", False):
            return inner  # e.g. a permission denial - pass through unchanged

        # Metadata extraction must never break the data stream: on any failure we
        # fall back to empty measures/buckets (the client then uses its defaults).
        measures = []
        try:
            crosses = (
                rc.crosses(request, *args, **kwargs)
                if callable(rc.crosses)
                else rc.crosses
            )
            measures = [
                c[0] for c in crosses if len(c) < 2 or (c[1] or {}).get("visible", True)
            ]
        except Exception:
            measures = []

        buckets = []
        try:
            rc.getBuckets(request, *args, **kwargs)
            for b in getattr(request, "report_bucketlist", []) or []:
                buckets.append(
                    {
                        "name": b["name"],
                        "startdate": (
                            b["startdate"].isoformat() if b["startdate"] else None
                        ),
                        "enddate": b["enddate"].isoformat() if b["enddate"] else None,
                    }
                )
        except Exception:
            buckets = []

        header = ('{"measures":%s,"buckets":%s,"data":') % (
            json.dumps(measures),
            json.dumps(buckets),
        )

        def stream():
            yield header.encode("utf-8")
            for chunk in inner.streaming_content:
                yield chunk if isinstance(chunk, bytes) else str(chunk).encode("utf-8")
            yield b"}"

        return StreamingHttpResponse(stream(), content_type="application/json")


# Back-compat alias: the forecast endpoint and tests still import this name.
ForecastJSONStreamView = PivotJSONStreamView
