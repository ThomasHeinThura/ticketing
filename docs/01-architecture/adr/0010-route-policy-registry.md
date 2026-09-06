# 0010 — Every route declares its policy; CI enforces it

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

TaskDesk v1 discovered **eleven authorization holes** during pre-go-live review. Its own
handover document records the lesson:

> *"Four of the worst defects were invisible to green tests… the lesson that repeated:
> 11 auth holes invisible to the test suite → mutation-test every check."*

Examples included: a customer-side account able to request an internal CAB approval; an
approver's email address returned to unauthenticated callers; and `/reports/*` having no
access control at all, so customers could read the entire SLA portfolio across every
customer.

The common shape of every one of these is **omission**. Nobody wrote a bad check. Someone
added a route and did not write a check at all. No test failed, because a test only fails
for behaviour someone thought to assert.

This is not solvable by care. v1's team was careful and had a review process and a green
test suite.

## Decision

**A route cannot exist without declaring the capability it requires. CI proves it.**

### 1. Policy declaration is part of route definition

Each feature folder has a mandatory `policy.ts`:

```ts
export const workItemPolicies = {
  'POST  /api/work-items':            { capability: 'work_item:create', scope: 'project' },
  'GET   /api/work-items/{key}':      { capability: 'work_item:read',   scope: 'work_item' },
  'PATCH /api/work-items/{key}':      { capability: 'work_item:update', scope: 'work_item' },
  'GET   /api/public/branding':       { public: true, reason: 'rendered on the login page' },
} satisfies PolicyMap;
```

The route factory refuses at module load to construct a route with no policy entry — so
the failure is at boot, not at request time.

### 2. Route coverage test

`tests/permissions/route-coverage.test.ts` enumerates every route in **Hono's router**
(`app.routes`) and fails if any lacks a policy. A public route must supply `public: true` **and
a `reason` string**, making "this is public" a deliberate, reviewable act rather than an
absence.

> **Correction, 2026-09-06 (#7).** This section originally said "the generated OpenAPI
> document". Reading kaneo's real source settled it the other way, and
> [rbac.md](../rbac.md#route-policies--the-anti-v1-mechanism) already carries the corrected
> wording: the OpenAPI document cannot see the routes registered inline in `index.ts`, the
> `/auth/*` mount, the websocket upgrades or `/metrics` — and `createRoute({ security: [] })`
> edits the document with **zero runtime effect**, so the document and the enforcement can
> disagree silently. Those are precisely the surfaces v1 leaked through. The decision — every
> route declares its policy, CI proves it — is unchanged; only the thing being enumerated is.

### 3. Permission matrix test

`tests/permissions/matrix.test.ts` executes every built-in role against every route and
asserts allow or deny against a checked-in fixture. Changing who may do what changes the
fixture, and the change appears as a diff in the pull request.

### 4. Negative E2E suites

Playwright tests that attempt forbidden things and assert failure: cross-tenant reads
return 404, a customer cannot approve their own request, a customer cannot de-escalate
priority, a viewer cannot write, a revoked session cannot act.

## Consequences

### Positive

- **The v1 class of bug becomes a build failure.** Adding a route without a check is
  mechanically impossible to merge. This alone justifies the decision.
- **Authorization is legible.** The complete answer to "who can do what" is a set of
  small, greppable files, rather than being distributed across middleware chains and
  handler bodies.
- **Changes are visible in review.** Widening access shows up as a fixture diff, which is
  exactly where a reviewer's attention should be drawn.
- **AI agents cannot forget.** An agent adding an endpoint gets a red build until it
  declares a policy. For a team where most code is agent-written, this is decisive.
- The matrix fixture doubles as documentation, and it cannot go stale.

### Negative

- **Ceremony on every new route.** Two lines, but two lines every time, and it will feel
  like bureaucracy on the tenth endpoint of a quiet afternoon. That is the point.
- **The matrix fixture grows large** — roles × routes. Mitigated by generating it in a
  compact grouped format and by only asserting built-in roles, not every custom role.
- **False confidence risk.** A route can declare `work_item:read` and still leak a field
  it should not. Policy coverage proves a check *exists*, not that it is *correct*. This
  is why explicit response schemas and negative E2E tests are also required — the controls
  are layered on purpose.
- Refactoring route paths means updating policy keys, which is friction.

### Neutral

- The `scope` field means the check knows *what* to evaluate against — project, work item,
  workspace — so resolution logic stays in one evaluator rather than being re-derived per
  handler.

## Alternatives considered

**Middleware that requires a capability, applied per router.** Rejected. It is what v1
effectively had. It is easy to add a route to the wrong router, or to a router with a
weaker guard, and nothing detects it.

**Deny by default with an explicit allowlist of public routes.** Partially adopted — this
*is* deny by default. The addition is that the allowlist must be exhaustive and machine
verified, rather than implicit.

**Mutation testing of authorization checks**, which v1's retrospective suggested. Not
rejected, but insufficient alone: mutation testing verifies that existing checks are
tested, and says nothing about a check that was never written. Worth adding later as a
second layer; policy coverage is the first.

**Trust code review.** Rejected. v1 had review. Review catches what a reviewer thinks to
look for, and the failure mode here is precisely something nobody thought about.

## Related

- [Security model](../security-model.md) · [RBAC](../rbac.md)
- [Testing strategy](../../04-engineering/testing-strategy.md)
