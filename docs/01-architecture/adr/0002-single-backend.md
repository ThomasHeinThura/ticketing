# 0002 — One backend, not three

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

TaskDesk v1 ran three backend services:

| Service | Language | Role |
| --- | --- | --- |
| `core-api` | .NET 10 / ASP.NET Core | System of record, all persistence, domain rules |
| `bff` | Node 20 / Express | Session handling, view aggregation, WebSocket gateway |
| `worker` | Go 1.26 | SLA scanning, snapshot computation, Valkey pub/sub |

Its own ADR 0001 argued for keeping them. In practice the split cost:

- **Three languages** — three dependency ecosystems, three build pipelines, three sets of
  idioms, three places a contributor must be competent.
- **Service-to-service authentication** between BFF and core-api, using a gateway service
  account with a `x-user-email` header trusted only for that client. This is a bespoke
  security mechanism that had to be designed, documented and defended.
- **Duplicated types** across the boundary, kept in sync by hand.
- **A BFF that did almost nothing** except hold secrets and reshape responses.
- **A worker that polled its own API** rather than reading the database, because it was in
  a different language.

Meanwhile kaneo's single Hono API already contains `croner` for scheduling and a
`job_lease` table for distributed locking — the exact capability the Go worker provided.

## Decision

**One backend: `apps/api`, Hono on Node, TypeScript.**

- The BFF role is absorbed. Hono *is* the backend-for-frontend: it owns the session,
  queries the database directly, and shapes responses for the UI.
- The worker role is absorbed. Background work runs in-process, scheduled by `croner`,
  made replica-safe by the `job_lease` table. See [ADR 0007](0007-in-process-jobs.md).
- v1's .NET domain logic — the SLA engine, workflow engine, approvals, assignment rules,
  service calendars — is **reimplemented** in TypeScript in `packages/domain` as pure,
  I/O-free functions.

Supporting services remain separate processes because they are off-the-shelf: PostgreSQL,
Valkey, SeaweedFS, Traefik, and optionally Keycloak.

## Consequences

### Positive

- **One language end to end.** Types flow from the Drizzle schema through Zod schemas to
  the Hono client to React, and a server change breaks the client build.
- **No service-to-service authentication to design.** The trust boundary is the browser,
  not an internal hop.
- **One deployment artefact.** One image, one version, one rollback.
- **The domain layer becomes testable.** Pure functions with no I/O can be exhaustively
  unit-tested, which matters because they encode the rules the business cares about.
- **Debugging is a single stack trace**, not a correlation exercise across three log
  streams.
- Far lower barrier for a small team and AI agents to work productively.

### Negative

- **The event loop is shared between requests and jobs.** A badly written job can add
  latency to requests. Mitigated by chunking, yielding between batches, and pushing
  aggregation into SQL — but it is a real constraint that a separate worker would not
  have.
- **No language-level isolation.** A memory leak or crash in job code takes the API with
  it. Mitigated by process supervision and by the fact that a crash releases job leases
  within one TTL.
- **We lose .NET's strengths** for CPU-bound work. None of our workload is CPU-bound;
  it is database-bound. If that changes we will have evidence rather than speculation.
- **Rewriting v1's domain logic costs real time** and risks reintroducing bugs v1 already
  fixed. Mitigated by reading v1's tests as a specification and porting them first.

### Neutral

- Horizontal scaling is by running more replicas of the same image. Job leasing and
  Valkey-backed WebSocket fan-out already support this.
- If a workload later genuinely needs isolation, extracting a worker from a well-factored
  `jobs/` directory is a contained change. We are not painting ourselves into a corner,
  we are declining to pay for a room we do not use.

## Alternatives considered

**Keep the .NET core-api, put Hono in front.** Rejected. It preserves the worst part —
two languages and a service boundary with bespoke auth — while adding a third stack.

**Keep the Go worker only.** Rejected. Its entire function is covered by `croner` plus
`job_lease`, and keeping it means keeping a second language and a second deployment for
maybe 800 lines of scheduling code.

**Move to a serverless/function architecture.** Rejected. We deploy on customer
infrastructure and on-premises; a single container behind Traefik is the requirement.

**Modular monolith with enforced package boundaries.** Accepted, in fact — that is
precisely what this is. `packages/domain`, `packages/permissions` and the API feature
folders are enforced module boundaries inside one process. We get the discipline of
services without the distribution.

## Related

- [Architecture overview](../overview.md)
- [ADR 0007 — in-process jobs](0007-in-process-jobs.md)
- [ADR 0009 — lazy SLA evaluation](0009-lazy-sla-evaluation.md)
