# UAT completion plan — 12 to 23 November 2026

Owner: Thomas. Coordinator: Claude, running the agent fleet in Orca. This plan replaces the 30 Oct UAT week plan and the 8 Nov A8 order in the [roadmap](roadmap.md). Background: [audit of 12 Nov](report/project-audit-2026-11-12.md). Rules: [AGENTS.md](../AGENTS.md). Current state: [handover](handover.md). An independent Opus review of this plan was folded in on 12 Nov.

## 1. Goal and finish line

**UAT is finished when all of these are true (Thomas, 12 Nov):**

1. Every item in section 4 is merged to `main` and independently reviewed. An item leaves this list only by moving to "After UAT" with Thomas's written yes.
2. The latest signed image is clean-installed on local SIT and on the UAT host.
3. The agents' own review on that build (7 roles, 3 widths, light and dark, journeys in section 7) has no high or medium defect open. Lows are listed.
4. Only then does Thomas start his review. He does not review while fixes are in flight.

**Date:** handover to Thomas on **Monday 23 November**. After he closes UAT, production preparation starts.

**Words used below:** *instant change* = the screen shows the new value at once and puts it back if the server refuses. *Placeholder* = the grey shape shown while a screen loads. *See-all* = a role that can open every project in its workspace. *CSP* = a browser security rule that blocks unexpected scripts.

## 2. Decisions recorded on 12 Nov

| # | Decision | Effect |
| --- | --- | --- |
| D-A | Only the super admin (instance admin) creates workspaces. Final. | Hard rule, no switch. |
| D-B | Agent app and customer portal are invitation-only. God Mode gets on/off switches for self-registration, default off. | Reverses A-15 (open sign-up, 31 Oct). |
| D-C | The inviter chooses the role when inviting. | Role picker in the invite dialog. |
| D-D | Projects and managed services are visible only to invited members. Same for customers: each customer person sees only their own projects. | Staff side mostly exists. Customer side is new and rewrites contracts CP-1, CP-16, CP-21. |
| D-E | Workspace admin and manager see all projects and can add themselves. | Manager gains see-all; new "Join project" action. |
| D-F | Journeys follow Jira and Plane (projects) and Jira Service Management (ticketing). The look stays Kaneo. | Section 7. |
| D-G | In UAT scope: password recovery by email (Amazon SES), enforced CSP, dependency fixes, A8-8 seed data. | Streams C, F, G. |
| D-H | UI must feel premium: instant press feedback, spring motion, interruptible transitions, small state motions. | Streams D, E; rules in section 6. |
| D-I | G11 performance check is frozen. | It is report-only and not a required check, so nothing is bypassed. #1091, #1106, #1114 parked. |
| D-J | Wipe and clean-install both local SIT and the UAT host. Data there is not real. | Section 8. Native PostgreSQL 62870 is still never touched. |
| D-K | Portal wording for staff-raised cases uses the industry term. | "Requester" (who it is for) and "Raised by" (staff who entered it), shown only when they differ. |
| D-L | Merges approved: #1090, #1093, #1101, #1113, A8-3, #1086, in that order. | Stream A. |
| D-M | God Mode has an Amazon SES setup screen with a Test button. | C-1. |
| D-N | An invitation link can be copied by the inviter at any time while it is valid and sent to the person by hand. This is the fallback when email is late. | C-6. Rewrites contract CP-23 ("the link is only ever emailed"). |
| D-O | A team that owns a project gives its members access to it. Nobody can add themselves to a team. | B-5. |
| D-P | Delete what is safe and completely finished. | Done 12 Nov: 21 clean worktrees and their merged branches removed (17 GB). Everything with unsaved work, private settings or an open PR was kept. |

Each decision is written into `docs/technical/design-and-decisions.md`, with what it reverses, in the PR that implements it.

## 3. How the work runs

- **Fleet.** Claude coordinates in Orca. Workers run in the Orca worktrees that already exist, each with a fixed list of paths. **No new worktrees are created, and a worktree is closed once its work is merged (Thomas, 12 Nov).** Implementers are Claude Sonnet, or Codex (Terra, Luna) and Gemini when their limits allow. Every PR gets an independent high-tier review (Claude Opus or Codex Sol) by a model that did not write the code. No Fable subagents.
- **Status.** Thomas gets a report in chat every hour, starting "Hey Thomas", with failures first. A failure is also reported as soon as it is seen.
- **Who commits.** Workers edit and test only. The coordinator commits, pushes, opens PRs, merges and deploys.
- **One owner per file.** `packages/permissions/src/evaluator.ts` has one owner at a time (stream B2, then B3). Only the coordinator edits `docs/status.md`, `docs/roadmap.md`, `docs/handover.md` and this plan. Generated files (`i18n/schema.json`, `pairs.json`, `openapi.json`) are regenerated when a branch is brought up to date, never merged by hand.
- **Per PR.** Bring up to date with `main`, all 17 required checks green, tests for the change, Opus review, then merge. High-risk areas (sign-in, permissions, customer separation, database changes) also run `pnpm test:permissions`, `check:route-policy` and `test:contract`, and every high and medium review finding is fixed before merge.
- **Merge budget.** One merger, about 25 minutes of checks per push and one review per PR allow about 6–8 merges a day, about 45 in the 7 build days. Section 4 has about 49 PRs, so the queue is already over its limit and the drop order below will be used. When the queue backs up, items drop in this order: E-1 batches 3–4, E-7, A-9, E-6 (sheets), D-5, F-9.
- **Merge trains.** `main` requires every PR to be up to date before it merges, so reviewed PRs are merged in batches: one integration PR per batch runs the 17 checks once and lands the batch with a merge commit.
- **Release.** Every merge builds a signed image automatically. Local SIT is clean-installed at the two checkpoints. The UAT host is deployed once, on Sat 21.
- **No new audits** until the Fri 20 self-review. Findings during the week go to the owning stream.
- **No worktree without a PR or a push.**

## 4. Scope

Effort: S under half a day, M about a day, L 2–3 days, XL more. **H** = high-risk, independent Opus high-effort review required.

### Stream A — Merge train (coordinator)

| ID | Item | Done when | Effort |
| --- | --- | --- | --- |
| A-1 | #1090 tablet sidebar | Tablet shows the full-width screen with a slide-in sidebar | S |
| A-2 | #1093 reports saving gate | Save in the Reports builder is off until permissions load; checked in a browser | S |
| A-3 | #1101 phone layout and accessibility | Projects table and calendar toolbar usable by phone and keyboard | S |
| A-4 | #1113 request forms (H) | Hidden answers are never stored; checkbox conditions work; CI rerun green | M |
| A-5 | A8-3 access gates (H) | Lead, member and viewer see "no access" on Request Types and Terminology | S |
| A-6 | #1086 shared page frame parts | The shared header, container and empty state exist in `packages/ui` | M |
| A-7 | #1098 first-admin setup (H) | Setup completes only after the first admin verifies TOTP; the seed writes the setup marker so nobody is locked out. **Merges before G-1.** | L |
| A-8 | #1087 portal polish, after A-4 and A-6 | Portal requests, dashboard, catalogue and inbox use the new look; checked in a browser | M |
| A-9 | #1088 settings polish, after A-4 | Settings screens reworked without losing the A-4 fix | L |

### Stream B — Access and roles (three workers)

**B1 worker (sign-in and invitations):** B-1 → B-4 → B-2 → B-3. **B2 worker (staff project access):** B-5 → B-6 → B-7 → B-9. **B3 worker (customer project access):** B-8, taking over `evaluator.ts` after B-6.

| ID | Item | Done when | Effort |
| --- | --- | --- | --- |
| B-1 | D-A workspace creation (H) | Only an instance admin can create a workspace, in the API and in every screen. The creator names the workspace owner at creation. Other people see "ask for an invitation". A test proves the owner cannot be removed or demoted. **Merges before G-1.** | L |
| B-2 | D-B agent sign-up switch (H) | A stored setting "allow staff self-registration", default off, is enforced on every sign-up path. God Mode has the switch. An invited person gets a staff identity whichever sign-in method they use. | L |
| B-3 | D-B portal (H) | The portal stays invitation-only. God Mode shows the state. A self-registration switch is added only with a safe design; otherwise fixed off. | S |
| B-4 | D-C role at invite (H) | The staff invite dialog has a role picker limited to roles at or below the inviter's. The pending invitation shows the role. | S |
| B-5 | D-D staff project access (H) | A test proves a non-member sees nothing of a project in lists, search, command palette, inbox, calendar, time, reports, exports, saved views and live updates. Every leak found is fixed. Nobody can add themselves to a team that owns a project. Remaining project routes use the current permission checks. | M–L |
| B-6 | D-E see-all and join (H) | A manager sees every project and can press "Join project"; a member cannot. Joining is recorded in the audit log. | L |
| B-7 | Customer-organisation binding (H) | The organisation list shows only organisations the workspace already serves. Linking a new one needs an instance admin. | S–M |
| B-8 | D-D customer project access (H) | A customer person sees only the projects they were given. The inviter picks them at invite. Staff can change them. Portal lists and notifications follow. Contracts CP-1, CP-16, CP-21 rewritten. | XL |
| B-9 | Reports and project access (H) | Report "read all" follows D-E: admin and manager see all; other roles see only their projects. | S–M |

### Stream C — Email and passwords

| ID | Item | Done when | Effort |
| --- | --- | --- | --- |
| C-1 | Amazon SES setup in God Mode (H) | The existing God Mode email screen gets a provider choice: Custom SMTP or Amazon SES. Choosing SES asks for the region, the SES SMTP user name and password, and a verified From address, and fills in the rest. **Test** sends a real email to an address the admin types and shows a clear result with the error code (today it only checks the login and sends nothing). The last test time and result stay on screen. A warning explains the SES sandbox. Saving asks for the admin's second factor. No new dependency. | M |
| C-6 | Copy invitation link (H) | After every invite or resend the inviter sees "Email sent" or "Email not sent: copy the link", with the expiry date. Staff links can already be copied; each copy is now audited. Customer invitations gain "Copy link" at any time until expiry, for the inviter and admins, returning the same link that was emailed. Resend makes a new link, revoke kills it, copying never extends the expiry. Every pending invitation shows its expiry. Contract CP-23 is rewritten. | M |
| C-2 | Forgot and reset password (H) | Both sign-in pages have "Forgot password". The emailed link works for one hour. The page never reveals whether an address exists. | L |
| C-3 | Change password while signed in (H) | Works in the agent app and the portal | M |
| C-4 | No-email banner | Invitation screens say clearly when no email provider is set | S |
| C-5 | Help article | The seeded article describes the real flow | S |

### Stream D — Smoothness

| ID | Item | Done when | Effort |
| --- | --- | --- | --- |
| D-1 | Work-item detail | State and assignee change at once and go back on refusal; menus do not wait | M |
| D-2 | Board | A dropped card stays where it lands; the board never locks; refusal puts it back | L |
| D-3 | Opening a screen directly | One placeholder shape, no blank flash, on overview, backlog, portal home and inbox | M |
| D-4 | Work-list polling | The list re-checks only the first page, and only when live updates are down | S |
| D-5 | Inbox and echo | Mark-read is instant; your own change does not reload twice | S |
| D-6 | One Create form | Overview button, command palette and shortcut open the same form as the board. First board open does not draw every card. | M |

Each has a unit test and one browser test against a real server. Deleting is never an instant change.

### Stream E — Page frame and motion

| ID | Item | Done when | Effort |
| --- | --- | --- | --- |
| E-1 | Shared page frame | Batch 1 work and projects, batch 2 portal: same title size, width and empty state. Batches 3 settings and 4 God Mode only if the merge queue allows. | L + L |
| E-2 | Motion tokens | Three durations and one spring live in `packages/ui` | S |
| E-3 | Press feedback | Buttons, rows, cards and tabs react within one frame | S |
| E-4 | Save feedback | The button shows working, then done; a "Changes saved" toast shows a progress line | M |
| E-5 | Placeholders and reduced motion | Placeholders appear only after about 150 ms; all movement stops when the user asks for reduced motion | M |
| E-6 | Switch and sheets | The switch has a spring and a helper line (first, for the God Mode switches); sheets and dialogs use the spring | S + M |
| E-7 | Upload drop zone | Highlight, progress and an "Uploaded" tick. Only if the merge queue allows. | M |
| E-8 | Motion test | A browser test checks rules 1, 3, 5 and 9 of section 6 | S |

No new dependency: Base UI, framer-motion and CSS already cover it.

### Stream F — Fixes and old Kaneo paths

| ID | Item | Done when | Effort |
| --- | --- | --- | --- |
| F-1 | Old Kaneo settings sections | Project Workflow settings no longer show the old Columns and GitHub automation sections; General settings stops reading the old task data | S |
| F-2 | Canonical links | Projects list, calendar and search open under `/agent`; old links redirect; notifications never open old task links | S |
| F-3 | A8-7 mobile Triage error | Reproduced, cause recorded, fixed | S–M |
| F-4 | #1059, #1060, #1061 | Not-found recovery, search focus and calendar toolbar fixed | S |
| F-5 | Portal wording (D-K) | Staff-raised cases show "Requester" and "Raised by" | S |
| F-6 | Server errors | The cause is logged; the error screen shows a reference id | S |
| F-7 | CSP enforced | Enforced on local SIT from Fri 13 so the whole week is tested with it | S |
| F-8 | Dependencies | #1058 merged; `deepmerge` recorded as accepted (no fix exists) | S |
| F-9 | Admin screens in English only | Hard-coded text moved to translations | S |
| F-10 | "No access" screen | A person who lacks the permission sees "You don't have access. Ask a workspace admin" with a Back button, and actions they cannot use are hidden. Checked as viewer, member and lead. | S–M |
| F-11 | Reply to customer or internal note | The reply box makes the two clearly different, internal notes are tinted, and a public reply on a customer item is never sent by accident. Check first; fix if wrong. | S–M |

### Stream G — Seed, install and real tests

| ID | Item | Done when | Effort |
| --- | --- | --- | --- |
| G-1 | New seed (after A-7 and B-1) | The instance admin creates the workspaces. Each staff role sits on specific projects with one PM. One customer organisation has two engagements with different customer people. One of each entity exists (A8-8). The service project has clear status names (New, Open, Waiting on customer, On hold, Resolved, Closed), a few real knowledge-base articles, approvals switched on with one change request, and two automations (a customer reply reopens; resolved items close after 3 days). | L |
| G-2 | Fresh-install script for local SIT | One command wipes and installs local SIT (today's scripts only upgrade) | M |
| G-3 | Real browser journeys | The journeys in section 7 run against a real server for every role | L |
| G-4 | Clean installs | Local SIT on Tue 17 and Thu 19; UAT host on Sat 21 (section 8) | M each |
| G-5 | Self-review | Fri 20 review done; highs and mediums fixed | L |

### Stream P — Ponytail audit, review and performance hardening (Approved 14 Nov)

| ID | Item | Done when | Effort |
| --- | --- | --- | --- |
| P-1 | `duplicate-suggestions.ts` UTC cutoff cast | `findDuplicateSuggestions` passes `${cutoff.toISOString()}::timestamp` instead of a raw `Date` so `node-postgres` never shifts the 90-day cutoff by local `TZ` | S |
| P-2 | `sla-scan` query & write reduction | `scanSla` filters live projects in the candidate query, passes the locked `work_item` row into `evaluateStoredWorkItemSla`, and skips `work_item_sla_cache` upserts when `state` and `dueAt` are unchanged | S–M |
| P-3 | Leader leases on remaining 3 cron jobs | `due-date-reminders`, `plugin-health`, and `impersonation-cap` wrap execution in `withJobLease` so multi-replica deployments never run duplicate scans or OIDC discovery probes | S |
| P-4 | Scheduled job history lease renewal & standby filter | `runScheduledJobWithHistory` renews `job_lease.expires_at` on heartbeats and discards standby no-op runs when the lease is held elsewhere | S–M |
| P-5 | Unused dependency removal & `valibot` → `zod` (Approved) | Remove 27 unused dependencies from `apps/web/package.json` & `apps/api/package.json` and replace `valibot` with `zod` in `redis-broadcast-adapter.ts` | S |
| P-6 | CSV download helper & `KbTriageSuggestions` early return | Share `downloadWorkItemsCsv` via native `URL.createObjectURL` (removing `file-saver`) and skip `KbTriageSuggestions` debounce timer when `feature.knowledge_base` is off | S |
| P-7 | MFA/CSRF fixture hardening (uncommitted in main checkout, reviewed 14 Nov) | Re-applied on current `main` (checkout is 288 commits behind): keep `isDisposableDatabaseUrl`, `disposableChildEnv`, `cleanupDisposableContainers` and `tests/api/mfa-csrf-disposable-safety.test.ts` (7/7 pass); drop the `^` hono/node-server bump unless still needed, then exact pins and a lockfile regenerated on `main`; delete the ~20 dead empty `SMTP_*`/OAuth env lines; stop the 7 `spawnChild` callers passing an `env` the fixture ignores; skip re-journalling the known container id; keep only the "Gemini 4 Hydrogen" word change in `AGENTS.md`; affected e2e journeys pass | S |

### After UAT

G11 work. Tooling PRs #1104, #1105, #1108, #1109, #1112. From the [reference comparison](report/reference-comparison-2026-11-12.md): customer admin and organisation-wide sharing, request participants, saved replies, satisfaction rating, follow-up reminders, agent queues with counts, customer-facing status names, undo on toasts, shortcut hints. Deleting the dead Kaneo screens and the old `/task` API. Changing the app-wide data-freshness defaults. Real-time "is typing". Corner smoothing and page-to-page transitions. Pages editor (L-04). God Mode extras (A-29 to A-34). Public projects. Sign-up rules for company single sign-on.

## 5. Schedule

| Day | Fleet | Thomas |
| --- | --- | --- |
| Thu 12 | Plan and handover. Worktree cleanup (done). A-1, A-2, A-3. Start B-1, B-5, C-3, C-4, D-1, F-7, F-8. | Start AWS SES: domain, DNS records, SMTP user, production access; verify the testers' addresses. Answer section 10. |
| Fri 13 | A-4, A-5, A-6. B-1, B-4. C-1. D-1, D-6. E-2, E-3, E-6 switch. F-1, F-2, F-7, F-8. | — |
| Sat 14 – Sun 15 | B-2, B-3, B-7, B-5. A-7. C-2, C-6. D-2. E-4, E-5. B-8 built. G-2. | — |
| Mon 16 | **Two gates:** SES delivers on local SIT; B-8 has passed review. B-6, B-9. D-3. E-1 batch 1. A-8. F-3 to F-6, F-10, F-11. G-1. | Enter SES values on SIT. Decide if a gate fails. |
| Tue 17 | **Checkpoint 1:** clean install on local SIT with the new seed and CSP enforced; real journeys; fix. | — |
| Wed 18 | B-8 merge. E-1 batch 2. D-4, D-5. A-9, E-6 sheets, E-7, F-9 if the queue allows. G-3. | — |
| Thu 19 | **Feature freeze.** **Checkpoint 2:** second clean install on local SIT with the final seed. Only fixes after this. | — |
| Fri 20 | **Self-review** on that install: 7 roles × 3 widths × 2 themes, all journeys. Fix highs and mediums. | — |
| Sat 21 | **UAT clean install** (section 8). Smoke and journeys on both hosts. | On hand for the first-admin TOTP step |
| Sun 22 | Buffer. Fixes and one redeploy if needed. Final docs. | — |
| Mon 23 | Handover note: build, checklist, accepted lows. | Starts review |

**If a Monday gate fails:** without SES, invitations still work through "Copy link" (C-6), but password recovery by email cannot be tested, so C-2 is tested on local SIT's mail capture and re-checked on UAT when SES is live. If B-8 has not passed review, it moves to "After UAT" with his written yes and customers keep seeing all of their organisation's projects meanwhile.

## 6. Premium UI rules (D-H)

1. Press feedback shows within one frame of pointer-down.
2. A changed value shows within 100 ms; the server confirms in the background and the screen puts it back on refusal.
3. Small elements animate 120–200 ms; nothing small takes over 300 ms.
4. Sheets, dialogs and toggles use one shared spring with a slight overshoot.
5. Animations can be interrupted and reversed; input is never blocked while one runs.
6. Placeholders appear only after about 150 ms and never flash.
7. Every save ends in a visible "saved" state.
8. Keyboard-triggered and very frequent actions do not animate.
9. The reduced-motion setting turns off movement everywhere.
10. All motion values come from tokens in `packages/ui`; screens do not set their own.

The iPhone-only ideas in the reference posts (momentum scrolling, rubber band) are handled by the browser and are not built.

## 7. Journeys the self-review must pass

Per role (owner, admin, manager, lead, member, viewer, customer), on a real server with seeded data:

1. Instance admin: first-run setup with TOTP, create a workspace, name its owner, God Mode switches.
2. Invite staff with a role; the invitee signs in and sees only the granted projects.
3. Create a project and a managed service; add members; an admin or manager joins a project.
4. Backlog, board (drag), work item detail (edit, assign, comment, attach).
5. Cycles, modules, calendar, timeline.
6. Views, filters, search, command palette, Create.
7. Inbox and notifications.
8. Time, hour bank, budgets; reports and dashboards.
9. Pages, documents, knowledge base.
10. Service desk loop: a customer raises a request, triage, convert, reply, the customer sees it, resolve.
11. Portal: sign in, forgot password, dashboard, cases, own projects only, documents, announcements.
12. Refusals: non-member, viewer, wrong portal, customer of another organisation.

## 8. Clean install

Rehearsed on local SIT (Tue 17 and Thu 19), then the UAT host (Sat 21).

1. Take a verified backup: database, files, private settings, checksums; prove one separate restore.
2. Record the running image.
3. Stop the stack; remove its containers by exact id and its volumes by exact name. No prune.
4. Install the latest signed image; verify its signature.
5. First-run setup: first admin with verified TOTP.
6. Apply settings: self-registration off, CSP enforced, SES, sign-in methods.
7. Run the new seed.
8. Smoke on both hosts, then the journeys in section 7.
9. Keep the backup and the previous image for rollback.

Never touched: native PostgreSQL 62870, the v1 UAT project, credentials files.

## 9. Risks

| Risk | Handling |
| --- | --- |
| The merge queue is over its limit (about 49 PRs for about 45 slots) | Drop order in section 3; daily count reported in `docs/status.md` |
| B-8 changes what customers can see | Own worker from Fri 13; must pass review by Mon 16 or move out; tested in both checkpoints |
| SES production access can take days; DNS is needed | Start today. Verify the testers' addresses so the SES sandbox can deliver to them. "Copy link" (C-6) covers invitations meanwhile. Monday gate. |
| Instant changes on board and detail can break drag, simultaneous edits or permissions | Put-back tests and a real-server drag test before merge |
| CSP enforcement can break styles or motion | Enforced on SIT from Fri 13, not at the end |
| CI machine failures | Rerun; #1115 only with Thomas's yes because it edits CI workflows |

## 10. Decisions needed from Thomas

**Answered by Thomas on 12 Nov:**

| # | Question | Answer |
| --- | --- | --- |
| 1 | Standing approval to merge reviewed, green PRs and to deploy to the UAT host | Yes: "approve all and continue" |
| 2 | SES | Already set up in AWS. Thomas enters the values in God Mode during UAT testing. C-1 is tested on local SIT with mail capture until then. |
| 3 | Copy invitation link | Yes, at any time while valid (D-N) |
| 4 | Team access | Yes; nobody adds themselves to a team (D-O) |
| 5 | Workspace owner | The super admin hands the workspace to the named owner |
| 6 | Second factor on the sign-up switch | Yes |
| 7 | New indirect packages from #1058 | Accepted after a check of what they are |
| 8 | Old stopped local SIT deployments | Wiped with the rest; local SIT is redeployed clean |
| 9 | Worktrees with unsaved work, parked-PR worktrees | Keep until after UAT, close earlier when safe. Parked ones are reused as work lanes. |
| 10 | Original 8 Nov files, old browser scripts | Deleted 12 Nov. The 132 GB evidence folder is deleted once nothing refers to it. |
| 11 | #1115 (edits CI workflows) | Approved if CI machine failures continue |
| 19 | Ponytail audit, review & dependency cleanup (P-1..P-6) | Approved 14 Nov ("all approve add that those into the plan.md and continue all taks, roadmpa") |

**Defaults that apply unless you say otherwise:**

| # | Question | Default |
| --- | --- | --- |
| 12 | A newly invited customer sees which projects? | Only the ones the inviter picks; none otherwise |
| 13 | Role given by "Join project" | Member |
| 14 | Fleet | Claude Sonnet builds and Claude Opus reviews; Codex and Gemini workers when their limits allow |
| 15 | Placeholder delay and how long data counts as fresh | 150 ms; unchanged until after UAT |
| 16 | What the SES Test button shows on failure | The error code and a clear message, plus the provider's text with addresses and server names removed |
| 17 | How the customer "Copy link" works | It returns the same link that was emailed (derived from the instance key); settled in the independent review |
| 18 | Should UAT testers see approvals? | Yes: switched on in the UAT workspace with one seeded change request |

## 11. Reference comparison (12 Nov)

Full table: [reference comparison](report/reference-comparison-2026-11-12.md) — 42 topics against Plane, Kaneo, Jira, Jira Service Management, OpenProject, Zendesk, Freshdesk, Zammad, ServiceNow and Linear.

- **TaskDesk is ahead** on breadth and on ticketing depth: versioned workflows, SLA calendars, approvals, knowledge-base suggestions, custom roles, and an instance admin that single sign-on can never grant. These are kept as they are.
- **TaskDesk is behind** on polish and on the 12 Nov decisions not yet in code. Both are this plan.
- **Pattern every reference shares**, and this plan follows: private invite-only projects; customers see only their own requests unless sharing is switched on; reply and internal note clearly separate; a few fixed status groups with editable names.
- **Not to be built:** public projects or self-join, anonymous or non-member roles, Jira-style permission and workflow schemes, a per-role workflow matrix, a separate resolution field.
- **Added to this plan from the comparison:** F-10, F-11, the owner-protection test in B-1, expiry shown on every invitation (C-6), and the seed contents in G-1.
