# Independent Luna review B — PR #583 complete frozen candidate

- **Reviewed head:** `1cf9dcc9a163ce48c0a0c19695774e725da90606`
- **Comparison base:** `08842235047a3ab2714427edce80331b94558150`
- **Independence:** Fresh reviewer context; did not author, direct, or remediate this candidate. No source edits made.
- **Scope:** Complete UI/shared-primitive/create lifecycle and keyboard/performance-source composition delta; exact candidate diff (98 files). API authorization and PostgreSQL behavior were left to their assigned reviewer.
- **Verdict:** No blocking source findings in this review scope. This is an ordinary source-review clearance only; pending acceptance gates remain.

## Review performed

Read repository workflow, SDLC, coding standards, status/decision log, work-items feature contract, UX quality-gate definitions, author packet, current remediation packet, hosted G8 rationale and hosted outcome record. Inspected the work-list route lifecycle, intent-lazy create form, dialog error boundary, shared Input/Button primitives, G1 conversions, affected list/board/task composition, and the priority helper.

- The route renders the dialog shell on create intent and only loads the form module from the shell's lazy child. Route-key remount and context/generation checks guard project switch, back/unmount, and stale focus restoration. Escape cancellation is active while the shell is open.
- The shared Input change routes nativeInputClassName onto the rendered input and includes a primitive test/story. Inspected native-input uses in task title and label search.
- All 200-card / 500-row workload definitions and the list/board composition remain in place. The priority helper is byte-identical to the reviewed base: the component migration description in earlier notes does not match this candidate; it calls the existing generic resolver.
- `git diff --check 08842235047a3ab2714427edce80331b94558150...HEAD`: pass.
- `pnpm --filter @taskdesk/web exec vitest run src/components/work-item/work-item-create-dialog-shell.test.tsx src/components/work-item/work-item-create-trigger.test.tsx src/components/kanban-board/create-task-dialog.test.tsx src/components/shared/modals/create-task-modal.test.tsx src/components/kanban-board/task-card.test.tsx`: 5 files, 19 tests passed.
- `pnpm check:ui`: pass; 0 unlisted Radix imports, 0 Base UI imports outside `packages/ui`, 0 tracked raw-element rows.

## Acceptance evidence and residuals

The retained hosted outcome is for 6b7c094b, before the current snapshot-only commit. Its G11 run passed 21/22; the 200-card board median was 527.5 ms against the unchanged 500 ms budget (samples 527.5, 518.7, 539.1 ms). Current candidate changes only the sign-in visual baseline relative to that hosted source candidate, so the measurement remains a known acceptance failure pending exact-head replay; it is not a source finding established by this review. No threshold, retry, fixture, or workload changes were found in the candidate. No unproven list patch was introduced.

The G8 rationale documents that the current baseline bytes came from the exact hosted AMD64 screenshot and explains the remaining old-baseline differences as likely ARM64/AMD64 corner rasterization. That is a supported inference, not a passing result. Strict hosted AMD64 replay on the exact current head remains required.

Not run per assignment: browser, full G11, build/container, PostgreSQL, and full CI. The author packet reports lifecycle Playwright 5/5 and local G11 22/22 as author evidence; I did not independently rerun those checks.

## Bounded artifact delta review — d479a72a3dd3f4f48473e62d5d933ad83c94fa2c

- **Parent reviewed:** `1cf9dcc9a163ce48c0a0c19695774e725da90606`.
- **Exact delta:** one added path only: `packages/ui/src/components/primitives-input--unstyled-native-input--linux.png` (7,363 bytes). All source and test files are identical to parent; no source-equivalence issue observed.
- **Artifact identity:** 1280×720 RGB PNG; SHA-256 `e13ea445fc7368160c81c0f246e8bf8abb5476e4933c91ef3d927251e6bb31a2`, matching the provenance note.
- **Visual inspection:** image shows the unstyled native input story with the “Jane Doe” placeholder on the white canvas. No unexpected overlay, crop, loading state, or unrelated content is visible.
- **Provenance:** reviewed the original note and corrective addendum. They report capture from a clean archive of 1cf in the pinned Playwright image on explicit AMD64, with only temporary story enumeration narrowed and screenshot assertion/options unchanged. The note reports one targeted story pass and no capture-owned process left running.
- **Delta verdict:** no blocking artifact finding. This bounded review does not relabel the prior reviews or establish G8 acceptance. The full 144-story hosted replay on exact d479 remains pending; the 1cf all-seven-screen pass predates this added baseline.
- **Checks run:** exact git diff/name status, non-baseline source diff emptiness, artifact hash/dimensions, and visual inspection. No tests, build, browser, or container rerun.
