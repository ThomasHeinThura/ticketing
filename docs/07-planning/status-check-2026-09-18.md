
### Addendum 3 (2026-09-18, ~12:45 UTC) — four lanes open, all green, all awaiting review tiers

- All five of this session's PRs rebased onto `26ec385` (PR #208's merge) and CI-verified:
  **every substantive check green on every head**; the sole red check on each is the
  `pull request template + security review` gate, correctly holding for reviewers.
  - **#209** SLA computation (draft) — do-not-15 posture comment posted for reviewers
  - **#210** status.md reconciliation — session-log entry now also records #208's merge
  - **#213** #95's two hygiene fixes — 12/12 integration re-verified on the rebased head
  - **#216** #206's OpenAPI 404 sweep — 23 added, 4 corrected; full sweep done; baseline
    regenerated and byte-verified
  - **#217** #196's five hardening notes — comment-only, beside the cycle guard
- **#205 stopped on do-not 17**: clarification proposal posted (freeze-writes/keep-reads;
  whole-reachable-graph rule; assets same rule) — implementation waits for an answer.
- **Approvals confirmed blocked** (do-not 15) — not started.
- Remaining open development items are all decision- or capacity-gated: #192 (pre-#23
  decision), #189/#180-182 (migrations, security-scope), #198 remainder (prerequisites),
  #212 (Copilot lane's finding), #170/#165/#166/#167 (CI/ops LOW backlog).

### Addendum 4 (2026-09-18, ~14:00 UTC) — full P2 execution mandate: first wave landed

Under Thomas's full-P2 execution mandate (Sonnet/Opus unavailable; independent contexts
execute packets; Opus gates remain mandatory):

- **#206 handed to P1** on PR #216 (full findings transfer: 23 added 404s, 4 corrected
  declarations, the verified-accurate module list, the residual message-wording class,
  the `assertAssignableUser` 403 discovery). Receipt confirmation requested from the
  Copilot lane; `lane-206-openapi` worktree preserved until it arrives. No competing PR.
- **Reviewer packets posted** on #209/#210/#213/#216/#217 — behavioural exercise lists
  with exact SHAs, so genuinely independent contexts can execute the ordinary reviews;
  actual model identities to be recorded per review as executed.
- **P2 ledger created**: `docs/07-planning/p2-ledger.md` (on #210) — the full chain per
  P2 feature (roadmap → spec → issue → PR → SHA → tests → reviews → UI → merge →
  acceptance), the P1 coordination proposal (shared-surface ownership; sequential
  drizzle/schema.ts edits), the durable Opus-review queue, and the owner decisions
  queued for Thomas.
- **PR #218 opened (stacked on #209)**: SLA policy resolution (SLA-1/2), version
  pinning (SLA-3), pause-open validation + close rules (SLA-11), scan-edge semantics
  (SLA-15); 19 new tests, 328 total. Two spec clarifications made in `sla.md` in the
  same PR (SLA-15 edge reading — the only one the cache shape supports; flagged, not
  silent).
- **sla.md §11 review findings CLOSED** (do-not 15): every finding verified resolved —
  storage findings already in `data-model.md` (project.sla_policy_id line 153,
  workspace.default_sla_policy_id line 110, work_item_sla_cache metric-keyed,
  at_risk_threshold_pct, request_type.sla_policy_id), the spec-text findings reconciled
  in #218. §11 emptied per the #176 precedent; `check:reviews --spec sla.md` green.
  One CI catch on the way: biome formatting on the new files — fixed, not waived.
- **Remaining P2 work is gate-gated, not abandoned**: persistence/CRUD/API/jobs/UI for
  every P2 feature waits on (a) P1's receipt confirmation + shared-surface ownership
  agreement (drizzle/schema.ts are sequential shared files), (b) reviewer contexts for
  the six open PRs, (c) Thomas's queued decisions (#205 freeze semantics, SLA-15
  reading, effects-vocabulary ownership). The integrated P2 demonstration additionally
  waits on P1's #23 write path. All queued in the ledger with unblock conditions.

### Addendum 5 (2026-09-18, ~14:50 UTC) — seventh PR, coordination request posted, queue terminal

- **#219 opened**: calendar coverage preview (`weeklyCoverMinutes` nominal +
  `annualCoverMinutes` real via the existing `coveredMinutesBetween` core — no parallel
  engine), 6 hand-computed tests including the 2026 weekday distribution (365 = 52×7+1 →
  53 Thursdays; 261 Mon–Fri days). My own first test expectation was wrong (52×5); the
  hand-recount caught it — the implementation was right.
- **Consolidated coordination request posted on #216** for the Copilot lane: #206 receipt
  confirmation, ordinary-review execution across the seven queued PRs (packets ready),
  and the shared-surface ownership proposal. Also flagged that #218/#219's SLA module is
  UTC-server-agnostic for their #212 audit.
- **do-not-15 map established** for every P2 spec (empty = implementable): work-items,
  projects-and-engagements, relations-and-hierarchy, workflows, sla, service-calendars,
  audit-trail. Blocked sections: views, comments, attachments, search, assignment, agile,
  request-types, intake, approvals, portal, KB, service-management. request-types §13 is
  partially closable (data-model already has organisation_request_type/auto_accept/
  deflection_event) but three of its ten findings need cross-spec coordination (rbac
  read-split, portal policy form, drafts decision) — queued behind the P1 agreement.
- **All seven PRs terminal**: every substantive CI check green on every head; the sole
  red check on each is the review-evidence gate. Worktrees all clean; everything
  committed and pushed; `lane-206-openapi` still preserved pending Copilot's receipt.

### Addendum 6 — ordinary-review sweep, current-model mandate (2026-09-23)

Standing rule applied: Sonnet-tier ordinary reviews run as **Cline (mimo-v2.26 Flash)**
under #336 (identity recorded honestly, never relabelled); **Opus stays the mandatory
FINAL review on every security-scope PR — never skipped.**

- #334 ordinary APPROVE recorded at `e5cf435` (comment 5799912649; mutation-proven;
  suites 261/43/80; G2 fixed → registers GREEN). Note-label fix pushed as the last commit.
- #334 residuals: **Opus delta at the note-fix head** (Claude-context, queued); other-lane
  ordinary cover for my mechanical commits 61a0971/fc58147 (no self-review); GitGuardian
  incident 37541345 (Thomas queue); CodeQL empty-output flake re-run.
- Queue (current-model ordinary, Opus final where security-scope): #338 → #320 delta →
  #326/#340 vs contract → #331 → #332 → #335 → #341 → #346. #107 held.
- My PRs #327/#328/#330/#343 need Luna/Copilot cross-reviews; #323/#343 Opus-final.
