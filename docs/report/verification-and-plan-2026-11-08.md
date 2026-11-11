# Checking the 8 Nov Codex and Gemini audit reports — results and plan

**Checked:** 8 Nov 2026 by Claude (Opus agents), against `main` 733c99d (release 1f9d949 + docs), the source, anonymous GETs to UAT, and the repo's mocked browser fixtures. Every confirmed defect was re-checked by a second agent trying to refute it; all held. Local SIT was down during the check (Docker Desktop not running), so screen claims that need a signed-in local session were checked on fixtures only. No tracked file, UAT data or seed was changed.

Reports checked: `openai-uat-audit-2026-11-08.md` and `openai-uat-browser-audit-2026-11-08.md` (Codex), `gemini-uat-full-audit-2026-11-08.md` (Gemini). `report.md` was an untracked byte-identical copy of the Gemini report and was removed on 11 Nov after verified private backup.

## 1. How accurate the reports are

- **Codex: accurate and careful.** Its claims hold, it states its limits, and it keeps UAT hosts out of the text. Two small errors: `.vscode/mcp.json` is not tracked (it is git-ignored), and the portal Backlog item is low, not medium.
- **Gemini: real findings, but its summary overclaims.** Its individual code findings mostly hold, but:
  - "API isolation is 100% enforced" / "API enforces capabilities on all mutations" — **false**. No mutation was sent, and its own F-02 shows leads can archive projects.
  - "154 rows: 144 PASS / 2 FAIL / 8 seed gaps" — **false**. Its own table adds up to 127 PASS, 14 WARN, 2 FAIL, 9 SEED GAP, 2 DRIFT; the two FAILs are on the wrong rows (64 and 75 instead of 55 and 70); verdicts were hard-coded in its script. "PASS" only means the page document returned HTTP 200.
  - "One `<main>`, one `<h1>` and a skip link on all 154 rows" — **false** by its own raw data (17 rows without h1, 3 with two, 7 without a skip link).
  - Wrong-portal refusal "403 for all 11 accounts" — only 2 accounts were tested; the rest were extrapolated.
  - "All 11 accounts signed in in Chromium, Firefox and WebKit" — each account signed in once; the session was copied into the other engines.
  - "WebKit CORS warning" — not CORS (same-origin); it is an aborted request during navigation. Not a defect.
  - "Project tab bar overflows at 1440" — not a defect: the strip scrolls and has a "More" menu.
  - Gemini's report, its copy `report.md`, `uat-audit-report.html` and `docs/uat-role-checklist.md` contain UAT host names, which AGENTS.md keeps out of docs. No credentials, cookies or emails were found in them.

## 2. Verified defects

| # | Defect | Verdict | Severity | Source |
|---|---|---|---|---|
| D1 | Expanded IPv6 forms (`0:0:0:0:0:0:0:1`, `0:0:0:0:0:ffff:127.0.0.1`, metadata IP) pass the private-address guard; the SMTP host path dials them. Also `::ffff:0:7f00:1` and `::127.0.0.1` (new; neither report found them). Instance admin only. | Confirmed | Medium | Codex F1/S2, Gemini F-01 |
| D2 | Leads can archive/unarchive projects and change board columns and workflow rules: routes require `project:update`, contract says `project:archive` / `project:manage_settings`. | Confirmed | Medium | Codex S1, Gemini F-02 |
| D3 | Request Types settings show the full authoring UI to lead, member and viewer on direct link (server still refuses writes). | Confirmed | Medium (UI only) | Codex B1, Gemini F-03 |
| D4 | Checkbox "Show when" never matches: editor stores the text "true", portal sends a boolean, comparison is strict. | Confirmed | Medium | Codex S5, Gemini F-05 |
| D5 | Hidden conditional answers and files are still submitted, stored and shown in two places. | Confirmed | Medium | Codex S4, Gemini F-07 (Gemini's "low" is too low) |
| D6 | `/agent` projects table on phones: scroll area not keyboard-focusable (axe serious), and project rows cannot be opened by keyboard. | Confirmed | Medium | Gemini F-13 (Gemini's "low" is too low) |
| D7 | UAT Content-Security-Policy is report-only (no enforcing CSP). Contract plans enforcement after rollout. | Confirmed on UAT | Medium (defence in depth) | Codex S6 |
| D8 | Terminology settings: lead, member, viewer get a 403 and an error with Retry instead of "no access". | Confirmed | Low | Gemini F-04 |
| D9 | Request-type editor: "Maps to" and "Show when" cannot be cleared once set; labels hard-coded in English. | Confirmed | Low | Codex F4/F9/B8, Gemini F-08 |
| D10 | Portal number fields send strings, so a number answer is rejected. No number field can be created in the editor today, so this is latent. | Confirmed | Low | Codex S3, Gemini F-06 (both overstate) |
| D11 | Staff signing in on the portal see "Failed to sign in" instead of "use the agent sign-in": the portal auth client drops the error code. | Confirmed | Low | Codex B2, Gemini F-09 |
| D12 | God Mode Imports on phones: third action button is cut off. | Confirmed | Low | Codex B4, Gemini F-10 |
| D13 | Change calendar on phones: title and month/year truncated (same toolbar as issue #1061). | Confirmed | Low | Codex B5, Gemini F-11 |
| D14 | Portal Backlog keeps `?project=` but shows the whole organisation; the selector's own contract says it filters. | Confirmed | Low | Codex F5/B9, Gemini F-14 |
| D15 | Issued portal download links (5 min) keep working after access is withdrawn. Already on the backlog (L-06). | Confirmed | Low | Codex S9 |
| D16 | Seeded KB article "Reset your password" points to a Forgot password control. There is no password-reset flow at all. | Confirmed | Low (content); flow is a product decision | Codex B6, Gemini F-16 |
| D17 | Pages missing an h1, with two h1s, or without a skip link (from Gemini's own raw data; needs a settled re-check). | Partly confirmed | Low | Gemini raw data |
| D18 | Mobile Triage error boundary seen once by a member. | Not reproduced (SIT down) | Unknown | Codex B3 |

## 3. Verified test, seed and documentation gaps

| # | Gap | Verdict |
|---|---|---|
| G1 | UAT seed: every staff project role is on every project, and each customer organisation has one project, so UAT cannot show "unassigned project denied" or two engagements for one customer. | Confirmed |
| G2 | Seed creates no cycle, module, saved view, custom field, webhook, announcement, report export or import run, so their detail screens cannot be checked on UAT. | Confirmed |
| G3 | Seed readiness report says password sign-in is ready if any portal allows it, not per portal. | Confirmed |
| G4 | Test "every account can sign in" checks the stored hash, not a real sign-in. | Confirmed |
| G5 | `docs/uat-role-checklist.md` is stale (Withdraw confirmation shipped; members can view the project roster read-only by contract) and contains UAT hosts. | Confirmed |
| G6 | `docs/screens.md` row 129 `key=access` is a fixture key; UAT keys are generated, so testers must open the form from a card. Gemini's "access_request" is wrong. | Partly true |
| G7 | Local `pnpm lint:ci` fails only on ignored files (`.vscode`, `test-results`, `backups`); CI is green. | Confirmed (local only) |
| G8 | `pnpm audit`: deepmerge (low, production, unreachable, no fix exists), glob and minimatch (moderate, dev/test only). | Confirmed |
| G9 | Strict policy enforcement is off by default by design; route guards still enforce. Cutover follows the runbook. | Staged design, not a bypass |

Gate claims that hold: typecheck, raw-element UI check, contrast tokens (421 pairs), contract, i18n (18 non-English locales + English), route policy 118/118, CI scripts 1,419, domain 749, MCP 74, inventory (9 of 10 planned routes absent, `/god-mode/organisations` present).

## 4. Plan

These rows are also in the [roadmap](../roadmap.md) as A8-1 to A8-12.

Order: security and permissions first, then data correctness, then UI and accessibility, then seed and docs. One PR per row; each goes through the AGENTS.md test order, independent review (Opus/Sol for A8-1 and A8-2), browser check on local SIT, then Technexus with backup.

| Row | Fixes | Notes |
|---|---|---|
| A8-1 | D1 — canonicalise IPv6 before classifying (built-in `net.BlockList`), unwrap embedded IPv4, deny unparsable; tests for every form above, including the SMTP path | Security model area: Sol/Opus high review |
| A8-2 | D2 — archive/unarchive require `project:archive`; columns and workflow rules require `project:manage_settings`; capabilities, UI gating and permission tests | **Thomas:** confirms the contract (leads lose archive and column/rule edits) |
| A8-3 | D3 + D8 — access gate on Request Types (new `manageRequestTypes` capability flag) and Terminology, like Features | |
| A8-4 | D4 + D5 + D9 + D10 — request forms: checkbox condition normalised (repairs published versions), visible-only answers and files on submit, server strips hidden answers, clear options for Maps to / Show when, English strings to i18n, number answers as numbers | |
| A8-5 | D6 + D12 + D13 + D17 — projects table scroll label and keyboard row link; Imports buttons wrap; calendar toolbar fits on phones (closes #1061); h1/skip-link fixes after a settled re-check | G8 baselines may change |
| A8-6 | D11 + D14 + D15 — wrong-portal message; Backlog honours the selected project; download re-checks reach | |
| A8-7 | D18 — reproduce on local SIT (10 cold loads at 390 px, console and network), then fix the failing request in place | Needs local SIT running |
| A8-8 | G1–G4 seed: second Contoso engagement with only agent2, one of each missing entity, per-portal readiness, a real sign-in test; fix the KB article text in the seed | **Thomas:** approve adding seed data on UAT (additive, no reseed of existing data) and editing the live KB article |
| A8-9 | D7 CSP — read collected reports, switch local SIT to enforce, browser smoke, then UAT | **Thomas:** security change on UAT |
| A8-10 | Docs: Biome ignores for local-only folders (G7); checklist and screens.md notes (G5, G6); sanitize historical report copies and remove duplicate untracked `report.md` after a verified private backup | **Done in #1111 (11 Nov):** 17 required checks passed and signed release verified; historical reports remain bounded evidence, not a new browser audit |
| A8-11 | G8 dependencies: record deepmerge as accepted risk; glob/minimatch via upstream or overrides | **Thomas:** dependency changes need approval |
| A8-12 | Password reset for customers (D16 flow) | **Thomas:** product decision (email OTP / magic link vs reset flow) |

**Before starting:** Docker Desktop must be running so local SIT is back for browser checks.
