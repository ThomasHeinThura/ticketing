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

**Repositories own queries.** `db.select()` outside `*/repository.ts` is a lint error, so
an unscoped query cannot creep into a controller.

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
