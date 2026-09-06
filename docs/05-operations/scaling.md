# Scaling

## Where we start

One container, one Postgres, one Valkey — and SeaweedFS only if the S3 profile is enabled;
the shipped default is `storage.filesystem` on a volume. That comfortably serves 100 concurrent
users on 5.5 cores and 5 GiB — half of v1's footprint, because there is one application
process rather than four.

**Do not optimise past this without measurements.** Every scaling mechanism below has a
cost, and paying it before the load exists is how a simple system becomes an operations
burden.

## The order things break

Based on where the pressure actually lands:

```
1. Postgres connections      ← first, and usually the surprise
2. Postgres CPU on reports
3. Node event loop           ← jobs competing with requests
4. Postgres storage
5. Object storage bandwidth
6. WebSocket connections
```

## 1 · Horizontal replicas

```yaml
taskdesk:
  deploy:
    replicas: 3
```

Requires `TASKDESK_VALKEY_URL`, which switches the WebSocket adapter to Valkey pub/sub.
Job leasing already guarantees each scheduled job runs once across the set.

**Watch the connection pool.** Three replicas at a pool of 20 is 60 connections to a
Postgres whose default `max_connections` is 100. This is the most common way adding
replicas makes things *worse*.

Fix: lower the per-replica pool, or introduce PgBouncer in transaction mode.

## 2 · Postgres tuning

The first thing to do, and the cheapest.

```
shared_buffers        = 25% of RAM
effective_cache_size  = 75% of RAM
work_mem              = 16MB      # per sort, per connection — be careful
maintenance_work_mem  = 256MB
max_connections       = 200       # with PgBouncer in front
random_page_cost      = 1.1       # SSD
```

Then:

- `pg_stat_statements` to find the expensive queries.
- `EXPLAIN ANALYZE` before adding an index. Guessing at indexes adds write cost for no
  read benefit.
- `VACUUM`/`ANALYZE` autotuning for high-churn tables — `activity`, `notification`,
  `outbox`.

## 3 · Query patterns

| Problem | Fix |
| --- | --- |
| N+1 on list endpoints | Load related data in one query, or batch |
| Counting large tables | Estimate above 10,000 and say so in the response |
| Deep offset pagination | Already avoided — cursor pagination only |
| Reports over months | Already avoided — `metric_snapshot` for closed periods |
| Full-text on a large corpus | GIN index is in place; consider Meilisearch only if measured |

## 4 · Caching

Valkey, with short TTLs and explicit invalidation.

| Cached | TTL | Invalidated by |
| --- | --- | --- |
| Resolved identity | 30 s | Membership or role change |
| Feature flag resolution | 60 s | Flag change |
| Branding | 5 min | Branding change |
| Queue counts | 30 s | TTL only |
| Service calendar expansion | 1 h | Calendar change |

**Never cache a policy decision.** Reach and authority are resolved per request; that is
what makes revocation immediate. Caching the *identity* is fine; caching the *answer* is
not.

Losing Valkey degrades performance and never loses data.

## 5 · Background jobs

The one real cost of [ADR 0007](../01-architecture/adr/0007-in-process-jobs.md) is that
jobs share the event loop with requests.

Mitigations, in order:

1. Chunk, and `await` between chunks.
2. Push aggregation into SQL.
3. Reduce cadence for expensive jobs.
4. Dedicate a replica to jobs — `TASKDESK_ROLE=jobs` on one replica (scheduler on, not in
   the proxy's backend pool) and `TASKDESK_ROLE=web` on the rest (scheduler off). This is
   the escape hatch; it needs a switch, not a code change, and the switch exists
   ([configuration-reference.md](configuration-reference.md)).

Monitor `taskdesk_nodejs_eventloop_lag_seconds`. Sustained lag above 100 ms means step 4.

## 6 · Object storage

Attachments are uploaded and downloaded **directly** via presigned URLs, so bytes never
pass through the application. This is why storage scales independently.

**One exception, stated plainly:** the `storage.filesystem` backend — the single-node
profile small customers run — has no presigned URLs, so bytes stream through the API with
a bounded, back-pressured path and the same size limit. That profile is explicitly not the
one this section is about; a deployment that outgrows it moves to an S3-compatible backend.

At volume: a CDN in front of the files origin, and lifecycle rules moving old objects to
infrequent-access tiers.

## 7 · WebSockets

Each connection costs memory and a file descriptor. Limits already in place: five sockets
per person, fifty subscriptions per socket, idle close after five minutes.

At several thousand concurrent connections, raise the file descriptor limit and add
replicas. Sticky sessions are not needed — the Valkey adapter fans out across replicas.

## What we will not do preemptively

| Not doing | Until |
| --- | --- |
| Read replicas | Read load measurably exceeds one Postgres |
| Sharding | Far beyond any plausible scale for us |
| Separate worker service | Event loop lag proves the need |
| Elasticsearch / Meilisearch | Postgres full-text is measured to be insufficient |
| Multi-region | A customer requires it contractually |
| Kubernetes as primary | Compose stops being enough |

Each of these is a real answer to a real problem we do not yet have.

## Capacity planning

| Users | Shape |
| --- | --- |
| ≤ 100 | 1 replica, 2 cores, 4 GiB. The default |
| ≤ 500 | 2 replicas, Valkey, tuned Postgres, 8 GiB |
| ≤ 2,000 | 3–4 replicas, PgBouncer, dedicated Postgres host, 16 GiB |
| > 2,000 | Measure, then decide. Do not extrapolate this table |

## Load testing

k6, before each release, with results recorded so regression is visible.

| Scenario | Target |
| --- | --- |
| 100 concurrent browsing | p95 < 500 ms |
| 50 concurrent board views | p95 < 800 ms |
| 1,000 creations per minute | No errors |
| SLA scan over 100,000 items | < 60 s |
| 500 concurrent WebSockets | Stable |

## Related

- [Deployment](deployment.md) · [Observability](../01-architecture/observability.md)
- [Background jobs](../01-architecture/background-jobs.md) · [Runbook](runbook.md)
