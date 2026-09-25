# Kubernetes — the Helm values contract

`charts/taskdesk` is derived from kaneo's chart but rewritten. kaneo's chart also runs a
**single combined image** — nginx serving the web bundle beside the node API, one entrypoint
starting both, one Deployment behind one hostname. What differs is the inside: TaskDesk
serves both bundles from the Node process, selected by `Host` header, with no nginx, so the
chart needs three Ingress hosts and a `TASKDESK_ROLE` split across two Deployments. Written
2026-09-05 because three documents described the chart three incompatible ways.

## Shape

**Corrected, D4 (independent Opus 5.5 delta review of PR #308):** the table below now
describes what `charts/taskdesk` actually renders today, not the target shape the intro
paragraph above still describes (`taskdesk-web`/`taskdesk-jobs` as two Deployments, and a
chart-rendered `Secret`) — that split is unbuilt scope, tracked separately, not part of
issue #296.

| Object | Notes |
| --- | --- |
| `Deployment taskdesk` | One Deployment, `replicas` from `.Values.replicaCount` (default 1), readiness on `/api/public/health/ready`, liveness on `/api/public/health/live`. `TASKDESK_ROLE` is not templated per-replica today — every replica runs `all` unless `taskdesk.env.trustProxy`/`extraEnv` overrides it — so the `web`/`jobs` split `TASKDESK_ROLE` already supports is not yet wired into this chart's values contract |
| `initContainer migrate` | On the `taskdesk` Deployment's own Pod (issue #296, D2 — independent Opus 5.5 delta review of PR #308): runs migrations and the database role/grant bootstrap (`TASKDESK_ROLE=migrate`) under the advisory lock, before the `taskdesk` container starts. It is the ONLY place that ever carries `TASKDESK_MIGRATION_DATABASE_URL` (the owner/superuser credential) — the `taskdesk` container never receives it, and refuses to start if it ever does. A `pre-install` hook Job was tried first and removed: it ran before the chart's own `ServiceAccount` and bundled Postgres existed, so a fresh `helm install` timed out waiting on it — an initContainer has no such ordering problem, since the kubelet guarantees it completes before the Pod's own containers start. Safe with multiple replicas: idempotent under its own advisory lock |
| `Service taskdesk` | Port 5173, in front of the `taskdesk` Deployment |
| `Ingress` | Agent and portal hosts, each with TLS, plus the files host **only** when the cluster serves an operator-owned S3 endpoint (`storage.bundled`); omitted on `storage.filesystem` and on a real S3 bucket |
| `ServiceAccount` | Created by default (`serviceAccount.create: true`); RBAC with named `resourceNames`, no wildcards — an AWS Marketplace requirement too |
| Secrets | **No chart-rendered `Secret` object by default** — every password (`TASKDESK_AUTH_SECRET`, `TASKDESK_ENCRYPTION_KEY`, the application role's password, the owner/migration password) is an inline value in the relevant Pod spec's `env`, the same as this chart's pre-existing convention, unless the operator sets the matching `existingSecret` value (`taskdesk.env.existingSecret`, `encryptionKeyExistingSecret`, `database.appExistingSecret`, `database.external.migration.existingSecret`, or the bundled `postgresql.auth.existingSecret`), in which case that field is read `valueFrom` the operator's own Secret instead. Since PR #296/#308, `TASKDESK_DATABASE_URL` connects as the non-owner application role (`taskdesk_app`); the owner/migration credential is set only on the `initContainer migrate` row above, never on the `taskdesk` container. See [`charts/taskdesk/README.md`](../../charts/taskdesk/README.md) for the exact values (`taskdesk.env.database.app*`, `external.migration.*`) and [configuration-reference.md](configuration-reference.md). An upgrade of an existing install must supply the application role's password. The other two required variables are not secrets and are not duplicated here: `TASKDESK_AGENT_URL` and `TASKDESK_PORTAL_URL` are **templated** as `https://` + `hosts.agent` / `hosts.portal` |

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
