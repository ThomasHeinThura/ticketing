# Independent ordinary review A — P0 rendering delta

**Reviewed head:** `c135595b8984e70ad6ee81833d87c9b572fa6243`  
**Comparison base:** `3404c83aee957b05fac849d1c6b4eaa1f903e80a`  
**Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate this candidate.  
**Verdict:** **BLOCKED** — one reproducible mutation-version freshness defect.

## Scope reviewed

Reviewed all seven changed web files and the related rendering delta: `task-card.tsx`, `task-move-popover.tsx`, `task-properties-controls.tsx` and its test, `task-properties-sidebar.tsx` and its test, and `use-get-projects.ts`. Also checked the changed status/decision-log facts, the view behavior rules VW-9/VW-10/VW-14, G11, board keyboard requirements, query/mutation call sites, and the current cached task mutation/version path. The frozen source worktree was clean at the exact reviewed head.

No source files were modified. I did not run repository test/build/browser/PG commands. After the canonical G11 quiet window ended, I ran one focused QueryObserver reproduction (from `apps/web`; an initial attempt from the worktree root could not resolve the app dependency). The reproduction changed cached task `version` 1→2 and `description` old→new while observing a selector with only `id` and `status`, and `notifyOnChangeProps: ['data']`. Result: `notifications: 0`, selected object identity unchanged, cache version 2. This confirms an update invisible to the component's selected data does not refresh its task snapshot. The root reports the canonical local G11 run passed 22/22; that result is orchestration evidence, not a check I ran. The packet's latest hosted G11 remains 19/22 and is not overridden by the local run.

## Blocking finding

**The property controls can submit a stale task version after a description-only update.** The sidebar selects a summary that omits both `description` and `version` ([task-properties-sidebar.tsx](/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2/apps/web/src/components/task/task-properties-sidebar.tsx:59), selector passed at lines 101–105). It then obtains the full task with a render-time, non-subscribing `queryClient.getQueryData` read (lines 110–113). `TaskPropertiesControls` copies that value into `taskRef.current` only during render (lines 74–75), and each memoized popover uses that ref when submitting its update.

A description edit in the same task detail view updates the full `['task', id]` cache after refetch, incrementing the server version while leaving every sidebar-selected field unchanged. Because the sidebar observes only selected `data`, TanStack Query can retain the same selected object and skip a component rerender. The ref then keeps the old version. A later start-date action spreads that stale task into the generic task update; `update-task.ts` sends `If-Match: "${task.version}"`, so the write can receive a 409 despite the user opening the controls against current task state. Other property controls use narrower endpoints, so this review does not claim every property action fails on the stale version. This is a regression from the prior full-task subscription, which observed the version change.

The added selector test asserts that `version` is absent (line 203), but it never changes the full cached task and checks the task consumed by an open control. The standalone reproduction above confirms the missing subscription behavior. Keep the display selector narrow while making the mutation snapshot react to the full task cache/version, or include a cache field that changes on every task mutation and prove freshness through the open-control path. Add a regression test that updates an omitted field/version and then verifies a property mutation uses the latest task version.

## Other review notes

- The project selector correctly reduces workspace project updates to a move-availability boolean; `useGetProjects` keeps its existing key and query function. The sidebar's two actual application call sites are the full page and details sheet; neither supplies a stale `task` prop, so both use the cache path described above. The move popover independently subscribes to the full project list.
- Board style inspection found the conditional inline style preserves transform, drag opacity, touch action, z-index, and the fallback transition while a transform/drag is active. I found no distinct board transition/keyboard semantic defect by inspection. There is no direct `TaskCard` regression test in the changed set; the canonical board drag run is relevant functional evidence but does not by itself exercise keyboard cancellation/reduced-motion semantics. This remains a coverage residual, not a separate blocker from this review.
- The candidate and packet make no new causal performance claim. The latest hosted G11 19/22 remains unresolved acceptance evidence independently of this code review.

## Actual checks

- Read-only diff, call-site, query hook, mutation, and spec inspection across the scope above.
- Focused QueryObserver reproduction: reproduced zero `data` notifications on an omitted-field/version cache update, with the full cache advancing to version 2.
- Repository tests/build/browser/PG: not run by this reviewer.
