# Independent ordinary review C — bulk integration #589

- **Reviewer:** GPT-6 Luna, fresh independent context C
- **Reviewed head:** `7dd3cbb461e9a6567acb07eda64cd3bbaaac54de`
- **Base:** `3096cb044bdf6ae98488bfc385f532fa6386343a` (exact merge base)
- **Independence:** I did not author, direct, or remediate this candidate. No source edits made.
- **Verdict:** **BLOCKED** — concrete query-gate bypass plus exact-head CI failures below. Do not treat this as approval.

## Scope checked

Reviewed repository instructions/workflow, status and review packet; feature contracts for service calendars and SLA; full changed-file list (641 files); P4 query-checker implementation and tests, OpenAPI operation counter, inventory/contrast control changes; URL route metadata and representative new calendar/SLA/approval/identity screens and hooks; current PR checks and hosted failures. Exact commit was confirmed with `git rev-parse HEAD`.

## Blocking findings

1. **P4 query ownership checker can be bypassed with direct `Reflect.apply`.** `queryReadViolations("Reflect.apply(db.select, db, []).from(users)", "x.ts")` returns no violation, while `db.select().from(users)` is flagged. The same bypass works with `db["select"]`. This is a normal direct invocation form of the protected read method and makes the checker’s read coverage incomplete. Add a regression probe/test and cover this invocation (and equivalent `Reflect.apply` forms) before relying on the gate. Reproduced locally against the exact candidate source; no files changed.

2. **Hosted `unit + component` fails on portal route metadata.** `apps/web/src/lib/generated-route-metadata.ts` includes `/sign-in`, but `apps/web/src/lib/routes.test.ts` still expects only `["/", "/approvals"]`. GitHub run `37467743538` reports 125 files / 500 tests passing and one failure at `routes.test.ts:169`; actual routes are `["/", "/approvals", "/sign-in"]`.

3. **Hosted OpenAPI contract gate rejects four response-enum expansions.** Run `37467743538` reports unapproved `user_deactivation` values on GET `/me/pending-actions`, GET `/me/pending-actions/{id}`, POST `/me/pending-actions/{id}/cancel`, and POST `/me/pending-actions/{id}/deny`. The gate explicitly says a pre-existing `openapi-approved-breaks.json` entry approves nothing; a new authorized entry or compatible contract change is required. Do not waive the gate.

4. **Hosted PR-template/security-review gate is red.** Run `37467743538` finds required template sections absent, including `## Security review`, `## Reviewed by`, and `## Implemented by`; it reports 276 security-scope paths. Restore/populate required sections and committed security review evidence through the normal review flow. This review does not substitute for GPT-6 Sol.

5. **Hosted G8 visual regression and G11 performance budget are red** on run `37467498678`. The run confirms the visual baseline step failed and the performance measurement failed; this review did not inspect downloaded artifacts or establish the underlying screen/metric causes. They remain genuine unresolved required checks, not waived.

## Checks / evidence

Author packet records passing local checks: frozen install, typecheck 9/9, `lint:ci`, `check:queries`, inventory (53 routes / 14 active screens), OpenAPI operation count (230), route-policy (88 tests), contrast (434 pairs), CI checker tests (54/54), focused API (20 tests), focused web (13 tests), and `git diff --check`. I did not rerun those checks. I inspected the exact hosted PR head and failures above. Hosted G4 and several static/build/dependency checks were green in the run snapshot; PostgreSQL integration was still in progress when queried.

## Non-blocking observations / limits

- The generated route metadata test discrepancy is likely a stale expected list, but must be corrected and the hosted suite rerun.
- OpenAPI enum additions may be intentional for the documented deactivation pending action; compatibility handling still must be explicit in the gate's accepted contract.
- I inspected representative URL state and shared UI usage in the new routes; local token, contrast, inventory, and route-policy gates are reported green. No separate UI defect beyond the failing portal-route assertion was established in this pass.
- The packet explicitly leaves database apply/full integration, Docker/image boot, manual product-screen use, hosted full-CI completion, and full acceptance outstanding. No claim is made for those surfaces.
- The independently reported provider-reload and cross-calendar SLA-pause findings from reviewers A/B were not duplicated here.
