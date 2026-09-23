{{/*
Expand the name of the chart.
*/}}
{{- define "taskdesk.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "taskdesk.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "taskdesk.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "taskdesk.labels" -}}
helm.sh/chart: {{ include "taskdesk.chart" . }}
{{ include "taskdesk.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "taskdesk.selectorLabels" -}}
app.kubernetes.io/name: {{ include "taskdesk.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "taskdesk.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "taskdesk.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
URL-encode credentials for URI userinfo. Sprig urlquery uses form escaping,
so spaces become +; in userinfo they must be %20 to preserve credentials.
*/}}
{{- define "taskdesk.urlencodeUserinfo" -}}
{{- . | urlquery | replace "+" "%20" -}}
{{- end }}

{{/*
API component common labels
*/}}
{{- define "taskdesk.api.labels" -}}
helm.sh/chart: {{ include "taskdesk.chart" . }}
{{ include "taskdesk.api.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: api
{{- end }}

{{/*
API component selector labels
*/}}
{{- define "taskdesk.api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "taskdesk.name" . }}-api
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Web component common labels
*/}}
{{- define "taskdesk.web.labels" -}}
helm.sh/chart: {{ include "taskdesk.chart" . }}
{{ include "taskdesk.web.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: web
{{- end }}

{{/*
Web component selector labels
*/}}
{{- define "taskdesk.web.selectorLabels" -}}
app.kubernetes.io/name: {{ include "taskdesk.name" . }}-web
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Env entries needed to build TASKDESK_DATABASE_URL, the APPLICATION role (issue #296) --
never a Postgres superuser, never owns a table. Shared by the API Deployment
(templates/deployment.yaml) and the migrate Job (templates/migrate-job.yaml): the Job
needs this only to satisfy deploy/entrypoint.sh's unconditional presence check for all
five required variables -- runMigrationStep() never connects with it -- but keeping one
copy of this branching is what keeps the two from silently drifting apart.
*/}}
{{- define "taskdesk.applicationDatabaseUrlEnv" -}}
{{- if and (not .Values.taskdesk.env.database.external.enabled) .Values.taskdesk.env.database.appExistingSecret.enabled }}
- name: TASKDESK_APP_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.taskdesk.env.database.appExistingSecret.name }}
      key: {{ .Values.taskdesk.env.database.appExistingSecret.key }}
{{- end }}
- name: TASKDESK_DATABASE_URL
  {{- if .Values.taskdesk.env.database.external.enabled }}
  {{- if .Values.taskdesk.env.database.external.existingSecret.enabled }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.taskdesk.env.database.external.existingSecret.name }}
      key: {{ .Values.taskdesk.env.database.external.existingSecret.passwordKey }}
  {{- else }}
  value: "postgresql://{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.external.username }}:{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.external.password }}@{{ .Values.taskdesk.env.database.external.host }}:{{ .Values.taskdesk.env.database.external.port }}/{{ .Values.taskdesk.env.database.external.database }}"
  {{- end }}
  {{- else }}
  {{- if .Values.taskdesk.env.database.appExistingSecret.enabled }}
  value: "postgresql://{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.appUsername }}:$(TASKDESK_APP_DB_PASSWORD)@{{ include "taskdesk.fullname" . }}-postgresql:{{ .Values.postgresql.service.port }}/{{ .Values.postgresql.auth.database }}"
  {{- else }}
  value: "postgresql://{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.appUsername }}:{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.appPassword }}@{{ include "taskdesk.fullname" . }}-postgresql:{{ .Values.postgresql.service.port }}/{{ .Values.postgresql.auth.database }}"
  {{- end }}
  {{- end }}
{{- end }}

{{/*
Env entries needed to build TASKDESK_MIGRATION_DATABASE_URL, the MIGRATION/OWNER role
(issue #296). Used ONLY by the migrate Job (templates/migrate-job.yaml) -- S1 (the
independent Opus 5.5 review of PR #308) requires the API Deployment never receive this
variable at all, so it must never be `include`d from deployment.yaml.

External database, `migration.enabled: false`: no separate owner credential exists, so
this falls back to the SAME url the application role uses -- the Helm equivalent of the
application's own single-URL fallback (configuration-reference.md). It either works (if
that external role happens to already have DDL rights) or the migrate Job fails loudly
with Postgres's own permission-denied error, which blocks `helm install`/`upgrade` via
the hook Job's own success gate -- a clear failure at install time, not a silent one.
*/}}
{{- define "taskdesk.migrationDatabaseUrlEnv" -}}
{{- if and (not .Values.taskdesk.env.database.external.enabled) .Values.postgresql.auth.existingSecret }}
- name: KANEO_POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgresql.auth.existingSecret }}
      key: {{ .Values.postgresql.auth.secretKeys.userPasswordKey }}
{{- end }}
{{- if and .Values.taskdesk.env.database.external.enabled .Values.taskdesk.env.database.external.migration.enabled .Values.taskdesk.env.database.external.migration.existingSecret.enabled }}
- name: TASKDESK_EXTERNAL_MIGRATION_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.taskdesk.env.database.external.migration.existingSecret.name }}
      key: {{ .Values.taskdesk.env.database.external.migration.existingSecret.passwordKey }}
{{- end }}
{{- if and .Values.taskdesk.env.database.external.enabled (not .Values.taskdesk.env.database.external.migration.enabled) .Values.taskdesk.env.database.external.existingSecret.enabled }}
- name: TASKDESK_EXTERNAL_APP_DB_PASSWORD_FOR_MIGRATE_FALLBACK
  valueFrom:
    secretKeyRef:
      name: {{ .Values.taskdesk.env.database.external.existingSecret.name }}
      key: {{ .Values.taskdesk.env.database.external.existingSecret.passwordKey }}
{{- end }}
{{- if not .Values.taskdesk.env.database.external.enabled }}
- name: TASKDESK_MIGRATION_DATABASE_URL
  {{- if .Values.postgresql.auth.existingSecret }}
  value: "postgresql://{{ include "taskdesk.urlencodeUserinfo" .Values.postgresql.auth.username }}:$(KANEO_POSTGRES_PASSWORD)@{{ include "taskdesk.fullname" . }}-postgresql:{{ .Values.postgresql.service.port }}/{{ .Values.postgresql.auth.database }}"
  {{- else }}
  value: "postgresql://{{ include "taskdesk.urlencodeUserinfo" .Values.postgresql.auth.username }}:{{ include "taskdesk.urlencodeUserinfo" .Values.postgresql.auth.password }}@{{ include "taskdesk.fullname" . }}-postgresql:{{ .Values.postgresql.service.port }}/{{ .Values.postgresql.auth.database }}"
  {{- end }}
{{- else if .Values.taskdesk.env.database.external.migration.enabled }}
- name: TASKDESK_MIGRATION_DATABASE_URL
  {{- if .Values.taskdesk.env.database.external.migration.existingSecret.enabled }}
  value: "postgresql://{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.external.migration.username }}:$(TASKDESK_EXTERNAL_MIGRATION_DB_PASSWORD)@{{ .Values.taskdesk.env.database.external.migration.host }}:{{ .Values.taskdesk.env.database.external.migration.port }}/{{ .Values.taskdesk.env.database.external.migration.database }}"
  {{- else }}
  value: "postgresql://{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.external.migration.username }}:{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.external.migration.password }}@{{ .Values.taskdesk.env.database.external.migration.host }}:{{ .Values.taskdesk.env.database.external.migration.port }}/{{ .Values.taskdesk.env.database.external.migration.database }}"
  {{- end }}
{{- else }}
- name: TASKDESK_MIGRATION_DATABASE_URL
  {{- if .Values.taskdesk.env.database.external.existingSecret.enabled }}
  value: "postgresql://{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.external.username }}:$(TASKDESK_EXTERNAL_APP_DB_PASSWORD_FOR_MIGRATE_FALLBACK)@{{ .Values.taskdesk.env.database.external.host }}:{{ .Values.taskdesk.env.database.external.port }}/{{ .Values.taskdesk.env.database.external.database }}"
  {{- else }}
  value: "postgresql://{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.external.username }}:{{ include "taskdesk.urlencodeUserinfo" .Values.taskdesk.env.database.external.password }}@{{ .Values.taskdesk.env.database.external.host }}:{{ .Values.taskdesk.env.database.external.port }}/{{ .Values.taskdesk.env.database.external.database }}"
  {{- end }}
{{- end }}
{{- end }}
