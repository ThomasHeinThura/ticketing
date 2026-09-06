# Risks

Ordered by expected damage. Reviewed at every phase close.

**Likelihood** and **impact**: low / medium / high.

---

## R1 · v2 repeats v1's UX failure

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **Critical** — the project ends |
| Owner | Thomas |

**Why it could happen.** Every pressure in a project pushes toward breadth. A gate that
blocks a merge on a spacing inconsistency feels absurd at 6pm on a Friday. Waivers
accumulate. Six months later the interface is inconsistent again and nobody can point at
the moment it happened.

**Mitigations**

- Gates are **automated**, not review-based — a tired person cannot skip a lint rule
- kaneo is the specification, so there is a concrete answer to "is this right?"
- No bespoke primitives, enforced by CI
- Only Thomas may waive a gate; agents may not
- A waiver without a linked follow-up issue is not a waiver

**Early warning:** waivers in consecutive pull requests; H1 answered as "close enough".

---

## R2 · Phase discipline collapses

| | |
| --- | --- |
| Likelihood | **High** |
| Impact | **High** |
| Owner | Thomas |

**Why it could happen.** This is the most likely failure. Starting P3 while P2 is at 90%
feels efficient and is how v1 ended up with twenty-five half-finished screens.

**Mitigations**

- A phase gate with a written review, including what went wrong
- The screen inventory makes incompleteness visible
- [Product principle 7](../00-overview/product-principles.md), stated so it can be pointed
  at

**Early warning:** work in flight for two phases at once; a phase review skipped "to save
time".

---

## R3 · Porting v1's domain logic reintroduces bugs v1 already fixed

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **High** |
| Owner | Whoever ports it |

**Why it could happen.** The SLA engine, workflow engine and approval rules encode years
of edge cases. A fresh TypeScript implementation will rediscover them the hard way.

**Mitigations**

- **Read v1's tests as a specification and port them first**, before the implementation
- Exhaustive unit tests: DST, holidays, pauses, reopen, policy versions
- The list of v1's known defects is recorded in
  [error-fix-loop.md](../04-engineering/error-fix-loop.md) and each has a named test

---

## R4 · Authorization holes, again

| | |
| --- | --- |
| Likelihood | **Low** |
| Impact | **Critical** |
| Owner | Thomas |

**Why it could happen.** v1 shipped eleven, past a green test suite and a review process.

**Mitigations**

- Route policy coverage test — a route without a policy fails the build
- Permission matrix test with a checked-in fixture
- Named negative E2E tests, one per v1 defect
- Reach/authority separation enforced by the type system
- 404-not-403 for out-of-reach
- Separate, narrow portal API router

**Residual:** policy coverage proves a check *exists*, not that it is *correct*. Hence the
layered controls, and an external penetration test in P7.

---

## R5 · Runtime plugin configuration is harder than expected

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **High** |
| Owner | Thomas |

**Why it could happen.** better-auth is configured at construction. Rebuilding it when
providers change, swapping it behind a stable reference, and propagating that across
replicas is the most delicate code in the system. A subtle bug here locks people out.

**Mitigations**

- Disproportionate test coverage on the rebuild path
- `auth.password` cannot be removed
- `test()` before a provider goes live
- Documented CLI break-glass
- Prototype this early in P3, not late

---

## R6 · AGPL blocks a commercial path

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **High** |
| Owner | Thomas |
| **Deadline** | **Before the first external contribution is merged** |

**Why it could happen.** Some enterprises refuse AGPL on policy, without analysis. A
proprietary or dual-licensed edition later requires a CLA from every contributor — and
retrofitting one means tracking people down or rewriting their work.

**Mitigation:** decide now whether a dual licence is wanted. If it might be, adopt a CLA
before accepting any external contribution. See
[ADR 0005](../01-architecture/adr/0005-agpl-licensing.md).

---

## R7 · Three agents produce three inconsistent codebases

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **Medium** |
| Owner | Thomas |

**Mitigations**

- A fixed vocabulary: `packages/ui`, feature folders, fetchers, query hooks
- CI rejects invention
- Specs before code
- One agent per branch, never two
- Cross-agent review — a different agent reviews than wrote

**Early warning:** two components doing the same thing; two ways of fetching data.

---

## R8 · Scope creep from four inspiration sources

| | |
| --- | --- |
| Likelihood | **High** |
| Impact | **Medium** |
| Owner | Thomas |

**Why it could happen.** kaneo, Plane, OpenProject, Jira Service Management and v1 between
them have hundreds of features. Each individually looks small.

**Mitigations**

- Phase scope is fixed at phase start
- Feature specs have an explicit **Out of scope** section
- The roadmap's "candidates, not commitments" list is where good ideas go to wait
- Feature flags mean an unbuilt feature costs nothing

---

## R9 · In-process jobs starve request handling

| | |
| --- | --- |
| Likelihood | **Low** |
| Impact | **Medium** |
| Owner | Thomas |

The accepted cost of [ADR 0007](../01-architecture/adr/0007-in-process-jobs.md).

**Mitigations:** chunking, yielding, SQL-side aggregation, an event-loop lag metric with an
alert, and a documented escape hatch — a job-only replica, requiring no code change.

---

## R10 · Bus factor of one

| | |
| --- | --- |
| Likelihood | **High** |
| Impact | **High** |
| Owner | Thomas |

**Why it could happen.** One human. If Thomas is unavailable, nothing merges, no design is
approved, no waiver is granted.

**Mitigations**

- This documentation corpus exists partly for this reason — everything is written down
- ADRs record *why*, not just *what*
- The agent workflow document lets a new person or agent start cold

**Residual:** genuinely unmitigated for approval authority. Accepted for now; revisit if
the project becomes business-critical.

---

## R11 · Import loses or corrupts history

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **Medium** |
| Owner | Whoever runs the import |

**Mitigations:** dry-run first, `import_mapping` for idempotency, provenance links to the
source, rehearsal against copies, a verification checklist, and the source systems kept
read-only rather than deleted for a period after cutover.

---

## R12 · Backups are not actually restorable

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **Critical** |
| Owner | Thomas |

**Why it could happen.** v1's go-live checklist recorded that the scheduled backup had
never completed and offsite was unset. This is the single most common operational failure
in small projects.

**Mitigations**

- **Monthly restore drill**, with a written record
- The backup script verifies the dump is restorable before uploading
- The restore checklist explicitly covers plugin secrets, which is what a naive test misses
- God Mode warns when no backup has been recorded in 48 hours

---

## R13 · Encryption key lost

| | |
| --- | --- |
| Likelihood | **Low** |
| Impact | **High** |
| Owner | Thomas |

Data survives; every plugin secret must be re-entered by hand.

**Mitigations:** the key is stored in a password manager separate from backups; the restore
checklist tests secret decryption explicitly.

---

## R14 · kaneo diverges and we miss important fixes

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **Low** |
| Owner | Thomas |

The accepted cost of [ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md).

**Mitigation:** a quarterly review of kaneo's changelog, with anything relevant
cherry-picked deliberately.

---

## R15 · Workstream A cannot finish inside the accelerated window

| | |
| --- | --- |
| Likelihood | **High** |
| Impact | **High** |
| Owner | Thomas |

The service-desk domain port (SLA, lifecycle engine, approvals) is the critical path of
[accelerated-delivery-plan.md](accelerated-delivery-plan.md) and the least compressible
work in it. **Mitigations:** named as such on day one; go-live scope narrows *or* the date
moves — a deliberate choice, never a silent slip.

---

## R16 · "Go-live" is treated as the final bar

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **High** |
| Owner | Thomas |

The accelerated plan's deferral register is read at the week-5 gate and again before any
external customer is onboarded. `2.0.0` is self-hosted-only; external sales wait for the
P7 penetration test — [release-plan.md](release-plan.md).

---

## R17 · Parallel workstreams reproduce R7 faster

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **Medium** |
| Owner | Thomas |

Cross-agent review stays mandatory under deadline pressure; the vocabulary in
[coding-standards.md](../04-engineering/coding-standards.md) is enforced by CI, not by
diligence.

---

## R18 · Marketplace metering integrity cannot be guaranteed technically

| | |
| --- | --- |
| Likelihood | **High** (it is a property of the architecture) |
| Impact | **Medium** — commercial, not security |
| Owner | Thomas |
| **Deadline** | **Decided 2026-09-05** — BYOL / contract preferred; the listing itself is deferred beyond the current scope |

AWS's anti-tamper requirement is unsatisfiable in a self-hosted AGPL product where the
buyer administers the instance — see [aws-marketplace.md](../05-operations/aws-marketplace.md)
and [ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md). **Mitigation — done:**
BYOL / contract chosen over usage metering ([decision log](decision-log.md)). Remaining, only
if and when a listing decision is taken: consult AWS Partner Business Development on the
AGPL position.

---

## R19 · The penetration test has lead time the calendar does not

| | |
| --- | --- |
| Likelihood | **High** |
| Impact | **High** — it gates every external sale |
| Owner | Thomas |
| **Deadline** | **Book in accelerated week 1** |

A third-party penetration test needs procurement, scoping, execution, remediation and a
retest — realistically four to eight weeks from booking. **Mitigation:** book it in week 1
for a scoped first pass (auth, tenancy, portal boundary) even if the product is not
feature-complete, with a second pass before the marketplace listing. **Independent of the
external test**, an internal red-team pass by a fresh Opus context over the authorization
surface, the portal boundary and the inherited kaneo routes is part of the go-live gate
([security-model.md](../01-architecture/security-model.md#testing-security)) — real customer
data does not land on a stack proven only by its own suite.

---

## R20 · The kaneo router retrofit is under-estimated or skipped

| | |
| --- | --- |
| Likelihood | **Medium** |
| Impact | **High** — it is the one place v1's failure mode can re-enter through inherited code |
| Owner | Thomas |

Every security control in this corpus is specified for code that does not exist yet, and
P0's first act is importing kaneo's existing routers. If the retrofit into the five policy
kinds is done mechanically — a `public` policy stamped on anything that will not otherwise
compile — the route-coverage test goes green and proves nothing. **Mitigation:** the
retrofit is a named P0 task with a human-reviewed pass router by router
([phases.md](phases.md#p0--foundation)); `public-project` is deleted rather than flagged; a
`public` or `delegated` policy requires a written `reason`, and the P0 Opus security review
reads every one of those reasons before P0 closes. The P0 exit criterion is green on the
*inherited* surface, not on an empty application. **Size, measured 2026-09-06:** kaneo mounts
28 sub-routers plus 6 inline routes in `apps/api/src/index.ts` — about 105 route
definitions, roughly 85 after the fork-time removals — so the order is **delete first, then
retrofit**; no policy is written for a route about to go.

---

## R21 · Inherited authentication defaults survive the fork

| | |
| --- | --- |
| Likelihood | **Medium** — three of them were found only by reading `auth.ts` |
| Impact | **High** — each is an authentication surface no specification knows about |
| Owner | Thomas |
| **Deadline** | **P0 step 1 exit** |

kaneo enables better-auth's `anonymous()` guest sign-in by default, ships
`accountLinking.enabled: true` with the generic OIDC provider trusted, keeps a five-minute
session cookie cache, and mounts `deviceAuthorization` and `bearer`. None of it was in any
TaskDesk document until 2026-09-06, and the route-coverage test cannot see a plugin that is
*on*. **Mitigation:** the fork-time removal and disable list in the
[decision log](decision-log.md) is executable — `tests/permissions/no-anonymous-plugin.test.ts`
reads the constructed better-auth configuration, `no-inherited-integration-routes.test.ts`
walks Hono's router — and both are P0 exit criteria ([phases.md](phases.md)). R15–R17 live
only in this register; the accelerated plan points here rather than restating them.

---

## Review

At every phase close:

1. Did any risk materialise? Write down what happened.
2. Did a mitigation work, or only appear to?
3. Any new risks?
4. Any risk now negligible? Retire it.

## Related

- [Roadmap](roadmap.md) · [Phases](phases.md) · [Decision log](decision-log.md)
