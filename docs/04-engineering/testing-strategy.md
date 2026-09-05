# Testing strategy

> v1's own handover: *"Four of the worst defects were invisible to green tests."*
>
> A green suite proves that what someone thought to check still works. It says nothing
> about what nobody thought to check. The layers below are arranged to close that gap.

## The layers

```
                        ▲  fewer, slower, higher confidence
   ┌──────────────────┐
   │  Manual          │  screen reader · keyboard day · fresh eyes
   ├──────────────────┤
   │  E2E             │  Playwright — journeys, security, a11y, visual
   ├──────────────────┤
   │  Permission      │  route coverage · role × route matrix · tenant isolation
   ├──────────────────┤
   │  API contract    │  OpenAPI validity · breaking-change diff · client drift
   ├──────────────────┤
   │  MCP             │  tool-to-route parity · idempotency · capability clamping
   ├──────────────────┤
   │  Integration     │  real Postgres via Testcontainers · lifecycle cross-feature
   ├──────────────────┤
   │  Component       │  Vitest + Testing Library + axe
   ├──────────────────┤
   │  Unit            │  packages/domain especially
   └──────────────────┘
                        ▼  many, fast, narrow
```

## Unit

**Where** — co-located `*.test.ts`.
**Tool** — Vitest.

`packages/domain` carries the heaviest burden, because it is pure and because it encodes
the rules the business cares about. **Target: 90% coverage on `packages/domain`.**

The SLA suite is the most important in the product. It must cover every calendar type,
every boundary to the minute, DST in both directions, holidays, pauses, reopen, and policy
version selection. See [sla.md](../03-features/sla.md).

```ts
test('SLA-9: reopening resumes rather than restarting the resolution clock', () => {
  const state = computeSlaState({ /* … */ });
  expect(state.consumedMinutes).toBe(180);   // not 0
});
```

Test names cite spec rules, so a failure points at the rule it protects.

## Component

**Where** — co-located `*.test.tsx`.
**Tool** — Vitest, Testing Library, `vitest-axe`.

Every `packages/ui` primitive tests: renders, keyboard-operable, axe-clean, all variants.
Feature components test behaviour, not implementation — query by role and label, never by
test id where a role exists.

## Integration

**Where** — `tests/api-integration/`.
**Tool** — Vitest plus Testcontainers running real PostgreSQL. Never a mock database; a
mock cannot reproduce a constraint violation, a cascade or a transaction boundary, which
are exactly the things that go wrong.

Covers: CRUD with policy enforcement, transactions and rollback, cascades, optimistic
concurrency, cross-tenant isolation, migration application, job leasing, outbox delivery.

## Permission tests — RBAC and its API, the structural layer

**Where** — `tests/permissions/`.

This layer exists specifically because of v1's eleven authorization holes, and it is the
one layer that tests the API surface itself rather than a feature behind it — see
[RBAC](../01-architecture/rbac.md) and [Security model](../01-architecture/security-model.md).

**`route-coverage.test.ts`** — enumerates every route in the OpenAPI document and fails if
any lacks a policy entry. A public route must declare `public: true` *with a reason*.

**`matrix.test.ts`** — every built-in role against every route, asserted against a
checked-in fixture. Changing access changes the fixture, which appears in the pull request
diff. Run twice: once against **capability** (does this role's declared capability set
allow the call at all), once against **reach** (does the same call succeed or 404 depending
on whether the acting identity's memberships put the target resource in scope) — a route
can pass the first and still leak data through the second, which is exactly the shape of
several of v1's eleven holes.

**`custom-role.test.ts`** — an administrator-created role (cloned, capabilities ticked and
unticked in the UI — see [roles and permissions UI](../03-features/roles-and-permissions-ui.md))
is exercised against the same matrix mechanism as the built-in roles, so "roles are
editable rows, not a fixed ladder" is proven, not merely asserted in a spec.

**`tenant-isolation.test.ts`** — two seeded organisations; every read route returns 404
across the boundary. Includes the customer role specifically: a customer session
requesting another organisation's record, another organisation's catalogue, and another
organisation's SLA data must each 404.

**`portal-vs-agent-router.test.ts`** — the narrow `/api/portal/*` router
([API design](../01-architecture/api-design.md)) is asserted to expose *only* the endpoints
[customer-portal.md](../03-features/customer-portal.md) documents, nothing more — an
accidental extra route here is the same class of hole as a missing policy on the agent
API, just on the smaller surface.

See [ADR 0010](../01-architecture/adr/0010-route-policy-registry.md).

## API contract tests

**Where** — `tests/api-contract/`.

The OpenAPI document ([API design](../01-architecture/api-design.md)) is generated, not
hand-written, but a generated contract can still silently change shape.

- **Spec validity** — the generated `/openapi.json` is linted against the OpenAPI 3.2
  meta-schema on every build. An invalid document fails CI before anything downstream
  (the typed client, the Scalar docs, an MCP tool schema) has a chance to be wrong too.
- **Breaking-change diff** — the spec generated on a pull request branch is diffed against
  `main`'s. A removed field, a narrowed type, or a new required property fails the build
  unless the PR also bumps the version, per [API design](../01-architecture/api-design.md)'s
  versioning policy.
- **Client-server drift** — `packages/libs`' typed client is generated from the same spec
  the server publishes; a server change that is not reflected in the client fails
  `pnpm typecheck`, not a runtime test, which is the point of generating both from one
  source.

## MCP server tests

**Where** — `tests/mcp/`, plus the integration and E2E cases already listed in
[mcp-server.md](../03-features/mcp-server.md#testing).

The MCP server is a thin client over the public API with no privileged access of its own,
so its tests exist to prove that property holds, not to re-test business logic already
covered elsewhere:

- **Tool-to-route parity** — every MCP tool is asserted to call an API route that itself
  passes route-coverage and the permission matrix above. A tool with no corresponding
  policy-checked route is a build failure, the same as an unguarded route.
- **Capability clamping** — an API key scoped to a capability subset cannot use an MCP
  tool that would require a capability outside that subset, even if the key owner
  personally holds it.
- **Idempotency under retry** — a repeated `create_work_item` call with the same
  `Idempotency-Key` produces exactly one work item; a scripted agent session that creates,
  comments on and transitions a work item, replayed identically, creates nothing new the
  second time.
- **Schema-described side effects** — every write tool's description is asserted to state
  its side effects and required permission in the text a model reads (`MC-6`), checked by
  a snapshot test, since this is the one part of the contract a human reviewer is least
  likely to notice drifting.

## Task and work-item lifecycle tests

**Where** — `tests/api-integration/lifecycle/`.

A state transition is rarely just a field update — it can stop an SLA clock, unassign
someone, require a note, require an approval, and emit an event three other features
listen to. These cross-feature interactions are where a change in one feature spec quietly
breaks another, so they get their own named suite rather than being assumed to fall out of
each feature's own tests:

- Transitioning into a `completed`-group state stops the resolution SLA
  ([`WF-17`](../03-features/workflows.md)); transitioning back out resumes rather than
  restarts it (`WF-18`).
- A transition that requires a note, requires an approval, or requires CAB is blocked
  until satisfied, and the block reason is machine-readable
  ([`WF-16`](../03-features/workflows.md)).
- A transition emits `work_item.transitioned`, and that event is asserted to reach the
  outbox (for webhooks and notifications) and the audit log in the same transaction as the
  state change — never as a best-effort side effect that can silently fail.
- Bulk transitions are per-item transactional: a batch of 50 where 3 are illegal reports
  exactly those 3 with reasons, and commits the other 47 (`WI-25`, `WI-26`).
- A customer-initiated action (escalate, withdraw, reopen) is exercised through the same
  lifecycle engine as a staff transition, not a parallel code path — proving
  [ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md)'s "one engine" claim
  rather than assuming it.

## E2E

**Where** — `tests/e2e/`.
**Tool** — Playwright, with projects for agent, portal, reduced-motion and mobile.

### Journeys

Every primary path, per phase. Sign in; create a work item; drag it across a board; comment
publicly and internally; raise a portal request; triage it; decide an approval; edit a role
and see the effect; configure an identity provider.

### Security

Named tests, each mapped to a v1 defect or a spec "must not":

```
cross-tenant-404.spec.ts
customer-cannot-request-cab.spec.ts
requester-cannot-self-approve.spec.ts
approver-email-not-leaked.spec.ts
customer-cannot-read-reports.spec.ts
portal-no-internal-comments.spec.ts
portal-cannot-deescalate.spec.ts
portal-session-rejected-on-agent-origin.spec.ts
viewer-cannot-write.spec.ts
revoked-session-cannot-act.spec.ts
godmode-requires-instance-admin.spec.ts
secrets-never-serialised.spec.ts
```

**Every one of these asserts a failure.** A test suite made only of happy paths is how v1
stayed green while being wrong.

### Accessibility

`@axe-core/playwright` runs on every screen the E2E suite visits. Zero critical or serious.

### Visual

Screenshot comparison on Storybook stories and on key screens. An unapproved diff fails the
build; approving is an explicit act in the pull request.

### Performance

Against a seeded dataset, asserting the budgets in
[UX quality gates](../02-design/ux-quality-gates.md).

## Manual

Automation catches roughly a third of accessibility problems and none of "this is
confusing". At each phase gate:

| Check | Method |
| --- | --- |
| Screen reader | VoiceOver on Safari, NVDA on Firefox |
| Keyboard only | One working session with no mouse |
| Fresh eyes | Someone unfamiliar attempts the main task unaided; every hesitation logged |
| Cross-browser | Chrome, Firefox, Safari, Edge |
| Real data | 10,000 work items, 50 projects, 200 people, long titles, non-Latin names |

Hesitation is a design bug, not a user error.

## Load

**Tool** — k6, before each release.

| Scenario | Target |
| --- | --- |
| 100 concurrent users browsing | p95 < 500 ms |
| 50 concurrent board views | p95 < 800 ms |
| 1,000 work item creations per minute | No errors |
| SLA scan over 100,000 items | Under 60 s |
| 500 concurrent WebSocket connections | Stable, no dropped messages |

Results recorded per release so regression is visible.

## Test data

`tests/fixtures/` and `scripts/seed.ts`.

Three sizes: **minimal** (one org, one project, ten items — for fast tests),
**realistic** (as above, for manual and performance), **hostile** (empty strings, 500-
character titles, non-Latin scripts, emoji, right-to-left text, null-heavy records,
deeply nested hierarchies).

The hostile dataset finds more layout bugs than any other single technique.

## Running

```bash
pnpm test                  # unit + component
pnpm test:integration      # Testcontainers, incl. lifecycle/
pnpm test:permissions      # route coverage + matrix + tenant isolation + portal router
pnpm test:contract         # OpenAPI spec validity + breaking-change diff
pnpm test:mcp              # tool-to-route parity + idempotency + capability clamping
pnpm test:e2e              # Playwright, all projects
pnpm test:e2e -- --project=security
pnpm test:visual
pnpm test:load
pnpm test:all              # everything; CI runs this
```

## CI gating

| Trigger | Runs |
| --- | --- |
| Every push | lint, typecheck, unit, component |
| Every pull request | + integration, permissions, contract, MCP, E2E, visual, a11y, performance budgets |
| Merge to `main` | + full E2E across browsers, container scan |
| Release | + load test, SBOM, migration dry-run against a production copy |

## Rules

1. **A bug fix ships with a test that failed before the fix.** No exceptions.
2. **Never disable a test to make a build pass.** Fix it or revert the change.
3. **Every "must not" in a spec has a test proving it.**
4. **Test behaviour, not implementation.** A test that breaks on a refactor with no
   behaviour change is a liability.
5. **No `sleep()`.** Wait for a condition.
6. **Tests are independent.** Any order, in parallel, repeatedly.
7. **A flaky test is a broken test.** Fix it or delete it. A suite with known flakes stops
   being trusted, and an untrusted suite is worth nothing.

## Related

- [SDLC](sdlc.md) · [Definition of Done](definition-of-done.md)
- [UX quality gates](../02-design/ux-quality-gates.md)
- [Security model](../01-architecture/security-model.md)
