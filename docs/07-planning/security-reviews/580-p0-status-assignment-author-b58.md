# P0 status and assignment interaction author evidence

This note records the author’s source and verification evidence. It is not an independent review or a hosted G11 acceptance claim.

## Source

- Base: `b58c965426752f19a25d287bfb9000c678b0dd98`
- Checkpoint: `2a5a811ddedfd820b008759b5d8a97feefe08bb7`
- Branch: `codex/p0-status-assignment-b58-20261005`
- Source tree: `676eda2db03f1915b7620e7ada8f8286b1918e1f`
- Binary diff SHA-256 from base: `d186eb6958e8d47ae92683614e2bff382c1577d34e4a679756e4bfed8b7bdc34`

The status and assignment option rows are memoized, and their event handlers stay stable across the optimistic task update. Handlers continue to use the latest full task reference for mutation input. The shared optimistic field writer now avoids publishing an unchanged confirmed value to the task cache; assignee confirmation compares the existing assignee ID/name fields. Tests cover both status and assignee confirmation without a redundant cache publication. The API edit only corrects the static-serving comment: registration is unconditional and the middleware responds per-request when a build is absent.

## Verification

- Focused Vitest: 4 files, 24 tests passed. Log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-status-assignment-b58/focused-vitest-final.log` (SHA-256 `fe9e3e1b382f7a77449c8d7a057337177f014abd9408b0a561a09c002d3d9316`).
- Web typecheck: `pnpm --filter @taskdesk/web typecheck`, exit 0. Log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-status-assignment-b58/final-web-typecheck-2.log` (SHA-256 `12284c28b556c339533415d91551b68d7a13902548b4a44c9aebf3d167f4c54c`).
- Web workspace build: passed. Log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-status-assignment-b58/workspace-web-build.log` (SHA-256 `3d18557701112f702abd72d180331714481bc57919c42f56f26edd6e3ce93215`). Agent manifest SHA-256: `6d1d7dae15ca551bcd9d8928d157a467d7f972a324a5e0cd6de29ae693608903`; portal manifest SHA-256: `06f3b04506b2a1d9fd6e81147e17d275e7317a8d9d4be8a41a1750e548f3a2fe`.
- Scoped browser benchmark: the existing status and assignment click-to-paint cases both passed with unchanged `<200 ms` budgets. Status median 76.2 ms (75.1, 76.2, 77.3); assignment median 77.7 ms (81.3, 73.9, 77.7). Log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-status-assignment-b58/scoped-state-assignment-perf.log` (SHA-256 `e09bfd20f38e092c44ee8c9e28d1090278ac6120a4ca13b9c5ce35367f7bd4ed`). This is scoped local evidence, not a full or hosted canonical run.
- `git diff --check` passed. Browser captures: `apps/web/test-results/g11-screens/legacy-task-state.png` and `apps/web/test-results/g11-screens/legacy-task-assignment.png`.

## Retained initial failure

The first focused run found that calling TanStack Query `setQueryData` with the same task object still emitted a cache success notification. Both new no-redundant-publication assertions observed two writes instead of one (2 failing, 22 passing). The shared writer was changed to check equality before calling `setQueryData`; the final focused run above passed all 24 tests. Initial output remains at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-status-assignment-b58/focused-vitest-first.log`.

No full canonical performance suite, hosted acceptance run, or independent review is claimed by this note.
