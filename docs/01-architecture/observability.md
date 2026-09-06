# Observability

v1 shipped without tracing and regretted it — "the four worst defects were invisible to
green tests". Observability is built in from Phase 0, not retrofitted.

## The three signals

| Signal | Tool | Purpose |
| --- | --- | --- |
| **Logs** | Pino → stdout, JSON | What happened |
| **Metrics** | Prometheus at `/metrics` | How much, how fast, how often |
| **Traces** | OpenTelemetry (optional exporter) | Where the time went, across a request |

All three carry the same `traceId`, so an error report from a user can be pivoted to the
exact request, its spans and its log lines.

## Logging

Structured JSON to stdout. The container runtime collects it; the application never
writes log files.

```json
{
  "level": "info",
  "time": "2026-09-05T10:14:22.113Z",
  "traceId": "01J8XQ…",
  "spanId": "a3f1…",
  "actorId": "usr_…",
  "organisationId": "org_…",
  "route": "PATCH /api/work-items/{key}",
  "status": 200,
  "durationMs": 42,
  "msg": "work item updated"
}
```

Levels: `error` (needs a human), `warn` (degraded but handled), `info` (state changes and
requests), `debug` (off in production).

**Never logged:** passwords, tokens, API keys, plugin secrets, session cookies, request
bodies containing custom field values, attachment contents. A redaction list is
configured in Pino and covered by a test that throws known secret patterns at the logger
and asserts they do not appear in output.

Log level is configurable at runtime in God Mode, per module, so debugging production
does not require a restart.

## Metrics

Prometheus exposition at `/metrics`, guarded by a bearer token configured in God Mode →
Observability, compared in constant time. Business metrics carry `{project, organisation}`
labels — a cross-tenant inventory — so the token is treated as a secret and, where the
operator can, `/metrics` is bound to a separate **internal listener on port 9464** (fixed,
never published, never an environment variable — the runbook's `curl` targets it) not
exposed through Traefik. The bearer token grants `/metrics` alone — it does **not** read
`/api/instance/health/deep`, which is `instance:admin` only (decision log 2026-09-06). Log
redaction is an **allowlist** — the log line serialises named fields only — because a
denylist of secret patterns cannot catch a field nobody anticipated.

**HTTP**
```
taskdesk_http_requests_total{route,method,status}
taskdesk_http_request_duration_seconds{route,method}   histogram
taskdesk_http_in_flight
```

**Business** — the ones that actually get looked at
```
taskdesk_work_items_open{project,priority}
taskdesk_sla_state{project,state}                      ok|at_risk|breached
taskdesk_intake_pending
taskdesk_approvals_pending
taskdesk_portal_sessions_active
taskdesk_auth_reload_total{outcome}                    ok|failed — auth configuration reloads per replica
taskdesk_auth_config_version                            the auth config_version each replica serves
```

**Jobs**
```
taskdesk_job_runs_total{job,outcome}
taskdesk_job_duration_seconds{job}                     histogram
taskdesk_job_last_success_timestamp{job}
taskdesk_outbox_pending
taskdesk_outbox_dead
```

**Infrastructure**
```
taskdesk_db_pool_{active,idle,waiting}
taskdesk_db_query_duration_seconds{operation}          histogram
taskdesk_ws_connections
taskdesk_plugin_health{plugin_id}                      1 healthy, 0 failing
taskdesk_nodejs_eventloop_lag_seconds
```

## Tracing

OpenTelemetry, off unless an exporter is configured in God Mode (OTLP endpoint, headers,
sample rate). Auto-instrumentation covers Hono, `pg` and `ioredis`; we add manual spans
for domain operations that matter:

```
PATCH /api/work-items/SUP-1234
├── auth.resolve-session                    2 ms
├── identity.resolve                        4 ms   (cache miss)
├── policy.evaluate                         1 ms
├── db.work_item.load                       6 ms
├── domain.workflow.validate-transition     0 ms   ← pure, always fast
├── domain.sla.compute                      1 ms
├── db.work_item.update                     9 ms
├── db.activity.insert                      3 ms
├── events.emit                             2 ms
│   ├── outbox.enqueue                      1 ms
│   └── ws.broadcast                        1 ms
└── response.serialize                      1 ms
                                    total  29 ms
```

Sampling: 100% of errors, 100% of requests slower than 1 s, 1% of the rest.

## Health endpoints

| Endpoint | Meaning | Used by |
| --- | --- | --- |
| `/api/public/health/live` | The process is running | Container liveness. Anonymous |
| `/api/public/health/ready` | Database reachable, migrations applied | Load balancer readiness. Anonymous |
| `/api/instance/health/deep` | Also checks Valkey, storage, SMTP, each plugin, backups | God Mode dashboard, monitoring. **`instance:admin` only** (the metrics token does not grant it) — it enumerates every dependency, which is reconnaissance if anonymous |

`live` never touches a dependency — a liveness probe that fails when Postgres blips will
restart a healthy container and make an outage worse.

## Errors

Sentry, configured in God Mode rather than only by environment variable, with:

- Release tagged to the build's git SHA, so a regression points at a commit.
- `traceId` attached, linking to logs and traces.
- PII scrubbed before send.
- The user's organisation as a tag, so "is this one customer or everyone?" is one click.

Frontend errors are captured too, with source maps uploaded at build time and **not**
served publicly.

## Frontend performance

Real user monitoring for Core Web Vitals, reported to the API and aggregated:

| Metric | Budget |
| --- | --- |
| LCP | < 2.5 s p75 |
| INP | < 200 ms p75 |
| CLS | < 0.1 p75 |
| Board render, 200 items | < 500 ms |
| Route transition | < 300 ms |

These are also asserted in CI against a seeded dataset, so a regression fails a pull
request rather than being discovered by a user. See
[UX quality gates](../02-design/ux-quality-gates.md).

## Dashboards

Shipped as Grafana JSON in `deploy/observability/dashboards/`:

1. **Service health** — request rate, error rate, latency percentiles, saturation.
2. **Business** — open work items, SLA states, intake depth, pending approvals.
3. **Jobs** — last success per job, durations, outbox depth.
4. **Database** — pool, slow queries, table sizes, index hit ratio.
5. **Frontend** — Web Vitals by route.

## Alerts

Starting set. Every alert must be actionable; anything that fires and is routinely
ignored gets deleted rather than muted.

| Alert | Condition | Severity |
| --- | --- | --- |
| API down | `/health/ready` failing 2 min | Page |
| Error rate | 5xx > 1% over 5 min | Page |
| Latency | p95 > 2 s over 10 min | Warn |
| Job stalled | `job_last_success` > 3× cadence | Page |
| Outbox backing up | `outbox_pending` rising 15 min | Warn |
| Outbox dead letters | `outbox_dead` > 0 | Warn |
| DB pool exhausted | `db_pool_waiting` > 0 for 5 min | Page |
| Plugin unhealthy | `plugin_health == 0` for 10 min | Warn |
| Disk | > 85% | Warn |
| Certificate expiry | < 14 days | Warn |

## Audit versus logging

They are different and must not be conflated.

| | Audit log | Application log |
| --- | --- | --- |
| Lives in | Postgres `audit_log` | stdout |
| Purpose | Answer "who changed what" under scrutiny | Debug the system |
| Retention | 12 months, configurable | Whatever the collector keeps |
| Mutable | Never | N/A |
| Contains PII | Yes, deliberately | No, deliberately |

## Related

- [Background jobs](background-jobs.md) · [Security model](security-model.md)
- [Runbook](../05-operations/runbook.md)
