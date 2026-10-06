# Independent ordinary review A — P0 rendering delta

**Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate this candidate.

**Verdict:** CLEAR — no blocking or non-blocking source findings in the reviewed delta. This is an ordinary code review verdict for this exact UI batch only. It does not clear the separate hosted G11 acceptance gate or any other P0 gate.

**Reviewed candidate:** `9d4d6cc2d198833b5fc6be919b4890f62a2d9da4`

**Comparison:** `df74702dd93a6bf1da5e1dd5807576bd8c58035e` (review-artifact descendant of cleared shipping baseline `94ecb0fe9d6577c2bb4c6d5b540b803be5ccfc98`) to candidate. The candidate equals the assigned SHA at start and finish. The worktree was clean at start and finish; no source files were edited.

## Scope checked

Inspected the complete diff, all changed source/tests/docs, relevant work-item, view, relation, settings, and workflow contracts, and the related query hooks and label mutations. Confirmed the delta contains only these 19 paths:

- `apps/web/src/components/common/header/task-crumb-select.test.tsx`
- `apps/web/src/components/common/header/task-crumb-select.tsx`
- `apps/web/src/components/kanban-board/index.tsx`
- `apps/web/src/components/kanban-board/task-card.test.tsx`
- `apps/web/src/components/kanban-board/task-card.tsx`
- `apps/web/src/components/task/task-labels-popover.tsx`
- `apps/web/src/components/task/task-labels-section.test.tsx`
- `apps/web/src/components/task/task-labels-section.tsx`
- `apps/web/src/components/task/task-properties-sidebar.test.tsx`
- `apps/web/src/components/task/task-properties-sidebar.tsx`
- `apps/web/src/components/task/task-relations.test.tsx`
- `apps/web/src/components/task/task-relations.tsx`
- `apps/web/src/components/work-item/work-item-list-project-switch.test.tsx`
- `apps/web/src/components/work-item/work-item-list.test.tsx`
- `apps/web/src/components/work-item/work-item-list.tsx`
- `apps/web/src/components/work-item/work-items-panel.tsx`
- `docs/07-planning/decision-log.md`
- `docs/07-planning/status.md`
- `packages/ui/src/styles/pairs.json`

Reviewed query enablement/freshness when opening the breadcrumb and relation pickers; relation status and final-state/icon metadata from the columns query; label-section memo boundaries and task/workspace-keyed query updates after attach, detach, and create; permission gating; board task flattening and the unchanged card/keyboard/write paths; and list partial-result diagnostics, unavailable-key links, delegated hover/focus/click behavior, native modified-click behavior, and once-built row URLs. Checked the full docs additions against the supplied evidence and explicitly retained the hosted failure as unresolved. Pair comparison found 422 entries at both heads; contrast/color/category/ratio/theme/backdrop values are unchanged, with occurrence-context updates only. `git diff --check` was clean.

## Checks run

- Focused Vitest: 7 files passed, **24 tests passed**. Command: `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/common/header/task-crumb-select.test.tsx src/components/kanban-board/task-card.test.tsx src/components/task/task-labels-section.test.tsx src/components/task/task-properties-sidebar.test.tsx src/components/task/task-relations.test.tsx src/components/work-item/work-item-list.test.tsx src/components/work-item/work-item-list-project-switch.test.tsx`.
- Web typecheck: `pnpm --filter @taskdesk/web typecheck` passed (app and node configs).
- Biome: `pnpm exec biome check` on 15 changed TS/TSX files passed, no fixes applied.
- `pnpm check:tokens` passed; both agent and portal production bundles built, and contrast validation reported **422 declared pairs passing** in light and dark built CSS.
- `git diff --check` passed.

## Findings and limitations

No source findings. No permissions or authority code, APIs, data contracts, or writes changed in this delta. I did not run an interactive browser session, performance suite, Docker/container boot, PostgreSQL suite, or hosted acceptance checks; the review packet says hosted G11 remains **18/22** on the latest hosted result. That remains a separate red acceptance blocker and is not waived or replaced by these focused local checks. The author’s local G11 and browser evidence are not independent evidence from this review.
