# Retained product and engineering constraints

This reference preserves substantive constraints from licensing, risk, bootstrap, test and release records, plus product decisions that need an explicit maintained home. It does not reactivate historical working procedures, reviewer/model assignments, branch/worktree prescriptions, schedules, waivers, implementation status or claimed test passes. Current [AGENTS.md](../../AGENTS.md), [alignment](../alignment.md), [testing](../testing.md) and current owner decisions govern execution. A retained target or test case is not implementation or acceptance evidence.

Use the detailed authorities for [permissions](permissions.md), [configuration](configuration.md), [data model](data-model.md), [events](events.md), [jobs](background-jobs.md), [safety/runtime](safety-and-runtime.md), [architecture/experience](architecture-and-experience.md), [operations/distribution](operations-and-distribution.md), [import/cutover](import-and-cutover.md) and [CI gates](ci-gates.md). This document adds no capability, variable, schema, dependency or approval flow by inference.

<a id="licensing-and-attribution"></a>
## Licensing, attribution and source provenance

TaskDesk is AGPL-3.0. Preserve the complete root `LICENSE`, root `THIRD-PARTY-NOTICES.md`, and `NOTICE` included in the image. Corresponding source must be available to users of hosted TaskDesk, including portal users; redistribution and linked product components must satisfy the applicable licence obligations. Commercial charging does not remove those obligations. A proprietary/dual-licence plan needs a deliberate contributor-rights decision before external contributions; do not assume a future CLA can retroactively cover existing work.

Application source may come only from original Kaneo or TaskDesk v1 under the current product rule. Other projects are inspiration, without copied application code. A compatible library is a separate dependency decision under current AGENTS; do not infer permission to add it from an old competitor table. Mixed-licence repositories do not become safe as a whole because one directory is open source. Never copy code from Stack Overflow, blogs, proprietary source or a model's recollection of proprietary code.

Kaneo is MIT. Retain its copyright and permission notice verbatim, including **"Copyright (c) 2024 Andrej Acevski"**, and copyright headers on files taken verbatim. The pinned snapshot is upstream main **`42bb801114aa1ae499228a53180f0cdbc5607964`**, rather than the earlier release tag. Third-party source notices record source path and exact commit; TaskDesk's own version history is separate from upstream tags. An old record that a notice exists is not a current packaging check.

TaskDesk v1 domain rules are reimplemented idiomatically in TypeScript: SLA calendars, versioned workflows/note policies, approvals/CAB, assignment, reach/authority, service calendars and audit. Preserve their tested behavior rather than mechanically transliterating C#.

**Conflicts retired:** the old Plane-copy exception does not override the current Kaneo/v1-only source rule. The archived competitor compatibility table is not maintained legal authority; in particular its unconditional GPL-2.0-to-AGPL-3.0 assertion must not be used as permission. The old requirement that root AGENTS point to a particular historical file is retired; current AGENTS is authoritative.

<a id="coding-standards"></a>
## Code semantics and product correctness

<a id="coding-standards-language"></a>
### Language

- TypeScript, `strict: true`, everywhere.
- **No `any`.** Use `unknown` and narrow. If you genuinely need `any`, add
  `// eslint-disable-next-line` equivalent with a reason — it will be questioned.
- No non-null assertion `!` except immediately after a check the compiler cannot see, with
  a comment saying why.
- Prefer `type` over `interface` except where declaration merging is needed.
- Prefer `const`. `let` only where reassignment is real.
- Named exports. Default exports only where a framework demands one.

<a id="coding-standards-naming"></a>
### Naming

| Thing | Convention |
| --- | --- |
| Files | kebab-case — `create-work-item.ts` |
| React components | PascalCase, file matches export |
| Functions and variables | camelCase |
| Types and enums | PascalCase |
| Constants | SCREAMING_SNAKE only for genuine compile-time constants |
| Booleans | `is`, `has`, `can`, `should` prefixes |
| Handlers | `handleX` for the definition, `onX` for the prop |
| DB tables and columns | singular snake_case |
| API paths | plural kebab-case |
| Capabilities | `resource:action` |

Names say what a thing *is*, not what it is made of. `workItems`, not `workItemArray`.

<a id="coding-standards-comments"></a>
### Comments

Follow the repository rule: **a comment states what the code cannot show on its own, in
one short line.**

```ts
// ✗
// Increment the counter
counter++;

// ✗
/**
 * This function updates the work item.
 * @param id - The id of the work item
 * @param data - The data to update
 */

// ✓
// Fractional ranks avoid rewriting every row on reorder; rebalanced by a nightly job.
const position = (before + after) / 2;

// ✓
// v1 compared display names here, which collided for duplicate names. Compare by id.
if (current.assigneeId === next.assigneeId) return;
```

Do not restate the next line. Do not explain your change to the reviewer — that goes in the
commit message. Do not write a paragraph where a line will do.

<a id="coding-standards-errors"></a>
### Errors

```ts
// ✗ swallowing
try { await save(); } catch { /* ignore */ }

// ✗ meaningless
throw new Error('Failed');

// ✓
throw new ConflictError('WORKFLOW_TRANSITION_ILLEGAL', {
  from: current.stateId,
  to: target.stateId,
  reason: 'No transition exists for your role',
});
```

- Throw typed errors from `packages/domain`; the transport layer maps them to problem
  documents.
- Never swallow. If it is genuinely ignorable, say why in a comment.
- Error messages are for humans. "Couldn't save — the ticket was changed by someone else"
  beats "Optimistic concurrency violation".

<a id="coding-standards-async"></a>
### Async

- `async`/`await`, not `.then()` chains.
- `Promise.all` for independent work. Sequential `await` in a loop is almost always a bug.
- Every `await` on I/O is in a `try` or a caller that handles failure.
- No floating promises — the lint rule is on.

<a id="coding-standards-backend"></a>
### Backend

**Feature folder** — every feature under `apps/api/src/` follows the same shape:
`index.ts`, `schema.ts`, `response.ts`, **`policy.ts`**, `controllers/`, `__tests__/`.

**Controllers are thin.** Validate, call domain, persist, respond. Business rules live in
`packages/domain`.

```ts
// ✓ controller
export async function transitionWorkItem(c: Context) {
  const { key } = c.req.valid('param');
  const body = c.req.valid('json');
  const identity = c.get('identity');

  const item = await workItems.forIdentity(identity).byKey(key);
  const workflow = await workflows.activeFor(item.typeId);

  // domain decides; the controller does not
  const result = assertTransitionLegal({ item, workflow, target: body.toStateId, identity });

  const updated = await workItems.applyTransition(item, result);
  return c.json(toWorkItemResponse(updated));
}
```

**Repositories own queries.** Controllers, middleware and services never build a query. A
repository call that can return cross-organisation data receives the resolved identity and
applies the caller's reach in the statement predicate. An additional workspace or project id
must be checked against that identity; an id alone is not authoritative scope. Repository
location alone does not guarantee scoping. The ownership rule and conventions are under
[query ownership](design-and-decisions.md#coding-standards-query-ownership-issue-580). The query-location check does not establish tenant-predicate semantics.

Query ownership, executor/transaction boundaries and the exact permitted paths are maintained in [query ownership](design-and-decisions.md#coding-standards-query-ownership-issue-580). The checker does not prove tenant predicates.

**Domain is pure.** No Drizzle import, no Hono import, no `Date.now()` — pass `now` in.
This is what makes it testable.

<a id="coding-standards-frontend"></a>
### Frontend

**Data fetching** — fetchers in `src/fetchers/`, wrapped in query and mutation hooks.
Components never call `fetch`.

```ts
// src/fetchers/work-item.ts
export const getWorkItem = (key: string) =>
  api.workItems[':key'].$get({ param: { key } }).then(unwrap);

// src/hooks/queries/use-work-item.ts
export const useWorkItem = (key: string) =>
  useQuery({ queryKey: ['work-item', key], queryFn: () => getWorkItem(key) });
```

**Server state is TanStack Query. UI state is Zustand.** Never duplicate server data into
a store — that is how two sources of truth start disagreeing.

**Components**

- One component per file.
- Props typed explicitly, no `React.FC`.
- Composition over configuration: prefer `<Card><CardHeader/></Card>` to
  `<Card header={…} />`.
- Extract reusable pieces when it improves composition; no artificial component line limit governs delivery.
- No business logic in a component. Put it in a hook or in `packages/domain`.

**Forms** — React Hook Form with the **server's** Zod schema as resolver, so client and
server validation cannot diverge.

<a id="coding-standards-imports"></a>
### Imports

Ordered by Biome: node built-ins, external, workspace packages, relative. Absolute imports
via path aliases within an app; relative only within a folder.

No circular imports. The dependency-cruiser check fails the build on one.

<a id="coding-standards-tests"></a>
### Tests

- Co-located `*.test.ts` for units; `tests/` for integration and E2E.
- One assertion concept per test.
- Test names describe behaviour and cite spec rules:
  `test('SLA-9: reopening resumes rather than restarts the clock')`.
- Arrange, act, assert — visibly separated.
- No shared mutable state between tests.
- Fixtures in `tests/fixtures/`, builders over literals.
- Never `sleep()`. Wait for a condition.

<a id="coding-standards-database"></a>
### Database

- Migrations generated by `drizzle-kit`, reviewed, committed. Never hand-written from
  scratch.
- Forward-only.
- Every foreign key declares its `ON DELETE`.
- Index anything you filter, sort or join on. Verify with `EXPLAIN`.
- `timestamptz`, always UTC.
- Some columns predate that rule and are `timestamp` (without time zone) —
  `session.expires_at`, `job_lease.expires_at`, `task.due_date`. Those hold **UTC wall
  clock**, because Drizzle writes them through `PgTimestamp.mapToDriverValue`
  (`Date.prototype.toISOString()`) and reads them back with `mapFromDriverValue`, which
  re-attaches `+0000`.
- **Compare such a column with `now() AT TIME ZONE 'UTC'`, never with a bare `now()`** —
  `dbNowUtc()` in `apps/api/src/utils/db-time.ts`. `now()` is `timestamptz`, so a bare
  comparison coerces the column through the session's `TimeZone`: on a database server ahead
  of UTC a row that expires in an hour compares as already expired, which for the
  `session-cleanup` purge means deleting live sessions, and behind UTC the purge never fires.
  Do not assume deployment pins the database server time zone.
- **Never bind a raw JS `Date` into a `timestamp` column from a raw `sql` template.**
  Drizzle's `noopEncoder` passes the `Date` straight to `pg`, which serializes it in the
  *process's* time zone and appends the offset; PostgreSQL then drops the offset for a
  `timestamp` column, so the value stored depends on the application container's `TZ`. Bind
  `date.toISOString()`, use the query builder (which applies the column's encoder), or have
  the database compute the instant. For example, a `12:00:00Z` expiry can otherwise be stored as `18:30:00` under `TZ=Asia/Yangon`.
- Money `numeric(14,4)`. Durations integer minutes. Never floats for either.

<a id="coding-standards-security"></a>
### Security

Non-negotiable, and re-stated because they are the ones that matter:

- Every route declares a policy.
- Every response goes through a response schema.
- Never trust a token claim for authority.
- Never build SQL by string concatenation.
- Never log a secret.
- Never `dangerouslySetInnerHTML` outside the sanitised rich-text renderer.

<a id="coding-standards-performance"></a>
### Performance

- Paginate. No unbounded list endpoint.
- Virtualise above 100 rows.
- Avoid N+1: load related data in one query, or batch.
- `React.memo`, `useMemo`, `useCallback` only when profiling shows a need. The React
  Compiler handles most of it, and premature memoisation is its own cost.
- Lazy-load routes.

<a id="repository-bootstrap"></a>
## Inherited surface and bootstrap constraints

The inherited application remains real Kaneo, not an empty replacement app. Preserve its shell/components/interaction libraries while integrating canonical persisted APIs. Exact pinned inheritance, dependency layout and attribution live in [inherited features](architecture-and-experience.md#inherited-features). Historical copy commands, one-time task sequencing and old procedural exit claims are retired; they are not instructions to copy a new snapshot or overwrite current work.

The source baseline distinguishes deliberate removals from regressions, with original lint/type/unit/build/integration/i18n pass/fail/skip counts recorded against the exact upstream SHA. An upstream result against PostgreSQL16 does not prove a PostgreSQL18 result or vice versa. Upstream dependency/image scans and local Trivy/secret/dependency findings require truthful disposition; no inherited input is trusted merely because a fork built.

<a id="repository-bootstrap-removals-and-authentication"></a>
### Removed and retained boundaries

- Remove anonymous guest sign-in, guest/demo fields and registration exemptions, device authorization and bearer authentication. Explicitly disable automatic account linking and the session cookie cache. Check constructed authentication configuration, not just HTTP behavior. Immediate session revocation remains required.
- Remove Better Auth's organization plugin and its routes; TaskDesk owns directory, membership, roles, teams and invitations. Keep `admin` solely as a session primitive with its HTTP administration endpoints refused. TOTP/backup-code integration must satisfy the complete verified-factor and policy requirements; enabling a plugin alone proves nothing.
- Remove inherited MCP/OAuth routers; TaskDesk MCP uses its separately specified API/capability and pending-action contracts.
- Remove the entire anonymous `public-project` path: inline route, schema/response/update fields, anonymous attachment-read branch, frontend route/components/fetchers/hooks and dormant access code. Retiring `project.is_public` follows forward/two-phase migration rules. A reserved future public-board flag is not dormant public access.
- Remove inherited GitHub, Gitea, Slack, Discord, generic-webhook and Telegram plugin routers, screens, registrations, integration tables/dependencies and private-destination bypass. Retain only the plugin contract/registry seam, with new integrations subject to their own accepted requirements.
- Remove inherited hosted billing/trial/Creem/Turnstile surfaces, Planka importer and independent upstream package/image publishing. Do not restore removed integrations to satisfy an import failure.
- Remove inherited Sentry integration and dependency coupling from shared UI, backend lifecycle, scheduler, auth and frontend error boundaries. Optional customer observability uses its maintained runtime configuration rather than bundled upstream credentials/DSNs.
- Upstream agent/editor/review/release instructions are not product policy. TaskDesk keeps its own release history and signed release workflow. No upstream marketing/docs app, nginx runtime substitution or startup web-env rewriting is implied by inheritance.

Remaining inherited features without a complete contract or validated UX remain unavailable behind their retained flag boundary until integrated; this is not permission to remove working Calendar/Gantt continuity or hide unfinished roadmap work. Keep the independently characterized surviving tests with surviving behavior; a removed-feature test does not justify deleting unrelated regressions.

<a id="repository-bootstrap-configuration-and-bundles"></a>
### Configuration and bundles

[Configuration](configuration.md) owns the complete allowed bootstrap read/registration contract. Customer SMTP, auth providers, storage, branding, registration, observability and egress policy belong in persisted runtime administration. Legacy SMTP bootstrap compatibility must never override an authoritative persisted resolver returning disabled/unconfigured or failing. A local capture inbox is optional; it is neither a configured sender nor a customer delivery requirement.

Derive CORS from exact agent/portal origins; no cross-subdomain cookie setting, separate browser API origin, Vite customer-specific build variables or startup substitution script. Storage uses one runtime-selected backend; cache uses one configured URL, not unretained Redis Sentinel/Cluster configuration. Compose database variables belong to the database service, not application bootstrap. OS/CLI path variables are not customer configuration.

The agent and portal have separate entry bundles, sessions and origin binding. Portal output contains no agent module. Shared UI has no app/observability dependency. Permissions/domain/contracts retain their maintained package boundaries, server state remains TanStack Query, and browser imports use only explicitly browser-safe domain exports. Registered URL state round-trips through `lib/routes.ts`; no second scanner/router vocabulary replaces the canonical registries.

<a id="testing-strategy"></a>
## Behavior and verification constraints

<a id="testing-strategy-unit"></a>
### Unit

**Where** — co-located `*.test.ts`.
**Tool** — Vitest.

`packages/domain` carries the heaviest burden, because it is pure and because it encodes
the rules the business cares about. **Target: minimum 90% statements, lines and functions on `packages/domain`; report branch coverage without a threshold** —
with a per-package threshold
(`@vitest/coverage-v8`), never a workspace-wide average.

`scripts/anonymise.ts` has its own suite in `tests/anonymise/`: every PII-bearing column
in the [data model](data-model.md) is enumerated in a fixture, and the
test fails if a column exists that the anonymiser does not touch. An anonymiser with a bug
feeding a UAT held to production standard is a data breach, not a nit.

The SLA suite is the most important in the product. It must cover every calendar type,
every boundary to the minute, DST in both directions, holidays, pauses, reopen, and policy
version selection. See [sla.md](feature-contracts-p2.md#sla).

```ts
test('SLA-9: reopening resumes rather than restarting the resolution clock', () => {
  const state = computeSlaState({ /* … */ });
  expect(state.consumedMinutes).toBe(180);   // not 0
});
```

Test names cite spec rules, so a failure points at the rule it protects.

<a id="testing-strategy-component"></a>
### Component

**Where** — co-located `*.test.tsx`.
**Tool** — Vitest, Testing Library, `vitest-axe`.

Every `packages/ui` primitive tests: renders, keyboard-operable, axe-clean, all variants.
Feature components test behaviour, not implementation — query by role and label, never by
test id where a role exists.

<a id="testing-strategy-integration"></a>
### Integration

**Where** — `tests/api-integration/`.
**Tool** — Vitest plus Testcontainers running real PostgreSQL. Never a mock database; a
mock cannot reproduce a constraint violation, a cascade or a transaction boundary, which
are exactly the things that go wrong.

Covers: CRUD with policy enforcement, transactions and rollback, cascades, optimistic
concurrency, cross-tenant isolation, migration application, job leasing, outbox delivery.

<a id="testing-strategy-permission-tests--rbac-and-its-api-the-structural-layer"></a>
### Permission tests — RBAC and its API, the structural layer
Required fork-boundary behavior:

- `no-inherited-integration-routes.test.ts` — the constructed Hono router has no
  `public-project`, GitHub, Gitea, Slack, Discord, Telegram or generic-webhook route; the
  exact `octokit` and `@octokit/webhooks` package names are absent from lockfile package and
  snapshot mappings and importer aliases. The constructed better-auth instance contains no
  `anonymous`, `device-authorization` or `bearer` plugin. The independently reconciled
  `pnpm test:no-inherited-routes` fast gate runs this test; `pnpm test:permissions` includes it
  as well. The existing `better-auth-plugin-list.test.ts` remains the authoritative exact
  approved-list assertion.
- `no-anonymous-plugin.test.ts` — the constructed better-auth configuration contains no
  `anonymous`, `deviceAuthorization` or `bearer` plugin, `accountLinking.enabled` is `false`
  and `session.cookieCache` is disabled (reads the config, not the HTTP behaviour).
- `session-revocation-immediate.test.ts` — a revoked session fails on the very next request
  ([auth-and-identity.md](safety-and-runtime.md#auth-and-identity) § Sessions).
- `auth-reload-on-identity-connection-change.test.ts` — a new or disabled
  `identity_connection` takes effect on every replica without a restart
  ([auth-runtime-reconfiguration.md](safety-and-runtime.md#auth-runtime-reconfiguration)).

**Where** — `tests/permissions/`. One command, `pnpm test:permissions`, needing no environment
and no database; exit `0` or `1`, no warning-only mode. The contract CI wires against — what
fails the build, and why there is no second route scanner — is
[`tests/permissions/README.md`](design-and-decisions.md#README).

This layer exists specifically because of v1's eleven authorization holes, and it is the
one layer that tests the API surface itself rather than a feature behind it — see
[RBAC](permissions.md) and [Security model](safety-and-runtime.md#security-model).

**`route-coverage.test.ts`** — enumerates Hono `app.routes` and every non-Hono listener
manifest exported by its runtime constructor, not the OpenAPI document. `/auth/*` and `/ws`
are Hono/delegated surfaces; `GET /metrics` is a separate Node listener on port 9464 and is
absent from `app.routes`. Its constructor must export the method/path/port/delegated-policy
key, and coverage compares the constructed listener to that manifest. It fails for an
unclassified listener route, orphaned delegated policy, or changed/extra method/path. Before
the listener is implemented, its manifest and policy are planned, not current coverage.
A public route must declare `public: true` *with a reason*; a delegated mount must say what
it delegates to and why. OpenAPI alone proves none of these surfaces.

**`matrix.test.ts`** — every built-in role against every route, asserted against a
checked-in fixture. Changing access changes the fixture, which appears in the pull request
diff. Run twice: once against **capability** (does this role's declared capability set
allow the call at all), once against **reach** (does the same call succeed or 404 depending
on whether the acting identity's memberships put the target resource in scope) — a route
can pass the first and still leak data through the second, which is exactly the shape of
several of v1's eleven holes.

`matrix.test.ts` checks the declared policy against the fixture; it does not exercise the
middleware that runs on each route. **`work-item-reach-guard.test.ts`** closes that gap for
item-scoped routes: it fails any `reach: required` route on the `work_item` scope whose
middleware does not resolve project reach, or that opts out of project reach without a
stated reason. The per-route integration suites (`work-item-project-reach*.test.ts`,
`legacy-task-project-reach.test.ts`) drive the real middleware and assert the matrix's
declared statuses.

**`project-reach-guard.test.ts`** extends the same guard beyond work-item scope (#720): it
fails any `reach: required` route on the `project` scope whose middleware does not resolve
project reach (or that has no reasoned exemption), any route in the task-targeting set
(labels naming a task, the asset download, the legacy bulk update) that lacks a reach mark,
and any route anywhere whose middleware resolves a project, task, column, time-entry or
workflow-rule row from the request without carrying project reach. Every route in those sets
must also appear in a behavioural table (`project-scoped-reach.test.ts`,
`task-target-reach.test.ts`), because a mark is self-attested and proves declaration, not
enforcement.

**`custom-role.test.ts`** — an administrator-created role (cloned, capabilities ticked and
unticked in the UI — see [roles and permissions UI](feature-contracts-p4.md#roles-and-permissions-ui))
is exercised against the same matrix mechanism as the built-in roles, so "roles are
editable rows, not a fixed ladder" is proven, not merely asserted in a spec.

**`tenant-isolation.test.ts`** — two seeded organisations; every read route returns 404
across the boundary. Includes the customer role specifically: a customer session
requesting another organisation's record, another organisation's catalogue, and another
organisation's SLA data must each 404.

**`portal-vs-agent-router.test.ts`** — the narrow `/api/portal/*` router
([API design](safety-and-runtime.md#api-design)) is asserted to expose *only* the endpoints
[customer-portal.md](feature-contracts-p3.md#customer-portal) documents, nothing more — an
accidental extra route here is the same class of hole as a missing policy on the agent
API, just on the smaller surface.

See [ADR 0010](design-and-decisions.md#0010-route-policy-registry).

<a id="testing-strategy-api-contract-tests"></a>
### API contract tests

**Where** — `tests/api-contract/`.

The OpenAPI document ([API design](safety-and-runtime.md#api-design)) is generated, not
hand-written, but a generated contract can still silently change shape.

- **Spec validity** — the generated `/openapi.json` is linted with **Redocly CLI** (the
  `recommended` ruleset, OpenAPI 3.1 — the version `@hono/zod-openapi` emits; see
  [API design](safety-and-runtime.md#api-design)) on every build. An invalid document fails
  validation before anything downstream (the Scalar docs, an MCP tool schema, a third-party
  integrator) has a chance to be wrong too.
- **Breaking-change diff** — **`oasdiff breaking`** compares the pull request's spec against
  `main`'s. A removed field, a narrowed type, or a new required property fails the build
  except under the maintained successor-version and exact-break classification policy in [API design](safety-and-runtime.md#api-design)'s
  versioning policy.
- **Client-server drift** — there is nothing to drift: `packages/libs`' client is a **Hono
  RPC client typed structurally from the server's `AppType`**, not generated from the spec,
  so a server change the client does not reflect fails `pnpm typecheck`. The OpenAPI
  document is the *published* contract for third parties; the in-repo client never reads it.

<a id="testing-strategy-mcp-server-tests"></a>
### MCP server tests

**Where** — `tests/mcp/`, plus the integration and E2E cases already listed in
[mcp-server.md](feature-contracts-p4.md#mcp-server-testing).

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
- **Same RBAC as the owner** (`MC-19`–`MC-21`) — a key whose owner is deactivated, loses a
  membership or has a role reduced fails on the next call; a service key cannot be flagged
  `is_mcp` (the schema `CHECK` is asserted); no `mcp:*` capability exists in the capability
  enumeration.
- **No self-approval** — `delete_work_item`, `decide_approval` and bulk operations return
  `202` with a pending action; a `confirm` argument is ignored; approval from the MCP key
  itself is `403 session_required` ([pending-actions.md](safety-and-runtime.md#pending-actions)).
- **Injection** — `injection.test.ts` (`MC-18`).

<a id="testing-strategy-identity-provisioning-tests--scim-and-microsoft-entra"></a>
### Identity provisioning tests — SCIM and Microsoft Entra

**Where** — `tests/api-integration/identity/`. Twenty-five named acceptance tests, numbered
`01`–`25` in [identity-provisioning.md](feature-contracts-p3.md#identity-provisioning-testing),
run against a synthetic IdP and, **before the P3 identity gate closes, against a real
Microsoft Entra test tenant**. In one line each: agent OIDC is agent-portal-only; customer
OIDC is bound to one organisation; portal sessions are isolated both ways; a SCIM token
cannot touch another organisation; no request attribute selects a tenant, role or portal;
a customer connection cannot create staff or authority; SCIM create/filter/update/deactivate/
reactivate behave per Entra; groups map only to permitted roles in scope; nothing grants
`instance:admin` automatically; token rotation invalidates the old token and never leaks;
OIDC protocol failures block sign-in; a second IdP does not auto-link on email; every
identity event is audited. Test 05 also covers exact per-connection Entra app-role
admission on first and repeat login, missing/malformed `acct` and guest rejection, unapproved
provider JIT, collision-deny-only domain handling, valid negative-admission retirement of
only the selected identity's OIDC/JIT grants, and no mutation for invalid tokens; test 15
covers PKCE mismatch, state replay, wrong-portal or expired state, nonce mismatch, and the
distinction between invalid-token no-mutation and valid absent/malformed/overage-group
reconciliation. Test 05's planned browser assertions capture the
complete bound- and unbound-domain flow: initial response, `Location` and cookie headers,
navigation, and next screen. They verify the accepted domain-to-SSO-binding/public-IdP-
destination disclosure and prohibit organisation/connection inventory, names, ids, discovery
configuration, claim mappings, secrets, or a TaskDesk user-account-existence signal.
The same 25 tests carry the source-provenance contract: tests 01–03 prove connection-only
reevaluation within the fixed portal/organisation; 04, 06 and 09 prove foreign scope, side,
reach and forbidden authority are rejected; 07–08 prove immutable same-connection subject
resolution and SCIM-grant linkage; 10–11 prove global SCIM deactivation/re-derivation without
resurrecting history; 12–13 prove one-role projection, direct-role precedence, group-source
independence and fail-closed equal-rank conflicts; 14 and 19–22 retain credential and SCIM
protocol boundaries; 16 and 23 prove linked-connection and disable isolation; 17 proves safe
grant/audit records; 18 proves placeholder claims cannot get grants; and 24–25 retain the
no-auto-link and separate cache/session SLA checks. Test 12 or 17 includes a real-PostgreSQL
concurrency subcase for OIDC login racing SCIM group removal on one person/scope. Migration
coverage must classify every legacy membership from durable evidence in a read-only
preflight before any DDL, backfill, uniqueness constraint, or projection. Null `derived_from`
does not prove direct provenance; any ambiguous or unclassified row must stop the whole
migration with no partial schema or data change. Assert that owner-approved reconciliation
is required, any failure rolls back DDL and data changes together, and a successful backfill
occurs only after all rows are classified. Duplicate-membership detection, explicit
provenance backfill, and migration refusal are subcases of the existing named tests, not
current test evidence; their presence here proves no implementation or run. The 25-test real-Entra requirement remains. Browser security coverage must prove the CSRF negatives before the applicable security claim. `/scim/v2/*` is also inside the IDOR fuzz and tenant-isolation
suites like any other scoped surface.

<a id="testing-strategy-pending-action-tests--universal-deletion-approval"></a>
### Pending-action tests — universal deletion approval

**Where** — `tests/api-integration/pending-actions/` and `tests/e2e/security/`; the named
list is in [pending-actions.md](safety-and-runtime.md#pending-actions-testing). What they
prove: a delete request creates a pending action and **mutates nothing**; API keys, MCP
keys, impersonation sessions and model-supplied fields cannot approve; approval is bound to
the exact targets and payload hash and is single-use; it expires at 15 minutes; the route
policy is re-run at execution; project/workspace/organisation/key/webhook/identity-connection
deletions require typed name + step-up; bulk requires the typed count; a service key
cannot request a deletion; retention purge of an approved soft delete needs no second
approval; legal hold blocks purge; there is no MCP purge tool; every transition is audited.

<a id="testing-strategy-multi-tenant-negative-tests--the-additions-of-2026-09-05"></a>
### Multi-tenant negative tests — the additions of 2026-09-05

Required negative cases: Customer A cannot infer Customer B's records through search, filter or `meta.total`
(`filter-as-oracle.test.ts`); a `private` request is 404 to a colleague
(`private-request-404-to-colleague.spec.ts`, `CP-16`); an owner-team change cannot silently
grant reach (`lead-cannot-change-owner-team-or-parent.spec.ts`); a parent-project change
cannot cross an organisation (`reparent-refused-across-organisations.test.ts`).

<a id="testing-strategy-notification-delivery-attempt-budgets"></a>
### Notification delivery attempt budgets

**Where** — API integration tests against PostgreSQL, using the notification delivery
contract in [notifications.md](feature-contracts-p4.md#notifications-delivery).

Prove the six-attempt cap from the durable pre-provider authorization transaction, for both
direct children and sealed digest groups:

- A crash after attempt authorization but before adapter I/O leaves the increment committed
  and consumes that slot; provider acceptance followed by a crash before completion also
  consumes exactly one slot and remains at-least-once.
- Repeated lease expiry and recovery after the sixth authorization dead-letters the child or
  group and cannot start a seventh provider call. Digest child counters remain zero, and all
  frozen pending members become terminal with the group.
- A rollback or failed owner/token/expiry fence in the pre-provider transaction consumes no
  attempt and makes no provider call. A worker with a stale or expired fence cannot call the
  adapter after takeover.
- Contention, quiet-hours deferral, suppression, failed dedupe-reservation acquisition and
  lease renewal consume no attempt. Completion and definite/ambiguous outcome handling do not
  increment or refund the already durable count.
- Backoff follows the durable attempt number; actual provider call starts never exceed six
  for either a direct delivery or a digest group.

These are acceptance requirements for the target design; documentation does not claim runtime
or test implementation.

<a id="testing-strategy-task-and-work-item-lifecycle-tests"></a>
### Task and work-item lifecycle tests

**Where** — `tests/api-integration/lifecycle/`.

A state transition is rarely just a field update — it can stop an SLA clock, unassign
someone, require a note, require an approval, and emit an event three other features
listen to. These cross-feature interactions are where a change in one feature spec quietly
breaks another, so they get their own named suite rather than being assumed to fall out of
each feature's own tests:

- Transitioning into a `completed`-group state stops the resolution SLA
  ([`WF-17`](feature-contracts-p2.md#workflows)); transitioning back out resumes rather than
  restarts it (`WF-18`).
- A transition that requires a note, requires an approval, or requires CAB is blocked
  until satisfied, and the block reason is machine-readable
  ([`WF-16`](feature-contracts-p2.md#workflows)).
- A transition emits `work_item.transitioned`, and that event is asserted to reach the
  outbox (for webhooks and notifications) and the audit log in the same transaction as the
  state change — never as a best-effort side effect that can silently fail.
- Bulk transitions are per-item transactional: a batch of 50 where 3 are illegal reports
  exactly those 3 with reasons, and commits the other 47 (`WI-25`, `WI-26`).
- A customer-initiated action (escalate, withdraw, reopen) is exercised through the same
  lifecycle engine as a staff transition, not a parallel code path — proving
  [ADR 0011](design-and-decisions.md#0011-ticket-lifecycle-engine)'s "one engine" claim
  rather than assuming it.

<a id="testing-strategy-e2e"></a>
### E2E

**Where** — `tests/e2e/`.
**Tool** — Playwright, with projects for agent, portal, reduced-motion and mobile.

<a id="testing-strategy-journeys"></a>
#### Journeys

Every primary path, per stage. Sign in; create a work item; drag it across a board; comment
publicly and internally; raise a portal request; triage it; decide an approval; edit a role
and see the effect; configure an identity provider.

<a id="testing-strategy-security"></a>
#### Security

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
csrf-rejected-on-elevated-route.spec.ts
forged-x-forwarded-for-moves-no-bucket.spec.ts
cross-origin-websocket-refused.spec.ts
ws-revoked-membership-stops-events.spec.ts
lead-cannot-change-owner-team-or-parent.spec.ts
service-key-cannot-exceed-creator.spec.ts
manager-webhook-sees-only-own-projects.spec.ts
oidc-rejects-missing-pkce-state-nonce.spec.ts
mcp-injected-ticket-cannot-write.spec.ts
impersonator-cannot-create-durable-authority.spec.ts
public-comment-placeholder-cannot-leak-internal-field.spec.ts
```

**Every one of these asserts a failure.** A test suite made only of happy paths is how v1
stayed green while being wrong. Each test identifies the behavior or finding it protects; a historical review is not passing evidence.

<a id="testing-strategy-accessibility"></a>
#### Accessibility
`pnpm test:a11y` runs the UI Storybook-story axe scan and the tagged Playwright browser scan
in the full stage ([ci-cd.md](ci-gates.md)). The browser scan injects the existing
`packages/ui` `axe-core` source into the page and checks the logged-out protected-route
redirect's sign-in screen. Zero critical or serious violations.

<a id="testing-strategy-visual"></a>
#### Visual

Screenshot comparison on Storybook stories and on key screens. Unexpected differences require diagnosis against original Kaneo and the intended feature; do not bless new baselines simply to pass.

<a id="testing-strategy-performance"></a>
#### Performance
Runs as its own Playwright project, invoked by `pnpm test:a11y` / `pnpm test:perf` in the full
stage ([ci-cd.md](ci-gates.md)) — one shape in both documents.

Against a seeded dataset, asserting the budgets in
[UX quality gates](architecture-and-experience.md#ux-quality-gates).

<a id="testing-strategy-design-system-conformance"></a>
#### Design-system conformance

The maintained [UI boundaries](ui-boundaries.md), [UX gates](architecture-and-experience.md#ux-quality-gates), [configuration](configuration.md), vocabulary authorities and [CI gates](ci-gates.md) own exact structural checks. Preserve error/empty/loading states, accessibility, approved primitives and concrete tokens. No check's existence proves runtime enforcement or screen parity.

<a id="testing-strategy-manual"></a>
### Manual

Automated scans do not establish usability or complete accessibility. Retain these product checks within the current consolidated phase verification, without reintroducing per-change review rounds:

| Check | Method |
| --- | --- |
| Screen reader | VoiceOver on Safari, NVDA on Firefox |
| Keyboard only | One working session with no mouse |
| Fresh eyes | Someone unfamiliar attempts the main task unaided; every hesitation logged |
| Cross-browser | Chrome, Firefox, Safari, Edge |
| Real data | 10,000 work items, 50 projects, 200 people, long titles, non-Latin names |

Hesitation is a design bug, not a user error.

<a id="testing-strategy-load"></a>
### Load

**Tool** — k6; these are unchanged product load targets, measured on suitable hardware. A functional-only local/cloud SIT host proves no capacity result.

| Scenario | Target |
| --- | --- |
| 100 concurrent users browsing | p95 < 500 ms |
| 50 concurrent board views | p95 < 800 ms |
| 1,000 work item creations per minute | No errors |
| SLA scan over 100,000 items | Under 60 s |
| 500 concurrent WebSocket connections | Stable, no dropped messages |

Results recorded per release so regression is visible.

<a id="testing-strategy-test-data"></a>
### Test data

`tests/fixtures/` and `scripts/seed.ts`. Run `pnpm seed minimal`, `pnpm seed realistic`, or
`pnpm seed hostile` against the explicitly configured database. Seeding is additive and
idempotent within a stable TaskDesk fixture namespace: it may create or reuse its own
fixture rows, but never truncates, deletes, resets, or overwrites existing rows. A conflicting
fixture identifier fails with an actionable error. The CLI does not run migrations; the
database must already have the current schema. Required CLI preflight runs without connecting; disposable PostgreSQL verification covers profile counts, repeat runs and preservation of an unrelated row. The ordinary profile command must not create login credentials or grant memberships/roles.
Run `pnpm test:seed` for the disposable PostgreSQL regression suite covering these ordinary
data profiles.
The CLI verifies the complete fixture-owned default type/template sets and each project's
default columns and concrete states against the existing code defaults, including state
order, default selection, and template references. It retains database-generated row IDs;
any conflicting or incomplete default set fails the seed transaction without rewriting it.

Three sizes: **minimal** (one org, one project, ten items — for fast tests),
**realistic** (as above, for manual and performance), **hostile** (empty strings, 500-
character titles, non-Latin scripts, emoji, right-to-left text, null-heavy records,
deeply nested hierarchies).

<a id="testing-strategy-manual-role-verification"></a>
#### Manual role verification

The ordinary `minimal`, `realistic`, and `hostile` profiles remain login-free. Role-specific
test accounts are provisioned only through private, operator-managed tooling; do not commit a role-user credential manifest or private operator instructions. Verify the resulting
identity scope and role-based access through the API against an explicitly isolated test
database. Never commit test login identities, credentials, or credential instructions.

The hostile dataset finds more layout bugs than any other single technique.

The hostile profile is deterministic and bounded. It includes work-item titles of exactly
500 characters, empty strings only in schema-permitted text fields, nullable values omitted
where the schema permits them, non-Latin text, emoji, right-to-left text, and a cycle-free
parent chain. The retained bounded hostile profile uses one project and ten items, with a cycle-free parent chain of
depth ten; the realistic profile distributes 200 items to each project. The 200 realistic
people are staff-side placeholders with no login, memberships, or role grants. These bounded
choices exercise the named cases without introducing identity or authorization behavior.

<a id="testing-strategy-rules"></a>
## Test integrity

Never disable or weaken a test to get a pass. Every retained "must not" needs a meaningful negative case. Test observable behavior rather than implementation structure, keep tests independent and repeatable, and wait for an actual condition rather than sleeping. Repair flaky behavior; do not label a flaky run passing. Bug regressions should demonstrate the failure the change repairs; current AGENTS determines proportionate verification for reversible low-impact changes.

Local checks provide the implementation feedback loop; current remote branch protection still applies to publication. Historical fast/full-stage tables, model-specific reviews, automatic per-PR manual checks, old commands and obsolete test-status assertions are not revived here. The maintained testing and CI references own current commands and triggers. Real-provider blockers, browser checks, local tests, independent phase review and Thomas acceptance remain separate facts.

<a id="risks"></a>
## Retained risk controls

Historical likelihood/owner tables, elapsed deadlines, model assignments and delivery-lane procedures are retired. Their substantive product controls remain:

| Risk | Required protection |
| --- | --- |
| UX divergence (R1) | Original Kaneo composition and working interactions, shared primitives and real screen evidence; no "close enough" acceptance or weakened performance/contrast budget. |
| Half-integrated breadth (R2/R8/R15/R16) | Finish coherent persisted journeys; report missing behavior and chosen scope/date explicitly. Never silently convert unfinished work or a target date into completion. |
| v1 domain regressions (R3) | Preserve its tested SLA/workflow/approval edge cases, including DST, holidays, pauses, reopen and policy versions. |
| Authorization (R4/R20/R21) | Policies on inherited as well as new routes, reasoned public/delegated surfaces, current reach/authority, negative matrix/tenant/portal tests, no dormant auth/integration surfaces. A declared policy is not proof it is correct. |
| Provider reconfiguration (R5) | Atomic validated auth-holder swap/replica propagation, `auth.password` cannot be removed, retained local credential recovery, pre-enable validation, and explicit operator recovery. |
| Contributor licensing (R6) | Decide commercial contributor-rights requirements before external contribution; preserve AGPL source rights and attribution. |
| Conflicting implementation (R7/R17) | One maintained vocabulary, shared contracts, coherent data-fetching/component patterns and independently verified integrated result, following current disjoint-file coordination. |
| Job starvation (R9) | Chunk/yield, SQL aggregation, event-loop lag metrics/alerts, and a configurable job-only replica without customer-specific code. |
| Single-operator knowledge (R10) | Maintained human-readable requirements, recovery instructions and recorded decisions; documentation does not invent delegated authority. |
| Import corruption (R11) | Dry-run on copies, stable import mappings/idempotency, source provenance, reconciliation, and source systems read-only rather than immediately destroyed. |
| Unrestorable backup (R12/R13) | Monthly isolated restore record, dump validation before upload, actual plugin-secret decryption, separately held encryption keys and backup warning after 48 h. |
| Missed upstream fixes (R14) | Deliberate review of relevant upstream fixes, retaining the one-time pinned source boundary; no unattended upstream merges. Historical quarterly inspection was a maintenance target, not proof it happened. |
| Marketplace integrity (R18) | BYOL/contract preferred for optional future listing; no false tamper-proof metering promise when the buyer controls an AGPL installation. No phone-home without explicit optional configuration. |
| External exposure (R19) | Consolidated independent security review includes auth, tenancy, portal and inherited routes before real data; it does not replace the external penetration test required before external paying customers. |

The external test is a real procurement/provider dependency, not a simulated pass. A missing provider, scan, restore or screen check stays missing or blocked in the actual report. Current phase review replaces old per-change model/procedure prescriptions; product safety and independent security evidence remain.

<a id="release-plan"></a>
## Distribution, support and upgrade promises

TaskDesk's version lineage starts at `2.0.0-alpha.1` and follows SemVer separately from Kaneo. A maintainer selects a SemVer value and exact full SHA reachable from protected main; release binds its tag/assets/signed multi-architecture image to that source. It does not manufacture a version-bump commit or rewrite package/chart/changelog versions. Edge builds use `edge` and `sha-<gitsha>`; prereleases use stage-appropriate alpha/beta/rc identifiers. `latest` and installer `stable.txt` mean verified stable, never latest merge. Stable promotion follows verification and smoke tests of the exact digest; date alone is insufficient.

**Publication destination:** use GHCR, GitHub releases/tags/assets/packages. Docker Hub publication was cancelled by the owner on 8 October. Public installer/docs hosting and Marketplace acceptance are separate deployment obligations; source availability does not prove either is hosted.

<a id="release-plan-release-classification"></a>
### Published release classification

Owner decision 16 October supersedes classification based solely on tag syntax: an explicitly prerelease GitHub release remains pre-stable even if its tag is stable-shaped. Live classification fails closed when unavailable or indeterminate. Existing published tags/releases stay intact. Any exact approved API-break exception must follow the maintained contract gate and exact fingerprint binding; this clarification does not waive compatibility checks or imply all breaks are permitted. [API stability](safety-and-runtime.md#api-design-versioning) and [CI gates](ci-gates.md) own enforcement.

<a id="release-plan-support-and-upgrade-policy"></a>
### Support and upgrade policy

- Support the latest stable minor. After the first external customer, the previous minor receives security patches for 90 days after its successor. Its temporary security-only maintenance branch does not become a parallel feature line. Security patches use the exact intended source and verified stable promotion; publish a patch the same day as its associated advisory when required.
- Every stable release upgrades from the two preceding minors: restore each schema snapshot, migrate synthetic data forward and run integration checks. More distant upgrades use documented stepping stones. A restored anonymised production-copy dry run is an operator action; production data never enters CI.
- Schema changes are forward-only and destructive changes use the two-phase contract. Image rollback redeploys the prior verified digest in under 5 minutes while retaining the compatible schema. Database restore is exceptional for a failed major upgrade, rather than routine image rollback. Back up and verify restore before a major upgrade.
- API deprecation lasts at least two subsequent minor releases and its stated sunset; publish `Deprecation`/`Sunset` headers and a successor. Removal is deliberate, never automatic on the date. Third-party plugin contracts get independent versioning once external plugins exist; until then they follow the product. No LTS promise before 3.0; any later listing requires an explicit support commitment.
- Release records need honest human-written changes, actual feature/screen state, source identity, SBOM, image/archive signatures and build-provenance attestations. Preserve the retained vendor-fix-available HIGH/CRITICAL Trivy block, audit findings and dependency scan obligations; ignoring unfixed findings is not erasing them from triage. Migration matrix, required protected checks and digest-bound smoke evidence remain required for publication. No command list proves those results.

Historical phase→version tables are product positioning, not acceptance claims: P0/P1 are internal foundations; P2 is a service-desk pilot; P3 adds real customer identity/provisioning; P4 targets customer-configurable self-hosting; P5–P7 retain reporting/planning/import/accessibility/security scope. `2.0.0` was self-hosted-only; external paying customers require the P7 penetration test. Old conflicting sales phrases, five-week dates, reduced-scope assumptions and unconfirmed waiver text do not waive any current scope or gate. The full roadmap and current owner decisions govern actual delivery.

<a id="decision-log"></a>
## Retained owner decisions and bounded implementation resolutions

These are intended behaviors, not evidence of implementation. Earlier delivery/model/worktree procedures and historical acceptance records are retired. Current owner instructions override execution order; a historical hold is not a new approval flow. Specific unresolved product semantics and controlled external activation still need their actual contract/owner decision, not guesses. The source-line ledger distinguishes owner decisions, bounded technical resolutions, relayed records and superseded proposals.

<a id="decision-log-bootstrap-admission"></a>
### First-user bootstrap admission and verified completion

The 3 October contract closes the ownership/marker gap rather than treating a factor-reset route as recovery for it:

- Exactly one local first-user admission and one pending administrator may succeed when valid setup-token and headless-email signups race. The loser commits no extra ordinary user. Use trusted server-side credential handling, authoritative database state and the existing promotion lock; create the user and grant atomically, then recheck stale/expired state inside that boundary. An in-memory lock or separately committed pre-hook check is insufficient. No request role/flag or IdP claim grants administration.
- Leave `setup_completed_at` unset until that exact first administrator verifies real TOTP enrollment. While pending, enrollment is mandatory even when stored factor policy is off. Restrict the session to the documented authentication/enrollment surfaces and return `mfa_enrollment_required` for protected custom APIs. Finalize under the promotion lock after rereading first administrator, active staff person and verified factor; clear setup-token fields and preserve the configured policy. Headless bootstrap uses identical ordering.
- Initial zero-user creation is local credential signup. Enforce that on server routes, OAuth callbacks and email-OTP auto-creation; provider data cannot create the initial administrator. Issue setup tokens only while there are zero users. Once the first user exists and setup is pending, additional registration is closed. Never reopen an initialized completion marker.
- Initialized provider behavior and ordinary credential recovery remain. The administrative recovery CLI is initialized-only. A pending first administrator who loses both password and email access has no implied credential-reset/database-repair path; that scenario needs its own protected operator recovery contract.
- Prove distinct-credential concurrency and loser rollback, setup token lifecycle, required enrollment/policy-off and marker sequencing using real persistence. Documentation does not claim the previously recorded race or sequencing defect fixed.

The initialized recovery contract uses the existing instance-admin source and exactly one eligible active staff identity. Attribution includes the service process and host operator. Interactive confirmation occurs before database locks; eligibility/setup/current authority are revalidated under the promotion lock. Grant, audit and durable alerts are atomic. A post-commit email failure reports the committed state and keeps the alerts. MFA still applies; do not activate/link an identity, accept IdP authority or add a parallel role source.

<a id="decision-log-native-workspace-create"></a>
### Native workspace compatibility

The inherited default organization-create contract is **nine effects**: workspace; owner workspace membership; three default `viewer/member/admin` workspace-role rows with no seeded owner-role row; `workspace.created` payload `{workspaceId, workspaceName, ownerId}`; default team; creator team membership; active organization and active team set on the same creating session; and eventually exactly one creator `workspace_created` notification with workspace resource identity and `eventData.workspaceName`.

The notification is eventually consistent, tested with bounded polling of its exact identity; pre-response timing is incidental. The boundary is eight first-order effects plus that one durable consequence. Generic session timestamps, downstream notification events/provider sends, rate-limit internals and unconfigured hooks/storage are not extra create effects. Future listeners do not silently enlarge this frozen baseline. The nondefault `keepCurrentActiveOrganization=true` path is outside that default oracle, not permission to lose its semantics. If teams are redesigned, explicitly reconcile session selection instead of silently dropping it.

Native replacements retain inherited session-only access to workspace, membership, invitation and capability surfaces. An API-key header or Bearer token does not gain this data or mutation authority merely because a route moved. Native workspace mutation still requires the caller's actual workspace-role authority; instance-admin status alone is no substitute. Workspace creation has no existing workspace scope. Ownership transfer is owner-only `workspace:transfer_ownership`, session-only, with a fresh-owner recheck in the transaction; real operation-bound elevation is required when the supported step-up mechanism exists. No sixth policy kind or decorative unenforced elevation flag is introduced.

<a id="decision-log-project-and-work-item-compatibility"></a>
### Project, board and mutation compatibility

Plain workspace membership grants no project reach. The recorded owner/admin explicit `sees_all` and creator project-lead grants, their audit/backfill limits and D1–D6 product decisions remain in [permissions](permissions.md) and [alignment](../alignment.md). A policy cannot move to workspace scope merely to make a failing project comparison agree.

The selected concrete-state catalogue is authenticated `GET /api/projects/{projectId}/states` with `project:read` and project reach; active concrete states include empty columns and sort by `position ASC,id ASC`. Return `{id,stateTemplateId,name,group,position,isDefault}`: name/group from its workspace template, position/default from the concrete row. An archived template still referenced by an active adopted state does not remove that column. Catalogue membership grants no transition. Cross-column moves use server legal offers and the lifecycle endpoint; within-column order uses rank. Keep default-state creation semantics and original Kaneo drag/inline/keyboard interactions.

A work-item PATCH requires `If-Match`; its conflict response `{message,assertedVersion,currentVersion}` is a route-specific resolution contract, not a replacement global error envelope. Full-task mutation controls reactively subscribe to the complete shared cache, including omitted fields and version; a narrow display selector cannot become a stale mutation authority. A 404 after mutation denotes lost/missing access and shows the not-found state.

First-party legacy full-task writes use required-precondition `PUT /api/v2/task/{id}`. Deprecated `PUT /api/task/{id}` preserves optional If-Match compatibility, strictly enforcing a supplied version under the same row lock; every task-row writer atomically advances the shared version. First-party web/MCP full-task callers use the successor. Legacy headers are `Deprecation: @1790812800`, `Sunset: Thu, 01 Apr 2027 00:00:00 GMT`, and successor-version Link. Removal waits for both sunset and two subsequent minor releases. Omitted-header third-party clients retain overwrite risk during migration; do not pretend every legacy client is protected.

The legacy invitation detail URL remains registered/deprecated and permanently refuses with 403 after its real `member:invite`/session-only checks. It reveals no invitation. The distinct anonymous pre-sign-in invitation view retains only workspace/inviter/expiry, anonymous rate limiting and constant-shape unknown/expired 404; no email or member inventory. Do not conflate these two surfaces.

<a id="decision-log-intake-and-portal"></a>
### Intake, portal and immutable provenance

Customer-serving project creation may set one active customer organization binding; null is internal. General updates cannot rebind it. Existing projects stay internal without inferred backfill. Intake acceptance requires the destination's exact submission organization and pinned request-version workspace. Missing/unreachable destinations give equivalent safe errors; **failed acceptance leaves no claim**, superseding the earlier committed-stuck-claim behavior. Validate before claiming or roll back the claim in the same transaction; create no work item on refusal.

Published request types snapshot form schema, type suggestion, SLA override and default assignee. Queued submissions keep their version; edits do not remap them. IQ-7 allows the triager to override type. Validate referenced policy/tenant at acceptance; an ineligible snapshotted default assignee leaves the item unassigned with a recorded reason, superseding the old all-references-unavailable atomic-refusal wording. Type determines workflow; request types add no separate workflow override. Preserve original submission SLA start/provenance. Auto-accept uses system actor `{type:"system",id:null,name:"Request type auto-accept"}` while the customer remains requester/initiator; manual acceptance uses the staff actor.

Request-type route keys are immutable, instance-unique CUID2 values independent of row id, returned in DTOs and refused in create/update input. Portal conditional visibility reuses the browser-safe canonical evaluator (`eq`,`neq`,`in`,trimmed `is_set`), not a duplicate operator switch or Node-only package root. Catalogue/triage is the canonical intake surface; an alternate historical request-type runtime must not create a second model.

Only system auto-declines from clarification timeout may be reopened by the customer. Staff declines remain final to the customer; no staff reopen action is implied without its contract. Submission withdrawal before triage remains a real customer action. Current D5 archives request types with existing submissions; older unresolved deletion records do not undo that owner decision. Portal home/search/privacy behavior remains as recorded in alignment.

The bounded local customer sign-in asks email then password against existing portal endpoints for admitted customers, completes TOTP/backup-code challenges, shows one generic credentials/admission/provider failure and sends success to `/catalogue`. Email-first is local UI, without discovery/account/provider inventory. Serving a portal shell for registered client routes does not grant API admission. Registration, invitations, typed-domain SSO and actual external activation need their full current product/security contract; the old narrow sign-in decision adds no backend route, continuation redirect or provider default.

<a id="decision-log-comments-and-notifications"></a>
### One composer and reach-aware notifications

One original Kaneo composer preserves permission-filtered public/internal choices, JSON submission, accessible label, send/error handling, draft recovery, scoped mentions and edit/history behavior. Do not lose one branch's behavior by choosing another branch's composition or add unsupported mention delivery/attachment semantics by inference.

Mention composition uses a permissioned workspace-scoped preflight; save rechecks recipient access. Reachable mentions become watchers without losing an explicit mute. People lacking access receive no notification. Public customer mentions retain public-comment/reach rules; internal comments exclude customers. No cross-tenant directory or identity-derived authority follows.

Read-all marks only currently reachable notifications. Hidden/deleted/unreachable task notifications stay invisible and unread; single read returns 404. Restored reach to an existing item reveals it unread. Personal notification/preference/rule/avatar writes are browser-session-only until explicit API-key capability scopes are defined; read-only self routes do not acquire extra restrictions by inference. No invented notification/avatar capability.

Event outbox parents retain domain-event id; delivery children own unique event/person/channel fan-out, provider attempts and reservations; digest groups seal/fence members and recheck current reach/preferences. Parent requeue repeats only idempotent materialization, never resets/recreates/resends children. Child requeue preserves child identity and reservations. Provider acceptance without committed completion is at-least-once. Retention is child-before-parent with holds; [notification feature contracts](feature-contracts-p4.md#notifications) and events/data model own the detailed schema. Null workspace is permitted only for explicitly registered instance event types; tenant events stay anchored.

<a id="decision-log-approvals-and-pending-actions"></a>
### Approval and pending-action consequences

Existing approvals survive feature disable: reads, decisions, withdrawals and reminders retain current reach/permissions, while disabled requests are refused. A flag never bypasses workflow approval gates. An approver losing reach remains pending with `approverReachLost`; decisions are denied while reach is lost. Store decision notes only in `decision_note`, never activity/notification metadata. Request time is durable `created_at` for explanation/reminder arithmetic.

Approvals are single-use for their unlocked transition run. Withdrawn and expired approvals do not satisfy or block `any`/`all`; completing a transition consumes approvals and closes its remaining pending approvals using existing `expired`, audited `approval.closed`, no inbox/reminder and later decision 409. A new run needs new approvals. Reminder/expiry windows use the UTC database clock, not database-session local time.

Requester withdrawal and instance-admin withdrawal use separate routes. Requester route retains current work-item reach and `approval:request`; permitted API keys still require owner authority/frozen subset/policy/reach. Admin withdrawal requires a genuine session/current `instance:admin` rechecked under lock, with the explicit elevated:false exemption because it grants no authority. State, event and audit remain atomic; it grants no admin decision authority or new capability. The original approval-continuity/storage/admin-withdrawal entries were relayed and later explicitly carried unchanged, not re-verified direct quotations.

PA-9 terminal invalidation covers explicit session signout/revocation, API-key disable/revocation, original-key natural expiry and loss of the action's required current reach/capability. Restoration or extending an already-expired key never revives an action. Ordinary session expiry alone permits reauthentication to approve. Unrelated role/profile changes do not cancel it. Bind original session/API-key identity using existing fields/reasons/vocabulary. Current identity must resolve before own pending-action reads; invalid identity 401 precedes action lookup/audit; valid foreign/missing 404 is indistinguishable. Summary reads use the allowlisted DTO and fail if viewed audit cannot be written; AU-14 mutation audit behavior remains separate.

<a id="decision-log-sla-and-calendars"></a>
### SLA and calendar resolutions

SLA effective time is `sla_started_at`: creating accepted submission's original instant, otherwise item creation. In the creation transaction resolve type override → original request type → project → workspace and pin the published policy version effective then with same-workspace integrity. Null is no configured effective version. Duplicate submissions do not change existing start/pin. Never rebuild historical pins from mutable bindings or invent backfill when provenance is unavailable. Discovered real operated data requires an actual data policy before migration.

Published policy versions pin calendar ID/goals/threshold immutably, without copying calendar definition. Evaluation uses the pinned same-workspace calendar's current timezone/windows/holidays, so calendar edits affect dependent SLAs without mutating published versions. Reachable policy authoring has one draft, immutable published versions, complete metric/priority matrices for at least one type and locked version/CAS checks. Detail evaluation remains authoritative even when a separately specified cache stores derived state/deadline. Each manual pause/resume applies to response and resolution together; conflict in either rolls back both, never partial mutation.

Holiday import supports finite all-day UTF-8 RFC 5545 VCALENDAR 2.0 VEVENTs only. `DTSTART;VALUE=DATE` required; optional DATE DTEND is exclusive/default next day, converted to inclusive stored range. SUMMARY is optional safely rendered plain text with RFC unfolding/escaping; valid UID/DTSTAMP confer no authority. Reject timed/TZID, recurrence/exception, DURATION, non-VEVENT/nesting and malformed/unsupported properties. No URL fetch, execution, silent drop or partial import.

Limits: 256 KiB decoded UTF-8; 1,000 events; 8 KiB unfolded line; 120-character name; 366 covered dates/event; real dates within canonical bounds. Reject empty input/event set. Preserve existing holidays and dedupe exact canonical identity plus normalized name, allowing differently named same-day holidays. Return added/duplicate counts; zero-addition retry emits no update/version/effects, but supplied If-Match still validates under lock. Existing import route uses `sla_policy:manage`, workspace reach, `{ics:string}`, optional canonical If-Match and `{calendar,importedCount,duplicateCount}`. Validate before mutation then recheck reach/CAS under calendar lock, reuse registered update audit/event/alert behavior. UI uses shared file/preview/error controls; impact counts remain honestly unavailable where unspecified. Country presets are separate.

<a id="decision-log-users-and-identity"></a>
### User safety and identity bounds

Suspension input: optional trimmed nonempty reason ≤500 Unicode code points; optional nullable ISO expiry strictly after server now; omitted/null is indefinite. Revoke current native sessions/API keys; unsuspend revives no revoked credential. Both request/execution refuse self-suspend/deactivation and a result with no active unbanned instance administrator, serialized under the promotion lock. Suspending a current administrator uses its dedicated operation-bound step-up, not proof for another operation.

Local password signup ensures its staff person before completion; an OAuth callback never guesses staff/organization. First SCIM-created identity becomes a login only by exact active connection+issuer+subject, correct portal/side/organization and active person; email/userName/externalId never claim it. Inactive identity/person refuses without revival, conflicting address refuses, other connection follows its own admission. Current IP-22 lock/reconciliation and session-after-commit rules remain.

Connection-scoped provisioning history is instance-admin-only; missing parent 404; limit 25/default, 100/max; opaque v1 cursor bound to connection and descending created_at/id. DTO exposes only kind/outcome/actorType/createdAt plus nextCursor/hasMore; no row IDs, trace, detail or total count. SCIM conflicts use the same generic 409 regardless of same/other connection or organization; internal ledger may distinguish. Entra evidence/commit-time grants, exact app-role/acct admission and the 25 real-provider tests remain the maintained identity contract, not relaxed by this summary.

Account erasure uses a subject-bound internal safety summary of own current persisted workspace memberships and member/owner counts even if canonical identity/reach is unusable; names appear only in the existing conflict message. No other member identities/individual role rows/general query exception. SCIM/OIDC members count as others: if someone else retains workspace access, stop 409 for transfer/removal first. Keep existing owner interpretation, two-pass locks and refusal before invalidation/deletion.

<a id="decision-log-policy-and-runtime-observability"></a>
### Policy enforcement and safe operational evidence

[Permissions](permissions.md) owns the full source-bound shadow/enforcement semantics. Preserve old guards alongside strict until authorized removal; no permanent exceptions/translation shim, task source last after permission expand/contract. Only supported persisted facts establish scope; missing provenance/identity/reach/elevation or evaluator errors deny before mutation. Public config's owner-approved bounded substitute verifies unchanged public response/order and config source strict/rollback; it does not waive other sources' real observation requirements. Preserve actual date/source/traffic coverage; no fabricated or backfilled clean period.

Shadow/native denial comparison independently computes declarative reach from persisted facts, never forces denial from legacy HTTP status; unavailable facts are unevaluated. Observer-only provenance reads are bounded to a registered live exact resource for read denial, never response/log/audit, never mutation or shadow-off. [Query/safety](safety-and-runtime.md#security-model) remains authoritative.

Unsafe cookie-authenticated custom requests need Origin/Referer and double-submit CSRF; an unverified API-key/header does not exempt them. Native work-item realtime is one subscribed agent socket with persisted topic/reach checks; legacy sockets retain their distinct consumers. Control-channel invalidation publishes after commit, never to browsers, with periodic reauthorization fallback. Lifecycle logs use finite fixed event/result helpers, never raw exceptions/context.

Performance failure evidence must not time DOM serialization overhead as product work or retain network secrets. Keep bounded sanitized route-template/status/timing summaries, fixed unknown labels, no raw URL/query/headers/cookies/bodies and explicit truncation; screenshots occur after measured actions. Preserve budgets, fixtures, successful-write assertions, retries and paint visibility. Calibration/profile changes follow the exact maintained G11 contract, not an improvised waiver.

<a id="decision-log-product-scope-and-conflicts"></a>
### Product scope and explicit conflicts

- Reporting is three tiers with twenty fixed reports, saved row/column layouts and a bounded aggregation/chart builder; no new query language. Charts retain token series and accessible tables; dashboards retain keyboard resize/drag paths. Pages remains specification-required before building unapproved editing/sharing/history semantics.
- No arbitrary cap on sidebar entries/fields: use progressive disclosure and original Kaneo composition. No formula/rollup custom fields, round-robin assignment, currency conversion or collaborative CRDT editor is silently added; concurrent text uses optimistic conflict handling. Later candidates stay visible in the roadmap.
- Email SMTP is core for auth links/codes, invitations, setup and notification/action notices, configured through runtime UI/test send. Chat integrations and developer integrations are future distinct work, not inherited dormant routers. Storage defaults to filesystem without bucket/third hostname; operator S3 is optional with exact public endpoint/CORS.
- Older one-shot task-table migration decisions were expressly conditional on no live data. They do not authorize destructive cutover now. Deprecated task compatibility and preserved source/provenance must be reconciled through the maintained migration/import contract.
- Earlier global email-uniqueness/person-model and original no-RLS declarations conflict with later contracts. Current identity/tenancy rules and ADR dispositions govern: source identity is connection-bound; an RLS backstop prototype never replaces application scope/policy. Do not silently add multi-role union or grant on a malformed role string.
- Older new-v2-screen wording is superseded by the current owner instruction to mount original Kaneo components/UX on canonical APIs. Older stable-tag-only break classification is superseded by explicit GitHub prerelease classification. Older fourteen-report count is superseded by twenty. Earlier Marketplace-first schedules/metering guarantees are superseded by future optional listing/BYOL decisions.
- Historical feature-activation holds do not create a second agent approval process. Current authorization covers implementation/testing; real external provider/notification activation and unknown product semantics must be reported honestly rather than faked. No product feature is complete because an old branch, review or status paragraph says so.


<a id="decision-log-gate-scope"></a>
### Existing capability and visual-coverage decisions

The 28 September scope decision makes a safety check mandatory when the capability it protects exists; a future capability gains its checks in the same implementation workstream. This never permanently exempts a feature. G4 accessibility, G8 visual regression and G11 performance already have their prerequisites and cannot be deferred as future work. Current AGENTS governs the local feedback loop and protected publication; this is no additional per-change review ceremony.

The 1 October visual-coverage decision includes every exported UI Storybook story and each route-kind inventory row marked in progress or complete. A newly implemented route gains its registration, deterministic fixture and committed screenshot baseline with that implementation. Not-started routes remain planned work, with every inventory route in eventual scope. Local screenshots alone do not prove the complete committed-baseline comparison. These retained decisions do not claim the current gates pass.
