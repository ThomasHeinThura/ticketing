# PR 590 remediation delta — independent GPT-6 Luna review

- Candidate: `80ad3ba85530190c18bca94ad7aa249971899c11`
- Prior reviewed head: `32ed86f472645a2c69ea7200c1955e4787bbb1ad`
- PR: https://github.com/ThomasHeinThura/ticketing/pull/590
- Review context: same independent reviewer as prior review; did not author or remediate.
- Verdict: **CLEAR for the reviewed delta**. The prior pending-shell Escape blocker is resolved; no new blocking defect found in this bounded remediation.

## Delta inspected

Reviewed all five changed files: route pending-open keyboard cancellation and trigger ref wiring; trigger ref pass-through; the delayed-import E2E regression; G11 fixture origin handling; and the regenerated contrast occurrence manifest.

The Escape listener exists only while the shell is pending and removes itself when the shell is ready, an error occurs, or the dialog closes. Escape prevents the pending open, closes the state, and restores focus to the trigger. The E2E holds the shell response, presses Escape, checks both loading and dialog are absent and focus returned, releases the import, then verifies the dialog remains absent before reopening. This closes the blocker recorded against `32ed86f`.

The contrast manifest retains 434 pair rows and changes total source occurrences from 2,852 to 2,860 (+8). The new entries reference the extracted shell caller contexts, including the six route/dialog occurrences implicated by the hosted `static590` failure. I inspected the changed contexts and found no unrelated threshold or theme changes. The hosted/author check is reported as passing; I did not independently run the contrast browser/build gate under the no-browser constraint.

The G11 fixture now echoes the requesting Origin in its mock response/preflight. The fixture is used for performance and UI journeys, not as a CORS security test; I found no CORS assertion that this change disables.

## Checks actually run

- Focused route preload Vitest: **1 file / 1 test passed**.
- Web typecheck: passed (`tsc --noEmit` for app and node configs).
- `git diff --check` from prior reviewed head: passed.
- Inspected the three preserved PNGs in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-06/p0-budget-complete/pr590-screens/`; all are valid 1280×720 images and visually correspond to initial work list, loaded create dialog, and shell-load error states.
- I did not run browser/E2E, contrast rendering, hosted performance, SQL, Docker, or external-resource checks. Author reports 3/3 mock E2E, types, two unit tests, agent build, Biome, diff check, and canonical contrast validation passing; those remain author evidence, not checks I independently ran.
- No performance budget or hosted G11 acceptance is claimed by this review.
