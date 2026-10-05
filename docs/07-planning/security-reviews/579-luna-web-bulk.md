# Independent ordinary review — PR #579

- **Candidate:** `add896ebbce5c827d30f89d80fed5e48c87b3552`
- **Base:** `8ddb9de8d4d242a0832f6f91e12872300480a905`
- **Model:** GPT-6 Luna
- **Independent reviewer context:** `25752809-9215-44C7-BC8B-76030FADD524`
- **Scope:** two web entries and portal boundary; shared UI, route metadata, density, contrast/accessibility; native realtime invalidation/reconnect; G8/G11 controls and evidence; the nine design-tokens §13 rows; CI changes.
- **Checkout:** requested worktree; `HEAD` matched candidate; initial `git status --short` was empty. No source or GitHub changes made.

## Verdict

**CHANGES REQUIRED — one blocking design-gate coverage gap.** The contrast implementation and ledger row 2 resolve the absent manifest/input problem for Button, Badge, and Input, but G3's stated universal requirement still exceeds the checker’s actual coverage. The candidate documents the limitation accurately; documentation does not make the uncovered pairs pass the stated gate. The known hosted failures remain separate acceptance blockers and were not re-reviewed as tiny fixes here.

## Blocking finding

1. **G3 does not cover every foreground/background pair required by its contract.** `docs/02-design/design-tokens.md` says every pair meets WCAG AA (lines 268–269), but the checker reads only `button.tsx`, `badge.tsx`, and `input.tsx` (`scripts/ci/check-contrast.mjs`, `sourcePaths` around lines 340–344); the spec expressly says all other component sources remain uncovered (design-tokens.md lines 309–312). Thus a low-contrast pair introduced in another shared primitive or application composition can pass `check:tokens`. This is the same canonical §13 finding 2, partially addressed by adding an operational manifest, but not closed against its requested “every legitimate … combination” scope. Either extend machine coverage to the promised source surface or record an authorized narrower G3 contract and its owner; do not claim universal G3 acceptance meanwhile.

## Nine canonical design-tokens §13 row dispositions (independent assessment)

1. **Product color values — addressed:** semantic light/dark values are now in `packages/ui/src/styles/theme.css`; authored status/priority/SLA values are documented in the design token document. I did not run the full token gate.
2. **No G3 pair input — partial (blocking above):** `pairs.json` and the built-CSS Chromium measurement path exist. They only enumerate/check Button, Badge, Input, while the owning document still says every pair.
3. **Invalid CSS spring — addressed:** the design document moves spring to a JS transition object and drops it from CSS; `packages/ui/src/lib/motion.ts` exports the transition. The remaining two CSS easing curves are documented as the source-supported curves.
4. **No shadow values — addressed by removal of bespoke token contract:** design tokens now direct authors to Tailwind’s existing `shadow-*` scale, and `motion.md` references `shadow-md`; no custom `--shadow-*` family is asserted.
5. **900px breakpoint — addressed:** `--breakpoint-app: 56.25rem` exists in shared `theme.css`; canonical doc names `app:`.
6. **Density enforcement — addressed for registered slots:** `density.css` and token docs register row/field/card slot values; `check-tokens` has a density-slot rule. Scope is explicitly starter inventory, not all future components.
7. **Font sizing conflict — addressed by removing bespoke pixel type-token scale:** typography points to Tailwind text utilities; the prior conflicting token table is gone. No new `--text-*` px scale found.
8. **Font serving/fallback — addressed:** local `@fontsource-variable/geist` imports and fallback stacks are stated in design tokens; web CSS imports the installed packages.
9. **Missing `ease-in` — addressed:** docs drop the unsupported third easing and motion documentation uses the two supported curves.

## Assigned review notes

- **Two entries / disabled portal:** `apps/web/portal/main.tsx` boots the portal-specific route tree and root; its only route renders `PortalUnavailableNotice`. `vite.config.ts` selects separate roots, route directories, caches and output directories; portal graph metadata is emitted for purity checking. This matches ADR 0004’s information-disclosure intent. It is not itself a server authorization boundary; no claim of one is made. The received portal route tree contains `/` only.
- **Route state:** route helpers derive both surfaces from generated trees and include a build/parse round trip. Focused route suite passed.
- **Realtime:** the hook subscribes to selected topics, invalidates affected list/detail/activity keys, invalidates lists after reconnect, reports denied/failed state and retries with bounded exponential backoff. Focused tests cover reconnect/outage paths. No material defect found in this assigned code.
- **CodeQL annotation `vite.config.ts:59` (JSON in inline preload script):** no finding raised. The serialized values are generated chunk file names and locale identifiers extracted from the checked-out build graph, with locale names restricted by a language-tag regex; they are not request data. This is build-time first-party metadata. This conclusion is scoped to those current sources and does not claim arbitrary future metadata safe for inline script embedding.
- **CodeQL annotations in `check-visual-scope.test.mjs`:** test source fixture strings are intentionally generated/tested source text, not an application sanitization boundary; no finding raised.
- **Performance budget, metric clocks, fixture datasets and CSRF fixture timing:** inspected the measurement harness and authored evidence pointers. I did not rerun G11 or alter/independently certify its 22/22 result. The given baseline evidence is author evidence.
- **G8:** independently ran `pnpm check:visual-scope`: passed, reporting 7 screenshot cases, 6 mapped active inventory route rows, 123 total rows. This validates declared scope only; it does not execute screenshot comparison or independently verify the author’s 142 Storybook snapshots. G8 browser results remain author evidence.
- **CI:** inspected both workflow diffs. G11 is now an unconditional performance job; G8 is an unconditional visual job; token check installs Chromium; inventory, bundle purity and bundle size checks are wired in. I did not treat wiring as successful run evidence.

## Checks actually run

- `pnpm check:visual-scope` — passed; 7 screenshot cases, 6 active inventory routes mapped (123 total route rows).
- `pnpm --filter @taskdesk/web exec vitest run src/hooks/use-native-work-item-realtime.test.tsx src/lib/routes.test.ts` — passed, 2 files / 15 tests.
- No full test suite, browser visual suite, contrast build, G11 run, API suite or Docker build was run by this reviewer.

## Residual acceptance state

- Hosted E2E/helper TypeScript/visual setup failures supplied in the assignment remain CI blockers; they are queued as one batch and were not reviewed separately.
- Full G8 execution and G11 22/22 are not independent reviewer results; status reports and artifacts cited in the repo are author evidence.
- The PR touches security-scope paths; a fresh exact-head GPT-6 Sol review remains required after ordinary review clears. No human H1–H6 approval or phase finalizer is claimed.
