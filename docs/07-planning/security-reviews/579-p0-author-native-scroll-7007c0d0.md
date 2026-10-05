# G8 `primitives-sidebar--native-scroll` Linux baseline author receipt

## Source and hosted failure

- Isolated source branch: `codex/p0-g8-sidebar-native-scroll-baseline-20261005`
- Worktree: `/Users/heinthura/.codex/worktrees/p0-g8-sidebar-native-scroll-baseline-20261005/Ticketing.v2`
- Capture source commit: `b58c965426752f19a25d287bfb9000c678b0dd98`
- Original G8 failure: CI full run `37251234473`, head `b58c965426752f19a25d287bfb9000c678b0dd98`, result failure. Raw log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/hosted-b58c9654-g8.log`.
- Pinned artifact: run `37251234473`, artifact `11321390035` (`playwright-visual`). Download: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/g8-artifact-11321390035/`.
- Artifact SHA-256: `a741eb10655bb89dc9c18651f4c7fa15cb7d03dacb0ce16b46c23ebaaa31be11` for `storybook-visual-every-exp-165de-as-a-visual-baseline-visual/trace.zip`; `2bd8369e99c53b078b86212f94494641133220e46fc33fdc93b8cf4af49e0686` for `error-context.md`.
- The hosted artifact had no PNG. Its trace screencast frame was a transient blank/loading frame; the trace DOM snapshot showed the Sidebar story. It was not used as the baseline.

## Capture and visual inspection

- Reproduced the relevant Storybook runner settings from `.github/workflows/ci-full.yml`: pinned `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`, `linux/amd64`, Node `v24.20.0`, frozen lockfile, permissions package build, Chromium install, and `apps/web/playwright.storybook.config.ts`.
- Exact focused runner: `pnpm --filter @taskdesk/web exec playwright test --config playwright.storybook.config.ts --update-snapshots=missing`.
- Runner traversed 143 stories. Existing baselines were compared; the only repository output was the previously missing `primitives-sidebar--native-scroll--linux.png`. The command exited 1 because Playwright reports the formerly absent expected snapshot as a soft assertion failure while writing the missing-only actual image. This is not reported as a passing test run.
- Inspected the generated PNG with `view_image`: it shows the `TaskDesk` sidebar, `Workspace` label, active `Work items`, `Projects`, and the adjacent `Work items` content header/toggle. The image is 1280 x 752 pixels; the configured Desktop Chrome viewport is 1280 x 720 and the screenshot uses `fullPage: true`.
- Baseline path: `packages/ui/src/components/primitives-sidebar--native-scroll--linux.png`
- Baseline SHA-256: `66466b993caf10027d363beda6f02c92ef17bb29e20fe2c9a69945ab9bc01584`
- It is the sole source change in the isolated worktree; no story, test, semantic code, or other baseline was changed.

## Scope

This adds the missing Linux visual baseline only. The original hosted missing-baseline failure is preserved. No full visual suite, source tests, review, or performance claim is made here; the exact hosted check remains pending after final publication.

## Checkpoint

- Commit: `7007c0d02bf33499338c123b4304c584b0056455`
- Commit contents: the single Linux baseline PNG listed above.
- Branch was pushed to `origin/codex/p0-g8-sidebar-native-scroll-baseline-20261005`; the isolated worktree is clean after push.
- The staged-file Biome hook passed in the pinned Linux container (`Checked 0 files in 33ms`); `git diff --cached --check` also passed before commit. The host hook attempt failed before commit because its Mac Biome optional binary was unavailable after the container install; no bypass was used.
