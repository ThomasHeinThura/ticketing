# PR #768 (#715 structured work list) — security review

**Reviewed head:** 91b37b462786f8250ce5bd2d003c9d16394cd3ee
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Comparison base:** merge-base d159704be626136e728df7ddef0381dc37cf7756 (origin/main at review time 9297362b5f2dd1f17da935c8051c1562b473638a)
**Role:** independent security reviewer; did not author, direct or remediate this change. Read-only (scratch detached worktree, removed afterwards).

Head confirmed with `gh pr view 768 --json headRefOid` = 91b37b46..., state OPEN, MERGEABLE.

## Surfaces examined

- `apps/web/src/lib/work-item-filter.ts` (tokenizer, parser, printer, client-side leaf validation, bounds)
- `apps/web/src/lib/work-item-list-search.ts`, `apps/web/src/lib/routes.ts` (URL state: `filter`, `filterMode`, `columns`, `sort`, `dir`, `layout`)
- `apps/web/src/fetchers/work-item/search-work-items.ts` (request body for `POST /api/work-items/search`, error detail handling)
- `apps/web/src/lib/work-item-search-error.ts`, `components/work-item/work-item-list-controls.tsx`, `work-item-filter-editor.tsx` (error mapping)
- `apps/web/src/hooks/queries/work-item/use-get-work-items.ts` (query keys, cursor pagination, placeholder data)
- `apps/web/src/components/work-item/work-item-list.tsx`, `work-items-panel.tsx`, route `agent/projects/$projectKey/work.tsx` (rendering, export hold)
- `apps/web/e2e/work-item-structured-search.spec.ts` (security-scope path)
- Server counterpart read for alignment only: `apps/api/src/work-item/search/query.ts` (field whitelist; `default:` → 400), `search/repository.ts` (cursor bound to the query).

## Checks and conclusions

1. **No raw query fragments.** The client builds a JSON AST (`{field, op, value}` / `{op, clauses}`) and sends it as JSON; no string concatenation into a server query language. Operators are produced only from a fixed set (`eq|in|contains|lt|lte|gt|gte`, `and|or`). Unknown fields are deliberately passed through for the server to refuse; the server's `switch` whitelist answers 400 for anything else. The server is authoritative.
2. **Project scope cannot be escaped.** The user filter is always wrapped as `AND(project = <slug>, <user filter>)`; an `OR(...)` inside the user filter cannot widen it. Reach is server-side.
3. **URL state.** `parseWorkItemQueryState` whitelists `sort`/`dir`/`filterMode`/`layout`, bounds `filter` to 8192 chars with no control characters, and accepts `columns` only as a duplicate-free subset of the six known columns (JSON-string or array). No property of the parsed object is used as a write target, so no prototype pollution; probe with a `__proto__`/`constructor` URL confirmed `({}).polluted` stays undefined and hostile values fall back.
4. **XSS.** All rendered values (titles, state, assignee, client parse errors) go through React text nodes; no `dangerouslySetInnerHTML`/`innerHTML` in changed files. Detail links use the pre-existing `detailHref` construction.
5. **Error mapping.** The UI shows only translated messages keyed by status (400/403/422); server text is kept in `HttpError.message` but not rendered (unit tests assert this). Client-side parse errors are client-authored strings.
6. **Export hold.** No export/download control or download start; e2e asserts no `export|download` button.
7. **Cursor pagination.** The infinite query key includes `projectId`, sort, dir, filter, workspaceId and columns; cursors are per key and the server binds a cursor to its exact query. Placeholder data is reused only for the same `projectId` (test-covered).

## Commands run (real results)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | exit 0 |
| `pnpm turbo typecheck --concurrency=2` | exit 0, 9/9 tasks |
| `vitest run` 8 targeted files (filter, list-search, fetcher, hook, editor, controls, list, route test) | exit 0, 8 files / 119 tests passed |
| `pnpm turbo build --filter=@taskdesk/web` | exit 0, 5/5 tasks |
| `playwright test e2e/work-item-structured-search.spec.ts` (scratch config, port 4391, uncommitted; scratch-only port edit in the g11 fixture) | exit 0, 12 passed |
| Scratch probe test (deep nesting, prototype keys, hostile URL), deleted afterwards | 3 run; observations below |

## Mutation testing (each reverted; worktree confirmed clean after each)

| Mutation | Test outcome |
| --- | --- |
| M1 drop the leading `project` clause (send user filter unscoped) | killed — `search-work-items.test.ts` 1 failed / 8 |
| M2 render server error text instead of the translated message | killed — `work-item-list-controls.test.tsx` 4 failed / 6 |
| M3 remove the URL filter length/control-character bound | killed — `work-item-list-search.test.ts` 1 failed / 14 |
| M4 accept any `columns` value from the URL | killed — `work-item-list-search.test.ts` 1 failed / 14 |
| M5 reuse placeholder rows across a project switch | killed — `use-get-work-items.test.tsx` 1 failed / 9 |

## Findings

**Blocking:** none.

**Non-blocking:**

- **NB-1 (robustness): prototype-chain lookups in plain-object tables.** `aliases[...]`, `FIELD_TOKENS[...]` and `OPERATOR_TOKENS[...]` in `work-item-filter.ts` are plain object literals indexed with user text. A field token named after an `Object.prototype` member yields a non-string `field` (an object or function) in the AST; it serializes to `{}` or is omitted, and the server refuses it with 400. No pollution and no escalation (verified by probe), but the client produces a malformed document instead of a clean refusal. Suggest `Object.hasOwn` checks or `Map`s.
- **NB-2 (robustness): nesting depth is checked only after parsing.** The recursive-descent parser enforces depth 8 in `validateTree` after the parse, so an 8 KB string of nested parentheses reaches the engine stack limit (`RangeError`) first. Every call site catches it (fetcher → 400 not sent; editor → inline error), so nothing crashes and nothing is sent. Suggest a depth counter during parsing.

## Residual risk / not checked

- Server-side search authorization (reach, field permissions, cursor binding) was read for alignment, not re-reviewed; it is outside this PR's diff.
- Did not run full suites (load control); did not test against a real API runtime (the e2e spec is mock-only).
- Visual snapshot and i18n/`pairs.json` changes not security-relevant; not reviewed in depth.

**Verdict:** CLEAR


## Mechanical rebind after main moved to 9fecda429de7793c0f3d6058394c558903841a38

This section establishes that `44d5fa3791bda5186682b55047f0f24f7565306b` is a mechanical rebind of `91b37b462786f8250ce5bd2d003c9d16394cd3ee`.

**Reviewed head:** `44d5fa3791bda5186682b55047f0f24f7565306b`
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Main:** 9fecda429de7793c0f3d6058394c558903841a38 (accepted main)
**Previous reviewed head:** 91b37b462786f8250ce5bd2d003c9d16394cd3ee

Method:
- **Parents:** first = `91b37b46` (prior branch head), second = `9fecda42` (main tip). Clean merge commit.
- **Merge-tree equality:** `git merge-tree --write-tree 91b37b46 9fecda42` equals `44d5fa37^{tree}`. Clean merge, no manual conflict resolution or extra edits.
- **Overlap:** files changed by PR do not intersect files changed on main since merge base (0 files overlap).
- **PR content:** byte-identical to previous reviewed head.

**Verdict:** CLEAR

## Mechanical rebind after main moved to 90b102ee0cd7b1b2394204ddff1eb6e715ab6b10

This section establishes that `debdbf16fed41a24ca08ce4db6cc6248ec663e73` is a mechanical rebind of `44d5fa3791bda5186682b55047f0f24f7565306b`.

**Reviewed head:** `debdbf16fed41a24ca08ce4db6cc6248ec663e73`
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Main:** 90b102ee0cd7b1b2394204ddff1eb6e715ab6b10 (accepted main with #772 and #778)
**Previous reviewed head:** 44d5fa3791bda5186682b55047f0f24f7565306b

Method:
- **Parents:** first = `6ecfa91c` (prior branch head including rebind note), second = `90b102ee` (main tip). Clean merge commit.
- **Merge-tree equality:** Clean merge with zero conflicts.
- **Overlap:** files changed by PR do not intersect files changed on main (0 files overlap).
- **PR content:** byte-identical to previous reviewed head.

**Verdict:** CLEAR
