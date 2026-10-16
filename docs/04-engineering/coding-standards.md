# Coding standards

Biome enforces formatting and most lint rules. This document covers what a tool cannot
check.

## Language

- TypeScript, `strict: true`, everywhere.
- **No `any`.** Use `unknown` and narrow. If you genuinely need `any`, add
  `// eslint-disable-next-line` equivalent with a reason — it will be questioned.
- No non-null assertion `!` except immediately after a check the compiler cannot see, with
  a comment saying why.
- Prefer `type` over `interface` except where declaration merging is needed.
- Prefer `const`. `let` only where reassignment is real.
- Named exports. Default exports only where a framework demands one.

## Naming

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

## Comments

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

## Errors

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

## Async

- `async`/`await`, not `.then()` chains.
- `Promise.all` for independent work. Sequential `await` in a loop is almost always a bug.
- Every `await` on I/O is in a `try` or a caller that handles failure.
- No floating promises — the lint rule is on.

## Backend

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
[Query ownership](#query-ownership-issue-580) below. `check:queries` (issue #580) is planned
but not currently wired, and will enforce query locations rather than tenant-predicate semantics.

### Query ownership (issue #580)

- **Where queries may live.** Drizzle/SQL statements are written only in these places, and
  the final `check:queries` enumerates them exactly, with no wildcard over `database/`, no
  per-site allowlist and no baseline:
  1. repository modules, recognised by their own name: `**/repository.ts`,
     `**/*.repository.ts` and `**/repository/**` (this includes feature repositories that
     happen to sit under `database/`, for example
     `apps/api/src/database/repositories/notification-delivery.repository.ts`);
  2. the persistence infrastructure, an explicit list of files under `apps/api/src/database/`:
     `schema.ts`, `relations.ts`, `index.ts`, `executor.ts`, `resolve-database-url.ts`,
     `wait-for-database.ts`, `prepare-database-startup.ts`, `migration-schema.ts`,
     `migrate-membership-provenance.ts`, `ensure-application-role.ts`,
     `assert-application-role-is-not-privileged.ts`,
     `assert-no-migration-url-in-api-process.ts`, `append-only-tables.ts` and
     `scram-sha-256.ts`.
  A new file under `database/` is not allowed to query until it is either named as a
  repository or added to that list in a reviewed change. Controllers, middleware, services,
  routes and scheduler code call repository functions. Startup SQL outside `database/` (for
  example `utils/migrate-*`) moves into the list above or into a repository.
- **Transactions.** A service may open `db.transaction(...)` as orchestration. Every statement
  inside it goes through a repository function that accepts the handle. Opening a transaction is
  not query construction; running a statement outside a repository is.
- **Executor.** `Executor` (`apps/api/src/database/executor.ts`) is the shared connection or a
  transaction handle. A repository function that always runs inside a caller's transaction takes
  `executor: Executor` as its first parameter. A function that is callable both inside and
  outside a transaction takes `executor?: Executor` as its last parameter and resolves it with
  `executorOrDefault(executor)`. A function that never joins a transaction may use the shared
  connection directly. A repository never opens, commits or rolls back a transaction it was
  handed.
- **Tenant scoping.** A repository query that can return cross-organisation data uses the
  resolved identity and applies the caller's reach in the statement predicate. An additional
  workspace or project id is checked against that identity and also appears in the predicate;
  supplying an id alone does not prove the caller's reach. `forIdentity(identity)` remains the
  accepted illustration/convention for scoped repositories, without claiming a literal fluent
  API or universal `ScopedQuery` type guarantee is implemented. See [multi-tenancy](../01-architecture/multi-tenancy.md#query-scoping)
  and the [security model](../01-architecture/security-model.md#5-secrets-never-serialise-queries-are-never-unscoped).
- **Results.** Repository functions await their statement and return rows, DTOs or scalars,
  never an un-awaited query builder, so a caller cannot keep composing the statement.
- **Raw SQL and fragments.** Raw `execute`/`sql` statements follow the same rule. SQL fragment
  helpers (for example a project-scope predicate) live in repository modules and are composed
  there.
- **Out of scope.** `apps/api/scripts/**` (dev and seed tooling, not shipped in the image).

**Domain is pure.** No Drizzle import, no Hono import, no `Date.now()` — pass `now` in.
This is what makes it testable.

## Frontend

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
- Extract when a component exceeds roughly 150 lines, or when a piece is reused.
- No business logic in a component. Put it in a hook or in `packages/domain`.

**Forms** — React Hook Form with the **server's** Zod schema as resolver, so client and
server validation cannot diverge.

## Imports

Ordered by Biome: node built-ins, external, workspace packages, relative. Absolute imports
via path aliases within an app; relative only within a folder.

No circular imports. The dependency-cruiser check fails the build on one.

## Tests

- Co-located `*.test.ts` for units; `tests/` for integration and E2E.
- One assertion concept per test.
- Test names describe behaviour and cite spec rules:
  `test('SLA-9: reopening resumes rather than restarts the clock')`.
- Arrange, act, assert — visibly separated.
- No shared mutable state between tests.
- Fixtures in `tests/fixtures/`, builders over literals.
- Never `sleep()`. Wait for a condition.

## Database

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
  Nothing in `Dockerfile`, `deploy/` or `charts/` pins the server's `TZ`.
- **Never bind a raw JS `Date` into a `timestamp` column from a raw `sql` template.**
  Drizzle's `noopEncoder` passes the `Date` straight to `pg`, which serializes it in the
  *process's* time zone and appends the offset; PostgreSQL then drops the offset for a
  `timestamp` column, so the value stored depends on the application container's `TZ`. Bind
  `date.toISOString()`, use the query builder (which applies the column's encoder), or have
  the database compute the instant. Found in `withJobLease`'s lease INSERT, which wrote
  `18:30:00` for a `12:00:00Z` expiry under `TZ=Asia/Yangon`.
- Money `numeric(14,4)`. Durations integer minutes. Never floats for either.

## Security

Non-negotiable, and re-stated because they are the ones that matter:

- Every route declares a policy.
- Every response goes through a response schema.
- Never trust a token claim for authority.
- Never build SQL by string concatenation.
- Never log a secret.
- Never `dangerouslySetInnerHTML` outside the sanitised rich-text renderer.

## Performance

- Paginate. No unbounded list endpoint.
- Virtualise above 100 rows.
- Avoid N+1: load related data in one query, or batch.
- `React.memo`, `useMemo`, `useCallback` only when profiling shows a need. The React
  Compiler handles most of it, and premature memoisation is its own cost.
- Lazy-load routes.

## Git

```
feat(work-item): add fractional ranking
fix(sla): resume clock on reopen rather than restarting
docs(adr): record the single-backend decision
```

Conventional commits, enforced by commitlint. Present tense, imperative.

One logical change per pull request. A pull request that fixes a bug *and* refactors four
files is unreviewable, and unreviewable pull requests get approved without being read.

## Related

- [SDLC](sdlc.md) · [Testing strategy](testing-strategy.md)
- [Monorepo layout](../01-architecture/monorepo-layout.md)
