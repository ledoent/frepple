{{- define "frepple.name" -}}
{{- default "frepple" .Values.nameOverride -}}
{{- end -}}

{{- define "frepple.labels" -}}
app.kubernetes.io/name: {{ include "frepple.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "frepple.pgHost" -}}
{{- if eq .Values.postgres.mode "builtin" -}}
{{ include "frepple.name" . }}-postgres
{{- else -}}
{{ .Values.postgres.external.host }}
{{- end -}}
{{- end -}}

{{- define "frepple.dbSecret" -}}
{{- if eq .Values.postgres.mode "builtin" -}}
{{ include "frepple.name" . }}-postgres
{{- else -}}
{{ .Values.postgres.external.credentialsSecret }}
{{- end -}}
{{- end -}}

{{/* Common env shared by the web + asgi containers. */}}
{{- define "frepple.env" -}}
- name: POSTGRES_HOST
  value: {{ include "frepple.pgHost" . | quote }}
- name: POSTGRES_PORT
  value: {{ (eq .Values.postgres.mode "builtin") | ternary "5432" (printf "%v" .Values.postgres.external.port) | quote }}
- name: POSTGRES_DBNAME
  value: {{ (eq .Values.postgres.mode "builtin") | ternary .Values.postgres.builtin.dbname .Values.postgres.external.dbname | quote }}
- name: POSTGRES_USER
  valueFrom:
    secretKeyRef:
      name: {{ include "frepple.dbSecret" . }}
      key: POSTGRES_USER
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "frepple.dbSecret" . }}
      key: POSTGRES_PASSWORD
- name: REDIS_HOST
  value: {{ include "frepple.name" . }}-redis
- name: REDIS_PORT
  value: "6379"
- name: FREPPLE_DATE_STYLE
  value: day-month-year
{{- if .Values.ingress.tls }}
# TLS is terminated at the ingress; tell Django the request is secure (via the
# forwarded-proto header) and trust the https origin so login POST passes CSRF.
- name: FREPPLE_SECURE_PROXY_SSL_HEADER
  value: "HTTP_X_FORWARDED_PROTO https"
- name: FREPPLE_CSRF_TRUSTED_ORIGINS
  value: {{ printf "https://%s" .Values.host | quote }}
{{- end }}
{{- end -}}
