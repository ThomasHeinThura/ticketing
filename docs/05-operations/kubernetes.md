# Kubernetes — the Helm values contract

`charts/taskdesk` is derived from kaneo's chart but rewritten: kaneo ships separate `api`
and `web` images, this product ships one image serving two bundles by `Host` header. Written
2026-09-05 because three documents described the chart three incompatible ways.

## Shape

| Object | Notes |
| --- | --- |
| `Deployment taskdesk-web` | `TASKDESK_ROLE=web`, `replicas` ≥ 1, readiness on `/api/public/health/ready`, liveness on `/live` |
| `Deployment taskdesk-jobs` | `TASKDESK_ROLE=jobs`, exactly 1 replica |
| `Service taskdesk` | Port 5173, in front of `taskdesk-web` only |
| `Ingress` | Three hosts — agent, portal, files — each with TLS; the files host points at the storage Service or is omitted when a real S3 bucket is used |
| `ServiceAccount` | Created by default (`serviceAccount.create: true`); RBAC with named `resourceNames`, no wildcards — an AWS Marketplace requirement too |
| `Secret` | `existingSecret` (recommended) or generated on first install; holds the five bootstrap variables |
| `Job taskdesk-migrate` | Optional pre-upgrade hook; by default the entrypoint migrates under the advisory lock |

## `values.yaml` contract

```yaml
image:
  repository: ghcr.io/<org>/taskdesk
  tag: ""            # defaults to appVersion; a digest may be given instead
  digest: ""
  pullPolicy: IfNotPresent
hosts:
  agent: ticket.example.com
  portal: portal.example.com
  files: files.example.com          # "" to disable the files Ingress
tls:
  issuer: letsencrypt               # cert-manager ClusterIssuer, or "" for pre-provisioned secrets
web:
  replicas: 2
  resources: { requests: { cpu: 500m, memory: 512Mi }, limits: { cpu: "2", memory: 1536Mi } }
jobs:
  enabled: true
  resources: { requests: { cpu: 250m, memory: 512Mi }, limits: { cpu: "1", memory: 1024Mi } }
secrets:
  existingSecret: ""                # name of a Secret with TASKDESK_DATABASE_URL, TASKDESK_ENCRYPTION_KEY, TASKDESK_AUTH_SECRET
postgres:
  external: { url: "" }             # use a managed database…
  bundled: { enabled: false }       # …or the bundled bitnami-style chart for evaluation only
valkey:
  external: { url: "" }
  bundled: { enabled: true }
storage:
  bundled: { enabled: true }        # SeaweedFS for evaluation; production uses S3 configured in God Mode
serviceAccount:
  create: true
  annotations: {}                   # IRSA role ARN goes here on EKS
podSecurityContext: { runAsNonRoot: true, runAsUser: 10001, readOnlyRootFilesystem: true }
```

## Rules

- **Image references appear only in `values.yaml`**, templated everywhere else — an AWS
  Marketplace validation rule as well as good practice.
- `helm lint` and `helm template` pass in the fast CI stage; the chart is packaged and
  pushed as an OCI artefact next to the image on release ([ci-cd.md](../04-engineering/ci-cd.md)).
- Parity with Compose: every bootstrap variable and every hostname has exactly one
  corresponding value; there is no Kubernetes-only configuration.
- Rolling updates: `maxUnavailable: 0` on `taskdesk-web`; the jobs Deployment uses
  `Recreate` (one replica, lease-safe).

## Related

- [Deployment](deployment.md) · [Container image](container-image.md) · [AWS Marketplace listing](aws-marketplace.md)
