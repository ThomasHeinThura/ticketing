# Independent ordinary review B — P0 rendering batch

## Candidate and independence

- **Reviewed head:** `c135595b8984e70ad6ee81833d87c9b572fa6243`
- **Comparison:** `3404c83aee957b05fac849d1c6b4eaa1f903e80a`
- **Reviewer:** fresh GPT-6 Luna context, independent from the implementation author and composition/fix work.
- **Verdict:** **REQUEST CHANGES** — one blocking stale full-task mutation source.

## Scope and review performed

Reviewed the exact seven web source/test files in the packet, plus the candidate's `status.md` and `decision-log.md` edits; read the required agent workflow, SDLC, coding standards, UX quality gates and work-items contract. Traced every current `TaskPropertiesSidebar` call site, all `useGetProjects` consumers, the property popover update hooks/fetchers, TanStack Query's observer listener logic, and dnd-kit sortable transition derivation. Checked full-task cache freshness, popover opening, provided-task behavior, move eligibility/project identity, and idle/drag/cancel/drop style conditions.

`git diff --check 3404c83a..c135595b` passed. **I ran no tests, builds, browser flows, or database checks.** No source files were changed. The packet reports the author's 12/12 focused component tests, web types, agent/portal production builds, UI/token checks, and desktop/390px smoke; that smoke used 50 successful writes. Root separately reported the canonical local G11 quiet run completed at 22/22 with 100 writes × 3. These are attributed reports, not checks I ran. This review does not establish CPU cause or hosted acceptance.

## Blocking finding

**Stale complete task can make start-date edits conflict after an unrelated background task update.** In `apps/web/src/components/task/task-properties-sidebar.tsx`, `taskForMutation` is read imperatively from `queryClient.getQueryData(["task", task.id])` (lines 111–113), while the `useGetTask` subscription selects a summary omitting `version`, `description`, and other full-task fields (lines 101–104 and selector above). The sidebar reads only the selected `data`; TanStack Query's observer notifies tracked props, and structural sharing keeps that selected object stable when only excluded full-task fields change. Consequently, a refetch or another observer can replace the raw cached task/version without rerendering this sidebar, leaving `TaskPropertiesControls`' ref (`task-properties-controls.tsx:74–75`) pointed at the old task. The memoized controls also capture that old task until a selected field or another sidebar dependency rerenders.

This is user-visible on the Start date control: `TaskStartDatePopover` reads the ref and calls `useUpdateTask`; `fetchers/task/update-task.ts` sends the full title/description and `If-Match` from that task. An unrelated background title/description update advances the server version, so selecting a start date sends the stale version and returns a conflict. The failed full-task update does not invalidate `['task', id]`, so the stale control can persist until an unrelated render/refetch. This is a correctness regression in the stated current-mutation-data boundary, even though version checking prevents a silent overwrite.

**Suggested disposition:** make the mutation source reactive to every raw task/version change, or resolve/refetch current task data when opening/committing a full-task mutation. Add a focused regression for an excluded-field/version-only cache update followed by opening Start date and saving. Preserve the summary subscription for render isolation.

## Non-blocking observations and residuals

- The current repository call sites do not pass `providedTask` to `TaskPropertiesSidebar`. That optional branch assigns `providedTask` directly as the mutation task and disables the query subscription; future callers must provide a live full `Task` source. It is not a present call-site failure, but the focused tests do not exercise this mode.
- `TaskCard` now omits inline drag styles while idle and retains them when `transform` exists or the item is actively dragging. Source inspection of dnd-kit shows post-drop derived transforms are used for sortable reflow; I found no concrete idle/cancel/drop defect in this branch. The existing card test stubs only the idle state, so cancel/drop/reduced-motion runtime behavior remains supported by the packet's scoped browser smoke only if actually exercised there; no such specific interaction assertion is claimed here.
- Move availability is selected as a boolean from workspace projects and keyed by the current task's `projectId`; `TaskMovePopover` separately subscribes to the destination project list. I found no project/workspace identity regression in the actual callers.
- The candidate status snapshot accurately records the state at its freeze, when canonical local G11 had not yet run. Root reports the reserved quiet run subsequently completed 22/22. The packet correctly says hosted G11 remains open and does not claim hosted clearance.
- No authored or independently run evidence here proves CPU causation, hosted acceptance, or browser interaction coverage beyond what the packet attributes to its author.
