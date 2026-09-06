# The permissions suite

The anti-v1 control. TaskDesk v1 shipped eleven authorization holes past a green test suite,
and every one was an omission — nobody wrote a bad check, someone added a route and wrote no
check at all. This suite converts that class of bug into a build failure.

See [RBAC](../../docs/01-architecture/rbac.md),
[ADR 0010](../../docs/01-architecture/adr/0010-route-policy-registry.md) and
[testing strategy](../../docs/04-engineering/testing-strategy.md).

## The command

```bash
pnpm test:permissions
```

One command, from the repository root. It needs **no environment variables and no database**:
`setup.ts` supplies bootstrap defaults, and the API app is *constructed*, never started —
`apps/api/src/index.ts` guards `startServer` behind an is-main-module check.

**Exit codes:** `0` everything passed · `1` at least one assertion failed, with the offending
route keys, plugin ids or fixture rows named in the output. There is no third state and no
warning-only mode.

**For CI (#10):** run this and nothing else. Do not write a second route scanner — the
enumeration lives in `packages/permissions/src/route-coverage.ts` and is shared. The job
belongs in the **fast** stage, as a required check, alongside lint, typecheck and unit.

## What fails the build

| Failure | Where it is caught |
| --- | --- |
| A route in Hono's router with no policy entry | `route-coverage.test.ts` |
| A policy of a shape that is not one of the five kinds | the registry, at construction |
| A public route with no stated reason; a delegated mount with no reason | the registry |
| A delegated surface outside the closed union | the registry |
| A policy whose route no longer exists (a renamed path) | `route-coverage.test.ts` |
| An `/api/instance/*` or authority-granting route with no `elevated` declaration | `elevated-actions.test.ts` |
| An `elevated: true` route that is not `sessionOnly` | `elevated-actions.test.ts` |
| An elevated route rbac.md's single table does not carry, or the reverse | `elevated-actions.test.ts` |
| A capability in `capabilities.ts` that rbac.md does not list, or the reverse | `capabilities-match-rbac.test.ts` |
| A built-in role whose capabilities or rank differ from rbac.md's table | `roles-match-rbac.test.ts` |
| A change to who may call what, without a fixture diff | `matrix.test.ts` |
| A better-auth plugin that is not on the approved list | `better-auth-plugin-list.test.ts` |

## The enumeration is Hono's router, not the OpenAPI document

The document cannot see the routes registered inline in `index.ts`, the `/auth/*` mount, the
websocket upgrades or `/metrics` — and `createRoute({ security: [] })` is documentation-only,
so the document and the enforcement can disagree silently. Position is untrusted as well:
`api.use("*")` gates only what is registered below it, and sixteen inherited routes sit above
it. A policy is a property of the route, never of where it happens to be declared.

`app.use(...)` registrations are excluded as middleware only when **all three** hold: method
`ALL`, a wildcard path, and a handler taking `(c, next)`. A catch-all terminal handler still
needs a policy.

## The two shrinking lists

Neither is an allowlist. Both only ever get smaller, and both fail when an entry goes stale, so
they cannot rot into permanent exemptions.

- **`inherited-uncovered.json`** — inherited kaneo routes still awaiting a verdict. The
  retrofit backlog for **#8**. Most entries disappear with #6's deletions rather than being
  classified. A *new* route never lands here silently: adding a line is a visible diff.
- **`better-auth-plugins-pending-removal.json`** — plugins removed at fork that #6 has not
  removed yet.

## Regenerating a fixture

By hand, deliberately, in the same change that changes behaviour. There is no flag that
rewrites `matrix.fixture.json` or either list: a fixture that regenerates itself asserts
nothing. When `matrix.test.ts` fails, the diff it prints *is* the review artefact — read it,
decide whether the widening is intended, and update the fixture only if it is.
