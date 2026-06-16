#
# Copyright (C) 2015-2017 by frePPLe bv
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

import time

from django.contrib.admin.views.decorators import staff_member_required
from django.http import JsonResponse
from django.shortcuts import render
from django.utils.translation import gettext_lazy as _
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET

from rest_framework import generics
from rest_framework_bulk import ListBulkCreateUpdateDestroyAPIView
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import permissions

from freppledb.common.models import User
from freppledb.common.auth import getWebserviceAuthorization


@require_GET
def APITokenView(request):
    """
    Mint a short-lived JWT for the logged-in (session) user so the same-origin
    SPA can authenticate REST + websocket calls. The session cookie authorizes
    this request; the token carries the username and is signed with the
    scenario's web-token secret (so it is valid for request.database).
    """
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "authentication required"}, status=401)
    ttl = 86400  # 1 day
    token = getWebserviceAuthorization(
        user=request.user.username, exp=ttl, database=request.database
    )
    return JsonResponse({"token": token, "exp": round(time.time()) + ttl})


@staff_member_required
@csrf_protect
def APIIndexView(request):
    try:
        exp = int(request.GET.get("exp", "3"))
    except Exception:
        exp = 3
    if exp > 7:
        exp = 7
    return render(
        request,
        "rest_framework/index.html",
        context={
            "exp": exp,
            "url": request.build_absolute_uri(f"{request.prefix}/api/input/demand/"),
            "request": request,
            "title": _("REST API Help"),
            "token": getWebserviceAuthorization(
                user=request.user.username, exp=exp * 86400, database=request.database
            ),
        },
    )


class frepplePermissionClass(permissions.DjangoModelPermissions):
    def has_permission(self, request, view):
        self.perms_map["GET"] = ["%(app_label)s.view_%(model_name)s"]
        self.perms_map["OPTIONS"] = ["%(app_label)s.view_%(model_name)s"]
        self.perms_map["HEAD"] = ["%(app_label)s.view_%(model_name)s"]

        # match the permissions on the correct database
        if not hasattr(request.user, "_state"):
            return False
        request.user._state.db = request.database

        # Django is not checking if user is active or superuser on the scenario
        try:
            thisuser = (
                User.objects.all().using(request.database).get(username=request.user)
            )
            request.user.is_active = thisuser.is_active
            request.user.is_superuser = thisuser.is_superuser
        except Exception:
            request.user.is_active = False
            request.user.is_superuser = False

        return super().has_permission(request, view)


class frePPleListCreateAPIView(ListBulkCreateUpdateDestroyAPIView):
    """
    Customized API view for the REST framework.:
        - support for request-specific scenario database
        - add 'title' to the context of the html view
    """

    filter_backends = (DjangoFilterBackend,)
    permission_classes = (frepplePermissionClass,)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            # OpenAPI schema generation has no scenario request; use the base
            # queryset so the endpoint is still introspected.
            return super().get_queryset()
        queryset = super().get_queryset().using(self.request.database)
        return queryset

    def get_serializer(self, *args, **kwargs):
        kwargs["partial"] = True
        return super().get_serializer(*args, **kwargs)

    def allow_bulk_destroy(self, qs, filtered):
        # Safety check to prevent deleting all records in the database table
        if qs.count() > filtered.count():
            return True
        # default checks if the qs was filtered
        # qs comes from self.get_queryset()
        # filtered comes from self.filter_queryset(qs)
        return False


class frePPleRetrieveUpdateDestroyAPIView(generics.RetrieveUpdateDestroyAPIView):
    """
    Customized API view for the REST framework.
       - support for request-specific scenario database
       - add 'title' to the context of the html view
    """

    permission_classes = (frepplePermissionClass,)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            # OpenAPI schema generation has no scenario request.
            return super().get_queryset()
        if self.request.database == "default":
            return super().get_queryset()
        else:
            return super().get_queryset().using(self.request.database)
