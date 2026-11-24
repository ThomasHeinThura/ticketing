> **Approved 24 Nov 2026:** Thomas accepted every recommendation below ("Take all recommendations"). Each item's recommended option is approved scope.

# Phase 4: decisions for Thomas

Drafted 21 Nov from the audit of all 66 open issues. Each item needs your call under AGENTS.md (contracts, permission semantics, workflows, dependencies, thresholds, security model, irreversible data, external sign-off). Reply with the issue number and option letter, or "take all recommendations".

## #55: Should issue #55 (the P7 customer-readiness umbrella) be closed as superseded by roadmap row L-10, leaving the external pentest and WCAG sign-off with you under T-1?
- **a.** Close #55 as superseded; L-10 and T-1 carry the remaining work. Cost: nothing; the work is already tracked.
- **b.** Keep #55 open as a tracking issue linking L-10 and T-1. Cost: a duplicate tracker to keep current.
- **c.** Split #55 into child issues now (locales, k6 and DR drill, installer acceptance, docs). Cost: triage effort before any work starts.

**Recommended:** Close it as superseded. L-10 already holds the work and T-1 holds your sign-offs, so a second tracker adds nothing.

*Why it's your call:* The external pentest and the external-readiness and WCAG sign-offs are Thomas-only (T-1). Closing a customer-readiness gate, and any change to performance budgets or the k6 and restore-drill environment, is the owner's call. *Blocks:* Starting L-10 sub-items under a clear tracker; the umbrella cannot be closed or relabelled until you decide.

## #93: For #93 (concurrency probes on membership guards), do you want only the missing concurrent-remove test, or also a PR-template rule and mutation testing?
- **a.** Add one concurrent-remove probe test, proven red then green, then close. Cost: S, no gate or dependency change, still needs one independent review because it covers tenant isolation tests.
- **b.** Probe test plus a PR-template item and check:pr-template enforcement for security-path guards. Cost: S more, edits a CI gate.
- **c.** Also add mutation testing (Stryker or similar). Cost: new dependency and a CI job; the largest option.

**Recommended:** Take the first option: the probe is the only proven gap. Skip the template rule and mutation testing, which add process and a dependency for a one-off hole.

*Why it's your call:* Editing the PR-template gate is a security-scope CI change, and mutation testing adds a dependency and a CI job, both on the ask-first list. The probe itself touches membership and tenant-isolation tests, which are high risk. *Blocks:* Closing #93; the concurrent-remove probe and any template change wait on your choice.

## #98: Should #98 (the wall-clock assertion in the permissions route-path test) be closed as won't-fix, or replaced with a step counter added to production permissions code?
- **a.** Close as won't-fix and keep the existing timing test. Cost: none; the test has never flaked, but it could miss a real O(n^2) regression.
- **b.** Add a test-only step counter to normaliseRoutePath and assert on step ratios instead of time. Cost: S, touches packages/permissions/src/policy.ts, needs a Sol high-effort review.

**Recommended:** Close it as won't-fix. Instrumenting the permissions package for a test that has not flaked is more risk than it removes.

*Why it's your call:* packages/permissions is on the high-risk list (permission semantics), so even test-only edits there need your go-ahead and an independent review. *Blocks:* Any change to the permissions package for #98; nothing else is waiting on it.

## #102: For #102 (CI alias table can be mutated via Map.prototype.set.call), should we accept the limit and close, add a small consumer-side check, or remove the alias mechanism?
- **a.** Accept the limit, record it in code, and close. Cost: none; exploiting it already needs commit access to scripts/ci/**, which review gates.
- **b.** Add a roughly 10-line expected-aliases check in test-all.mjs plus a probe. Cost: XS, but it only raises the attacker's cost because the guard lives in the same unpinned file.
- **c.** Delete the alias mechanism and align the CI gate names in ci-gates.md and ci-cd.md. Cost: M, changes the CI gate contract.

**Recommended:** Accept and close, matching #106. A guard in the same file as the attack proves little, and the contract change is not justified by an unexploited low-urgency gap.

*Why it's your call:* It edits CI gating scripts (high risk), and the full fix changes the CI gate contract in docs/technical, a retained contract that needs your approval. *Blocks:* Closing #102 and any edit to the CI gate scripts or contract.

## #106: For #106 (pr-body guard can be evaded by respelling the comment-stripping loop), do you accept the recorded limit and close, or approve an AST guard that needs a parser dependency?
- **a.** Accept the limit; the existing code comment already records it. Close with no code change. Cost: none; the evasion needs reviewed commit access to scripts/ci/**.
- **b.** Add an AST check in pr-body.test.mjs using acorn or similar. Cost: M and a new dependency.
- **c.** Add a weaker regex-based approximation with no dependency. Cost: S, easy to evade and could give false confidence.

**Recommended:** Accept and close. The issue itself calls that legitimate, and a parser dependency for a guard that review already covers is not worth it.

*Why it's your call:* The AST option adds a dependency and changes CI gate behaviour, both of which AGENTS.md reserves for Thomas. *Blocks:* Closing #106 and any dependency or CI guard change for it.

## #139: Add the Drizzle config file to the security-review path list in the CI gates doc, and delete the unused auth-schema file?
- **a.** Add the config path to the list and delete the dead file (one small PR; widens a security gate, so a Sol review is needed).
- **b.** Delete the dead file only and leave the security list as it is (no gate change; edits to the config still skip security review).
- **c.** Close the issue as won't fix (no work; the gap stays open).

**Recommended:** Option 1. The config pulls in schema files outside the covered folders, so a bad edit could drop tables from generation unreviewed, and the fix is one line plus a prune of the vocabulary baseline.

*Why it's your call:* Changing ci-gates.md alters a security gate (security model), which AGENTS.md says to ask Thomas about before changing. *Blocks:* The #139 PR (security-scope list edit and dead-file removal).

## #181: Should we add database-level guards on membership and roles now, and should the work-item assignee guard be split into its own issue?
- **a.** Do S3 (role scope match), S5 (enum checks) and S6 (placeholder cannot hold a membership) in one migration with a preflight that fails on bad rows; document S7 only; split the assignee guard out (medium cost, needs Sol review).
- **b.** Do everything, including the assignee guard, in one migration (larger, riskier PR, and the 'inactive person' rule is still undecided).
- **c.** Leave the app-level guards as the only protection and close the issue (no cost; no DB backstop for tenant isolation).

**Recommended:** Option 1. It adds the backstops that are cheap and clearly right, and keeps the undecided assignee semantics out of a tenant-isolation migration. Confirm the allowed person.side values come from the docs before writing the CHECK.

*Why it's your call:* It is a migration on membership and tenant-isolation data, and a new DB constraint is a retained-contract change; AGENTS.md says to ask first for tenant isolation and irreversible data changes. *Blocks:* The #181 migration, schema mirror and DB tests.

## #189: Close #189 as mostly fixed by PR #215, and drop the remaining work-item key format CHECK and watcher cross-org guard?
- **a.** Close with a recorded decision linking PR #215 and the later FK migrations; send timestamps to #221 and the watcher guard to the #181 track; add no key CHECK (no cost, no import risk).
- **b.** Close, and also add a NOT VALID CHECK on work_item.key after confirming which key formats imports allow (one small migration; a wrong regex could break imports).
- **c.** Keep #189 open and add both the key CHECK and the watcher composite guard (two migrations touching import and tenant isolation).

**Recommended:** Option 1. Nearly all of the issue shipped, the key format is already controlled by app code and uniqueness, and the rest has other homes. Do not add a regex that could reject legitimate imports.

*Why it's your call:* The roadmap's acceptance rule for L-09 requires 'fixed with tests or closed with a recorded decision', and any new key or watcher migration touches tenant isolation and import behaviour. *Blocks:* Closing #189 and the L-09 schema hygiene row.

## #198: What should the retention work finish with: invitation purge, a legal-hold lift CHECK, and soft-deleted comment purge?
- **a.** Add a legal_hold CHECK (lifted_at and lifted_by both set or both null) only if the lift route does not already enforce it; add hold-aware purge of expired, unaccepted, unrevoked invitations; fix the stale comment; split comment purge into its own issue (one medium PR, Sol review).
- **b.** Do only the stale-comment fix and the legal_hold CHECK; record invitation and comment purge as decided not to be built (small; invitations stay in the database indefinitely).
- **c.** Close the issue as done and open follow-up issues for everything remaining (no work now; leftover items are less visible).

**Recommended:** Option 1 with comment purge split out. Invitation purge is the one real gap, and the predicate (expired, not accepted, not revoked) is the obvious one. Check the lift route first so the CHECK is not redundant.

*Why it's your call:* The purge predicates decide what customer data is permanently deleted, and the CHECK is an irreversible migration on a table holding data; AGENTS.md says to ask before deleting data or irreversible changes. *Blocks:* The invitation purge, legal_hold migration and closing #198.

## #230: Build the break-glass `grant-instance-admin` command with an in-app security alert only, and mark the other documented recovery commands as not built?
- **a.** Build only grant-instance-admin on a shared function with the existing route, log it as a system actor with the OS user recorded, send the in-app alert, and mark the other commands as not built in the runbook (medium PR, Sol review).
- **b.** Same, plus email every existing admin (needs a mail path callable from the command line; larger and may need a new provider path).
- **c.** Remove the documented CLI from the runbook and rely on direct database recovery (no code; recovery stays manual and error-prone).

**Recommended:** Option 1. The runbook already promises this command and it does not exist, so the recovery path fails on a real image. Ship the smallest working command and be honest in the docs about the rest. If audit_log cannot take a system actor with no actor id, come back to Thomas before changing the schema.

*Why it's your call:* It is an auth and permission recovery path that grants instance admin outside the normal step-up flow, which falls under the security model and permission semantics rules in AGENTS.md. *Blocks:* The #230 CLI, its build target and the runbook fix.

## #232: On an unclaimed instance with password sign-up turned off, should the two refusal messages be made identical, or do we accept that they differ?
- **a.** Unify: make the early gate return the same 403 as the later registration check, keyed on the setup-completed marker. Small auth change, needs an independent high-effort review, plus a test.
- **b.** Accept: the difference only reveals whether the instance is claimed. Close that part as accepted risk and add just the missing password-disabled test (XS).
- **c.** Do nothing and leave the issue open (no cost, but the security question stays open).

**Recommended:** Option 2. Whether an instance is claimed is low-value information, and the small test closes the real gap. Skip the auth rewrite and its review rounds.

*Why it's your call:* AGENTS.md 'Ask Thomas first': changing the security model and permission semantics (auth refusal behaviour); also high-risk auth work needing an independent review.

## #257: Should expired invitation links keep showing the invitee email, workspace name and inviter name, or show nothing?
- **a.** Keep showing them and fix only the wording: policy reason, the architecture doc line, one test pinning the field set. XS, no contract change.
- **b.** Hide email, workspace and inviter on expired invitations. Changes the public response, the API schema snapshot and the invite page (S-M).

**Recommended:** Option 1. The link is already secret and was sent to that address, and the expired page needs the inviter name to say who to ask. Fix the wording only.

*Why it's your call:* AGENTS.md 'Ask Thomas first': changing the public response contract and security model. Only the stricter option needs him.

## #266: May we add an operator runbook for deleting a squatted project slug claim, given claims are permanent by design?
- **a.** Yes, doc-only runbook: confirm no live project, require zero burned work-item keys for that slug, back up, delete in one transaction. XS, no code.
- **b.** Same runbook plus an integration test that runs the documented SQL (a little more work, proves the predicate).
- **c.** No: keep claims permanent and close as won't-fix (zero cost, but no recovery path for a squatted slug).

**Recommended:** Option 1. A doc-only runbook with the burned-key check gives a safe recovery path without new code. Skip the test and any script.

*Why it's your call:* AGENTS.md 'Ask Thomas first': deleting data irreversibly and changing a retained tenant-isolation contract ('claimed forever').

## #314: How much of the remaining settings work should we do: only the cross-workspace leak fix, that plus a database constraint, or also editable work-item types?
- **a.** Scope the two work-item joins to the workspace plus a cross-workspace test. XS, no migration, closes the leak.
- **b.** Option 1 plus a migration pinning state templates to the workspace with a composite key. M, high-risk review.
- **c.** Everything: work-item type edit API, new permission, migration, audit and settings panel. L, new permission semantics.

**Recommended:** Option 1 now. It fixes the only live leak cheaply. Defer the constraint and type editing until a customer asks, and split them into separate issues.

*Why it's your call:* AGENTS.md 'Ask Thomas first': a new capability (permission semantics) and a migration adding a tenant-isolation constraint on existing data.

## #348: Should setting priority when creating a work item require the 'set priority' permission, like it already does when editing?
- **a.** Yes: require set_priority on create (API check, disable the control in the create dialog, one denial test, one doc line). S. Only custom roles are affected, since built-in roles that can create also hold it.
- **b.** No: record in the permissions doc that creating includes initial priority, and add one test. XS, but leaves create looser than edit and than the other initial fields.

**Recommended:** Option 1. It closes a real bypass (a role that cannot edit priority can set it on create) and matches how dates, labels and assignee already work. Keep the UI change to disabling the control.

*Why it's your call:* AGENTS.md 'Ask Thomas first': permission semantics and a retained contract; either choice edits permissions.md.

## #359: Should the assign-time check also refuse customer-side people and placeholders, so it matches what the assignee picker already hides?
- **a.** Yes: one shared rule (active staff, not placeholder) used by both picker and write, plus one parity test. Small API change, no UI change.
- **b.** Also require a live workspace member and non-banned user at assign time. Stricter, but a further permission change and more testing.
- **c.** No change: leave the picker as the only filter and close the issue. Stray customer or placeholder rows stay assignable through the API.

**Recommended:** Option 1. It is the smallest change that makes the rule identical in both places, which is what the issue asks for; skip the extra workspace-member check unless you want it.

*Why it's your call:* Changes who can be assigned (permission semantics) and records a staff-only project roster rule (contract). High-risk, so independent Sol review is also needed. *Blocks:* Closing #359 and roadmap row L-09.

## #398: Is it safe to permanently delete the old `task` permission key from stored roles and API keys, given that an older build could no longer be rolled back to?
- **a.** Yes: one forward-only migration copies `task` into `work_item` where missing, then removes `task`. Needs a backup first and cannot be undone.
- **b.** Not yet: keep the old key and wait until the rollback window for the earlier release is clearly closed. No cost now, but the legacy key stays in the data.
- **c.** Descope: leave the key forever, since the roles list already hides it. Close the issue as accepted.

**Recommended:** Option 1 once you confirm no pre-#392 build will be redeployed; it is one small migration and needs no runtime self-heal. If you are unsure, choose option 3 over carrying a stale key.

*Why it's your call:* Irreversible data migration on permission data, and rollout/rollback and the UAT deploy are production matters that need your approval. *Blocks:* The migration PR and the #398 acceptance sign-off.

## #402: May I edit the release workflow and add a scheduled image re-scan, so end-of-life base images fail the security scan?
- **a.** Yes, both: set the end-of-life exit flag on the release scans and add a weekly re-scan workflow where a red run is the alert. Small, but it changes what blocks a release.
- **b.** Only the release scan flag. No new workflow, so no scheduled alert; newly found issues surface only at the next release.
- **c.** Neither: leave the workflows alone and close the issue, since the Dockerfile part is already fixed.

**Recommended:** Option 2: it is a one-line gate change. A weekly re-scan is extra scope the need does not clearly justify yet; add it later if you want ongoing alerts.

*Why it's your call:* Editing workflows and changing release-gate semantics need your approval; the PR also needs a Sol high review. *Blocks:* The workflow PR and closing #402.

## #445: Should team leads be allowed to edit team-visibility saved views, reversing the recorded decision to hold that for a later release?
- **a.** No: fix the stale code comments, update the issue title to say the column exists and lead editing is deferred, and close it. Docs-only, no permission change.
- **b.** Yes: allow a lead of the view's team to edit it (non-leads, other teams, deactivated leads and API keys still denied). Medium change with tests and browser checks across roles.
- **c.** Yes, and also build the departing-member view transfer to a lead. Largest option and moves data ownership.

**Recommended:** Option 1. The schema blocker is fixed and the contracts deliberately defer lead editing, so there is no defect to repair; revisit only if a real team asks for it.

*Why it's your call:* Lead editing changes permission semantics on the view edit and delete routes and overrides a recorded contract decision; transfer changes data ownership. *Blocks:* Closing #445; any SV-17 or TM-8 work.

## #477: How should the PR-body checker stop code spans and escapes being read as hidden comments: add a Markdown parser dependency, or keep tightening the hand-written scanner?
- **a.** Add a Markdown parser library (micromark or similar). Removes the whole class of bug and logs a notice entry, but adds a dependency and is a medium-to-large change.
- **b.** Extend the hand-written scanner for code spans, fences and backslash escapes only, one test per case. Small, no dependency, but the exposure may only move.
- **c.** Close as low value: first confirm on real GitHub whether any of the five cases is actually exploitable; close if none is.

**Recommended:** Option 3 first, because the issue itself says none of the cases is confirmed exploitable. If one is, take option 2 rather than adding a dependency for a CI template check.

*Why it's your call:* Option 1 adds a dependency, which needs your approval, and reverses the earlier decision to defer a parser; the checker is also a required CI gate. *Blocks:* The #477 fix and roadmap row L-11.

## #478: Should the PR-template check also ignore link definitions, DOCTYPE, CDATA, script and style blocks, or should we close this as not worth defending?
- **a.** Patch it: strip only the confirmed hidden forms in the existing script, no new dependency. Medium effort, needs one Sol review because it is a CI gate.
- **b.** Close as won't-fix: the check already handles HTML comments and only stops accidents, not deliberate hiding by our own agents. No work.
- **c.** Swap in a real Markdown parser. Most accurate, but adds a dependency and is shared with #477.

**Recommended:** Close as won't-fix. The remaining forms are deliberate evasion by our own agents, which the check was never meant to stop, and the comment case that mattered is fixed.

*Why it's your call:* Closing changes the PR-gate security model, and a Markdown parser would be a new dependency; both are Thomas's call under AGENTS.md.

## #580: How far should we take the query-ownership checker: wire it now with the existing violations frozen, finish the full migration, or drop the gate?
- **a.** Wire it now: add the package script and a CI job that blocks new violations only, with about 100 existing files listed as known debt. Small change; migrate files later as each area is touched.
- **b.** Finish the full migration first: move queries from about 100 files into repositories (including purge, identity login, secrets rekey) in sliced PRs, then wire the gate. XL effort, several high-risk Sol reviews.
- **c.** Drop the gate: leave the checker unwired and mark the docs 'not planned'. No work, but nothing stops new direct queries.

**Recommended:** Wire it now with the current violations frozen, if the checker can support a baseline. It stops new debt for a small diff, and the risky purge and identity moves wait until those areas are touched anyway.

*Why it's your call:* Adding a CI job means editing a workflow, which needs Thomas, and a new required gate changes CI gating and possibly branch protection.

## #626: Do we run the pre-2.0.0 readiness pass (screen reader, keyboard, cross-browser, big-data test, restore check) once before release, and do we allow k6 for the load test?
- **a.** Run it once at the end on local SIT using the tools we already have (Playwright, G4, backup/restore scripts, demo seed at PG6 size), with no k6. Thomas does the manual PG2/PG4/PG5 pass and signs the screen inventory.
- **b.** Same as above, plus approve k6 as a container-run tool for a load baseline. Adds a new tool and a script to maintain.
- **c.** Waive it again, as on 10 Oct, and close the issue. No work, but nothing is proven before 2.0.0.

**Recommended:** First option. The existing Playwright, restore and seed tooling covers the need; skip k6 until a real load problem shows up. Thomas's manual pass and screen sign-off are required and cannot be delegated.

*Why it's your call:* Human sign-off and the screen-inventory approval are owner decisions, and k6 would be a new tool.

## #637: Should we stop treating the board-render miss as its own issue and fold it into the L-05 performance row?
- **a.** Fold into L-05: close #637, keep one measured code-side fix there (for example defer drag-and-drop hooks), with the G11 budget, fixture and thresholds unchanged. Closes the duplicate with no extra work.
- **b.** Keep #637 open as a separate item until the board render passes on CI with headroom. Same work, more tracking overhead.
- **c.** Re-calibrate the 500 ms budget to match observed runs. Quick, but changes a frozen performance budget.

**Recommended:** Fold into L-05 and close #637. The gate is report-only, no product cause has been found in several diagnoses, and a separate issue adds only tracking cost. Do not touch the budget.

*Why it's your call:* G11 budgets, thresholds and calibration are frozen, and closing a performance-budget item needs Thomas's sign-off.

## #711: Is G11 staying report-only for good, so #711 closes with a pointer to L-05 and L-02?
- **a.** Yes, G11 stays report-only: close #711 pointing at the L-05 and L-02 roadmap rows, which keep tracking headroom work. No further effort here.
- **b.** Keep #711 open until three consecutive CI runs have LCP under 2500 ms. Needs more route-graph work and A/B measurement; the last recorded runs were 2549 and 2579 ms.
- **c.** Make G11 blocking again once headroom is back. Restores the gate but risks blocking merges on runner noise.

**Recommended:** Yes, close it into L-05 and L-02. The blocking symptom is already gone, the headroom work continues under L-05, and the three-runs bar there is the real exit test. Decide #637 the same way.

*Why it's your call:* Closing while G11 stays frozen and report-only is a performance-gate decision, and any budget or calibration change needs Thomas.

## #737: Should the owner/admin reach sync stop granting to deactivated people and revoke stale system_backfill grants at boot?
- **a.** Do items 1 and 2: skip inactive people and revoke stale system_backfill grants at boot, plus fix two stale ADR lines. Small API change, but boot-time revoke reduces reach for existing data.
- **b.** Do only item 1 (skip inactive people, no boot revoke) plus the ADR lines. Lowest risk, but stale grants on demoted members stay.
- **c.** Close it: accept current behaviour and fix only the ADR lines.

**Recommended:** Option 1, with the revoke limited to system_backfill grants so admin-made grants are untouched. A deactivated owner regaining sees_all is a real defect and the fix reuses the existing sync path.

*Why it's your call:* Changes permission semantics and tenant reach, which AGENTS.md lists under ask-first; ADR 0015 is also still proposed. *Blocks:* Backlog L-09 permission follow-ups for #737 and the ADR 0015 wording edit.

## #746: Should a creator who is demoted from owner/admin get their project-lead grant back on their own projects?
- **a.** Yes: restore the grant on demotion for projects they created (skipping ones with an existing direct grant), and add the create/remove race re-check and API key in the audit row. Medium change, needs a Sol review.
- **b.** Only the race re-check and audit API key; leave demotion as it is. Small, no new reach, but demoted creators stay locked out of their projects.
- **c.** Close the demotion part as won't-fix and handle project reach manually by an admin.

**Recommended:** Option 2 now. The race and audit fixes are clear defects with no new reach. Restoring access on demotion is a permission-semantics choice the decision log does not cover, so add it only if you want it.

*Why it's your call:* Restore-on-demotion changes who can reach a project, and the race fix touches tenant isolation and membership locking; both are ask-first. *Blocks:* Closing #746 and the L-09 permission follow-ups row; the strict-enforcement checklist line.

## #770: Should the SCIM admin response gain token status and a server-provided base URL, and should the test-connection endpoint be built?
- **a.** Add tokenStatus and scimBaseUrl to the SCIM response, update the panel, and delete the stale identity-provisioning helper. Defer test-connection and GET-by-id. Medium change, one contract amendment.
- **b.** Do the above and also build the test-connection endpoint. Larger, adds a new outbound-call security surface.
- **c.** Close as done: the group-mapping UI shipped, and leave the SCIM panel deriving its URL on the client.

**Recommended:** Option 1. Showing whether a token exists and the real base URL is what admins need, and it is a small contract addition. Skip test-connection until someone actually asks for it.

*Why it's your call:* Adding fields to the SCIM admin response changes a retained contract, and a test-connection route would extend the security model. *Blocks:* SCIM panel token status work and removal of the stale libs helper.

## #876: For the G11 calibration failures on hosted runners, do you want to change the bounds, re-record the reference, or keep them and only improve logging?
- **a.** Keep bounds and R0; I add raw batch logging on failure only (XS, no threshold change). Leave the issue open for the variance question.
- **b.** Widen the factor floor and spread limit to fit the observed hosted-runner results (0.736 and 0.567-0.638). Quick fix, but it loosens a performance gate.
- **c.** Re-record R0 on current hosted hardware and keep the bounds. Most accurate, needs new evidence runs and your sign-off.

**Recommended:** Option 1 now, since it needs no approval and shows the real data. Decide on bounds or R0 only after a few runs with that evidence; the issue itself forbids raising the bounds.

*Why it's your call:* Performance budgets, thresholds and calibration are Thomas's call under AGENTS.md; never changed by an agent. *Blocks:* Closing #876 and trusting G11 headroom numbers in roadmap L-02 and L-05.

## #894: Should report-export downloads get a short-lived signed URL so Firefox and Safari stream them, or stay on the current authenticated download?
- **a.** Keep the authenticated download and close the issue as an accepted limit. Cost: none. Effect: Firefox and Safari buffer files up to the 512 MB cap.
- **b.** Have the browser download by a plain link navigation to the existing authenticated endpoint, so the browser streams it. Cost: small web change, no contract change, and it needs a check that the session cookie authenticates the request.
- **c.** Add a signed download URL. Cost: contract and security-model change, new token issue, expiry and audit work. Effect: a link that works without a session and could leak.

**Recommended:** Option 2. The server already streams, so the smallest fix is a different browser download method, with no new URL type. If that cannot work with the session cookie, take option 1 rather than weakening the security model.

*Why it's your call:* Signed URLs would change the report-export API contract and the security model (authenticated download, per-download rate re-check, audit), which AGENTS.md reserves for Thomas.

## #895: Import retry can lose pending publish events if a run pauses before an uncertain commit is reconciled. Do we add a durable column and define checkpoint semantics, or accept the in-memory limit?
- **a.** Add a nullable import_chunk.pending_publish column and write the checkpoint semantics into the import contract. Cost: a migration plus a contract edit, then re-review. Effect: no lost events across pause or crash.
- **b.** Accept the in-memory behavior and document the gap in the import contract. Cost: XS. Effect: a paused or crashed run can lose publish events, so a re-run must reconcile them.
- **c.** Drop the transient retry change. Cost: discards 4 review rounds. Effect: import behaves as before.

**Recommended:** Option 1. The loss already exists on crash today, and the column is a small nullable addition. Before merge, check that the migration does not rewrite existing import rows.

*Why it's your call:* Needs a migration and a change to the import contract's checkpoint semantics, both of which AGENTS.md reserves for you.

## #896: Should import attachment failures that look temporary be retried, and how many times?
- **a.** Retry transient failures (exceptions, network errors, 5xx, storage errors) up to 3 times, then record one terminal loss, and rebuild the loss index at finalize. API-only, medium change with a Sol review.
- **b.** Retry once only, with no new stored field. Smaller and simpler, but some transient failures still become permanent losses.
- **c.** Leave as is and document that failed attachments must be re-imported.

**Recommended:** Option 1 with a fixed limit of 3 and no backoff tuning. Today a brief outage permanently loses attachments, and the retry reuses the existing pending ledger and idempotent writes.

*Why it's your call:* Import is a high-risk area, and adding an attempts field changes the stored pendingAttachments report shape, a retained contract. *Blocks:* Backlog row L-06 and the import resilience tests.

## #897: If a project turns SLA on while the workspace has SLA off, should the project SLA be ignored, or allowed to run with its own policy and calendar management?
- **a.** A: Project SLA needs the workspace flag; the scanner, work-item creation and reports ignore a project-on override while the workspace is off. Small change, no permission change, matches the UI that already hides SLA settings.
- **b.** B: Allow project-only SLA; relax the SLA policy and calendar routes and settings screens to 'workspace or any project on'. Larger, changes permission semantics, more UI to build and test.
- **c.** C: Leave as is and just record that the mismatch is accepted. No work, but a project SLA keeps running with nobody able to manage its policy.

**Recommended:** Option A. It is the smallest complete change and it matches how the UI already behaves; B adds permission surface that nothing asked for.

*Why it's your call:* Changes feature-flag inheritance and permission semantics, which AGENTS.md reserves for Thomas. *Blocks:* L-06 backlog row and the SLA flag tests, scanner change and decision row for #897.

## #904: Do we build the capability rename alias mechanism (AK-12) now, or descope it until a first rename is actually planned?
- **a.** A: Build the minimal version: an empty alias map, a CI test that fails if a registry name vanishes without an alias, alias lookup when reading stored capabilities, and a short rename runbook. Medium size, touches auth reads, needs a Sol review.
- **b.** B: Descope to docs only: keep the existing log-and-deny handling for unknown names, record that AK-12 waits for the first real rename, and close the issue. No code, no risk.
- **c.** C: Add only the CI check with no alias resolution. Small, but stored old names would still be dropped on a rename.

**Recommended:** Option B. No capability has ever been renamed and unknown names are already denied safely; build the alias path when a rename is on the table.

*Why it's your call:* Alias resolution changes how stored capabilities are read in auth, a permission-semantics and security-model change, and may need a new CI gate. *Blocks:* Closing L-07 for AK-12 and the independent auth review it would trigger.

## #905: Do we add a real-database MCP injection journey test, or accept the existing scripted-fetch test as meeting MC-18 and close the issue?
- **a.** A: Add one integration test that seeds an injected work item and runs the MCP read, then checks the real 403 for a read-only key and the real 202 pending action for a write key, with nothing deleted. Medium size, no dependency, no UI.
- **b.** B: Close as met: the contract only asks for a scripted-model test and the earlier audit judged the current test sufficient. No work.
- **c.** C: Add the integration test later, after the other L-07 items.

**Recommended:** Option A, kept to one file. The server-side pieces are tested separately but no single test proves the injection cannot cause a delete end to end, and it needs no contract change.

*Why it's your call:* L-07 says the item is closed with tests or explicitly descoped by Thomas; the descope choice is his. *Blocks:* L-07 row for MC-18, the status and requirements evidence update.

## #906: Should the attachment upload contract (AT-2) be rewritten to describe the presigned PUT with signed exact size that the code already uses, or should the code move to a presigned POST?
- **a.** A: Update the docs and two stale comments to say presigned PUT with signed Content-Length and Content-Type, plus the size re-check and copy-to-new-key at completion, and add a decision row. Small, docs only, no behaviour change.
- **b.** B: Change the code to presigned POST with a content-length-range to match the old contract. Medium, touches uploads, tests and bucket CORS, and gains nothing the exact-size PUT does not already give.
- **c.** C: Leave the mismatch and note it as known. No work, but retained docs stay wrong.

**Recommended:** Option A. The exact-size PUT plus the completion check already enforces the limit; rewriting the docs is the smallest complete fix.

*Why it's your call:* Changes a retained contract (AT-2) and the upload security model, which AGENTS.md says to ask about first. *Blocks:* The docs, requirements-index and comment cleanup for #906, and the AT-2 requirement row.

## #907: Imported placeholder people are stored active so the verified claim works. Do we keep that and fix the docs wording that says inactive, or add a separate claimable state?
- **a.** A: Keep the code. Reword IM-7 and the import docs to say placeholders have no login or membership, are never assignable, and are claimable only through the verified path; add a decision row and denial tests for inactive and unverified claims. Small.
- **b.** B: Store placeholders inactive and add a separate claimable state. Requires a schema and contract change, risks the identity claim path, larger.
- **c.** C: Keep the code and leave the docs. No work, but the requirement stays contradicted.

**Recommended:** Option A. The code is safe by the issue's own account; only the contract wording is wrong, so fix the wording and add the missing denial tests.

*Why it's your call:* Rewording IM-7 changes a retained contract and the identity-claim (IP-30) semantics, which AGENTS.md says to ask about first. *Blocks:* The IM-7 wording fix, decision row and placeholder denial tests for #907 (L-01).

## #912: Project point-in-time reconstruction (AU-9) is missing. Do we build it from existing audit rows, or narrow AU-9 to work items only?
- **a.** Build GET project reconstruct from existing audit rows, covering only the fields that have before/after history. Cost: L, high-risk, Sol review. Effect: AU-9 is met, with the covered fields stated in the response.
- **b.** Narrow AU-9 to work items and the existing settings history list. Cost: XS docs change. Effect: no project time-travel, and the contract wording changes.
- **c.** Build it and also add a project activity journal with a migration. Cost: L plus a migration. Effect: complete history, but this is a bigger contract change.

**Recommended:** Narrow AU-9 to work items and close the issue unless a customer needs project time-travel. If you want it, take option 1 and do not add a journal.

*Why it's your call:* Changes a retained contract (AU-9, feature-contracts-p2) and adds a new permission-gated route; a migration would also touch persistence and the security model.

## #913: GM-5 asked for plugin settings forms generated from each plugin's schema. Do we narrow it to the fixed catalog, or build the generic framework?
- **a.** Narrow GM-5 to: the catalog is fixed, SMTP is schema-derived, storage, identity and observability keep their own screens. Add a test that every catalog entry has a valid config path. Cost: XS/S, docs plus one test.
- **b.** Build the full generic path: plugin manifest registry, one settings route with step-up and audit, and a generic settings page. Cost: L, high-risk, new API and security surface.
- **c.** Build the registry and route and migrate one more plugin as proof. Cost: L, with the same risk and no extra customer value.

**Recommended:** Option 1. Nothing registers plugins at runtime, so a generic framework serves one real form and adds a security surface. Correct the stale issue text while updating the row.

*Why it's your call:* Retiring or narrowing a requirement changes a retained contract, and a new settings API with step-up touches the security model and permission semantics.

## #914: Do we finish workspace-admin SIT coverage by creating missing fixtures inside the approved isolated QA workspace only?
- **a.** Yes, inside the isolated QA workspace only. Add records there or mark each case not applicable, re-run the 294 unconfirmed cases, then commit credential-free evidence and close the issue. Cost: M, tests and evidence only.
- **b.** Fold it into the #929 whole-product SIT sweep and close #914 as a duplicate when that lands. Cost: none now, but #914 closes later.
- **c.** Accept the evidence from the 24 passing cases plus denials and close it now. Cost: XS, but the 294 unconfirmed and 132 blocked cases stay unverified.

**Recommended:** Option 2. #929 already covers every route and role, so a parallel run duplicates it. Make the role-assertion preamble a shared precondition there. Your approval is needed only if a fixture must go outside the isolated workspace.

*Why it's your call:* Fixtures would touch SIT accounts and records. AGENTS.md forbids rerunning the SIT seeder or overwriting your records, so anything beyond the approved isolated QA workspace needs your approval.

## #1200: Old project keys 404 after a rename. Do we add a reach-gated resolve-by-old-key route that redirects to the current key?
- **a.** Add one policy-declared route that looks up the old key in project_slug_claim, applies the normal reach check, returns the same 404 as an unknown key on any failure, and add a web redirect that keeps query and hash. Cost: M, no migration, Sol review.
- **b.** Do nothing. After a rename, old URLs break and users re-open from the project list. Cost: none; close as won't-fix and note it in the rename dialog.
- **c.** Add the old key to the existing project list response instead of a new route. Cost: M, and it changes an existing contract.

**Recommended:** Option 1 if renames are expected in normal use, since the claim table already holds the data and no migration is needed. Otherwise option 2, because it is a new API on the key-enumeration and tenant-isolation surface.

*Why it's your call:* A new retained API route and policy touches tenant isolation and permission semantics. The issue itself requires owner approval first.
