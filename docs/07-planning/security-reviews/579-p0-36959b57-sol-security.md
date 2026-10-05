# Independent GPT-6 Sol security review — P0 integrated candidate

**Reviewed head:** `36959b579075a4463c04bd01ede7c55913abce33`

- **Reviewer/model:** GPT-6 Sol, fresh independent subagent context on 2026-10-05. I did not author, direct, or remediate this candidate. No repository file, commit, push, or merge was changed by this review.
- **Comparison:** previously cleared `83bb56493712d2a548ead33b865d65393ba5d3a7..36959b579075a4463c04bd01ede7c55913abce33`. This pass reviewed the complete later board/scanner delta and its integration with the earlier Sol-cleared P0 baseline. It is the per-candidate security review, not the separate P0 phase finalizer.
- **Trigger and risk:** the integrated P0 candidate includes earlier `apps/api/src/index.ts` and `scripts/ci/**` security-scope changes under `docs/04-engineering/ci-cd.md`. The later delta changes the scanner ignore file and source-bound G3 inventory. The ignore is outside the listed path triggers but directly affects a required security gate.

## Scope and evidence

Read AGENTS, agent workflow, CLAUDE, CI/security scope, current status and decision entry, the prior exact-`83bb` Sol clearance, the original blocked `146f` Luna A/B reports and both `369` delta-clearance reports. Inspected all changed paths in `83bb..369`, focused on board selection/focus ownership, prop propagation, task card handlers and authority boundaries, the historical TOTP fixture/ignore, public review notes, and the 228-pair contrast inventory.

Board selection/focus is subscribed once at board level and passed as projected booleans to memoized cards. The store creates a new selected-id Set on selection changes, and keyboard/mouse handlers call the current store action. Drag, task navigation and delete invocation remain behind their existing handlers. No changed code grants a capability, changes a server authorization check, introduces an API route, or changes tenant isolation. The new single-PR accessible name is React-rendered text from existing status/number data. This inspection found no new UI authority bypass.

The exact historical gitleaks ignore is bound to the old commit, fixture path, rule and line; it is neither path-wide nor rule-wide. I independently compared the historical and current deterministic fixture and decoded the Base32 seed without printing it: both match, and it equals the published 20-byte RFC 6238 public seed. The decision entry now correctly distinguishes current line 16 from historical line 13.

The G3 manifest contains 228 pairs at both comparison points. Exactly 36 records changed, and only their `occurrences` and derived `occurrenceIds` fields differ; all colors, surfaces, themes, minimum ratios and other pair metadata are unchanged. Luna B independently ran the current-head token checker: 228 declared source-grounded pairs pass in light/dark built CSS. This does not substitute for hosted CI.

I inspected the current-head operator assessment at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-04/p0-shadow-reach-runs/20261005T104047Z-36959b57/operator-normative-assessment.json` and recomputed the result-file SHA-256: `e928292edcd10e89887c150fac3ec04e2f914b8ceea4db4b4be4f36e2fedb391`. The assessment binds candidate/image revision and reports all 15 validations true: live health, UID 10001, accepted migration prefix, CAS/auth negatives, metrics, source hashes, reconciled events, 129 requests, 28/28 eligible sources, 44 tally rows, 127 occurrences, and eight cleaned resources. This is receipt inspection, not my own container run. The earlier Docker Hub TLS failure was followed by this successful separate run; both records remain.

## Checks I ran

- `git diff --check 83bb56493712d2a548ead33b865d65393ba5d3a7..36959b579075a4463c04bd01ede7c55913abce33` — passed.
- `pnpm --filter @taskdesk/web exec vitest run src/components/kanban-board/task-card.test.tsx` — one file, nine tests passed; native Vite config warning only.
- Independent JSON comparison — 228 pairs unchanged in count; 36 source-binding records changed, with no other fields changed.
- `gitleaks git --no-banner --redact --log-level warn --log-opts 'origin/main..HEAD' .` — **failed, one finding**. The redacted report is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/36959b57-sol-gitleaks-redacted.json`, mode 0600. Finding fingerprint: `36959b579075a4463c04bd01ede7c55913abce33:docs/07-planning/security-reviews/579-p0-146f0584-luna-a.md:generic-api-key:28`. The public retained note copies the deterministic URI; the old fixture fingerprint does not cover this new commit/path/line. No raw value is repeated here.
- Searched all public `docs/07-planning/security-reviews` notes for the same URI/secret form: only that Luna A note has the literal. The full gitleaks range scan reports only this one finding.
- Verified the checkout stayed at the reviewed SHA and remained clean.

## Findings and verdict

**BLOCKED — one required scanner gate failure.** The new review-note finding is the same verified public test vector, so I found no exposed production secret or authority bypass. It still makes the required gitleaks scan red on this exact candidate. Remove the literal from the public note while preserving the historical record and handle the immutable historical fingerprint narrowly; then freeze a new SHA and obtain current-head delta review and the required GPT-6 Sol security pass. Do not treat this report as clearance for a changed head.

No other blocking or non-blocking security finding emerged from the inspected source. The original `146f` contrast, rationale and accessible-status findings have evidence of remediation at `369`, but that does not override the new scanner failure.

**Delivery residuals:** The current head still needs publication/PR and exact-head hosted checks. Earlier hosted performance results and the author's scoped 293 ms board/browser run are not current hosted acceptance. Actual observation spans only partial October 4 and 5 UTC dates; October 6, DEV refresh/cutover, protected merge and the additional P0 Sol phase finalizer remain open. I did not run a browser, full CI, a Docker build, or a phase finalizer.
