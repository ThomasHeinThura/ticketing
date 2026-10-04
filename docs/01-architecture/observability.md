# Observability

v1 shipped without tracing and regretted it — "the four worst defects were invisible to
green tests". Observability is built in from Stage 0, not retrofitted.

## The three signals

| Signal | Tool | Purpose |
| --- | --- | --- |
| **Logs** | Pino → stdout, JSON | What happened |
| **Metrics** | Planned: Prometheus at `/metrics` | How much, how fast, how often |
| **Traces** | OpenTelemetry (optional exporter) | Where the time went, across a request |

Application request logs and trace spans share a server-generated `traceId`. Ordinary
Prometheus series do not: trace ids are unbounded and must never be metric labels. A future
tracing integration may use exemplars for metric-to-trace navigation; that is not part of
P0 acceptance.

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

Every record is constructed from an explicit typed field allowlist. Do not pass raw request,
response, header, body, error, cookie, or plugin-configuration objects to the logger. Route
labels use the registered route template, never a raw URL or query. Pino redaction is a
second layer of defence; a test that throws known secret patterns at the logger supplements
the allowlist and does not define it.

**Never logged:** passwords, tokens, API keys, plugin secrets, session cookies, request
bodies containing custom field values, attachment contents, or arbitrary exception text.

Log level is configurable at runtime in God Mode, per module, so debugging production
does not require a restart.

HTTP server lifecycle failures use the fixed `http.lifecycle_failure` message, module
`http`, level `error` and result `failed`. This covers startup, graceful HTTP close and
forced connection close failures. The lifecycle helper accepts no error or context argument;
it emits no request route, duration, identifier, configuration, payload or exception text.
It does not alter propagation, shutdown deadlines, forced-close decisions or completion.
Structural and injected-failure regressions must reject raw exception serialization in the
API server lifecycle; successful startup/shutdown messages may remain finite informational
text. Realtime failures continue to use `realtime.failure`.


## P0 metrics contract (candidate implementation; not accepted runtime)

P0 starts with bounded HTTP request metrics and the audit-write-failure counter below. The
broader business, job, and infrastructure catalogue remains a target for later producer-by-
producer work; it is not a P0 completeness claim. Application metric names and finite label
values are registered here before implementation. Route labels use normalized registered
templates; method values use `GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|OTHER`; status values
are the five finite classes `1xx|2xx|3xx|4xx|5xx`. Never label by raw path, query,
project/organisation/person identifiers or names, token, exception, actor, or trace id.

Prometheus exposition is `GET /metrics`, guarded by a bearer token configured through the
administrator API in God Mode and compared in constant time. The metrics-only Node listener
binds on the container network interface at fixed internal port **9464** and is not
published to the host or exposed through Traefik. It has no API, health, OpenAPI,
static-file, or authentication mount. The
token grants `/metrics` alone and never reads `/api/instance/health/deep`, which is
`instance:admin` only (decision log 2026-09-06).

The listener accepts only exact `GET /metrics` with no query. `HEAD`, `OPTIONS`, and other
methods on that path return `405`; other paths return `404`. A valid scrape returns only
registered Prometheus metrics. The listener starts only in serving role after the safe
observability configuration has loaded and validated; a bind failure prevents readiness.
Shutdown closes it with the API server. Migration and job roles do not open the listener.

The token is exactly 32 random bytes from the Node cryptographic random generator, shown as
an unpadded 43-character base64url value once after successful rotation. Store only its
32-byte SHA-256 digest and rotation timestamp; there is no plaintext, prefix, previous-token
grace, or token export. The bearer must decode from exactly 43 unpadded base64url characters
to 32 bytes; compare fixed-length SHA-256 digests with `timingSafeEqual`. Malformed bearer
values follow the same denial path as a wrong value. A scrape reads the current digest from
PostgreSQL without a credential cache. A scrape whose credential read starts after a
rotation commits rejects the previous token; a scrape authorized before commit may finish.
Credential read failures return `503` without exposition. Missing, malformed, and wrong
credentials share a generic `401` response. These credentials do not authorize any API
operation.

The P0 administrator surface is `GET /api/instance/observability`,
`PATCH /api/instance/observability`, and
`POST /api/instance/observability/metrics-token/rotate`. GET returns only safe settings;
PATCH changes log levels with an optimistic version; rotation returns the token once and
requires fresh session-only operation-bound step-up. The route registry, OpenAPI schemas,
permission matrix, and implementation tests must agree. The candidate includes the `/god-mode/observability` screen for log levels, local-factor policy, and metrics-token rotation; browser evidence and integrated acceptance remain pending.

Per-module levels are a closed document with `default` and `modules` only. Initial module
keys are `http`, `auth`, `database`, `jobs`, `audit`, `plugins`, and `realtime`; each level is one of
`error`, `warn`, `info`, or `debug`. All modules start at `info`, which keeps production
debug logging off. Validate on write and when reading persisted settings; invalid persisted
shape prevents readiness. Serving replicas refresh the complete validated snapshot at most
every five seconds and apply it atomically. A transient refresh failure keeps the last known
non-secret levels, emits one bounded warning per failure interval, and retries. The metrics
credential is never cached.

The P0 candidate enables Better Auth `twoFactor` for local TOTP and backup-code verification
and implements password proof only for the documented account class with no enrolled or
required second factor. It does not implement a fresh Entra `prompt=login` step-up callback.
Token rotation therefore remains unusable for account classes whose required factor cannot
be verified. Such a request fails closed with `403 step_up_unavailable`; implementation must
not substitute a session-only check, sign-in email OTP, or client assertion of successful
re-authentication.

**Current status:** the accepted runtime has not yet implemented `/metrics`, the port 9464
listener, or a metrics bearer token. The current P0 candidate implements the schema/API,
listener lifecycle, local-factor foundations, and bounded HTTP/audit metrics; those candidate
changes remain under review and are not deployed or accepted as complete until the full runtime,
image, and browser gates pass. The metric names below are a candidate contract, not evidence
that the accepted runtime serves them.
Until implementation and verification, use the container, database and application logs in
the [runbook](../05-operations/runbook.md).

The finite structured log `msg` values are `http.request`, `http.lifecycle_failure`, `auth.failure`,
`database.failure`, `jobs.failure`, `audit.write_failure`, `plugins.failure`,
`realtime.failure`,
`observability.config_refresh_failure`, and `observability.listener_bind_failure`.
Callers cannot supply arbitrary message text. The `route` field uses an actual registered
method-and-template pair; a request that cannot be matched is recorded as the finite `unmatched`
bucket rather than its raw path.

**HTTP**
```
taskdesk_http_requests_total{route,method,status}
taskdesk_http_request_duration_seconds{route,method}   histogram
taskdesk_http_in_flight
taskdesk_audit_write_failures_total{operation}
```

`operation` is a closed label enum: `mutation`, `pending_action_decision`,
`pending_action_self_read`, or `audit_read`. Do not add route, id, actor, exception text, or
trace id labels. `audit_read` covers the best-effort AU-13 audit-row append after an audit-log
read; it is separate from pending-action self-read auditing.
The counter increment and its safe error-level log line happen outside any rolled-back audit
savepoint. They do not change AU-14's successful mutation behavior or the separately
fail-closed pending-action self-read contract. A positive five-minute increase is an urgent,
page-worthy alert for the affected instance. Background pending-action expiry groups the
administrator notification and safe log by degraded batch while counting every failed append.

The counter and durable administrator notification are implemented in the current candidate;
the integrated image/runtime and independent review gates are still pending. A positive
five-minute increase is an urgent, page-worthy alert for the affected instance.

**Business** — instance-wide aggregate targets, never per-tenant or per-resource series
```
taskdesk_work_items_open{priority}                     priority: low|medium|high|urgent
taskdesk_sla_state{state}                              state: ok|at_risk|breached
taskdesk_intake_pending
taskdesk_approvals_pending
taskdesk_portal_sessions_active
taskdesk_auth_reload_total{outcome}                    ok|failed — auth configuration reloads per replica
taskdesk_auth_config_version                            the auth config_version each replica serves
```

`work_items_open` and `sla_state` are instance-wide aggregates. They contain no project or
organisation series. `priority` is the closed enum in [data-model.md](data-model.md); the
SLA state values are the finite values shown above. All names in this broader catalogue are
targets, not evidence of live producers.

**Withheld job metrics**

Do not implement the current target shapes `taskdesk_job_runs_total{job,outcome}`,
`taskdesk_job_duration_seconds{job}`, or
`taskdesk_job_last_success_timestamp{job}` until
[background-jobs.md](background-jobs.md) registers a finite,
configuration-independent job enum. `outcome` is limited to `ok|failed` where used. An
`other` bucket is permitted only if that owner document explicitly defines it. Scalar
outbox gauges have no job label:

```
taskdesk_outbox_pending
taskdesk_outbox_dead
```

**Infrastructure** — bounded scalar targets
```
taskdesk_db_pool_{active,idle,waiting}
taskdesk_ws_connections
taskdesk_nodejs_eventloop_lag_seconds
```

Do not implement the target shape `taskdesk_db_query_duration_seconds{operation}` until
the query owner enumerates a finite, configuration-independent operation set; an `other`
bucket is allowed only if that owner specifies it. Do not implement
`taskdesk_plugin_health{plugin_id}`: `plugin_id` can identify a customer-configured plugin
instance. A separate owner-reviewed metric contract must replace that shape with finite,
privacy-safe aggregation before instrumentation.

Every Prometheus label in the P0 core and later catalogue must come from a documented finite
enum or the finite registered HTTP route-template set. A label may never contain a tenant,
organisation, project, person, work-item, resource, credential, plugin-instance id/name/key,
user-controlled text, raw path/query, trace id, or exception. A producer whose useful
dimensions cannot meet this rule remains withheld until its owner specifies a safe finite
aggregation and a retention/cardinality test. The internal bearer is still required because
aggregate cross-tenant operating data is sensitive.

## Tracing

OpenTelemetry is deferred beyond the P0 core. If implemented later, it is off unless an
exporter is configured in God Mode (OTLP endpoint, headers, sample rate). Auto-instrumentation
covers Hono, `pg` and `ioredis`; we add manual spans
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
| `/api/public/health/ready` | Database reachable, migrations applied; after observability settings ship, safe settings loaded and validated | Load balancer readiness. Anonymous |
| `/api/instance/health/deep` | Planned dependency and plugin diagnostics; not currently served |

`live` never touches a dependency — a liveness probe that fails when Postgres blips will
restart a healthy container and make an outage worse.

## Errors (deferred)

The intended error reporting uses Sentry, configured in God Mode rather than only by
environment variable, with:

- Release tagged to the build's git SHA, so a regression points at a commit.
- `traceId` attached, linking to logs and traces.
- PII scrubbed before send.
- The user's organisation as a tag, so "is this one customer or everyone?" is one click.

**Current status:** the application does not include Sentry reporting or frontend source-map
upload. These are planned behaviors.

## Frontend performance (deferred)

P0 has no RUM client and no public ingestion endpoint. A future RUM contract must first
specify its route policy, bounded payload, PII handling, and retention before browser
reporting is implemented. The currently discussed target budgets are:

| Metric | Budget |
| --- | --- |
| LCP | < 2.5 s p75 |
| INP | < 200 ms p75 |
| CLS | < 0.1 p75 |
| Board render, 200 items | < 500 ms |
| Route transition | < 300 ms |

**Current status:** the app does not report these measurements, and the performance-budget
CI job is not enabled. These target budgets are not current CI gates. See
[UX quality gates](../02-design/ux-quality-gates.md).

## Dashboards (deferred)

The following are target Grafana dashboard panels. No dashboard JSON is currently shipped;
the panels depend on instrumentation that is also planned.

1. **Service health** — request rate, error rate, latency percentiles, saturation.
2. **Business** — instance-wide aggregate open work items by priority, SLA states, intake depth, pending approvals.
3. **Jobs** — only scalar outbox depth is currently dimension-safe; last-success and duration panels are blocked until the job owner registers a finite job enum.
4. **Database** — pool, slow queries, table sizes, index hit ratio; per-operation duration is blocked until the query owner registers finite operation labels.
5. **Frontend** — deferred Web Vitals by route; no P0 RUM ingestion exists.

## Alerts

The audit failure alert is implemented in the current candidate with a durable instance
notification to currently-authorized administrators; integrated runtime and review gates are
still pending. The remaining conditions are candidates for later monitoring work. Every alert
must be actionable; anything that fires and is routinely ignored gets deleted rather than
muted.

| Alert | Condition | Severity |
| --- | --- | --- |
| Audit write failures | `increase(taskdesk_audit_write_failures_total[5m]) > 0` | Urgent / Page |
| API down | `/api/public/health/ready` failing 2 min | Page |
| Error rate | 5xx > 1% over 5 min | Page |
| Latency | p95 > 2 s over 10 min | Warn |
| Job stalled | Blocked until a finite, configuration-independent job label contract exists; then evaluate last-success against 3× cadence | Deferred |
| Outbox backing up | `outbox_pending` rising 15 min | Warn |
| Outbox dead letters | `outbox_dead` > 0 | Warn |
| DB pool exhausted | `db_pool_waiting` > 0 for 5 min | Page |
| Plugin unhealthy | Blocked until a finite, privacy-safe plugin-health aggregation contract exists | Deferred |
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
