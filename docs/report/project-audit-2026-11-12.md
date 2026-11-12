# TaskDesk project audit — 12 November 2026

Read-only audit for Thomas. Target: UAT finished Monday 16 Nov 2026.

**How it was done:** 7 fact-gathering agents (Sonnet) and 9 code/delivery reviewers (Opus). Every review was re-checked by a second Opus agent that tried to refute it. Sources: code on `main` (31c91af75, 11 Nov), git history, 19 open PRs, 120 open issues, CI runs of 9–11 Nov, the 8 Nov audit reports. **Not done:** no browser run, no tests run, the UAT server was not touched or inspected.

## 1. Summary

| # | Topic | Report |
| --- | --- | --- |
| 1 | **Status** | **Pending.** UAT was due 6 Nov. It is not signed off. The UAT server still has the 7 Nov build (last recorded; not rechecked). |
| 2 | **Result** | **Timeline late: 10 days** (6 Nov → 16 Nov). Fixes are written but not delivered: 19 PRs open, about 59,000 lines unmerged. |
| 3 | **Outcome** | The next phase and new features cannot start. Testers on UAT would find the same 8 Nov defects again. One security gap must be closed before customers are let in (section 6). |
| 4 | **Todo — not a dev fault, pending Hein** | Approve merges and one UAT deploy. Decide: upgrade vs clean reset, freeze tooling/speed work, close sign-up on UAT, A8-8, A8-9, A8-11, A8-12, "Created by" wording. Do the role checks (pending since 7 Nov). |
| 5 | **Planning — internal decision** | Agree what "UAT finished" means (none is written). Freeze everything not needed for Monday. Follow the 5-day plan in section 8. |

## 2. Where we are

| Area | State | Evidence |
| --- | --- | --- |
| Phases P0–P6 | Done, accepted 27 Oct | roadmap |
| UAT items U-1 to U-15 | Done and live since 7 Nov | handover |
| 8 Nov audit rows A8-1, A8-2, A8-6, A8-10 | Merged to `main`, **not on UAT** | #1078, #1081, #1103, #1111 |
| A8-3 request-type access | Branch only, no PR | — |
| A8-4 request forms | Draft #1113, CI red (machine fault, not its code) | PR checks |
| A8-5 phone layout | Draft #1101, required checks pass | PR checks |
| A8-7 mobile Triage error | Not started | — |
| A8-8, A8-9, A8-11, A8-12 | Waiting on Hein since 8 Nov | roadmap |
| UX polish (your feedback) | Written, unmerged since 8–9 Nov | #1086, #1087, #1088, #1090 |
| Clean UAT reset | Blocked on draft #1098 (sign-in setup) and #1089 (demo data) | handover 11 Nov |
| Browser check, all roles × widths × themes | Not complete | roadmap L-08 |
| Written UAT pass/fail rule | Does not exist | checklist has tick boxes only |

**What the team did 9–11 Nov:** mostly release/deploy tooling (#1092, #1094, #1104–#1112, #1115), speed-test diagnostics (#1091, #1106, #1114) and docs. Only one product fix merged (#1103).

## 3. What is failing and repeating

| Pattern | Evidence | Cost |
| --- | --- | --- |
| Audit → fix → new audit finds more | 31 Oct: 61 findings. 3 Nov: 64. 4 Nov: 15. 8 Nov: 18 + 9 gaps | Scope grows as fast as it closes |
| Speed test (G11) red on every PR | Latest 2,605 ms vs 2,500 ms budget; passed once, failed again on nearly the same code | About 2 weeks of work on a report-only check. The gap is smaller than the test's own noise |
| Finished work not merged | 19 open PRs, 17 drafts; UX PRs waiting 3–4 days | Branches go stale and conflict (#1087 already does) |
| Tooling before product | 7 of 19 open PRs are deploy/recovery/CI tooling | UAT fixes wait |
| CI slow and noisy | About 25 min per push; Ubuntu package-server failures; known flaky tests | Reruns; hard to tell real red from noise |
| Same UI problems fixed screen by screen | Native controls, mobile layout, raw labels, empty/error states — 3 rounds each | No shared fix, so new screens repeat it |
| Docs out of date | `status.md` leads with 7 Nov; roadmap says 86 issues (real: 120) | State cannot be read from docs |

## 4. Why the timeline is long

1. **No finish line.** There is no written "UAT is done" rule, so every audit adds work.
2. **Priority drift.** Since 9 Nov effort went to release tooling and the speed test, not to the 12 audit rows and your UX feedback.
3. **Heavy cost per change.** One small UI fix needs about 14 steps: 17 required checks, review, signed release, local SIT, smoke, UAT deploy. About a day each.
4. **Tests do not test like a tester.** 44 of 60 browser tests use a fake server. The release smoke only opens pages. No real test drags a card or signs in as lead or viewer. So "all green" still gives 60+ findings per audit.
5. **Size.** About 650,000 lines of product code plus about 320,000 lines of tests. 673 requirements; about 117 are for things no UAT tester touches (import, MCP, API keys, webhooks, God Mode extras). An old "task" data model still runs beside the new "work item" model, so some fixes are done twice.
6. **Owner switches and parallel work.** Codex → Claude → Codex, 47 worktrees, many stacked branches editing the same translation and docs files.
7. **Decisions waiting.** Five rows have waited on Hein since 8 Nov.

## 5. Why the UI/UX is not smooth

| Cause (confirmed in code) | What the tester feels |
| --- | --- |
| Actions wait for the server before the screen moves | Dropped board card jumps back, board locks during 3–4 calls. State/assignee menus hang, then 6+ data groups reload |
| Screens load in stages | Open a link directly: skeleton, blank, then screen. Buttons appear late |
| No shared page frame | About 106 screens build their own title and width (4 widths). Pages look uneven. The fix (#1086) is unmerged and covers about 7 files |
| Two different "Create" forms | The form depends on where you click; the board one still uses the old task model |
| Polish done one screen at a time, after each audit | Same problems come back on the next screen |
| Hard-coded English on admin screens | Mixed language |
| Speed work aimed at the lab test, not real use | Little visible gain for testers |

Server speed itself is fine: board/list requests went from 1.2–4.1 s to 35–45 ms (#1034).

## 6. Security — fix before customers are let in

**High, confirmed by two reviewers and spot-checked in code.** Sign-up is open by default (accepted for UAT on 31 Oct, A-15). A new account becomes internal staff, can create its own workspace, list every customer organisation, open a project for any of them, read that customer's names and emails, and post tickets into that customer's portal. Any existing staff tester can do the same by creating a workspace.

**Fix is settings, not code:** on the UAT host set `DISABLE_REGISTRATION=true`, `DISABLE_PASSWORD_REGISTRATION=true` and `DISABLE_WORKSPACE_CREATION=true`, restart, then confirm sign-up and workspace creation are refused and review the God Mode users list for unknown accounts. Whether UAT has these set today is unverified.

Nothing else found should stop UAT. Customer data separation inside the portal is solid. Lower items: CSP is report-only on UAT (a stored setting; A8-9), server errors are returned without a logged cause in one handler, no customer password recovery.

## 7. What to keep and what to park

| Keep (works, protect it) | Park until after UAT |
| --- | --- |
| U-1 to U-15 features, live | Speed test work: #1091, #1106, #1114 |
| Portal data separation | Release tooling: #1104, #1105, #1108, #1109, #1112 |
| Signed release chain, backups, rollback | Big unverified UI PRs: #1087, #1088 (#1088 would overwrite the #1113 fix) |
| Server speed fix | Clean reset: #1098 (risky sign-in change), #1089 |
| Small ready fixes: #1090, #1093, #1101 | New audits; 64 post-UAT issues; 23 obsolete issues to close |

## 8. Plan to Monday

| Day | Dev | Hein |
| --- | --- | --- |
| Thu 12 | Stop tooling and speed work. Rebase and ready #1101, #1093, #1090. Rerun CI on #1113. Open the A8-3 PR | Make the decisions in section 9. Approve merges |
| Fri 13 | Merge #1113, A8-3, #1086. Backup UAT, upgrade it to current `main`, set the three sign-up flags, smoke test | Approve the UAT deploy |
| Sat–Sun | Run a real browser pass: 6 roles on the main journeys. Fix blockers only | Role checks with the checklist |
| Mon 16 | Final smoke. Record results | Sign off against the written rule |

**Proposed "UAT finished" rule:** each of the 6 roles completes its checklist journeys on UAT with no high or medium defect open; lows are listed and accepted; sign-up closed.

## 9. Decisions needed from Hein

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | What "UAT finished" means | Use the rule in section 8 |
| 2 | Upgrade UAT in place, or clean reset first | Upgrade for Monday; clean reset after UAT |
| 3 | Freeze speed-test and tooling work until UAT ends | Yes |
| 4 | Close sign-up and workspace creation on UAT (reverses A-15) | Yes, before testers return |
| 5 | Approve merges: #1090, #1093, #1101, #1113, A8-3, #1086 | Yes, in that order |
| 6 | A8-8 extra seed data (second engagement) on UAT | Yes, additive only |
| 7 | A8-12 customer password recovery | After UAT; fix the help article text now |
| 8 | A8-9 enforce CSP; A8-11 dependencies | After UAT |
| 9 | Portal "Created by" wording for staff-raised cases | Choose one; small |

## 10. Limits

- Code review was by reading, not by running. UI findings were not seen in a browser.
- The UAT server's real build and settings were not checked.
- Issue triage (8 UAT-relevant of 120) was judged from titles.
- CI figures cover 9–11 Nov only.
