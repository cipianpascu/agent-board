{{/*
Expand the name of the chart.
*/}}
{{- define "agent-board.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "agent-board.fullname" -}}
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
{{- define "agent-board.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "agent-board.labels" -}}
helm.sh/chart: {{ include "agent-board.chart" . }}
{{ include "agent-board.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "agent-board.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agent-board.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "agent-board.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "agent-board.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolve the image reference. digest takes precedence over tag.
*/}}
{{- define "agent-board.image" -}}
{{- if .Values.image.digest }}
"{{ .Values.image.repository }}@{{ .Values.image.digest }}"
{{- else if .Values.image.tag }}
"{{ .Values.image.repository }}:{{ .Values.image.tag }}"
{{- else }}
"{{ .Values.image.repository }}:{{ .Chart.AppVersion }}"
{{- end }}
{{- end }}

{{/*
Secret name for sensitive environment variables.
*/}}
{{- define "agent-board.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "agent-board.fullname" . }}
{{- end }}
{{- end }}
