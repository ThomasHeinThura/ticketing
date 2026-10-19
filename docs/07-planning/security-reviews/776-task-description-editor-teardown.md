# Real editor destruction before test environment teardown — #776

**Reviewed head:** `4e69c9ce9583d5916744504e8e6a54dd14b0ec5c`

This bounded test-lifecycle/CI pass-fail correction has one strong independent ordinary clearance and a separate fresh full Sol clearance. It observes real Tiptap Editor instances and waits for actual destruction before jsdom teardown, preserving the existing navigation/undo assertions. Application code and shipped runtime inputs are unchanged. The conductor's failure adjudication is evidence, not an independent review. Explicit dispatcher selectors were GPT-6 Luna for author/ordinary and GPT-6 Sol for security; original reports retain their runtime introspection limits.

The original hosted #790 exception is retained as a failure. One unchanged local comparison passed without reproducing it. Focused repaired-source verification passed two files/four tests, and standard web typecheck passed five tasks. A current complete hosted unit run is still necessary; no source review clears the older failed head or claims a product/browser/release/phase result.

---

Preserved record 1: `790-unit-failure-adjudication.md`; SHA-256 `5b2241c1e9ffc614ef63920e6ecc77cea4a874bd30cd4c69cd336c17ec4c5ae9`.

# Current #790 unit failure — not a pass

Exact head e49e88c97b96ba16293aab9f35e684e1446bfd18, job116691366406. Full unit/component job failed with11/12tasks. API120files859tests passed; web186files1023tests passed but Vitest caught ONE uncaught exception: `ReferenceError: window is not defined` during @tiptap/core destroy -> EditorView.destroy -> Editor.unmount -> Editor.destroy -> @tiptap/react delayed Timeout. Vitest attributes the error to `src/components/task/task-description.test.tsx`. The whole job exits1. Private rawlog790-unit-component-e49e88c9.log is retained, not an accepted result.

Static diagnosis: shared test setup calls synchronous Testing Library cleanup. This test intentionally uses real Tiptap editor lifecycle; unmount may schedule delayed editor destruction after jsdom teardown. A bounded file-local cleanup that waits for actual editor destruction before environment teardown is a candidate repair. This is a hypothesis supported by the stack, not yet reproduced or fixed; no unchanged CI rerun or suppression is authorized. Keep real editor, original #1580 navigation/undo assertions and unhandled-error failure behavior. No dependency/global-error workaround, arbitrary extended suite timeout or skip.

Existing issue776 covers test failures/load; this is a newly observed concrete acceptance failure. No source change, authored test, review clearance or merge from this diagnosis. Root will assign one bounded Luna author on a separate clean branch when a slot is available; avoid editing reviewed #790 source merely to hide the failure.

## Local comparison

One unchanged focused local run on #790 sourcee49e88c9 completed exit0: task-description.test.tsx one file/two tests passed, no uncaught error. Raw local result790-task-description-local-reproduction.log retained. This did not reproduce the hosted timing condition and does not supersede the failed complete job. Any repair must establish real editor destruction before jsdom teardown rather than suppressing errors or retrying the hosted suite unchanged.


---

Preserved record 2: `task-description-teardown-repair-luna.md`; SHA-256 `6b9bfef9c005ce579e6a793e49d3110843a4b529ee4913fe227d764f3f6dc973`.

# #776 hosted task-description teardown repair

- **Author context/model provenance:** GPT-6 Codex implementation context (this report is the author’s record, not an independent review).
- **Branch:** `codex/task-description-teardown-776`
- **Base:** accepted `main` `e9df2294fa580fd2885343bbef0cec28e81ead4c`
- **Candidate:** `4e69c9ce9583d5916744504e8e6a54dd14b0ec5c`
- **Commit:** `test(web): await task description editor teardown`
- **Scope:** only `apps/web/src/components/task/task-description.test.tsx`.

## Evidence and diagnosis

The hosted #790 failure adjudication records exact source `e49e88c97b96ba16293aab9f35e684e1446bfd18`, job `116691366406`, and a Vitest unhandled `ReferenceError: window is not defined`. The private hosted log’s relevant stack is Tiptap core `destroy` → ProseMirror `EditorView.destroy` → Tiptap `Editor.unmount`/`Editor.destroy` → delayed timeout in `@tiptap/react`; Vitest attributed the exception to `task-description.test.tsx`. The hosted web task otherwise reported 186 files and 1,023 tests passed but exited with the unhandled error. I read only this failure excerpt; no secret content was copied here.

The existing web setup’s Testing Library cleanup runs synchronously in a setup-file `afterEach`. The focused test uses a real editor. Repair wraps the real `useEditor` only to observe each actual `Editor` instance and its `destroy` event. A file-local `afterEach` first unmounts with `cleanup()`, then awaits the event for every observed editor before jsdom teardown. It does not mock the editor, suppress errors, add sleeps, alter setup, or modify production code. Both original #1580 navigation and undo assertions remain unchanged.

The independent prior unchanged focused run on #790 source passed 1 file / 2 tests and did not reproduce the hosted race. This candidate’s local focused run also passed; neither is evidence that the hosted failure has been cleared. The lifecycle regression is enforced by awaiting each real editor’s destroy event in teardown; if destruction stops occurring, teardown does not silently finish. No separate negative-control run was feasible without recreating the unavailable hosted timing condition, so no negative-control result is claimed.

## Checks

- Frozen dependency install: `pnpm install --frozen-lockfile` completed; lockfile unchanged.
- Focused and adjacent behavior: `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/task/task-description.test.tsx src/components/task/task-description-save.test.tsx` — exit 0, 2 files / 4 tests passed.
- Web types: direct `pnpm --filter @taskdesk/web typecheck` initially failed because workspace package build outputs were absent in the fresh worktree. The prescribed dependency build path then passed: `pnpm exec turbo run typecheck --filter=@taskdesk/web` — exit 0, 5 tasks successful including web typecheck.
- Biome: `pnpm exec biome check apps/web/src/components/task/task-description.test.tsx` — exit 0, one file checked.
- `git diff --check` — exit 0.
- Commit hook rechecked the changed file with Biome and passed.

## Residuals

The original hosted fault was timing-dependent and did not reproduce locally. No hosted rerun was performed; do not infer clearance from local tests. Independent ordinary review remains outstanding. No push, PR, merge, full suite, browser, Docker, or PostgreSQL work was performed.


---

Preserved record 3: `task-description-teardown-ordinary-luna.md`; SHA-256 `e3412aa65ff6a5936d594179c82721e5a161bc0c4a82219b7f1ae5392805d456`.

# #776 ordinary review — task description editor teardown

- **Reviewer model:** GPT-6 (platform model for this reviewer context)
- **Role:** independent strong ordinary reviewer for bounded CI/test lifecycle repair
- **Independence:** fresh reviewer context; did not author, direct, or remediate this change
- **Branch:** `codex/task-description-teardown-776`
- **Base:** `e9df2294fa580fd2885343bbef0cec28e81ead4c`
- **Reviewed candidate:** `4e69c9ce9583d5916744504e8e6a54dd14b0ec5c`
- **Scope:** `apps/web/src/components/task/task-description.test.tsx`

## Checked

Inspected the candidate diff, the web test setup hook, the pinned installed Tiptap React/core lifecycle source, the author diagnosis, and the adjudication of hosted job `116691366406`. Confirmed that the wrapper calls the actual `useEditor`, returns the actual editor unchanged, and records each non-null editor returned across renders. The existing Tiptap hook creates the editor in its effect, publishes it through its external store, and later schedules destruction after unmount. Core emits `destroy` synchronously before calling its own unmount cleanup; when invoked from the scheduled destruction callback, the teardown hook's awaited promise continuation runs after that synchronous callback stack (including core unmount) completes. If a tracked editor never emits destroy, the afterEach remains pending until Vitest's hook timeout, failing the test run rather than clearing the error.

The local file hook explicitly unmounts before awaiting all recorded editors. The shared setup also calls cleanup; the duplicate cleanup is idempotent, and regardless of hook ordering the local hook invokes cleanup before its own wait. The mock preserves all other `@tiptap/react` exports and does not replace the editor implementation. The original navigation and undo assertions remain intact. The test keeps genuine editor instances and no error suppression, sleep, dependency, or global setup change was introduced.

## Checks

- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/task/task-description.test.tsx src/components/task/task-description-save.test.tsx` — exit 0; 2 files / 4 tests passed.
- `pnpm exec turbo run typecheck --filter=@taskdesk/web` — exit 0; 5 tasks successful, including web typecheck.
- `git diff --check e9df2294fa580fd2885343bbef0cec28e81ead4c..4e69c9ce9583d5916744504e8e6a54dd14b0ec5c` — exit 0.
- `git status --short` — clean at review time.

## Findings and limits

No blocking or non-blocking code findings. The event wait is tied to actual editor teardown and preserves the original regression coverage. This is an ordinary-review pass for the exact candidate above.

The historical hosted failure was not reproduced by the focused local check, as recorded in the source evidence. This review does not establish hosted full-suite clearance. The required independent GPT-6 Sol security review remains outstanding for this bounded CI/test pass/fail repair; hosted full-suite rerun is also still required before declaring the failure cleared.


---

Preserved record 4: `task-description-teardown-security-sol.md`; SHA-256 `a9e8e804c97bac4f3e7491ffd52a8318cd67fe691c20e854072560186c7f8494`.

# #776 task-description teardown — independent security-tier review

- **Model:** GPT-6 Sol (assigned reviewer dispatch; this context is the Sol-tier reviewer).
- **Role/context:** fresh independent security-tier reviewer; no inherited author turns; did not author, direct, or remediate the candidate. Reviewer output is this file.
- **Branch:** `codex/task-description-teardown-776`
- **Comparison base:** `e9df2294fa580fd2885343bbef0cec28e81ead4c`
- **Reviewed head:** `4e69c9ce9583d5916744504e8e6a54dd14b0ec5c`
- **Scope:** `apps/web/src/components/task/task-description.test.tsx` only; bounded test lifecycle and CI pass/fail evidence repair. No application authorization logic changed.
- **Verdict:** PASS for this exact candidate, within the source and focused-check scope below. No blocking or non-blocking code findings.

## Review

Read the exact candidate diff and entire test file, web test setup, TaskDescription component context, pinned installed Tiptap React/core lifecycle code, ordinary review, author evidence, and the hosted #790 failure adjudication. The wrapper delegates to the actual `useEditor`, returns that same real instance, and tracks every non-null instance by identity. It preserves the remaining Tiptap React exports and the original #1580 navigation and undo assertions. The existing inert extension mocks predate this change.

The local `afterEach` calls Testing Library `cleanup()` before waiting. Tiptap React's effect cleanup schedules `Editor.destroy()` in a 1 ms timeout. In the installed core, `destroy()` emits `destroy` synchronously, then calls `unmount()` and clears internal resources. The test's promise resolution queues its continuation as a microtask, so the awaited hook resumes after the synchronous destroy callback stack, including ProseMirror view destruction, has completed. The setup-file cleanup and local cleanup are idempotent; whichever hook runs first, the local hook waits after an unmount. A missing destroy event leaves the hook pending until Vitest fails its hook timeout. The code does not swallow an exception, create a dummy editor, skip a test, add an arbitrary sleep/global timeout, or alter a dependency or product file.

The observed hosted error was thrown in the delayed Tiptap destroy after JSDOM removal. This change directly waits for that real lifecycle boundary while keeping JSDOM alive. A `destroy` callback exception or post-event synchronous cleanup exception is not suppressed; Vitest's unhandled-error behavior remains available to fail the run. There is no security authority or tenant boundary modification.

## Checks performed in this reviewer context

- `git rev-parse HEAD` — exact reviewed head above; `git status --short` — clean.
- `git diff --check e9df2294fa580fd2885343bbef0cec28e81ead4c..4e69c9ce9583d5916744504e8e6a54dd14b0ec5c` — exit 0.
- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/task/task-description.test.tsx src/components/task/task-description-save.test.tsx` — exit 0; 2 files / 4 tests passed. Vite emitted only its existing config native-loader warning.
- Existing ordinary-review evidence records web typecheck (5 Turbo tasks) and focused 2-file/4-test pass on this same head; those are prior evidence, not tests run by this reviewer.

## Residual and gate boundary

The timing-dependent hosted failure did not reproduce in the unchanged focused local check and no hosted full-suite rerun has been performed on this candidate. This PASS is an independent review of the repair and local focused execution, not proof that hosted job `116691366406` has cleared or that the full image/runtime is accepted. Required exact-head hosted checks and any other PR gates remain for the conductor; this review does not waive them.


