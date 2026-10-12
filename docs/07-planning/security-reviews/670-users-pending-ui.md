# PR #670 security review record: selective Users directory and pending-action UI

This note is the committed review record for PR #670, "feat(web): selectively integrate canonical Users and pending-action UI". #670 is the replacement for the cumulative #608 branch: #608's backend is already accepted on main through #647, but its seven unique UI/helper units (God Mode Users directory with URL-backed selection and action dialog, requester-owned pending-action list and detail, operation-bound admin step-up, exact-email deactivation approval) and 159 message leaves across 19 catalogs were not on main. #670 carries those units forward against the accepted backend. It adds no backend policy, capability, schema, dependency or locale identifier. Original #608 stays open and its branch is preserved until every original unit has an accepted disposition (see `docs/07-planning/integration-execution-queue.md`, the "Users / #670" and "Source conservation" entries).

Security surface: operation-bound admin proofs, typed-email PA-15 approval, target and tenant binding on the God Mode Users screen, and a shared intent-lifecycle hook that invalidates delayed proof continuations after route-intent changes, A to B to A returns and unmount. The server remains the authority.

## Review chain

The reviewed source was repaired in rounds. The chain below runs from the first selective-source review to the current candidate. Every report is embedded unmodified further down, including the BLOCKED reports; none was dropped. Historical reports keep their original model identity.

- Full source security review (GPT-6 Sol): BLOCKED at `d7e3dd7c`, then CLEAR at `d106cf0a`. The d7e3dd7c BLOCKED report is the "prior BLOCKED verdict" the PR body mentions, and it is published here unchanged.
- Delta security reviews (GPT-6 Sol) cleared each later source delta through `1c02fb1a`, the last GPT-6 Sol clearance.
- Two later test-and-UI deltas, `809b593c` and `8e47e787`, were cleared by a fresh Claude Opus 5.5 context as delta security reviews, with ordinary reviews by Claude Sonnet 5.5. These are labelled Claude Opus 5.5 and Claude Sonnet 5.5 in the index. They are not recorded as GPT-6 Sol. Claude Opus 5.5 is on the accepted-model list on main.
- The real-browser journey at `8e47e787` passed 1/1 (private evidence `670-real-users-playwright-8e47e787-claude`).
- Two UI acceptance deltas after the real-browser probe, `55227706` (layout, loading skeleton, option labels and a clean merge of main `d86d3089`) and `c5ccfe58` (layout-shift fix, contrast manifest, three Linux baselines), were reviewed by fresh Claude Sonnet 5.5 ordinary contexts and cleared by fresh Claude Opus 5.5 security rebind contexts. They are labelled with those models and are not recorded as GPT-6 Sol.

**Reviewed head:** `9bff711d84929a1d7bbb6135e64bf5af8f5c20d6`
**Reviewed head:** `d2de7ce0d6eecae487944bebff21391da65b04e2`
**Reviewed head:** `d7e3dd7c4b2e400a5dcf2443430e10150767b94f`
**Reviewed head:** `d106cf0a6bb1d06005578abfe1b858df37a98d4d`
**Reviewed head:** `f5ef92fbaa7bb7ee9e2c064dbcbc9e966d363695`
**Reviewed head:** `9ee958bbe5e0ed87053b9bef9ca34a5ae60667d0`
**Reviewed head:** `f3883a3cb4202c0fc243c5078a3be3cb1129cde2`
**Reviewed head:** `643bb77e0dc842a71b3ec162e3d20d233efff63c`
**Reviewed head:** `0469577db3f7d8c7e2c384c922efff4370ac169c`
**Reviewed head:** `7658fdbe43c75370d60747ee2401f08b965f3ce4`
**Reviewed head:** `a2677ffb808d76076606fd73c4886d732f3e0595`
**Reviewed head:** `1c02fb1a605496dcfcb661301e21dc2784b3a077`
**Reviewed head:** `809b593c24a54b7d63eb6e7dc4978c59d1c75d77`
**Reviewed head:** `8e47e787e40c85754d51c33fb8bcc686a432d91c`
**Reviewed head:** `552277064d6e09b41157b14afc431928f24bff7b`
**Reviewed head:** `c5ccfe58458077c4882937799dfc39010c285145`

The last line above is the candidate head, `c5ccfe58458077c4882937799dfc39010c285145`, cleared by Claude Opus 5.5 as an exact-head delta review over `55227706..c5ccfe58`. Earlier heads are listed in chronological order for the audit trail. Every one is an ancestor of the candidate.

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/`. The SHA-256 is of the file bytes and matches the embedded copy below. "Model" is what the report itself declares, kept as written; for the 608 and #670 Luna and Sol reports the serving variant was not always exposed, and those reports claim only the assigned tier.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `608-current9bff-ordinary-a-luna.md` | Ordinary review A (selected Users/pending-action UI source) | GPT-6 Luna | `9bff711d` | CLEAR WITH ONE NON-BLOCKING FINDING | `f238bdace54556880ba21823c4181d4823c13f1fba77fc88ee67d75af66428a6` |
| 2 | `608-current9bff-ordinary-b-luna.md` | Ordinary review B | GPT-6 Luna | `9bff711d` | PASS (no source-level blocker) | `c8c6fac44cd30a04713e6b7fa1a04a9ecd38ee3d5b628d67797130187238b6fa` |
| 3 | `608-current9bff-ordinary-c-luna.md` | Ordinary review C | GPT-6 Luna | `9bff711d` | BLOCKED (action dialog not URL state; selection retargets it) | `ac52d78d91ef604c75c4295e9e2ff34a3c05886d03b79b44cf1ef1282aaa934d` |
| 4 | `608-currentd2de-blocker-disposition-luna.md` | Blocker disposition (review C finding) | GPT-6 Luna | `d2de7ce0` | BLOCKED (original finding closed; ABA stale-proof issue remains) | `8becf98c2eb821631891a4d9cf0409a8a5ff5a4609f5556a75900092ec7cd08a` |
| 5 | `608-currentd7e-blocker-disposition-luna.md` | Blocker disposition (ABA) | GPT-6 Luna | `d7e3dd7c` | CLEAR (prior ABA blocker closed) | `211758db0bb1f4eb5bf38477cddb0d1ca768046c0d72dfa26fb03c33789eb47f` |
| 6 | `608-currentd7e-full-security-sol.md` | Full security review | GPT-6 Sol | `d7e3dd7c` | BLOCKED (stale pending-action approval continuation) | `642f6d461b8643de27449bb9bc49d6207574102f0919a04cfcb2f1f7f1e88b35` |
| 7 | `608-currentd106-structural-ordinary-b-luna.md` | Structural-delta ordinary review B (d7e3dd7c..d106cf0a) | GPT-6 Luna | `d106cf0a` | PASS | `fdff6678fa2a1a1c9bd78692cf17756c7c2da8aa4d1ca3b1321150a3590c7e9d` |
| 8 | `608-currentd106-structural-ordinary-c-luna.md` | Structural-delta ordinary review C (d7e3dd7c..d106cf0a) | GPT-6 Luna | `d106cf0a` | CLEAR | `5089ea8f6616f8a19b071dbf0518c07e18b5f4f631a9cd1768591ea2eb9e4394` |
| 9 | `608-currentd106-full-security-sol.md` | Full security review (source review CLEAR) | GPT-6 Sol | `d106cf0a` | CLEAR | `f23e29950ef62bc73e9b116684baf2d4cd7aa4a783c08248f989832974e894b5` |
| 10 | `670-current-route-g8-ordinary-luna.md` | Ordinary delta review (d106cf0a..f5ef92fb) | GPT-6 Luna | `f5ef92fb` | CLEAR | `8711218df521b0ef620b2db1d6db2f8c3d1e314d4f8e1fed24b857d283f9e6c5` |
| 11 | `670-current-route-g8-security-sol.md` | Security delta review (d106cf0a..f5ef92fb) | GPT-6 Sol | `f5ef92fb` | CLEAR | `1331a95b43fd586cd2dc8dbc71909172cae427a50418f984642e21a4df28aa09` |
| 12 | `E12/670-real-users-journey-ordinary-luna.md` | Ordinary review of the real Users journey test (base f5ef92fb) | GPT-6 Luna | `9ee958bb` | BLOCKED (journey test not acceptable at this head) | `fc029cb7bcbf9841ffa596f0ad52dab9294bf2d655083b8512ef750685c8c0ff` |
| 13 | `E12/670-current-split-and-journey-ordinary-luna.md` | Ordinary delta review (9ee958bb..f3883a3c) | GPT-6 Luna | `f3883a3c` | CLEAR | `b421f101d89f4a04cfc1b44e92f7637becc659badff18ecfc353d60ed5ef808c` |
| 14 | `670-current-split-and-journey-security-sol.md` | Security delta review (9ee958bb..f3883a3c) | GPT-6 Sol | `f3883a3c` | CLEAR | `6d6866153a799c1f439d2104d27bf388829881062a5de6b74fa405473c66f47e` |
| 15 | `E12/670-auth-readiness-and-error-context-ordinary-luna.md` | Ordinary delta review (f3883a3c..643bb77e) | GPT-6 Luna | `643bb77e` | CLEAR | `14de938f1e98ad5cc6d4cc2cbd7b0ff44c84327569f69b6f6f0a2548a1da2f6d` |
| 16 | `670-auth-readiness-and-error-context-security-sol.md` | Security delta review (f3883a3c..643bb77e) | GPT-6 Sol | `643bb77e` | CLEAR | `e39ecdcd145d74c18cc7e8fc67787118303bccc7c271e53e692de0a1ce54b3f2` |
| 17 | `670-corrected-hook-and-privacy-probe-ordinary-luna.md` | Ordinary delta review (643bb77e..0469577d) | GPT-6 Luna | `0469577d` | CLEAR | `cc29b013bd82e2c2486531f0d11727f7d1fec80e396e4f64a67138eef384026a` |
| 18 | `670-corrected-hook-and-privacy-probe-security-sol.md` | Security delta review (643bb77e..0469577d) | GPT-6 Sol | `0469577d` | CLEAR | `f6ce21e7cb6fe624b9cd48081777b89e4d454bd13bd5eaef0ddca6bd2dabaaa0` |
| 19 | `670-directory-locator-delta-ordinary-luna.md` | Ordinary delta review (0469577d..7658fdbe) | GPT-6 Luna | `7658fdbe` | CLEAR | `1b9e86868da0999c605936f187007acdd1aa8801fc148a28ddaa3f86888aff9c` |
| 20 | `670-directory-locator-delta-security-sol.md` | Security delta review (0469577d..7658fdbe) | GPT-6 Sol | `7658fdbe` | CLEAR | `3bc1127f416cc627f7bd5b9df248ca784f61e98941d23751a962287a83bc7e21` |
| 21 | `670-feedback-oracle-delta-ordinary-luna.md` | Ordinary delta review (7658fdbe..a2677ffb) | GPT-6 Luna | `a2677ffb` | CLEAR | `1d1f598c639208f9f6339f15ae4049b06091bde90205a0b67a4cc9537013831b` |
| 22 | `670-feedback-oracle-delta-security-sol.md` | Security delta review (7658fdbe..a2677ffb) | GPT-6 Sol | `a2677ffb` | CLEAR | `93cfa7c27e808ed22260e3c4e622d243dbd5eb71234fddf13ec1986870e91289` |
| 23 | `E12/670-pending-proof-wire-ordinary-luna.md` | Ordinary delta review (a2677ffb..1c02fb1a) | GPT-6 Luna | `1c02fb1a` | CLEAR | `414962580ab8d7763d7708923dd376f6404f1bbee1004df07a75aa8d230430c5` |
| 24 | `670-pending-proof-wire-security-sol.md` | Security delta review (a2677ffb..1c02fb1a); last GPT-6 Sol clearance | GPT-6 Sol | `1c02fb1a` | CLEAR | `55af536249082dae093aa382ee313cae7d4decf7bf1141837e20fcaef65f52b3` |
| 25 | `670-809b-e2e-fix-ordinary-sonnet.md` | Ordinary delta review (1c02fb1a..809b593c) | Claude Sonnet 5.5 | `809b593c` | APPROVE | `6f711e3a28b236a93a57c7c62897d8affea4ae0799895d8da43f44cfe923c3bf` |
| 26 | `670-809b-e2e-fix-security-opus.md` | Security delta review (1c02fb1a..809b593c) | Claude Opus 5.5 | `809b593c` | CLEAR | `8ae2ae5bec10d2bed0a7e5e8067fbaae02db2d2a957ad9c15fdd25d876c9b2ed` |
| 27 | `670-8e47-list-refetch-ordinary-sonnet.md` | Ordinary delta review (809b593c..8e47e787) | Claude Sonnet 5.5 | `8e47e787` | APPROVE | `3ea2b8119efe1c23453d00aae71290e9e9e4d429cc0ea18a10ab907b75ab9da5` |
| 28 | `670-8e47-security-rebind-opus.md` | Security delta review and note rebind (809b593c..8e47e787) | Claude Opus 5.5 | `8e47e787` | CLEAR | `b20a4698ea8b0efaaa9ba6b9613c45e28f9845d1726d54e4e5c6bf454a15443d` |
| 29 | `670-80ba-5522-ordinary-sonnet.md` | Ordinary delta review (80ba782f..55227706) | Claude Sonnet 5.5 | `55227706` | APPROVE | `c0d688101472d2962f2a351c5b6e4453069ec5b0e86173e7c418f7e5d567e5ff` |
| 30 | `670-5522-security-rebind-opus.md` | Security delta review and rebind (80ba782f..55227706) | Claude Opus 5.5 | `55227706` | CLEAR | `f8b91619c6d627c5528e188e080db3348e667ba261df77e73ffe0c118536435c` |
| 31 | `670-5522-c5cc-ordinary-sonnet.md` | Ordinary delta review (55227706..c5ccfe58) | Claude Sonnet 5.5 | `c5ccfe58` | APPROVE | `13991dea0ae8e610db5eccdaeb43d2d5f0848f417410fd19b8f80e8cb15dfdc1` |
| 32 | `670-c5cc-security-rebind-opus.md` | Security delta review and rebind (55227706..c5ccfe58) | Claude Opus 5.5 | `c5ccfe58` | CLEAR | `430b362062683b238646317cc09dd0f5ba4c7e163392dc4c4f9cec1e52baaf99` |

Model bindings checked against session metadata (private JSON, metadata only): `608-current9bff-ordinary-ab-model-bindings.json`, `608-current9bff-ordinary-c-model-binding.json`, `608-full-sol-and606-runner-v2-model-bindings.json`, `670-current-route-g8-review-model-bindings.json` and `current606-panel-and643-users-review-model-bindings.json` record `gpt-6-luna` for the Luna reviewers and `gpt-6-sol` for the Sol reviewer sessions they cover. The Sol reports after `f5ef92fb` came from the same Sol reviewer session and declare the Sol tier; the binding file covers the turns that existed when it was written. The Claude Sonnet 5.5 and Claude Opus 5.5 reports declare their own model in their first line.

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/608-current9bff-ordinary-a-luna.md; GPT-6 Luna; sha256 f238bdace54556880ba21823c4181d4823c13f1fba77fc88ee67d75af66428a6) -->
# Independent ordinary review A — #608 selective Users and pending-action UI

- **Reviewed head:** `9bff711d84929a1d7bbb6135e64bf5af8f5c20d6`
- **Comparison base:** `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`
- **Original source:** `8f1713934cb91fb7048930ae9b776b29cb67089b`
- **Independence:** Fresh reviewer context; did not author, direct, or remediate the candidate. Read-only review; no source, report, PR, or queue edits.
- **Reviewer/model:** Independent GPT-6 Luna-tier ordinary review assignment. The platform does not expose the serving variant/version in this context, so the report does not claim a more specific model identity.
- **Scope:** Changed Users directory, pending-action list/detail, fetchers/query hook, route state/generated route artifacts, locale catalogs/schema, and browser spec; compared UI behavior against accepted API contracts and the current Users/God Mode, PA-15, pending-actions, and owner-decision rules.

## What I checked

- Verified `HEAD` is the assigned SHA and the worktree has no local changes. `git diff --check 4088e8ab..HEAD` passed. The source-map receipt maps the selected UI/fetcher/query/route/test and 19 locale source blobs to the original #608 source; the changed paths are confined to the selected UI surface and locale additions.
- Independently inspected exact source for suspension proof binding and request construction, deactivation request handling, pending-action allowlist/confirmation checks, stale/terminal UI, requester list/cancel behavior, directory filter/cursor/selection URL state, and cache updates.
- Compared UI proof and confirmation behavior with accepted `apps/api/src/instance/users/index.ts`, `apps/api/src/auth/step-up-api.ts`, `apps/api/src/pending-action/service.ts`, and `apps/api/src/pending-action/approval-contract.ts`. Server requires God Mode for user detail/directory, returns the allowlisted user DTO, and owns self/last-usable-admin suspension/deactivation refusals.
- Read the retained focused test receipt for `pnpm --filter @taskdesk/web exec vitest run src/lib/routes.test.ts`: exact source `9bff711d...`, exit 0, 1 file / 15 tests passed. This is the candidate-provided retained evidence; I did not rerun it.
- No browser/E2E, API integration, image/runtime, full suite, hosted CI, or screenshot evidence was run or inspected for this review. Those acceptance gates remain pending.

## Findings

### Non-blocking — cached current user email can briefly remain actionable during refresh

In `apps/web/src/routes/agent/_layout/_authenticated/agent/settings/profile/pending-actions/$id.tsx`, the detail query fetches the current user DTO with default zero stale time, but `canApprove` checks only `email !== null`; it does not require the current-target query to have completed its fresh fetch or be free of a refresh. If an existing cached detail is present, the UI can briefly display that old email and enable the exact-email/PA-15 form while the fresh request is in flight. The server remains authoritative and rejects an outdated typed email, so this does not provide an approval bypass, but the visible “current email” can be stale and the user may get a needless 400. Gate the form on successful non-fetching current-target data (or clear/disable cached data while refetching) if tightening this behavior.

## Checks against requested risks

- **Admin suspension:** one request object is built once and reused in operation challenge, proof, and mutation. Reason is trimmed, expiry is serialized to ISO, and the server trims/validates the strict body. Self and last usable admin errors are server-owned; there is no optimistic user/account write in the UI. PASS by inspection.
- **User deactivation:** the pending-action detail path accepts only `action=delete`, `targetType=user`, `confirmation=typed_name_step_up`, `approvalSupported`, and pending state; it obtains the current allowlisted user DTO and binds PA-15 proof to the pending action ID. Confirmation compares exact email text. The stale-cache UX edge above is non-blocking because the server revalidates. PASS with noted UX edge.
- **Calendar/saved-view click approvals:** only `delete` plus the supported target type and `confirmation=click` can take the click path; the mutation sends `{}` and the destructive label is `common:actions.delete`. Unsupported and terminal actions stay view-only. PASS by inspection.
- **Expiry/revocation/stale email:** terminal state and invalidation reason are rendered; expired or changed server state is caught as 409 and shown as stale approval; exact-email mismatch is surfaced as a confirmation error. The server lifecycle rules remain authoritative. PASS by inspection; runtime behavior not browser-verified.
- **Requester list/cancel/session expiry:** list and cursor are URL-backed, cancellation uses the requester-owned cancel route, and network/auth failures render errors without local success state. PASS by inspection; session-expiry browser scenario not run.
- **Directory state/access/allowlist:** filter, cursor, and selected-user values are route search state; cursor is reset on filter changes; directory/detail data use API allowlisted DTOs and God Mode server checks. PASS by inspection. Route round-trip receipt is 15/15.

## Verdict

**CLEAR WITH ONE NON-BLOCKING FINDING** for this ordinary review at exact head `9bff711d84929a1d7bbb6135e64bf5af8f5c20d6` against `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`.

No blocking code defect found in the inspected high-risk flows. This verdict is only one member of the required three-review ordinary panel for this cross-package UI/API integration context. It is not a security review or acceptance of pending browser, integration, image, runtime, or hosted CI gates.
<!-- END REPORT (sha256 f238bdace54556880ba21823c4181d4823c13f1fba77fc88ee67d75af66428a6) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/608-current9bff-ordinary-b-luna.md; GPT-6 Luna; sha256 c8c6fac44cd30a04713e6b7fa1a04a9ecd38ee3d5b628d67797130187238b6fa) -->
# Independent ordinary review B — #608 selected Users/pending-actions UI

**Model:** GPT-6 (platform did not expose a more specific model/version label in this reviewer context; assigned ordinary Luna-tier role)
**Role:** Independent ordinary reviewer B
**Candidate:** `9bff711d84929a1d7bbb6135e64bf5af8f5c20d6`
**Comparison base:** `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`
**Independence:** Fresh reviewer context; did not author, direct, or remediate this candidate.
**Scope:** Exact composed diff of 31 paths, with emphasis on God Mode user transport/UI, pending-action approval transport/UI, PA-15 proof binding, query invalidation, URL state, generated route artifacts and source composition. Read-only.

## What I checked

- Confirmed checkout HEAD is the exact candidate SHA and the candidate diff against the exact base is 31 paths. Reviewed the source map and composition manifest as provenance aids, then inspected the actual diff and current source.
- Read accepted `AGENTS.md`-provided workflow, active mission, status snapshot, `docs/03-features/god-mode.md`, `docs/01-architecture/pending-actions.md`, and the relevant decision-log references. Checked accepted API implementation/schema paths for the PA-15 operation and pending-action DTO contracts.
- Inspected the user fetchers, query hooks, Users route, pending-action list/detail routes, E2E assertions, route parser/builders, and focused tests as source. Checked `git diff --check` (exit 0).
- No tests, browser journey, API integration, build, image, or runtime were run in this review context. Existing focused test/typecheck results cited by the source map are not represented here as independently reproduced evidence.

## Findings

No blocking or non-blocking code findings from this source review.

The admin-suspension path builds one normalized request object and supplies it to both the `instance_admin_suspend` challenge/proof binding and the suspend mutation. It derives whether proof is needed from the current allowlisted `isInstanceAdmin` DTO field; server-side role, self-target and last-admin checks remain authoritative. Grant-admin and MFA-reset challenges use the registered operation discriminants and carry the target and required verification note. The UI disables protected submission when required factor status is missing, errored, or policy-required but not enabled; failed proof clears the entered secret and surfaces an error.

For person deactivation approval, the detail route fetches the current allowlisted target DTO and uses its current email for exact typed confirmation. It requests a pending-action-bound PA-15 proof and posts the same action id, email and proof. A missing/failed target lookup prevents approval; a missing/failed factor lookup disables approval. Approval controls require `approvalSupported`, pending state, and an exact supported action/target/confirmation tuple. The click-only branch is limited to delete of `service_calendar` or `saved_view` with `confirmation === "click"`, and sends no step-up proof. Unsupported/terminal items remain read-only apart from the existing cancellation path.

The UI consumes `isInstanceAdmin` and the narrow user DTO rather than legacy/raw role values. Directory filters, cursor and selected user are represented in the URL; filter edits clear the cursor. Successful user mutations invalidate directory and selected-user queries. Pending-action approval/cancellation invalidates the related list/detail queries, and successful deactivation refreshes user queries. Error and loading states are visible and mutation/proof failures do not report success.

The 31-path composition preserves the user-owned UI/fetcher/test/locale units and accepted-base record paths listed in the manifest. I found no API, schema, migration, dependency or permission-registry change in the candidate diff. The route registration and generated artifacts are consistent with the implemented routes by inspection.

## Verdict

**PASS — ordinary review B, exact candidate `9bff711d84929a1d7bbb6135e64bf5af8f5c20d6` vs `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`.** No source-level blocker found in the reviewed scope.

## Residuals / not verified

This is a source review, not runtime acceptance. Browser interaction/evidence, focused route and E2E execution, full applicable CI, image/runtime acceptance and applicable independent Sol review remain separate gates. The E2E file contains mock API coverage and captured request assertions; those assertions do not establish actual backend behavior or browser acceptance until executed against the required environment. Locale additions were checked for structural presence only, not translation quality.
<!-- END REPORT (sha256 c8c6fac44cd30a04713e6b7fa1a04a9ecd38ee3d5b628d67797130187238b6fa) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/608-current9bff-ordinary-c-luna.md; GPT-6 Luna; sha256 ac52d78d91ef604c75c4295e9e2ff34a3c05886d03b79b44cf1ef1282aaa934d) -->
# Independent ordinary review C — #608 selected Users and pending-action UI

- **Reviewed head:** `9bff711d84929a1d7bbb6135e64bf5af8f5c20d6`
- **Comparison base:** `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`
- **Independence:** Fresh reviewer context; did not author, direct, or remediate the candidate. Read-only review; no source edits.
- **Reviewer/model:** GPT-6 Luna-tier ordinary review assignment. The platform did not expose a more specific serving variant/version; this report does not claim one.
- **Scope:** Entire 31-path selective integration diff, with detailed review of Users selection/actions, pending-action approval, URL contracts, PA-15 use, generated routing, locale additions, and E2E assertions.

## What I checked

- Confirmed checkout `HEAD` equals the assigned candidate. Inspected the full changed-path list and `git diff --check` (pass).
- Read repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, active mission, UX quality gates (especially G5), God Mode Users feature contract, auth-and-identity selected implementation contract, pending-actions PA-15, and relevant 2026-10-10/11 decisions. Checked the supplied source-map and composition-manifest receipts as provenance aids, then reviewed actual candidate source.
- Inspected the Users route and its E2E coverage, pending-action detail/list components and fetchers, route parser/builders and generated metadata/tree, user query hooks/fetchers, plus locale/schema changes. Reviewed exact source for confirmation allowlists, step-up bindings, errors, stale/terminal action handling, and URL-backed filters/cursor/selection.
- No tests, browser journey, build, API integration, image/runtime, full suite, or hosted checks were run in this reviewer context. Those remain outside this source review.

## Findings

### Blocking — the Users action dialog is not URL state, and selection changes retarget it

`apps/web/src/routes/agent/_layout/_authenticated/god-mode/users.tsx` keeps the open action in local `useState` (`action`) while the selected user is `search.user` in the URL. The action dialog is rendered against the *current* `selected.data`; changing the selected-user link updates the URL but does not close/reset the action. Consequently an open “Deactivate”, “Grant admin”, “Reset MFA”, or other action dialog can silently change its displayed target when a different user is selected. The reason, expiry, verification note, selected proof method and entered secret also persist. Submitting then invokes `runAction(selected.data)`, so the still-open dialog performs against the newly selected user using the carried-over form state. PA-15 remains target-bound and server authorization remains in force, so this is not a proof-binding bypass; it is a concrete high-impact mis-targeting hazard in administrator operations.

This also violates the applicable G5 contract: the canonical URL carries the selected user, but omits the open action panel/dialog. The G5 text says filters, tabs, selections, and open panels are URL state; I found no explicit exception in the reviewed UX contract or feature decisions for this action dialog. Sensitive form values should stay out of the URL, while the open action identity can be represented there and selection changes should close/reset the action and its sensitive state. The E2E spec exercises user selection and action submissions separately, but has no selection-change-while-dialog-open assertion.

**Reproduction by source trace:** select user A; open an action and enter any form value/step-up secret; select user B while the dialog remains open; the dialog's header now renders B, existing form values remain, and the submit callback passes B to `runAction`.

### No other blocker found

The deactivation pending-action path requires a supported typed-name-step-up tuple and sends the exact email with action-bound proof; calendar/saved-view click approvals send `{}` and no proof; unsupported or terminal actions do not get approval controls. The grant/suspend operation proof paths use the registered operation bindings. These conclusions are source inspection only, not runtime evidence.

## Verdict

**BLOCKED — one blocking finding** for ordinary review C at exact head `9bff711d84929a1d7bbb6135e64bf5af8f5c20d6` vs `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`. The mis-targeting behavior and omitted URL state should be corrected and covered by a focused regression before this UI integration is clear.

Residual limits: browser behavior, PA-15 server execution, focused tests, integration, build/image/runtime acceptance and hosted CI were not independently verified here. Locale catalog structure was inspected, but translation quality was not assessed. This is one ordinary review and not a security review or runtime acceptance.
<!-- END REPORT (sha256 ac52d78d91ef604c75c4295e9e2ff34a3c05886d03b79b44cf1ef1282aaa934d) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/608-currentd2de-blocker-disposition-luna.md; GPT-6 Luna; sha256 8becf98c2eb821631891a4d9cf0409a8a5ff5a4609f5556a75900092ec7cd08a) -->
# Independent disposition — #608 action-target blocker on follow-up

- **Reviewed head:** `d2de7ce0d6eecae487944bebff21391da65b04e2`
- **Comparison base:** `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`
- **Disposition delta:** `9bff711d84929a1d7bbb6135e64bf5af8f5c20d6..d2de7ce0d6eecae487944bebff21391da65b04e2` (four paths)
- **Independence:** Fresh, read-only disposition context; did not author, direct, or remediate the follow-up. Prior report `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/608-current9bff-ordinary-c-luna.md` was left unchanged.
- **Reviewer/model:** GPT-6 Luna-tier ordinary-review disposition. Serving variant/version was not exposed; no more specific model label is claimed.

## Scope and checks

Read the exact changed source and tests for `users.tsx`, `users.test.tsx`, `routes.ts` and `routes.test.ts`; checked the supplied source-conservation manifest and focused verification logs; ran `git diff --check` on the candidate diff (pass). The worktree is clean at the assigned SHA.

The focused logs report: at 9bff, the real route-component test failed because clicking the action left `mocks.search.action` undefined; at d2de, the route and component test files passed 18/18, Biome checked four files successfully, web typecheck exited 0, and `git diff --check` exited 0. I inspected the actual log contents and hashes. These are retained author-run checks, not runs by this reviewer. The manifest records the accepted-base composition as 31 source paths plus three accepted records and the follow-up adds only the two product files and two tests. I did not independently recompute every original-source blob receipt. No browser, E2E, build, API integration, DB, image, Docker, or hosted checks were run.

## Disposition of original finding

**The original stable-selection blocker is closed.** The open action is now read from the allowlisted `action` URL parameter, parsed only when a user is selected. Selecting a different user strips the action. The changed-intent effect clears reason, expiry, verification note, secret and error state. The test exercises a pending proof, changes the URL target, confirms the dialog and secret disappear, reopens an action for the new target with an empty secret, then resolves the old proof and asserts no mutation. Route tests cover action round-trip, unknown action rejection, action-without-target rejection, and exclusion of secret/reason parameters. The negative-control receipt demonstrates the new route assertion failed against the old behavior; it is a useful regression signal, but not independent runtime acceptance.

Sensitive values stay local and are not added to route search. The method selector itself is **not** reset by the intent-change effect; it persists as an authentication-method preference. This does not carry a credential or proof across targets and is non-blocking. The author’s broader claim that “method reset” occurs on context changes is not supported by the current source.

## Remaining blocking finding — action-intent equality permits an ABA stale-proof mutation

The post-proof guard uses the string binding `${userId}:${action}`. It rejects a proof result when navigation leaves that binding, but accepts it if navigation leaves and then returns to the same binding before the asynchronous proof resolves.

Reproduction by source trace: open `grant-admin` for user A and submit so `createUserOperationProof` is pending; navigate to user B (the action is stripped); then use browser Back to restore A with `action=grant-admin` before the proof promise resolves. `intentRef.current` again equals the captured `userA:grant-admin` binding, so the guard at line 189 passes and submits the old proof/mutation even though the new action context cleared the form. The same pattern applies to admin suspend and MFA reset. The current test covers leaving the action context and staying away until proof resolution; it does not cover returning to the identical binding.

This preserves PA-15 target binding, so it is not a cross-target authorization bypass. It can nevertheless execute a previously submitted high-impact admin operation after its dialog was closed by navigation, contradicting the follow-up’s cancellation guard. The action context needs an identity that changes on every departure/intent transition (for example, a monotonically increasing generation captured by the async call), and the regression should navigate away and back before resolving the proof.

## Verdict

**Original finding: CLOSED. Overall disposition: BLOCKED by the remaining ABA stale-proof issue above.** Exact source is `d2de7ce0d6eecae487944bebff21391da65b04e2` against base `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`.

Limits: focused checks cited above are retained author evidence; I did not rerun them. The UI has not been browser-verified here, and no runtime, integration, image, or hosted acceptance is claimed.
<!-- END REPORT (sha256 8becf98c2eb821631891a4d9cf0409a8a5ff5a4609f5556a75900092ec7cd08a) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/608-currentd7e-blocker-disposition-luna.md; GPT-6 Luna; sha256 211758db0bb1f4eb5bf38477cddb0d1ca768046c0d72dfa26fb03c33789eb47f) -->
# Independent disposition — #608 action-context ABA blocker

- **Reviewed head:** `d7e3dd7c4b2e400a5dcf2443430e10150767b94f`
- **Comparison base:** `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`
- **Disposition delta:** `d2de7ce0d6eecae487944bebff21391da65b04e2..d7e3dd7c4b2e400a5dcf2443430e10150767b94f` (two paths: Users route and its component test)
- **Independence:** Fresh, read-only disposition context; did not author, direct, or remediate this candidate. Earlier reports at `608-current9bff-ordinary-c-luna.md` and `608-currentd2de-blocker-disposition-luna.md` remain unchanged.
- **Reviewer/model:** GPT-6 Luna-tier ordinary-review disposition. The serving variant/version was not exposed; no more specific model label is claimed.

## Scope and evidence

Inspected the full two-path delta and actual component test lifecycle, generation changes on URL action/target changes, unmount cleanup, and delayed proof success/error paths. Confirmed `HEAD` is the assigned SHA and the worktree is clean. `git diff --check` against the frozen base passed. The delta changes no fetcher, contract, generated route, locale, or other source-conservation path.

The supplied author-run receipts were inspected, not rerun here. The d2de negative-control log runs the actual route component test with the Back-to-same-action scenario and fails because the old proof calls `grantAdmin` once. The d7e3 focused receipt reports 2 files / 21 tests passed, Biome on four files passed, web typecheck passed, and `git diff --check` passed. These focused results are retained evidence, not browser or runtime acceptance. No browser/E2E, full suite, build, integration, DB, image, Docker, or hosted checks were run in this review context.

## Disposition

**The ABA finding is closed.** Each committed action-intent transition increments `actionGenerationRef` in a layout effect; route unmount also increments it in layout-effect cleanup. `runAction` captures that generation and checks it after the asynchronous PA-15 proof and before the protected mutation. It also checks after mutation and invalidation before writing success state, and checks in the catch path before writing an error. This closes the prior string-binding ABA: leaving A/grant-admin and returning to the same URL produces a new generation even though the user/action string matches. A late proof cannot trigger a mutation; a late success/error cannot overwrite the reopened action’s state. Unmount cleanup invalidates an outstanding proof as well.

The component tests now exercise: the d2de ABA scenario with delayed proof success; cancel and reopen of the same action followed by delayed proof rejection, verifying no stale alert; and route unmount followed by delayed proof success, verifying no mutation. The author’s negative control fails on the old implementation at the assertion that the mutation must not run, and the changed candidate’s focused test receipt passes. These are meaningful regression checks for the prior defect class.

The step-up method selector persists when action intent changes. The source does not reset it, and that persistence remains a non-blocking preference behavior; no claim that it resets is made here. Sensitive values and action-specific text are cleared on intent transition.

## Verdict

**CLEAR — prior ABA blocker closed** at exact head `d7e3dd7c4b2e400a5dcf2443430e10150767b94f` against `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`. No new blocking finding in this bounded disposition.

Residual limits: focused tests, lint, typecheck and diff results above are author-run retained evidence, not rerun by this reviewer. This does not establish browser interaction, E2E, integration, image/runtime acceptance, or hosted CI. Full ordinary-panel clearance and separate Sol review remain independent gates.
<!-- END REPORT (sha256 211758db0bb1f4eb5bf38477cddb0d1ca768046c0d72dfa26fb03c33789eb47f) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/608-currentd7e-full-security-sol.md; GPT-6 Sol; sha256 642f6d461b8643de27449bb9bc49d6207574102f0919a04cfcb2f1f7f1e88b35) -->
# #608 current selected source — independent full security review

- **Reviewed head:** `d7e3dd7c4b2e400a5dcf2443430e10150767b94f`
- **Comparison base:** `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`
- **Role/model:** Fresh independent full security reviewer, GPT-6 Sol tier. The serving variant/version was not exposed to this reviewer, so no narrower model identity is asserted.
- **Independence:** This context did not author, direct, or remediate the candidate and made no source edits. The earlier ordinary review reports and author validation are evidence, not this verdict.

## Scope and checks

I confirmed the clean worktree at the exact 40-character head and reviewed its 32-path diff against the stated accepted base. I inspected the changed Users and pending-action screens, fetchers, query hook, route search contract, route tests, and E2E spec; checked representative locale/schema changes and the generated-route paths; and compared the client flows to the accepted God Mode Users, PA-9/PA-15, step-up, instance-users and pending-action backend contracts. The diff introduces no backend route, policy, schema, migration, dependency, or secret storage. `git diff --check 4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2..HEAD` passed in this review context.

I inspected the retained source-conservation map, ordinary review dispositions, negative-control and focused-test receipts, and root validation receipt. The latter reports green lint, typecheck, `pnpm test`, API build, and web build at d7e3dd7; those are author/root-run checks, not commands rerun by this reviewer. No browser journey, database integration, image boot/health, Docker, full E2E, or hosted CI was run in this context. The E2E spec mocks the API and cannot establish a live lifecycle workflow.

The Users screen builds admin suspend proof and mutation from the same canonical request object; grant-admin and MFA-reset proofs bind their target and operation. The generation guard invalidates delayed proof results after target/action changes, A→B→A return, and unmount, consistent with the focused negative control and 21 passing focused tests. The client does not grant authority from UI data: the accepted backend locks the target, rechecks actor/session/admin status, applies last-admin/self protections, and consumes bound proof. Deactivation requests use the server-owned pending-action route. The detail screen obtains the current target email, compares exact typed text, and sends a pending-action-bound PA-15 token. Click-confirmed calendar and saved-view actions send an empty approval body; unsupported/terminal contracts are view-only. URL search holds filter/selection/action identifiers, while password, one-time code, suspension reason, note, and token stay out of URL state. Generic client errors avoid displaying response bodies. These checks do not cure the finding below.

## Blocking finding — pending-action approval survives departure from its intent

At `apps/web/src/routes/agent/_layout/_authenticated/agent/settings/profile/pending-actions/$id.tsx:151-166`, `approveAction` captures `id`, `typedName`, and `secret`, awaits `createPendingActionProof`, then calls `approve.mutateAsync({ id, typedName, stepUpToken })` without checking that the detail route is still mounted or that its action intent is still current. The same screen keeps its form values in component state across `$id` transitions. A concrete sequence is: open pending deactivation A, enter A's current email and authentication secret, click approval, then navigate to another pending action or away from the detail route while the challenge/proof request is delayed. When proof resolves, the old continuation approves A even though the operator left its approval context. Returning A→B→A before resolution has the same result. This is the same stale-intent/ABA class that the d7e Users dialog specifically fixed, now on the higher-impact final deletion approval step.

The server's PA-15 binding, current email check, current policy recheck, and single-use token protect against cross-target substitution and unauthorized execution; the finding is an operator-intent failure, not a claimed server authorization bypass. It still permits person deactivation after the user abandoned the approval screen. The completion may also write A's notice/error state into a later `$id` view. Add a route/action generation or equivalent lifecycle guard before the approval mutation, clear sensitive form state on ID change, and exercise delayed proof success/rejection through navigation away and A→B→A in a component regression. A new candidate head needs fresh exact-head disposition and security review.

## Non-blocking observations and residuals

- The pending-action detail currently obtains the target email through the God Mode detail API. A changed email between display and approval is server-revalidated and fails closed; the display can be stale until refetch.
- The selected source adds 159 message leaves to each of 19 locale catalogs. This review sampled structure and representative values, not every translation.
- Source inspection and retained automated receipts do not establish actual browser, database, image/health, or hosted-check acceptance. Those gates remain mandatory after source clearance.

## Verdict

**BLOCKED** at exact head `d7e3dd7c4b2e400a5dcf2443430e10150767b94f`. One high-impact stale-approval finding remains. Do not merge this candidate on this review. No review gate is waived.
<!-- END REPORT (sha256 642f6d461b8643de27449bb9bc49d6207574102f0919a04cfcb2f1f7f1e88b35) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/608-currentd106-structural-ordinary-b-luna.md; GPT-6 Luna; sha256 fdff6678fa2a1a1c9bd78692cf17756c7c2da8aa4d1ca3b1321150a3590c7e9d) -->
# Independent ordinary review B — #608 intent-lifecycle structural delta

**Model:** GPT-6 Luna-tier ordinary-review assignment; serving variant/version was not exposed in this reviewer context.
**Role:** Fresh independent ordinary reviewer B for the structural helper and consumer integration.
**Candidate:** `d106cf0a6bb1d06005578abfe1b858df37a98d4d`
**Comparison base:** `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`
**Delta reviewed:** `d7e3dd7c4b2e400a5dcf2443430e10150767b94f..d106cf0a6bb1d06005578abfe1b858df37a98d4d`
**Independence:** Fresh read-only reviewer context; did not author, direct, or remediate this structural delta. The earlier full review of `9bff` is unchanged.

## Scope and checks

Inspected the complete four-path delta: new `use-intent-lifecycle.ts`, both production consumers (God Mode Users and pending-action detail), and the pending-action detail component test. Checked the actual candidate HEAD, clean worktree, changed-path set, and `git diff --check` against both the delta parent and frozen base (pass).

Reviewed generation changes on committed intent transitions and unmount; reset callback freshness; proof success/failure continuations; mutation submission boundaries; delayed cache invalidation/UI writes; current-email and PA-15 fields; and click-only approval request behavior. Inspected supplied focused verification and negative-control logs as evidence, but did not rerun them. The logs bind the final focused checks to the committed `d106` files and report 3 test files / 27 tests, web typecheck pass, Biome pass on four changed files, and diff-check pass. The negative control records the prior component test failing because the approval mutation ran after A→B→A while proof was outstanding. These are source-owner results, not independently executed checks.

No browser/E2E, full suite, build, API integration, database, image, Docker, or hosted checks were run in this reviewer context.

## Findings

No blocking or non-blocking source defect found in this bounded structural delta.

The shared hook advances its generation in a layout effect when the committed intent changes, resets the consumer's current form/error/notice state, and invalidates the generation on unmount. Its reset ref avoids retaining an older callback. The consumers capture one generation for each operation and test it after every asynchronous boundary that could otherwise submit or publish stale client state.

In Users, the generation is checked after operation-bound proof creation before the protected mutation; after direct mutations before success UI; and after query invalidation before resetting the form. In pending-action detail, it is checked after PA-15 proof creation before approval submission and before publishing either success or error state. Cancellation submits immediately from the explicit user click, then checks the captured intent before showing its result. Navigation does not claim to cancel a mutation already sent to the server.

The added component tests exercise pending-detail A→B→A while proof is pending, stale proof rejection after fresh values are entered, completion of an already-submitted approval after route return, delayed cancellation after changing action id, unmount during proof creation, and the click-confirmation request path. The test change exports the route component for direct mounting; no production API or security contract is added by that export.

The existing pending-action contract remains intact: deactivation binds proof to the pending action id and posts exact typed email with that proof; the supported calendar/saved-view click confirmation submits only its existing id input and skips step-up. The lifecycle generation prevents a proof minted for an abandoned routed intent from causing a later approval submission, without introducing a client-side cancellation claim for pending actions.

## Verdict

**PASS — bounded structural ordinary review B** at exact head `d106cf0a6bb1d06005578abfe1b858df37a98d4d` against `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`. No blocker found in the new helper, its two consumers, or the focused regression-test source.

## Residuals

Retained test/typecheck/Biome results were not rerun here. This verdict is limited to the four-path structural delta; the prior `9bff` source verdict remains separate. Browser/runtime acceptance, exact-head hosted checks, remaining ordinary review-panel coverage, and the required fresh independent Sol review remain separate gates.
<!-- END REPORT (sha256 fdff6678fa2a1a1c9bd78692cf17756c7c2da8aa4d1ca3b1321150a3590c7e9d) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/608-currentd106-structural-ordinary-c-luna.md; GPT-6 Luna; sha256 5089ea8f6616f8a19b071dbf0518c07e18b5f4f631a9cd1768591ea2eb9e4394) -->
# Independent structural ordinary review — #608 intent lifecycle

- **Reviewed head:** `d106cf0a6bb1d06005578abfe1b858df37a98d4d`
- **Comparison base:** `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`
- **Reviewed delta:** `d7e3dd7c4b2e400a5dcf2443430e10150767b94f..d106cf0a6bb1d06005578abfe1b858df37a98d4d` (shared hook, Users route consumer, pending-action detail consumer, pending-action detail component test)
- **Independence:** Fresh read-only ordinary review context; did not author, direct, or remediate the structural candidate. Prior review/disposition reports were not changed.
- **Reviewer/model:** GPT-6 Luna-tier ordinary-review assignment. The serving variant/version was not exposed; no more specific model label is claimed.

## Scope and checks

Inspected the complete structural delta, including `use-intent-lifecycle.ts`, both production consumers and the pending-action component tests. Reviewed intent transitions, unmount cleanup, delayed proof success/error, post-mutation cache invalidation and UI writes, typed-email confirmation, PA-15 payload construction, and the allowlisted click-confirmation branch. Confirmed exact candidate `HEAD`, clean worktree, exact changed-path set, and `git diff --check` against the frozen base (pass).

The two supplied logs were inspected but not rerun. The negative-control record binds the test-only export to the d7e3 source, says behavior was unchanged, and records the actual component test failing because the pending approval mutation was called after A→B→A while proof was pending. The final d106 focused log binds source hashes to committed HEAD and reports route tests at 3 files / 27 tests, web typecheck pass, Biome pass on four changed source/test files, and `git diff --check` pass. The log also preserves an earlier Biome failure during the pre-commit repair run and a later clean rerun; it does not conceal that first result. These are author-run retained checks, not independent execution. No browser/E2E, full suite, build, API integration, database, image, Docker or hosted checks were run here.

## Findings

No blocking or non-blocking source defect found in this bounded structural delta.

The shared `useIntentLifecycle` hook owns a generation ref, advances it on each committed intent change before resetting consumer form/error/notice state, and advances it on unmount. Each async operation captures the current generation. In Users, the operation checks the generation after PA-15 proof creation before issuing its mutation; it also checks before publishing errors/success and after invalidation before resetting the active form. In pending-action detail, approval similarly checks after PA-15 proof creation before `approveOwnPendingAction`, and guards delayed success/error UI writes. Cancellation is a direct user-submitted request with no proof await; its completion/error UI is guarded by the same captured generation. A request already submitted to the server is not canceled by later navigation; the UI does not claim or implement a backend cancel-on-navigation path.

The new real-component tests exercise pending-detail A→B→A while proof is outstanding, stale proof rejection after a fresh form is entered, completion of an already-submitted approval after returning to the route, cancellation completion after changing action id, unmount during proof creation, and the empty-body click-confirmation path. The negative control and final focused receipt are consistent with the actual assertions and source changes inspected.

PA-15 binding remains action-id bound for pending approval; typed current email and token are submitted together. The existing allowed `delete`/`user`/`typed_name_step_up` branch remains distinct from the `service_calendar`/`saved_view`/`click` branch, which sends only `{ id }` to the existing fetcher and does not request proof. No change to API/security contracts was introduced by this four-path delta.

The step-up method preference persists on intent changes. This is explicitly treated as deferred non-blocking UI behavior, not reported as a reset. Sensitive typed email, proof secret, error and notice state are reset for a changed pending-action id; Users resets its action-specific form values on context changes.

## Verdict

**CLEAR — bounded structural ordinary review** at exact head `d106cf0a6bb1d06005578abfe1b858df37a98d4d` against `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`. The shared generation invariant closes the stale-intent class found in both Users and pending-action detail. No new blocker was found in the reviewed delta.

Residual limits: focused results are retained author evidence, not reviewer-run checks. This verdict is not browser/runtime acceptance, full ordinary-panel clearance, or the required fresh independent GPT-6 Sol review. Browser workflows, image/runtime acceptance and current hosted checks remain separate gates.
<!-- END REPORT (sha256 5089ea8f6616f8a19b071dbf0518c07e18b5f4f631a9cd1768591ea2eb9e4394) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/608-currentd106-full-security-sol.md; GPT-6 Sol; sha256 f23e29950ef62bc73e9b116684baf2d4cd7aa4a783c08248f989832974e894b5) -->
# #608 current selected source — independent full security review after lifecycle repair

- **Reviewed head:** `d106cf0a6bb1d06005578abfe1b858df37a98d4d`
- **Comparison base:** `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`
- **Repair delta:** `d7e3dd7c4b2e400a5dcf2443430e10150767b94f..d106cf0a6bb1d06005578abfe1b858df37a98d4d`
- **Role/model:** Fresh independent full security reviewer, GPT-6 Sol tier. The serving variant/version was not exposed to this reviewer, so no narrower model identity is asserted.
- **Independence:** This context did not author, direct, or remediate the candidate. It made no source edits, did not merge, and did not change the earlier d7e3 blocked report.

## Scope and actual checks

I confirmed the clean worktree at the exact 40-character head. The full diff against the accepted base has 34 paths; the repair delta has exactly four paths: a new shared intent-lifecycle hook, the God Mode Users consumer, the pending-action detail consumer, and a new detail component test. The other 30 selected paths are unchanged from d7e3. I reviewed the complete repair delta and revisited the full selected source and accepted backend contracts covered in the prior full security review: Users directory/detail/actions, pending-action list/detail/fetchers, route state, PA-9/PA-15 confirmation, accepted instance-users step-up and deactivation routes, and approved click-confirmation contracts. `git diff --check` against the accepted base passed in this review context.

I inspected the two fresh independent ordinary delta reports, the actual negative-control log, the final focused verification log, and the current root validation receipt. The negative control ran the new component assertion against the old d7e3 detail behavior and failed because the approval mutation was called after A→B→A during a delayed proof. The final focused receipt binds the four changed file hashes to committed d106 and reports 3 test files / 27 passing tests, web typecheck pass, Biome pass on the four paths, and diff check pass. I independently compared its four SHA-256 file hashes to the checked-out d106 files; all matched. The current root receipt reports successful lint, typecheck, `pnpm test`, API build, and web build on d106. These focused/root commands were run by the source owner or conductor, not independently rerun by this reviewer. I ran no browser, E2E, database integration, image boot/health, Docker, or hosted CI check.

## Disposition of the d7e3 blocker

**Closed.** The shared `useIntentLifecycle` hook increments a generation in a layout effect for each committed routed-intent change and on unmount. It resets pending-action typed email, authentication secret, error and notice on action-ID change. Both consumers capture the generation at the user action and reject a delayed proof continuation if the generation changed. In pending-action detail, the check at `pending-actions/$id.tsx:152` occurs *before* `approve.mutateAsync`, so a proof minted for an abandoned A cannot submit an approval after navigation to B, return to A, or unmount. A late proof rejection is also suppressed. The Users consumer retains the same pre-mutation protection for operation-bound admin suspend, grant and MFA reset.

Once an approval or cancellation request has already been sent, navigation does not undo that server request. This is an appropriate submission boundary: later completion still invalidates the relevant action caches, but its success/error does not overwrite a different routed detail context. The test covers delayed approval completion and delayed cancellation after navigation. The component's A→B→A, stale proof rejection, unmount, and click-confirmation tests, together with the old-source negative control, substantiate the repaired defect class; they remain offline mocked tests, not live workflow evidence.

## Security contract assessment

The repair changes no backend, policy, schema, migration, dependency, request DTO, or step-up binding. Admin suspend still uses one canonical request for proof and mutation; grant and MFA reset remain operation/target bound. The accepted server rechecks actor, active agent session, target state, self/last-admin constraints and consumes a single-use PA-15 proof. User deactivation still creates a server-owned `delete`/`user` pending action. Its detail view requires the current target email, exact typed confirmation and action-bound PA-15 proof, while the accepted execution route revalidates the current email, requester authority, target identity and state. Calendar and saved-view click approvals retain the existing empty-body request and do not acquire elevated proof. Unsupported and terminal actions remain view-only. URL state contains action identifiers and filters, not authentication secrets, typed confirmation, proof tokens, suspension reason, or MFA note. Generic errors do not surface response bodies. I found no cross-person or cross-tenant elevation path in the selected UI source.

## Findings and residual limits

No blocking or new non-blocking source finding at d106. The previous observation remains: the displayed current email can become stale before approval; the server revalidates it and fails closed. The step-up method preference persists across action changes while sensitive form values reset.

The E2E spec mocks API responses. This review and retained offline tests do not establish a real browser lifecycle, database integration, image boot/health, Docker, or exact-head hosted CI. Those acceptance gates remain required. This verdict is source/security clearance only and does not claim merge readiness by itself.

## Verdict

**CLEAR — full independent security review** at exact head `d106cf0a6bb1d06005578abfe1b858df37a98d4d` against `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`. The d7e3 stale pending-approval blocker is independently closed by the committed generation guard and its regression evidence. No security gate is waived.
<!-- END REPORT (sha256 f23e29950ef62bc73e9b116684baf2d4cd7aa4a783c08248f989832974e894b5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-current-route-g8-ordinary-luna.md; GPT-6 Luna; sha256 8711218df521b0ef620b2db1d6db2f8c3d1e314d4f8e1fed24b857d283f9e6c5) -->
# #670 current route and G8 ordinary review

**Verdict: CLEAR for the post-d106 route, navigation, inventory, contrast-register, mock-browser, and G8-baseline delta at exact candidate `f5ef92fbaa7bb7ee9e2c064dbcbc9e966d363695`. No blocking finding.** This is a bounded ordinary review of the delta after the prior d106 product clearance; it is not a full replay of the earlier implementation panel or an acceptance of the Users workflow.

## Provenance and scope

- **Model:** GPT-6 Luna (assigned ordinary-review tier; this task context was independent of implementation and remediation).
- **Role/context:** Fresh independent ordinary reviewer, `/root/review670_current_route_g8_luna`; no source authoring, direction, or remediation.
- **Candidate:** `f5ef92fbaa7bb7ee9e2c064dbcbc9e966d363695`; clean at review. Comparison source: previously cleared `d106cf0a6bb1d06005578abfe1b858df37a98d4d`.
- **Scope inspected:** exact post-d106 changes, especially `9034ccc3` route/test/contrast reconciliation, `2ea00027` workspace-switcher navigation restoration, `49ae65da` G8 inventory and cases, `f1a224bf` native admin visual fixture, and `f5ef92fb`'s three Linux baselines. I read the repository instructions and workflow, God Mode and pending-actions architecture/spec context, current PR description/status, route source and generated metadata, relevant test fixtures, inventory, contrast register diff, and captured G8 receipts/log/screens.
- **Checks actually run by this review:** `git status --short`, `git log`/`git diff`/`git show` source inspection, `git diff --check d106cf0a..HEAD`, direct inspection of the three PNGs, and read-only inspection of the private G8 capture/evidence records. I did not run tests, build, Docker, or live browser workflows.

## Findings

1. **Canonical route restoration is coherent.** The file route now lives at `/_layout/_authenticated/agent/god-mode/users`, and the generated agent tree, generated route metadata, `routes.godModeUsers.path/build`, round-trip expectation, screen inventory and navigation target consistently use `/agent/god-mode/users`. Query state remains encoded by the existing parser/builder. Pending-action list/detail remain under `/agent/settings/profile/pending-actions`; the Users screen links to that list and uses the server-provided approval URL for a requested action. The delta does not alter PA server contracts or the previously cleared intent-generation guard.
2. **Navigation retains server authority.** The restored menu entry is conditionally displayed by the existing `session.user.role === "admin"` presentation hint. The change adds no route policy, capability, backend endpoint, or authorization path. Users data and actions still use the existing instance-user API; this delta does not change its server-side native `instance:admin` enforcement. The UI role check therefore controls discoverability only and does not confer the God Mode authority described by the spec.
3. **Shared UI and contrast evidence are consistent with the design-system rule.** The Users screen uses imported `@taskdesk/ui` `Button` and other shared components; I found no locally defined button primitive in the restored route. The large `pairs.json` change is the contrast scanner's register update for the restored route/callers and moved route paths, not a modification to shared Button behavior or color tokens. The route tree and contrast occurrence paths agree with the canonical moved files. This review did not rerun the contrast gate or independently certify every existing occurrence represented by that generated register.
4. **Mock browser regression and G8 coverage are useful but bounded.** The visual cases assert rendered Users directory, pending-action list and detail content against the new Linux snapshots. The authenticated visual fixture explicitly uses an admin-shaped session and returns mocked API payloads; it verifies screen rendering and screenshot stability, not authentication, policy enforcement, API integration, or the end-to-end Users workflow. The separate God Mode E2E remains an API-mocked browser regression. No real Users browser workflow is established by these cases.
5. **The three new baselines are source-bound to the reviewed route/test source.** The captured `prep.json` pins capture source `f1a224bf10b8fdddfc40c94fca6ee4f9f406e379`; `source-copy-commit-receipt.json` binds the final candidate to that source and records only the three listed PNG additions. The preserved log records exactly three selected `@visual` cases passing once in the pinned Playwright Linux/amd64 child (amd64 emulation on the arm64 host is disclosed). I inspected the committed images: each is readable at 1280×720 and shows the expected content without blank, error, or truncation. This is baseline inspection, not approval of overall UX or browser acceptance.
6. **Inventory claims are accurate for the changed rows.** It marks Users and the pending-action list/detail as in progress and raises the count from 138 to 139 for the added detail screen. The capture receipt reports `check:inventory` success with 44 canonical routes and 9 active routes, and `check:visual-scope` success with 10 screenshot cases mapped to 9 active inventory rows. These counts describe gate coverage, not the total planned screen rows.

## Residual acceptance and gates

- Required real Users workflow remains outstanding: open the screen in the real application and exercise its directory/detail/action flows, including step-up, exact-email deactivation approval, URL state/Back behavior, and resulting pending-action return. The PR correctly does not call mock coverage real-browser evidence.
- The prior d106 G11 work-list performance failure remains preserved and unwaived. A later `2ea00027` run also has a distinct preserved G11 failure in the private update; neither is explained or cleared by this route/G8 delta. At review time, the current exact-head G11 job was still in progress, and the current PR-template/security-review check was red. This report does not make the candidate merge-ready or waive any gate.
- No source change in this bounded delta alters authentication authority, permissions, a security control, CI gate semantics, or a shared UI primitive. I see no additional security review requirement created by this delta; the ordinary review count and all existing PR gates remain governed by repository policy.

## Verdict

**CLEAR for this exact post-d106 delta only.** No blocking or non-blocking code finding. The report does not clear the real Users workflow, prior or current G11 results, other pending DoD items, independent review count, required security review if separately determined applicable, or hosted CI on the exact head.
<!-- END REPORT (sha256 8711218df521b0ef620b2db1d6db2f8c3d1e314d4f8e1fed24b857d283f9e6c5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-current-route-g8-security-sol.md; GPT-6 Sol; sha256 1331a95b43fd586cd2dc8dbc71909172cae427a50418f984642e21a4df28aa09) -->
# #670 exact-head security review: route and G8 delta

**Verdict: CLEAR for the bounded post-`d106cf0a6bb1d06005578abfe1b858df37a98d4d` delta at `f5ef92fbaa7bb7ee9e2c064dbcbc9e966d363695`.** No blocking or non-blocking security finding in this delta. This confirms the current security boundary; it does not repeat or replace the earlier full Sol pass over the structural intent-invalidation work, and it does not establish merge readiness or real Users workflow acceptance.

## Independence and reviewed source

- **Reviewer:** fresh independent `/root/review670_current_route_g8_sol`, Sol-tier security-review assignment. I did not author, direct, or remediate the candidate. The platform-visible identity is GPT-6; its exact serving variant is not independently exposed in this context.
- **Exact candidate:** `f5ef92fbaa7bb7ee9e2c064dbcbc9e966d363695`; checkout clean when inspected. Comparison source: `d106cf0a6bb1d06005578abfe1b858df37a98d4d`. The prior d106 ordinary panel and full Sol review cover the unchanged Users action/intent implementation. The separate current ordinary report is `670-current-route-g8-ordinary-luna.md`.
- **Scope:** route relocation, generated route metadata/tree, URL builder and round-trip test, workspace-switcher navigation, unchanged action guard, PA return link, shared Button caller in the pending-action test, API-mocked E2E/visual fixture, inventory and contrast register, three Linux baselines and current hosted G8 log. I inspected the relevant `apps/api/src/instance/users/index.ts`, `apps/api/src/instance/policy.ts`, and native-admin resolver as the unchanged server authority boundary. I read AGENTS, active mission, workflow/model/review policy, relevant God Mode/PA spec references, queue/decision-log context and the prior current ordinary report.

## Checks actually performed

- Read-only `git status --short --branch`, `git rev-parse HEAD`, `git log`, `git diff --stat/--name-status`, focused source diffs and a direct old/new Users-route comparison. The route component's only source change is its TanStack file-route identifier matching the moved path; its `useIntentLifecycle` binding and generation checks are byte-identical to d106.
- `git diff --check d106cf0a..HEAD` reported a trailing blank line in the unrelated `671-delivery-reconciliation.md` review packet. That is a formatting observation, not a security-boundary defect or a waiver of any repository check. No source edits were made.
- Inspected the preserved hosted G8 log: checkout recorded PR head `f5ef92fbaa7bb7ee9e2c064dbcbc9e966d363695`; scope check reported 10 screenshot cases mapped to 9 active inventory rows; Playwright reported `10 passed (14.4s)` and Storybook screenshot coverage reported 145 stories with its single coverage test passing. The referenced Storybook job is `114674453179`. I did not rerun CI, tests, Docker, builds, fixtures, or a live browser.

## Security assessment

1. The canonical Users URL is consistently `/agent/god-mode/users` in the moved file route, generated agent tree/metadata, `routes.godModeUsers`, route round-trip test, inventory, visual mapping and restored workspace-switcher target. Query parsing/building still binds selected user and action to URL state. The component's server-provided `approveUrl` link and existing pending-action list/detail paths are unchanged. No new endpoint, policy key, capability or PA authority is introduced.
2. The new menu entry is shown when Better Auth session `user.role === "admin"`; this is a discoverability condition, not an authorization decision. Every instance-user handler inspected still invokes `requireGodMode`, which requires an agent session, rejects impersonation, and calls the native `isCurrentInstanceAdmin` check. That check requires the database user role `admin` plus an active staff person. The registered instance-user policies retain `instance:admin` and session-only constraints. Route relocation and menu visibility cannot mint that authority.
3. The moved Users component still imports `Button`, dialog, input, select, table and other primitives from `@taskdesk/ui`; the pending-action test replaces a raw harness button with the shared Button. No shared Button implementation or token was changed. `packages/ui/src/styles/pairs.json` is a generated contrast occurrence/register change for the restored route/callers, not a contrast algorithm, authorization rule or CI pass/fail implementation change. I did not independently re-evaluate every register occurrence.
4. The God Mode E2E and new G8 cases intercept API calls. The visual fixture supplies an admin-shaped session and mock directory/pending-action payloads. The hosted 10-case and Storybook results are evidence for this mocked visual coverage. They do not prove server authorization, step-up, exact-email approval, action execution, URL Back behavior in a real account, or a complete Users workflow.
5. The post-d106 source delta does not alter the earlier-reviewed intent-invalidation mechanism. The current route's `runAction` still compares the selected intent to the requested user/action, captures a generation before proof, and checks currency before mutation or subsequent state writes. The relocation did not weaken the prior security guard.

## Remaining gates and limits

- Real authenticated Users browser workflow, including directory/detail/actions, PA step-up and return, remains unverified; no acceptance claim follows from this report.
- The preserved d106 and later 2ea G11 failures remain unresolved. I also inspected the newly completed exact-current-head G11 raw log under `670-currentf5-hosted-g11`: calibration was valid, 21 required cases passed and work-list LCP failed after its permitted retry (normalized medians 2653.3 ms, then 2626.9 ms, against strict <2500 ms). Assignment 188.9 ms and board 426.0 ms passed their budgets. The separate optional app-frame diagnostic failed to capture app frames. The current required G11 is therefore red; G8 success does not diagnose or waive it. No unchanged rerun or threshold change is implied. Exact-head required checks and PR review publication remain for the conductor to assess independently.
- This report clears only this head and this post-d106 delta. Any subsequent product, test, gate or authority change needs a fresh exact-head review at its applicable tier. The included #671 review packet is separate publication evidence, not a new #670 security implementation or a substitute for #670 review.
<!-- END REPORT (sha256 1331a95b43fd586cd2dc8dbc71909172cae427a50418f984642e21a4df28aa09) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/E12/670-real-users-journey-ordinary-luna.md; GPT-6 Luna; sha256 fc029cb7bcbf9841ffa596f0ad52dab9294bf2d655083b8512ef750685c8c0ff) -->
# #670 real Users journey ordinary review

**Verdict: BLOCKED for using this source as the real Users journey acceptance test at exact candidate `9ee958bbe5e0ed87053b9bef9ca34a5ae60667d0`.** The proposed test is not executed in this review. One central delayed-grant sequence cannot perform its specified user selection through the open modal, and the approval lifecycle assertions omit the required membership/grant transition. No source edits or remediation were made.

## Provenance and scope

- **Model:** GPT-6 Luna (assigned ordinary-review tier).
- **Role/context:** Fresh independent review context `/root/review670_current_route_g8_luna`, which did not author, direct, or remediate the source.
- **Exact source:** candidate `9ee958bbe5e0ed87053b9bef9ca34a5ae60667d0`; base `f5ef92fbaa7bb7ee9e2c064dbcbc9e966d363695`. The sole changed path is `apps/web/e2e/instance-users-journey.spec.ts`.
- **Reviewed source hash:** SHA-256 `cfcef148ba323978217d6beac3f1ddeb1e4862f20c4dfd29c9033f659b59090d`.
- **Checks actually run:** verified checkout SHA/status; inspected the complete new spec, preparation plan, current Dialog and Users route behavior, pending-action fetcher, MFA/CSRF app fixture, relevant applied migration SQL, and God Mode/IP-15 specifications; ran `git diff --check f5ef92fbaa7bb7ee9e2c064dbcbc9e966d363695..9ee958bbe5e0ed87053b9bef9ca34a5ae60667d0`; computed the spec hash above. No test, build, fixture, browser, DB, container, retry, or source modification was performed.

## Findings

1. **Blocking: the delayed-grant race attempts to select a user through an open modal dialog.** At lines 328–341, the test submits the grant form, waits until the real `/api/me/step-up` response has been fetched and held, then calls `selectUser()` without closing the dialog. The Users screen keeps `UserActionDialog` open for the routed `action`; the shared `@base-ui/react/dialog` wrapper renders a modal portal/backdrop, and the dialog has no close button. While the grant mutation is pending, its visible Cancel button is explicitly disabled (`disabled={pending}`). The underlying directory link used by `selectUser()` is therefore inert/covered and cannot receive the click. The `selectUser()` helper cannot establish the URL intent change on this path, so the primary delayed-continuation regression is unreachable as written. It needs a supported, explicit navigation sequence that closes/leaves the modal before the next selection, while still proving the in-flight continuation is invalidated.
2. **Blocking coverage gap: no target membership/grant rows are seeded or checked.** `seedTargets()` inserts each target `user` and linked `person`, and one target's `session` and `apikey`, but inserts neither `workspace_member` nor `membership`/direct grant data. The final database assertions cover person activity, sessions, keys, pending action, audit rows and outbox events only. God Mode GM-15 specifies `end_memberships`; IP-15 requires retiring external and direct grants and recomputing/removing effective memberships. This fixture starts with no target grant closure, so it cannot demonstrate that deactivation performed those lifecycle effects. It should seed a legitimate disposable membership/grant case with explicit IDs and assert the expected retirement/effective-state result. The current spec contains no raw SQL insert into `workspace_member` or `membership`, so there is no missing-`id` column in those absent inserts; I checked the applied migration definitions rather than relying on Drizzle `$defaultFn` metadata.
3. **Non-blocking test reliability issue: a failed `route.fetch()` leaves `ready` unresolved.** In `holdNextRealStepUpResponse()` (lines 227–243), `resolveReady()` runs only after `route.fetch()` succeeds. The `finally` resolves `completed`, but neither resolves nor rejects `ready`; callers await `ready` before reaching their `finally`/`remove()` call. If the real endpoint/network fails before yielding a response, the test waits until its overall timeout and cannot use the normal route cleanup path. Reject `ready` on fetch failure (and abort/continue the intercepted route as appropriate) so failure is immediate and cleanup is guaranteed.

## What is sound in the inspected path

- The actor is created through browser sign-up and workspace onboarding, enrolls MFA through the real security screen, signs out, then signs in and completes the real TOTP challenge. The helper fixture owns a disposable PostgreSQL 18 container, random auth secret and loopback origin, private temporary logs, supervised API child, and awaited API/container shutdown.
- The target setup uses random synthetic IDs/emails and inserts only disposable rows. I verified its raw inserted columns against applied migration SQL: `user` required fields are supplied; `person` required fields including `organisation_id`, `side`, `active`, `is_placeholder`, and timestamps are supplied; `session` supplies required `id`, `token`, `user_id`, expiry and timestamps with permitted `portal='agent'`; `apikey` supplies required `id`, `key`, `user_id`, timestamps and allowed nullable/defaulted fields. `display_name` exists by migration 0095. It does not attempt raw `workspace_member` or `membership` inserts.
- The interception is scoped to the one `/api/me/step-up` proof response, calls `route.fetch()` against the real server, and fulfills with the actual response. It does not synthesize API payloads, set auth cookies/storage, or bypass authorization. The separate pending-action delay is on a detail route without an open action dialog and uses the visible workspace/pending-action navigation path.
- The actual deactivation request checks the real 202 DTO, exact user target, pending row and unchanged person/credentials; the final approval checks exact typed email, a separate backup code, one approval POST, executed state, credential revocation, audit and outbox records. The test disables Playwright trace/video/automatic screenshots; its manual screenshots contain the random fixture's synthetic records and do not include factor secrets.

## Verdict and residuals

**BLOCKED for test acceptance** until findings 1 and 2 are addressed and the exact changed source is reviewed again. Finding 3 should also be fixed before relying on the race probe in CI because it otherwise converts a real endpoint failure into a long timeout and weakens cleanup observability. This verdict does not question the previously reviewed product implementation and does not re-run or replace its ordinary/security panel.

The test remains source-only here. The parent's recorded f5 evidence (Postgres 18: 177 files / 2183 tests / 5 tasks; G8: 10 apps / 145 stories; G11 valid calibration: 21 pass / 1 LCP failure at 2626.9 ms) is not evidence that this new test executed or that it clears any gate. The existing G11 failure remains preserved; no waiver or gate clearance is implied.
<!-- END REPORT (sha256 fc029cb7bcbf9841ffa596f0ad52dab9294bf2d655083b8512ef750685c8c0ff) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/E12/670-current-split-and-journey-ordinary-luna.md; GPT-6 Luna; sha256 b421f101d89f4a04cfc1b44e92f7637becc659badff18ecfc353d60ed5ef808c) -->
# PR 670 current split and Users journey ordinary review

- **Model:** GPT-6 Luna (task-routed ordinary reviewer context)
- **Independence:** Fresh reviewer context; did not author, direct, or remediate the candidate.
- **Reviewed source:** `f3883a3cb4202c0fc243c5078a3be3cb1129cde2`
- **Comparison:** `9ee958bbe5e0ed87053b9bef9ca34a5ae60667d0..f3883a3cb4202c0fc243c5078a3be3cb1129cde2`
- **Worktree:** `/Users/heinthura/.codex/worktrees/field-source-conservation/Ticketing.v2`, branch `codex/users-pending-ui-selected-20261012`; clean at review time.
- **Verdict:** CLEAR for this bounded ordinary delta. This is not runtime/browser acceptance and does not clear any pre-existing G11/LCP, hosted, or other acceptance result. Because the delta changes pass/fail assertions in `scripts/ci/**`, a separate fresh full security-tier review is required before merge.

## Scope checked

Reviewed the full delta in the seven changed files: the real Users journey E2E test; Users and pending-action detail route implementations and their component tests; and `scripts/ci/check-bundle-size.mjs` plus its unit tests. Focused on the previous 9ee findings about closing the pending grant intent, lifecycle membership evidence, route abort/failure completion, and the new two-route bundle assertions. Checked the relevant God Mode and pending-action contracts, IP-15 lifecycle implementation, applied SQL migrations `0052`, `0090`, and `0107`, the shared Dialog wrapper, and installed Base UI 1.7.0 Escape-dismiss implementation.

## Findings

No blocking or non-blocking finding in this delta.

The grant-protection test now holds a real successful step-up response while the grant dialog is open, presses Escape, confirms the dialog closes while the stale user remains selected, then navigates to the deactivation target. `Dialog` is the Base UI Root; the wrapper does not disable modal Escape behavior, and the route's `onOpenChange(false)` calls `resetAction`, removing the URL action. The pending grant continuation checks its captured `useIntentLifecycle` generation after proof resolves, so changing the routed intent invalidates it before `grant-admin` can be posted. A modal is not bypassed with a click on inert background content.

The hold helper now rejects `ready` if `route.fetch()` fails, aborts the intercepted route best-effort, and resolves `completed` in `finally`; `remove()` releases the hold, unregisters the route, and awaits a claimed handler. This closes the reviewed failure-path hang.

The IP-15 test seeds explicit role, effective membership, and direct admin-origin membership-grant IDs. Against applied SQL, the explicit non-null fields are provided; the source-shape check is met (`direct`, `admin`, a real `granted_by_person_id`, null external linkage), and the referenced person/role/workspace exist in seed order. Migration `0107` permits `person_deactivated`. Assertions establish the grant is initially active, is retired with `person_deactivated`, the effective membership is removed, the event reports one ended membership, and pre/post credentials and pending-action state follow the intended lifecycle. This is consistent with the server's current IP-15 implementation and GM-15 contract.

The pending-action held-proof navigation case still verifies return to the same action after leaving and reopening its route; the intent lifecycle invalidates the old component's continuation on route change/unmount. The requester/approver relationship follows the documented pending-action model (requester approves in an authenticated browser session), while target self-deactivation remains refused by the server contract.

The bundle checker requires both added route components to exist as Vite dynamic entries and to be absent from the initial static imports graph of the agent entry and work-list route. It follows manifest `imports` transitively and deliberately excludes `dynamicImports`, matching the static-graph assertion. The existing byte budgets, agent/portal entry classification, asset bounds, and work-list graph measurement are unchanged. No waiver, threshold increase, path exclusion, or skipped check was introduced.

## Checks actually run

- `git status --short --branch`, exact `git rev-parse HEAD`, and changed-file inventory.
- `git diff --check 9ee958bbe5e0ed87053b9bef9ca34a5ae60667d0..HEAD` — clean.
- `node --test scripts/ci/check-bundle-size.test.mjs` — 11 tests passed, 0 failed.
- Static source inspection only for routes, lifecycle guard, UI Dialog, actual installed Base UI Escape path, pending-action contract/handler, lifecycle writer, and SQL migrations.
- No build, fixture, browser, G11 checker, database, or runtime was run.

## Residuals and prior evidence boundary

The real Users workflow must still be executed in its intended browser/runtime acceptance lane. This source review does not claim the new E2E passes in a browser. Preserve the prior `f5ef92fbaa7bb7ee9e2c064dbcbc9e966d3636952` hosted PostgreSQL and G8 evidence/counts as exact-source evidence only; the later test-source change does not inherit runtime acceptance. The existing G11 failures and the recorded LCP result remain as previously source-bound and are not waived or reclassified here. The added split assertion alone proves no actual bundle size or runtime improvement.

## SHA-256 of reviewed files

```
8f62b55237cc7e0a8ebc11616ce1add3935838c8eb95fd226bc87d95f681641a  apps/web/e2e/instance-users-journey.spec.ts
1d7d9f1f397e40a939fe9a6f4a2f2d62178a372da96e9d0ae167bd3c1ef46ec2  apps/web/src/routes/agent/_layout/_authenticated/agent/god-mode/users.tsx
cabb51cab73501e38cb584e65166ff5a235d6309c26926aea0d177b5182d7d87  apps/web/src/routes/agent/_layout/_authenticated/agent/god-mode/users.test.tsx
5028d18cb1266fd60257c9b7a11be28343ad1bce28b1b9a86c47288032afee6c  apps/web/src/routes/agent/_layout/_authenticated/agent/settings/profile/pending-actions/$id.tsx
f860db66c0b03b8b217b9385d17c71e01fb1b21276c0ef209c131d7e2f5f5ea4  apps/web/src/routes/agent/_layout/_authenticated/agent/settings/profile/pending-actions/$id.test.tsx
42a35a3f1203df4d904d57e6b7a7c2ec2c32c1a988dd834882f1323a58139fc8  scripts/ci/check-bundle-size.mjs
e34569d69cb513a77df2aa98b982894492ed682ad499b155868a04b44ae6042d  scripts/ci/check-bundle-size.test.mjs
```
<!-- END REPORT (sha256 b421f101d89f4a04cfc1b44e92f7637becc659badff18ecfc353d60ed5ef808c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-current-split-and-journey-security-sol.md; GPT-6 Sol; sha256 6d6866153a799c1f439d2104d27bf388829881062a5de6b74fa405473c66f47e) -->
# #670 full independent Sol-tier security review — current split and Users journey

**Verdict: CLEAR for the exact `9ee958bbe5e0ed87053b9bef9ca34a5ae60667d0..f3883a3cb4202c0fc243c5078a3be3cb1129cde2` delta.** No blocking or non-blocking security finding. This is a full pass on the bounded CI pass/fail change and its associated real-journey test repair and route split; it does not substitute for runtime acceptance, required current-head CI, or earlier product reviews.

## Reviewer and source

- **Reviewer:** fresh independent context `/root/review670_current_route_g8_sol`, assigned the Sol-tier security pass. I did not author, direct, or remediate this candidate. Platform identity is GPT-6; the exact serving variant is not independently displayed in this context.
- **Exact candidate:** `f3883a3cb4202c0fc243c5078a3be3cb1129cde2`, clean checkout when reviewed. Comparison: `9ee958bbe5e0ed87053b9bef9ca34a5ae60667d0`. The earlier 9ee test blocker remains historical evidence of the issue this delta repairs; the independent current ordinary result is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/E12/670-current-split-and-journey-ordinary-luna.md`.
- **Changed files:** `apps/web/e2e/instance-users-journey.spec.ts`; both heavy route modules and their component tests; `scripts/ci/check-bundle-size.mjs` and its test. I checked the relevant unchanged native-admin route/policies, pending-action proof and lifecycle behavior, applied membership-grant constraints, isolated fixture, and God Mode/PA contract. Prior f5 product source and its exact-source evidence are reused only within their unchanged scope.

## Checks actually performed

- Inspected exact Git head/status, all seven changed-file hunks, full bundle checker, full journey test, relevant server/spec/fixture source, and a read-only existing built Vite manifest to check the expected `?tsr-split=component` key shape. I did not perform a new build or use that manifest as proof of the current head's build.
- `git diff --check 9ee958bbe5e0ed87053b9bef9ca34a5ae60667d0..HEAD` — clean.
- `node --test scripts/ci/check-bundle-size.test.mjs` — 11 passed, 0 failed, 0 skipped. This includes the new dynamic-component graph assertion. I did not rerun the bundle checker against a current production build, Playwright, API/database fixture, Docker, G11, or a live browser; the conductor's current build/check batch is separate evidence.

## Security and gate findings

1. **No authority expansion.** The two route implementation changes remove `export` from their heavy component functions. `Route` remains exported, still registers the same component, paths, query validation and action handlers. Their intent-generation guards and server calls are unchanged. Unit harnesses now obtain the component through `Route.options.component`; they do not add production access paths. The existing instance-user API remains session-only, requires an agent non-impersonated session, and checks the native database admin role joined to an active staff person. The registered instance-user policies retain `instance:admin`. The UI menu role hint still grants no authority.
2. **Delayed real response is handled as a security regression.** The journey intercepts only the next real `/api/me/step-up` response; `route.fetch()` reaches the actual service and the test holds the response before the browser receives it. With the grant dialog open, Escape invokes the existing Dialog `onOpenChange(false)`/`resetAction`; the selected user remains in the URL while its action is removed. Selecting another user then invalidates the old captured `useIntentLifecycle` generation before a `grant-admin` POST. The test expects no grant request and no role change. The second held proof leaves and reopens the pending-action detail route; the old route's continuation must not issue approval, and the action remains pending. The helper now rejects `ready` when fetch fails, best-effort aborts the route, and always resolves completion before cleanup, so a failed upstream fetch cannot masquerade as a successful held response or hang the handler indefinitely.
3. **Seed and approval trust boundary stay explicit.** The test uses the existing isolated PostgreSQL 18 container and loopback built API fixture, creates the administrator through real sign-up/MFA/sign-in UI, and seeds only disposable synthetic targets. Its direct membership grant supplies a real issuer person, workspace/role/person references, `source_kind='direct'`, `direct_origin='admin'`, and false `sees_all`; this meets the applied 0090 source-shape constraint, and 0107 permits `person_deactivated`. The test asserts the grant exists before approval and is retired afterward, effective membership is removed, sessions and key are revoked, and the event reports one ended membership. These assertions mirror the unchanged IP-15 writer and GM-15 server-selected `end_memberships` contract. The test does not bypass the native admin or PA-15 operation proof to execute an action.
4. **Proof and privacy boundaries remain.** The test uses real MFA backup codes through the UI and expects the server's pending action to stay unexecuted until exact-email approval and a fresh action-bound proof. No token or backup code is asserted in output. Playwright automatic trace, video and screenshot capture are disabled for this test; three explicit screenshots are taken only on synthetic Users/pending-action screens, after the sensitive MFA entry screens. The fixture keeps child process output in a private temporary directory. This is source inspection, not a claim that a browser run or artifact inspection has succeeded.
5. **The changed CI gate strengthens failure conditions.** For each Users and pending-action detail component, the checker requires a manifest key with the exact route-component suffix and `isDynamicEntry`; missing/non-dynamic components throw. The shared helper walks `imports` transitively from both the agent entry and work-list route and throws if either component enters an initial static graph. It deliberately ignores `dynamicImports`, which are outside those initial graphs. The existing role classification, asset measurement, strict 350/350/200 KB budgets, output-missing errors and work-list accounting remain intact. New tests exercise the allowed dynamic case and a transitive static-import violation. I find no threshold increase, check skip, path exclusion or gate relaxation. A current production manifest/build must still prove these assertions on the actual head.

## Residuals

- The repaired journey is source-reviewed but has not been executed by this reviewer. Its real Users browser flow, step-up, approval, database effects and screenshots require the intended runtime acceptance evidence.
- Older f5 hosted PostgreSQL/G8 evidence and its G11 work-list LCP failure remain bound to their own source. The route split alone is no evidence of LCP improvement or a G11 root-cause fix. Any current-head build/check result belongs to its own exact SHA and run.
- This clearance is for `f3883a3cb4202c0fc243c5078a3be3cb1129cde2` only. Subsequent source or CI-gate changes require the applicable fresh review before protected merge.
<!-- END REPORT (sha256 6d6866153a799c1f439d2104d27bf388829881062a5de6b74fa405473c66f47e) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/E12/670-auth-readiness-and-error-context-ordinary-luna.md; GPT-6 Luna; sha256 14de938f1e98ad5cc6d4cc2cbd7b0ff44c84327569f69b6f6f0a2548a1da2f6d) -->
# PR 670 MFA readiness and Playwright error-context ordinary review

- **Model:** GPT-6 Luna (task-routed ordinary reviewer context)
- **Independence:** Fresh review context; did not author, direct, or remediate this delta.
- **Reviewed source:** `643bb77e0dc842a71b3ec162e3d20d233efff63c`
- **Comparison:** `f3883a3cb4202c0fc243c5078a3be3cb1129cde2..643bb77e0dc842a71b3ec162e3d20d233efff63c`
- **Worktree:** `/Users/heinthura/.codex/worktrees/field-source-conservation/Ticketing.v2`, branch `codex/users-pending-ui-selected-20261012`; clean at review time.
- **Verdict:** CLEAR for this bounded test-only delta. The ordinary source review does not establish browser execution or acceptance; a focused privacy negative control remains a useful evidence step before treating artifact redaction as runtime-proven.

## Scope and checks

Reviewed the complete one-file delta in `apps/web/e2e/instance-users-journey.spec.ts`: asynchronous MFA enrollment readiness and acknowledgement, recursive `TestInfoError.errorContext` replacement, and the test-level `afterEach` hook. Checked the rendered enrollment UI, repository Playwright config and per-spec overrides, plus the installed Playwright 1.63.0 public type and actual artifact recorder implementation. I did not inspect private captured snapshots or print/read backup-code values.

- `git rev-parse HEAD`, status, changed-file inventory, and comparison diff.
- `git diff --check f3883a3cb4202c0fc243c5078a3be3cb1129cde2..HEAD` — clean.
- Static inspection of Playwright 1.63.0 `TestInfoError.errorContext`, matcher serialization, error-context generation, and `_takePageSnapshot` skip behavior.
- No test, browser, fixture, probe, build, or CI command was run.

## Findings

No blocking or non-blocking source defect found.

MFA enrollment now waits for the acknowledgement button to be visible, polls until at least three backup-code list items have rendered, then reads them and awaits the acknowledgement button disappearing. That addresses the observed UI-render readiness race; `allTextContents()` is no longer called before the DOM is ready. The real backup codes remain held in test memory and are only used to fill the later step-up forms.

The error hook replaces each top-level and nested-cause `errorContext` with a fixed safe note. The installed Playwright type exposes this field publicly. In the installed recorder, any non-empty error context suppresses the later whole-page ARIA snapshot, and the generated `error-context.md` writes the supplied context instead of matcher DOM snapshots. This is compatible with its lifecycle: afterEach mutation occurs before final error-context artifact generation. The spec also overrides configured `retain-on-failure` trace behavior with `trace: off`, and explicitly disables video and automatic screenshots. Its intentional manual screenshots occur after the MFA enrollment screen has been acknowledged and navigated away from.

The hook leaves error messages and stacks intact. In this file, no assertion interpolates a backup code or provisioning URI into its failure message; the secret-bearing steps use fill operations and count/status assertions. The fixed replacement note itself contains no secret.

## Negative-control / residual evidence

No negative-control run was performed. For runtime evidence, the narrowest meaningful check is an intentional failure through the existing Playwright E2E command/config, positioned after a synthetic canary is rendered while the enrollment secret UI is present. Require the runner's actual non-zero failure result, then inspect/search the generated attachments privately for the canary and for the in-memory backup-code values without printing either. Confirm `error-context.md` contains only the fixed replacement context, and confirm no trace/video/screenshot artifact was produced for this spec. Use the existing runner and output directory; this review does not authorize new harness/config scaffolding or claim that such a control has passed.

The earlier captured ARIA snapshot was real Playwright error-context evidence despite trace/video/screenshot being disabled; those flags alone did not protect that artifact. This patch addresses that route to disclosure, but this review deliberately preserves the prior captured evidence and verdicts without reopening or copying its secret-bearing contents. The prior exact-f388 product, G8, and G11 evidence remains source-bound; this test-only head does not inherit runtime/browser acceptance from f388.

## SHA-256

```
c1bd775ac0b072323b80e30941a0714a4209e4c9d56c5f0ed3c395fe9a4e38cd  apps/web/e2e/instance-users-journey.spec.ts
```
<!-- END REPORT (sha256 14de938f1e98ad5cc6d4cc2cbd7b0ff44c84327569f69b6f6f0a2548a1da2f6d) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-auth-readiness-and-error-context-security-sol.md; GPT-6 Sol; sha256 e39ecdcd145d74c18cc7e8fc67787118303bccc7c271e53e692de0a1ce54b3f2) -->
# #670 independent Sol-tier security review — MFA readiness and error context

**Verdict: CLEAR for the bounded test-only delta `f3883a3cb4202c0fc243c5078a3be3cb1129cde2..643bb77e0dc842a71b3ec162e3d20d233efff63c`.** No blocking or non-blocking source finding. This is a source-level security verdict, not proof that the Playwright failure artifact was redacted at runtime or that the real Users journey passed.

## Provenance and exact scope

- **Reviewer:** fresh independent Sol-tier context `/root/review670_current_route_g8_sol`; I did not author, direct, or remediate the candidate. Platform identity is GPT-6; exact serving variant is not independently displayed in this context.
- **Candidate:** `643bb77e0dc842a71b3ec162e3d20d233efff63c`, clean checkout when inspected. Base: `f3883a3cb4202c0fc243c5078a3be3cb1129cde2`. Only `apps/web/e2e/instance-users-journey.spec.ts` changed (30 insertions, 2 deletions). Prior full f388 security review and ordinary review cover unchanged product/CI-gate source; the current ordinary privacy/readiness report is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/E12/670-auth-readiness-and-error-context-ordinary-luna.md`.
- **Incident boundary:** the first f388 real Users attempt failed when `allTextContents()` returned zero immediately after enrollment verification. The retained private Playwright ARIA context reportedly contained the rendered backup-code list and acknowledgement button. I did not open, read, print, copy or reclassify those private artifacts or code values. Existing private storage and access protections were not changed by this review.

## Checks actually performed

- Read-only `git status`, `git rev-parse HEAD`, one-file diff/stat and `git diff --check f3883a3cb4202c0fc243c5078a3be3cb1129cde2..HEAD` (clean).
- Inspected the enrollment UI rendering, this spec's capture settings and explicit screenshot positions, repository Playwright config, installed Playwright 1.63.0 public `TestInfoError.errorContext` type, matcher error-context assignment, `ArtifactsRecorder._takePageSnapshot`/`buildErrorContext`, and worker ordering of `afterEach` before fixture teardown. No test, browser, fixture, negative-control probe, build, CI or G11 command was run.

## Findings

1. **Readiness wait repairs the observed race without changing proof semantics.** The new code waits for the backup-code acknowledgement button, polls for at least three alert-list items, then reads the item text and checks its count. The enrollment UI renders those `li` elements with backup codes and uses the acknowledgement button to set their state to `null`. The test clicks it and awaits disappearance before moving to sign-in. The TOTP enrollment, later backup-code fills, native-admin session, PA-15 proof calls and action assertions are unchanged. An unsuccessful wait still fails the test; no skip, softened assertion or alternate credential path was added.
2. **The error-context hook targets a real automatic disclosure path.** This spec already sets automatic trace/video/screenshot capture to `off`, but Playwright can separately write an ARIA snapshot in `error-context.md` after failure. Installed Playwright 1.63.0 exposes mutable `TestInfoError.errorContext`. Its recorder skips `_takePageSnapshot` when any error has nonempty `errorContext`; `buildErrorContext` writes that field instead of the page snapshot. The worker invokes `afterEach` before test fixture teardown, so the hook replaces top-level and nested-cause contexts before artifact generation for ordinary test-function failures. The replacement is a fixed non-secret note. Error messages, stacks, assertion outcomes and nonzero failure status are left intact; the hook is not a gate bypass.
3. **Scope of privacy claim is narrow.** The spec takes three explicit screenshots only after enrollment codes are acknowledged and the browser is on synthetic Users/pending-action screens. The fixture starts a disposable PostgreSQL container and loopback app and keeps child output in a private temporary directory. The patch does not sanitize arbitrary exception messages, stacks, reporter output, explicit screenshots, other test files, or hypothetical failures before this `afterEach` can run. Source inspection supports the intended ARIA-context suppression path, not a blanket no-secret guarantee. Runtime negative-control evidence is still required before calling redaction demonstrated.
4. **Product and gate scope are conserved.** No production route, API policy, auth verifier, token binding, CI script, threshold, build input or bundle assertion changed after f388. The first failed real journey remains a failed run, and this test-only edit does not inherit or erase prior hosted G8/G11 evidence. There is no basis here to claim LCP savings or Users acceptance.

## Focused runtime evidence still needed

If the conductor authorizes an operational probe, use the existing Playwright config and fixture to make one expected-failure negative control while a **synthetic canary** is visible on the authentication screen. Preserve the natural exit-1 and useful error/stack output; inspect the generated attachments privately for the canary and actual in-memory backup-code values without printing either. Confirm `error-context.md` contains the fixed replacement note and no ARIA snapshot; also check that no automatic trace/video/screenshot artifact was made. Do not introduce a new runner/config/framework or weaken the success journey to obtain this evidence. No such probe was performed by this reviewer.

This clearance is limited to exact head `643bb77e0dc842a71b3ec162e3d20d233efff63c` and this one-file delta. Current-head browser/CI acceptance and any later source change require their own evidence and applicable review.
<!-- END REPORT (sha256 e39ecdcd145d74c18cc7e8fc67787118303bccc7c271e53e692de0a1ce54b3f2) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-corrected-hook-and-privacy-probe-ordinary-luna.md; GPT-6 Luna; sha256 cc29b013bd82e2c2486531f0d11727f7d1fec80e396e4f64a67138eef384026a) -->
# #670 corrected hook and privacy probe — ordinary review

**Model:** GPT-6 Luna  
**Role:** Independent ordinary reviewer  
**Independence:** Fresh reviewer context; did not author, direct, or remediate the source or proposal.  
**Comparison base:** `643bb77e`  
**Reviewed source head:** `0469577db3f7d8c7e2c384c922efff4370ac169c`  
**Private proposal SHA-256:** `0fe06985931b42380776b3b94e9dad1f37ce88b1b33a83d23e040b6e160e15de`

## Scope and checks

Reviewed the one-line change in `apps/web/e2e/instance-users-journey.spec.ts`: `test.afterEach` now destructures `{ page: _page }`, leaving the redaction loop and its body unchanged. This meets Playwright's fixture-object callback shape and avoids the repository's `noEmptyPattern` lint finding from the earlier empty pattern.

Reviewed the private expected-failure proposal and its preparation note. The proposal retains the per-spec `trace`, `video`, and automatic `screenshot` settings as off; saves a random canary and actual rendered backup codes only to a mode-0600, exclusive-created file in the fixture's private directory; appends the canary to the DOM after code-render assertions; then throws a static intentional error before the save-code acknowledgement. The afterEach hook replaces Playwright's `errorContext` recursively, including nested causes. The static failure text and stack line do not interpolate secrets. No added runner, configuration, dependency, environment variable, upload, skip, or global behavior was found. Later explicit journey screenshots are unreachable after this deliberate throw.

The preparation note binds the source and proposal to the reported SHA-256 values and marks the probe not run. I ran only the existing standard Playwright discovery command from `apps/web`: `pnpm exec playwright test --list --config playwright.config.ts`; it exited 0 and collected 29 tests in 11 files. This is collection evidence only. I did not run the probe, browser, build, database, or container.

## Verdict

**Clear for ordinary review** for the corrected one-line hook and the private probe preparation. No blocking or non-blocking findings in this bounded scope. This verdict does not establish runtime privacy behavior or full Users journey acceptance; the proposed expected-failure probe remains unrun, and the required independent Sol closure remains separate.
<!-- END REPORT (sha256 cc29b013bd82e2c2486531f0d11727f7d1fec80e396e4f64a67138eef384026a) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-corrected-hook-and-privacy-probe-security-sol.md; GPT-6 Sol; sha256 f6ce21e7cb6fe624b9cd48081777b89e4d454bd13bd5eaef0ddca6bd2dabaaa0) -->
# #670 corrected hook and prepared privacy probe — independent Sol-tier review

**Verdict: CLEAR for the exact one-line source delta `643bb77e0dc842a71b3ec162e3d20d233efff63c..0469577db3f7d8c7e2c384c922efff4370ac169c` and for the specifically bound, private expected-failure probe proposal SHA-256 `0fe06985931b42380776b3b94e9dad1f37ce88b1b33a83d23e040b6e160e15de`.** No blocking or non-blocking source/security finding. This clears preparation for the conductor's one bounded negative control after its runtime window, not a claim that the probe ran, redaction was empirically demonstrated, or the Users journey was accepted.

## Provenance and source binding

- **Reviewer:** fresh independent Sol-tier context `/root/review670_current_route_g8_sol`; I did not author, direct or remediate this source or probe proposal. Platform identity is GPT-6; the exact serving variant is not independently displayed in this context.
- **Exact candidate:** `0469577db3f7d8c7e2c384c922efff4370ac169c`, clean checkout at review. The only Git delta is `apps/web/e2e/instance-users-journey.spec.ts`, whose SHA-256 is `b67a1a59d9f406886f4d8816404f3ca7dd6e27a68d3398baf590b437b3d2938f`. The private proposed copy is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-privacy-probe-preparation/instance-users-journey-privacy-probe.corrected.proposed.ts`; its independently computed SHA-256 matches `0fe06985931b42380776b3b94e9dad1f37ce88b1b33a83d23e040b6e160e15de`. The proposal parent directory is mode 0700 and the copy mode 0600.
- **Prior scope:** The f388 full product/CI-gate Sol review and the 643 source-level privacy review remain preserved for what they inspected. The hosted 643 collection failure was a Playwright callback-signature error before the intended negative control; it is not a redaction result. The current ordinary review is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-corrected-hook-and-privacy-probe-ordinary-luna.md`.

## Checks actually performed

- Read-only `git status --short --branch`, exact `git rev-parse HEAD`, source diff/stat, `git diff --check 643bb77..HEAD` (clean), SHA-256 of the current source and private proposed copy, file permission metadata, and a source-to-proposal diff. Read the corrected preparation note and independent ordinary report. I did not read or print private backup-code artifacts or values.
- Inspected installed Playwright 1.63.0 fixture-parameter parser, worker hook/fixture-teardown order, public `TestInfoError.errorContext` type, and artifact recorder's snapshot/error-context path. Existing ordinary collection evidence is 1 focused test and 29 full tests in 11 files; I did not rerun discovery, test, build, database, container, browser, probe, CI or G11.

## Findings

1. **The corrected callback is discoverable and retains the guard.** Playwright's installed `fixtureParameterNames` parser requires object destructuring in the first hook parameter and reads the `page` property from `{ page: _page }`. The changed line fixes the callback-shape error; its loop still replaces `errorContext` on each `testInfo.errors` entry and nested cause with the same fixed note. It does not modify assertion outcomes, messages, stacks, the test's failure status, or global Playwright configuration. The recorded focused/full `--list` results show collection, not execution.
2. **The proposed negative control is correctly positioned.** It waits for the real enrollment acknowledgement button and at least three rendered backup-code list items before reading them. It then adds a random visible `TASKDESK_PRIVACY_CANARY_<UUID>` node while the actual secret list remains on screen, writes only the canary and trimmed codes to `670-privacy-probe-secrets.json` in the fixture's unique private 0700 directory using exclusive create and mode 0600, and throws the literal `Intentional privacy-probe failure after backup codes rendered`. The throw is before acknowledgement and before sign-in, seeding, action calls or the later explicit screenshots. Thus a natural expected exit 1 with the fixed message and source line is the relevant result; an earlier setup/readiness error is a failed probe, not positive redaction evidence.
3. **Artifact path and privacy scope are bounded.** The spec retains `trace: off`, `video: off`, and automatic `screenshot: off`. Playwright runs `afterEach` before test fixture teardown; its recorder skips an automatic ARIA page snapshot if a nonempty error context is present and uses the supplied fixed context in `error-context.md`. The probe does not put the canary or codes into its intentional error message or source line. No new runner, config, dependency, environment flag, upload skip, CI change or production auth/PA behavior is in the proposal. The prior private artifact remains untouched.
4. **Runtime proof has not happened.** The conductor must run exactly the prepared proposal under the existing Playwright config during its exclusive window, preserve the natural failing exit/status/stack, and compare all generated public result artifacts privately against the oracle values without printing them. A matching canary or code in a public artifact, a missing/incorrect oracle, an unexpected error, or an absent natural failure is a failed control. Even a clean negative control proves only this error-context path for this test and Playwright version; it does not establish a blanket no-secret guarantee or full Users workflow acceptance.

No source edit, fixture run, temporary worktree probe copy, or runtime resource was created by this reviewer. This verdict is bound to exact Git head `0469577db3f7d8c7e2c384c922efff4370ac169c` and the proposal digest above. Subsequent source/proposal changes require review at their actual risk tier.
<!-- END REPORT (sha256 f6ce21e7cb6fe624b9cd48081777b89e4d454bd13bd5eaef0ddca6bd2dabaaa0) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-directory-locator-delta-ordinary-luna.md; GPT-6 Luna; sha256 1b9e86868da0999c605936f187007acdd1aa8801fc148a28ddaa3f86888aff9c) -->
# #670 Users directory locator delta — ordinary review

**Model:** GPT-6 Luna  
**Role:** Independent ordinary delta reviewer  
**Independence:** Fresh reviewer context; did not author, direct, or remediate this delta.  
**Comparison base:** `0469577db3f7d8c7e2c384c922efff4370ac169c`  
**Reviewed source head:** `7658fdbe43c75370d60747ee2401f08b965f3ce4`  
**Source SHA-256:** `77aceecd86f988b464e63ba5610614d843c214d97364a2900a554673b9b942dd`

## Scope and checks

The diff changes only the two directory-entry button names in `apps/web/e2e/instance-users-journey.spec.ts`: `Grant instance administrator` → `Grant instance admin`, and `Request person deactivation` → `Deactivate person`. The localized `i18n/en-US.json` values for the directory buttons are exactly `Grant instance admin` (`instanceUsers.copy.d6ac6adb7aa6`) and `Deactivate person` (`instanceUsers.copy.eb3c0567a3f7`). The dialog action values remain exactly `Grant instance administrator` (`instanceUsers.dynamic.actions.grantAdmin`) and `Request person deactivation` (`instanceUsers.dynamic.actions.deactivate`); their submit locators are unchanged. The locale registry identifies `en-US` as the default locale, and the users screen uses the audited directory keys.

Reviewed the complete spec diff and the supplied whole-label audit at `670-users-label-audit-0469577/AUDIT.md`. No other source or assertion changes are in this delta; delayed-proof, route-intent, target, approval, credential, membership, and privacy assertions are unchanged. This addresses the two directory locators only and makes no claim that the prior failed journey passes or that the full workflow is accepted.

Commands run on the reviewed checkout:

- `pnpm exec biome check apps/web/e2e/instance-users-journey.spec.ts` — passed, one file.
- From `apps/web`, `pnpm exec playwright test --list --config playwright.config.ts e2e/instance-users-journey.spec.ts` — passed, one test in one file.
- From `apps/web`, `pnpm exec playwright test --list --config playwright.config.ts` — passed, 29 tests in 11 files.

No test body, browser, build, database, container, or temporary source copy was run or created.

## Verdict

**Clear for ordinary delta review.** No blocking or non-blocking findings in this bounded change. Runtime outcome remains unverified; the earlier timeout evidence remains intact, and this verdict covers locator accuracy only.
<!-- END REPORT (sha256 1b9e86868da0999c605936f187007acdd1aa8801fc148a28ddaa3f86888aff9c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-directory-locator-delta-security-sol.md; GPT-6 Sol; sha256 3bc1127f416cc627f7bd5b9df248ca784f61e98941d23751a962287a83bc7e21) -->
# #670 independent Sol-tier security delta: Users directory locators

**Verdict: CLEAR for exact `0469577db3f7d8c7e2c384c922efff4370ac169c..7658fdbe43c75370d60747ee2401f08b965f3ce4`.** No blocking or non-blocking security finding. This clears only the two locator corrections; it is not evidence that the next real Users journey passes or that earlier failures vanished.

## Provenance and scope

- **Reviewer:** fresh independent Sol-tier context `/root/review670_current_route_g8_sol`; no authoring, direction or remediation of this delta. Platform identity is GPT-6; exact serving variant is not independently displayed in this context.
- **Candidate:** `7658fdbe43c75370d60747ee2401f08b965f3ce4`, clean checkout at review. Only `apps/web/e2e/instance-users-journey.spec.ts` changes; current file SHA-256 is `77aceecd86f988b464e63ba5610614d843c214d97364a2900a554673b9b942dd`. The independent ordinary report is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-directory-locator-delta-ordinary-luna.md`.
- **Previous evidence:** The f388 full product/CI-gate review, 643 privacy source review and 046 corrected-hook/probe preparation review remain bound to their unchanged scopes. The reported 046 negative control's natural intentional failure and private artifact scan are separate runtime evidence; I did not rerun or inspect secret-bearing artifacts. The original f388/046 journey failures remain preserved.

## Checks actually performed

- Read-only `git status --short --branch`, `git rev-parse HEAD`, `git diff --stat`, full one-file diff, SHA-256, and `git diff --check 0469577..HEAD` (clean). A path-limited `git diff --quiet` confirmed no delta in production web/API source, `scripts/ci`, or workflow docs.
- Inspected the canonical `i18n/en-US.json` action strings, the Users screen's directory-button and dialog-title/submit keys, the earlier whole-label audit, and the unchanged journey assertions. The ordinary reviewer reported Biome success and Playwright collection of one focused test / 29 tests in 11 files; I did not rerun either command. No browser, fixture, body, build, database, container, privacy probe or G11 run was performed.

## Findings

1. The two changed locators now select the actual directory buttons: `Grant instance admin` (`instanceUsers:copy.d6ac6adb7aa6`) and `Deactivate person` (`instanceUsers:copy.eb3c0567a3f7`). The dialog continues to use the distinct longer labels `Grant instance administrator` and `Request person deactivation`; its submit locators are unchanged. The correction targets test discovery of an existing UI action, not a production behavior or permission change.
2. The test still requires the real native-admin MFA session, holds a real delayed step-up response, dismisses and changes route intent before releasing it, asserts no stale grant request or role change, requests deactivation as a pending action, requires exact-email/action-bound approval, and checks terminal credential/membership/audit effects. None of those calls, target checks, or oracles changed. No alternate authorization path, weakened assertion, retry, skip, timeout increase, schema change or CI-gate adjustment was introduced.
3. The per-spec `trace/video/automatic screenshot` settings remain off, and the `afterEach` error-context redaction body and fixture-object signature remain byte-identical to 046. The prior privacy negative control, if accepted from its own evidence, demonstrates that earlier guard on that source; this locator edit does not touch the capture or error path. This review does not claim general secret-proof artifact handling or re-run that control.

The next real journey run is still required. A failure after these two corrected locators must be diagnosed from that run, not attributed to this review. Current-head CI and protected merge readiness remain separate gates.
<!-- END REPORT (sha256 3bc1127f416cc627f7bd5b9df248ca784f61e98941d23751a962287a83bc7e21) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-feedback-oracle-delta-ordinary-luna.md; GPT-6 Luna; sha256 1d1f598c639208f9f6339f15ae4049b06091bde90205a0b67a4cc9537013831b) -->
# #670 feedback oracle delta — strong ordinary review

**Model:** GPT-6 Luna  
**Role:** Independent strong ordinary reviewer  
**Independence:** Fresh reviewer context; did not author, direct, or remediate the delta.  
**Comparison base:** `7658fdbe43c75370d60747ee2401f08b965f3ce4`  
**Reviewed source head:** `a2677ffb808d76076606fd73c4886d732f3e0595`  
**Source SHA-256:** `87dc0307b32a71bbee1781bf15e532cb10cb3215d09e7153a71595f498d26517`

## Scope and checks

Reviewed the complete one-file diff in `apps/web/e2e/instance-users-journey.spec.ts`. The old exact whole-text locator is replaced with a `role=status` locator filtered by the complete notice text and a `toContainText` assertion. The test then independently requires the exact-name `Review pending approval` link to be visible and its `href` to equal the `approveUrl` already validated from the HTTP response.

The Users screen renders the success notice and that link together inside the same `role=status` paragraph, and the English dictionary strings match the new expected text and link name. The link points to the `pendingActionUrl` sourced from the response. The source's later route and approval assertions remain present. The diff leaves the 202 response, action/confirmation/pending-ID/URL checks, delayed grant proof and stale-target assertions, database and credential checks, privacy hook, and timeout settings unchanged. The new assertions strengthen the UI oracle by checking both the notice content and the correct approval destination; they do not imply that later workflow steps succeeded.

Reviewed the diagnosis report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/E12/670-current7658-feedback-diagnosis-luna.md` as context and verified its relevant UI rendering claim directly against the current component and dictionary. The diagnosis appropriately labels the cause as likely based on source because no post-action DOM capture was available.

Commands run on this checkout:

- `pnpm exec biome check apps/web/e2e/instance-users-journey.spec.ts` — passed, one file.
- From `apps/web`, `pnpm exec tsc --noEmit -p tsconfig.app.json` and `pnpm exec tsc --noEmit -p tsconfig.node.json` — passed.
- From `apps/web`, focused Playwright `--list` — passed, one test in one file.
- From `apps/web`, full Playwright `--list` — passed, 29 tests in 11 files.

No test body, browser, build, database, container, or temporary source copy was run or created. The three prior runtime failures remain separate evidence; this static review does not establish that the next runtime journey passes.

## Verdict

**Clear for strong ordinary delta review.** No blocking or non-blocking findings in the feedback-oracle change. Runtime behavior remains unverified on this head.
<!-- END REPORT (sha256 1d1f598c639208f9f6339f15ae4049b06091bde90205a0b67a4cc9537013831b) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-feedback-oracle-delta-security-sol.md; GPT-6 Sol; sha256 93cfa7c27e808ed22260e3c4e622d243dbd5eb71234fddf13ec1986870e91289) -->
# #670 independent Sol-tier security delta: deactivation feedback oracle

**Verdict: CLEAR for exact `7658fdbe43c75370d60747ee2401f08b965f3ce4..a2677ffb808d76076606fd73c4886d732f3e0595`.** No blocking or non-blocking security finding. The change corrects a test locator for existing combined status text and link; it does not establish that the current real Users journey passes.

## Provenance and scope

- **Reviewer:** fresh independent Sol-tier context `/root/review670_current_route_g8_sol`; no authoring, direction or remediation of this delta. Platform identity is GPT-6; exact serving variant is not independently displayed in this context.
- **Candidate:** `a2677ffb808d76076606fd73c4886d732f3e0595`, clean checkout when inspected. The only changed file is `apps/web/e2e/instance-users-journey.spec.ts`, SHA-256 `87dc0307b32a71bbee1781bf15e532cb10cb3215d09e7153a71595f498d26517`. Independent strong ordinary report: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-feedback-oracle-delta-ordinary-luna.md`.
- **Prior evidence boundary:** f388 full product/CI-gate security review, 643/046 privacy reviews, the 046 privacy negative-control result as separately recorded, and 7658 locator review remain preserved for their unchanged inputs. The three actual journey failures remain failure evidence; this delta does not turn any into a pass.

## Checks actually performed

- Read-only Git status/head, complete one-file diff/stat, `git diff --check 7658fdbe..HEAD` (clean), current file SHA-256, and path-limited `git diff --quiet` confirming no production web/API source, CI script or workflow-doc change.
- Inspected the Users route's status paragraph, notice/approve-url assignment, canonical `en-US` notice and link strings, server-returned URL validation in the journey, and later unchanged pending-action/approval, credential, membership, delayed-proof and privacy assertions. The ordinary reviewer reported Biome, scoped TypeScript and Playwright collection checks passing; I did not rerun those or any test body, browser, build, database, container, probe or G11 check.

## Findings

1. **The revised UI oracle remains specific.** The earlier `getByText(..., { exact: true })` targeted a whole element even though the product renders the sentence plus a nested link within one `role="status"` paragraph. The new `getByRole("status").filter({hasText: full sentence})` still requires the complete deactivation notice, and `toContainText` confirms it after selection. The additional exact-name `Review pending approval` link must be visible and have an `href` equal to `pending.approveUrl`. That URL was already checked against the exact `pending.pendingActionId` returned by the real `202` response, so another target's link cannot satisfy this assertion. The link is a separate mandatory assertion; the test has not merely dropped the prior feedback check.
2. **No authorization or proof path changed.** The candidate does not modify production UI/API, policy, native-admin checks, route-intent guard, PA-15 binding, pending-action write or approval. The test still checks no stale `grant-admin` POST or role grant after delayed proof, the server-owned `delete`/`user` pending-action response, exact-email approval, credentials and membership retirement, and audit/outbox results. No assertion, timeout, skip, retry, capture or CI-gate threshold was weakened by this delta.
3. **Privacy scope is unchanged.** Per-spec trace/video/automatic screenshot settings and the `afterEach` error-context redaction hook are byte-identical to 7658. The reported earlier expected-failure privacy probe belongs to its own evidence, not this source inspection. This report makes no general no-secret guarantee.

The 7658 failure occurred after the real MFA/delayed-grant/deactivation-request sequence and before the remaining PA approval workflow. Source rendering supports the whole-element mismatch as a likely cause, but no post-action DOM capture established it conclusively. The next real journey run must still exercise the rest of the workflow on this exact head. Current-head CI and merge readiness remain separate.
<!-- END REPORT (sha256 93cfa7c27e808ed22260e3c4e622d243dbd5eb71234fddf13ec1986870e91289) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/E12/670-pending-proof-wire-ordinary-luna.md; GPT-6 Luna; sha256 414962580ab8d7763d7708923dd376f6404f1bbee1004df07a75aa8d230430c5) -->
# #670 pending-action proof wire contract — strong ordinary review

**Model:** GPT-6 Luna  
**Role:** Independent strong ordinary reviewer  
**Independence:** Fresh reviewer context; did not author, direct, or remediate this change.  
**Comparison base:** `a2677ffb808d76076606fd73c4886d732f3e0595`  
**Reviewed source head:** `1c02fb1a605496dcfcb661301e21dc2784b3a077`  
**Risk classification:** Bounded frontend wire-serializer correction for a strict, documented request contract; no authority, policy, or server gate semantics changed. One strong ordinary review and a separate full Sol review are required for this narrow pass/fail case.

## Scope and checks

Reviewed all three changed files. In `apps/web/src/fetchers/pending-actions.ts`, the proof builder explicitly copies `challengeId` and `nonce` from the challenge response and combines those fields with the existing `kind`, `pendingActionId`, method, and credential field. The challenge response schema in `apps/api/src/auth/step-up-api.ts` includes `expiresAt`; the `/step-up` pending-action proof request schema is strict and accepts the method-specific proof fields without `expiresAt`. The correction therefore matches the accepted wire DTO while preserving all existing binding and authentication inputs.

The new `pending-actions.test.ts` exercises password, TOTP, and backup-code proof paths using the real response shape, including `expiresAt`. Its mock rejects any outgoing key set that differs from the strict canonical request, and each case checks the complete serialized body, returned token, and absence of `expiresAt`. The preparation note records a pre-fix negative control where restoring the old spread failed all three cases, followed by all three passing with the corrected serializer. I independently ran the current focused regression: **1 test file, 3 tests passed**.

The E2E delta waits for both the canonical pending-actions page heading and the expected target record heading before capturing the list screenshot. The component and dictionary confirm the page and record labels. The existing source diff preserves the delayed-proof, route-intent, target, pending-action, privacy, and approval assertions. The wire repair makes no API/schema, permission, configuration, dependency, timeout, or product authorization change.

The prior actual journey's HTTP 400 reason was not captured. The source contract and focused negative/positive regression substantiate this narrow serializer fix; this review does not claim the exact cause of that historical runtime response or acceptance of the next full journey.

Commands run on the reviewed checkout:

- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/fetchers/pending-actions.test.ts` — passed, 3 tests.
- `pnpm exec biome check apps/web/src/fetchers/pending-actions.ts apps/web/src/fetchers/pending-actions.test.ts apps/web/e2e/instance-users-journey.spec.ts` — passed, 3 files.
- From `apps/web`, TypeScript checks for `tsconfig.app.json` and `tsconfig.node.json` — passed; direct E2E TypeScript check with `tsc --ignoreConfig` — passed.
- From `apps/web`, Playwright `--list` for the canonical spec — passed, 1 test discovered.
- `git diff --check` — passed.

No canonical journey body, browser, build, database, or container was run. No temporary source copy was created.

## Verdict

**Clear for strong ordinary review.** No blocking or non-blocking findings in this bounded wire-contract repair. The required full independent Sol review remains separate, and runtime acceptance of the full Users journey remains unverified on this head.
<!-- END REPORT (sha256 414962580ab8d7763d7708923dd376f6404f1bbee1004df07a75aa8d230430c5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-pending-proof-wire-security-sol.md; GPT-6 Sol; sha256 55af536249082dae093aa382ee313cae7d4decf7bf1141837e20fcaef65f52b3) -->
# #670 full independent Sol-tier security review — pending-action proof wire

**Verdict: CLEAR for exact `a2677ffb808d76076606fd73c4886d732f3e0595..1c02fb1a605496dcfcb661301e21dc2784b3a077`.** No blocking or non-blocking security finding in this bounded frontend serializer and E2E-readiness change. The current real Users journey, exact-head build/CI and performance gates remain separate, unproven by this review.

## Provenance and risk

- **Reviewer:** fresh independent Sol-tier context `/root/review670_current_route_g8_sol`; I did not author, direct or remediate this candidate. Platform identity is GPT-6; exact serving variant is not independently displayed in this context.
- **Candidate:** `1c02fb1a605496dcfcb661301e21dc2784b3a077`, clean checkout when reviewed. Comparison base `a2677ffb808d76076606fd73c4886d732f3e0595`. Changed files: `apps/web/src/fetchers/pending-actions.ts`, its new focused regression test, and `apps/web/e2e/instance-users-journey.spec.ts`. Independent strong ordinary result: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/E12/670-pending-proof-wire-ordinary-luna.md`.
- **Tier:** narrow, documented client pass/fail serializer correction around a security proof. It does not change core authentication verification, schema, capability, API policy, server trust boundary, expiry window, token binding or authority. Because the serializer decides whether a strict step-up request is accepted, this is a full Sol security pass, not a mere path-based lightweight confirmation. Earlier broad product reviews remain valid for unchanged source only.

## Checks actually performed

- Read exact Git status/head, complete three-file diff/stat, `git diff --check a2677ff..HEAD` (clean), source hashes, repair note, God Mode/PA contract context, server challenge response and strict pending-action proof schemas, pending-action token issuance/expiry check, client request/approval path, and the pending-actions UI heading rendering. No server or CI source changed.
- Independently ran `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/fetchers/pending-actions.test.ts`: 1 file, 3 tests passed, 0 failed. The ordinary reviewer separately reported Biome, TypeScript and focused Playwright collection passes. I did not rerun those, the real E2E body, browser, build, database, container, G11 or current-head CI.
- The author preserved a pre-fix negative control: old `...challenge` behavior gave 3/3 HTTP-400 mock failures; corrected source gave 3/3 passes. I inspected the test and source; my own run verifies only the corrected positive cases, not the temporary old-source execution.

## Security findings

1. **Exact proof DTO is conserved.** The server's challenge response is `{challengeId, nonce, expiresAt}`. Its pending-action proof request is a strict discriminated schema requiring `kind="pending_action"`, `pendingActionId`, `challengeId`, 43-character `nonce`, `method`, and either `password` or `code`; it does not accept `expiresAt`. The old raw spread supplied that extra response field. The new client object copies only `challengeId` and `nonce` in all three password/TOTP/backup-code branches. The binding kind/id, method-specific credential field, request endpoint and returned token remain unchanged. No opaque caller-provided authority field, altered action ID or new token route is introduced.
2. **Server expiry and one-use checks remain server-owned.** Omitting the challenge's display expiry from the proof request does not alter the stored challenge expiry; token issuance still updates only a row in challenge state whose `challengeExpiresAt > now()` under database time. The server still looks up the pending action for the acting person, checks `delete`/`user`/`typed_name_step_up` and the fixed deactivation route, then issues a proof bound to actor person/session/user and pending-action ID. The client cannot extend or select the expiry by this wire change. The later approval request still sends the proof only in `X-TaskDesk-Step-Up-Token` with the typed name; that path is unchanged.
3. **Focused regression matches strict serialization.** Each of three test cases mocks the real challenge response shape including `expiresAt`, rejects any outgoing key set outside the canonical strict DTO with HTTP 400, asserts the full submitted body and returned token, and explicitly checks that `expiresAt` is absent. The test uses a synthetic credential string. It checks all three method branches rather than just one happy path. The current local run passed all three. This validates client serialization, not the original runtime 400's exact server validation reason, which was not captured.
4. **E2E readiness is additive.** The Users journey now waits for the pending-actions page heading and the exact target-record heading before its list screenshot. The product renders that record as `Deactivate person · <target email>`. The wait reduces a screenshot timing race and does not remove the subsequent delayed-proof, route-intent, exact-email approval, credential, grant, membership, audit, event, or privacy assertions. No capture setting or timeout changed.

The prior actual Users run's HTTP 400 remains a real failure with uncaptured reason. Source contradiction and the focused old/new regression support this repair, but only a fresh current-head real journey can establish end-to-end behavior. Earlier G11 failures remain preserved; this delta claims no performance improvement or waiver. No source edit or runtime resource was created by this review.
<!-- END REPORT (sha256 55af536249082dae093aa382ee313cae7d4decf7bf1141837e20fcaef65f52b3) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-809b-e2e-fix-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 6f711e3a28b236a93a57c7c62897d8affea4ae0799895d8da43f44cfe923c3bf) -->
Reviewer model: Claude Sonnet 5.5 (claude-sonnet-5-5)
Context id: fresh independent ordinary-review context (read-only; did not author or direct the change)
**Reviewed head:** 809b593c24a54b7d63eb6e7dc4978c59d1c75d77
Verdict: APPROVE (no blocking findings). Static review only; the real browser run is still the proof.

## Scope
`git diff 1c02fb1a..809b593c`: one file, apps/web/e2e/instance-users-journey.spec.ts, +18/-1. HEAD verified as 809b593c.

## 1. Diagnosis verified against source
- apps/web/playwright.config.ts has no `actionTimeout` and no `expect.timeout` (5 s default). The test sets `test.setTimeout(240_000)` (spec:384). A click on a missing locator therefore waits until the 240 s test timeout. This matches the hosted "Test timeout of 240000ms exceeded".
- `openInstanceUsers` (spec:275-284) clicks `getByRole("button", {name:/Disposable Users Workspace/})`. That button is the workspace switcher, which is only rendered via components/workspace-switcher.tsx -> app-sidebar.tsx -> components/common/layout.tsx.
- The detail route `.../pending-actions/$id.tsx` (lines 98/105/207), the list route `pending-actions.tsx:51` and `god-mode/users.tsx:251` each render a bare `<main>`. `routes/agent/_layout.tsx` and `_authenticated.tsx` only provide an Outlet. No Layout/Sidebar wraps these routes. The only other `openInstanceUsers` call (spec:~417) is from the dashboard, which does have the sidebar.
- Conclusion: the diagnosis is correct. It is a wrong test assumption, not a product defect.

## 2. Fix correctness
- Held proof stays in flight: `page.goBack()` over pushState history is same-document, so `route.fetch()` in `holdNextRealStepUpResponse` stays pending until `remove()` or `release`. Navigation does not abort it.
- History shape traced:
  - dashboard -> users (menuitem push) -> `?user=` pushes from `selectUser` (Links, no replace).
  - The deactivate dialog `action=deactivate` is added via `navigate({replace:true})`. After the 202, `resetAction()` also replaces `action` back to undefined (users.tsx:122-129, 177).
  - Then the "My pending actions" link pushes the list, and "Review" pushes the detail.
  - goBack from the detail goes to the list (URL changed, not users), then to `/agent/god-mode/users?user=<deactivation>`, which matches `usersUrl`. There is no residual `action=` in that entry, so the dialog does not reopen over the page.
  - The "My pending actions" link exists on the Users page (users.tsx:282), so the following click works.
- Route-intent cancellation is still really exercised: leaving the detail unmounts the page and bumps `useIntentLifecycle`. The held 200 is released only afterwards, in `remove()` in `finally`. Still asserted afterwards: `approvalRequests` is `[]` (spec:~636), the person is still active, and the pending_action state is still "pending". The Pending text is visible on the remounted page.
- Fresh-proof approval is untouched and still asserted end to end: backupCodes[2], approve response 200, "Executed", `approvalRequests` has exactly one entry, person deactivated, grant revoked (revocation_reason person_deactivated), membership row gone, pending_action executed, sessions 0 and enabled_keys 0, audit rows present, plus the outbox assertions that follow.
- Bounded loop: at most 8 iterations. Each iteration waits for the URL to change (`expect.poll`, 5 s default) before re-testing. It exits on the first users URL, and the traced path takes exactly 2 steps. If history is unexpectedly shaped, it fails within about 5 s per step, or on the final `toHaveURL`, instead of burning the whole 240 s. It is deterministic. Worst case is 8 x 5 s, which is still well under the test timeout.

## 3. Assertions and timeouts
No assertion removed or loosened. No timeout changed. The only behavioural change is the navigation mechanism, plus a new tightening: `toHaveURL` and the "Instance users" heading are asserted after leaving.

## Findings
- BLOCKING: none.
- NON-BLOCKING 1 (spec:296-311): the helper relies on goBack semantics for TanStack Router pushState history. A same-document `page.goBack()` may resolve with `null` and rely on the poll, which the code already handles. Real-browser confirmation is needed (the author's list in the diagnosis file is right).
- NON-BLOCKING 2: the diagnosis is inferred statically (no CI trace inspected). Anything after `ready=200` first ran on CI, so a different later hang cannot be fully excluded. The next hosted run is the proof.
- NON-BLOCKING 3 (playwright.config.ts): adding an `actionTimeout` (for example 15 s) would make this class of mistake fail fast. It is out of scope for this PR.
- NON-BLOCKING 4: the helper lands on `?user=<deactivation>` rather than a bare `/users`. This is harmless for the following steps.

## Commands run (all read-only)
- `git rev-parse HEAD` -> 809b593c24a54b7d63eb6e7dc4978c59d1c75d77
- `git diff 1c02fb1a..809b593c --stat` / full diff
- `pnpm exec biome ci apps/web/e2e/instance-users-journey.spec.ts` -> Checked 1 file, no fixes, pass
- `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.node.json` -> pass (e2e is not in tsconfig.app or tsconfig.node includes, so this does not cover the spec)
- `cd apps/web && pnpm exec tsc --ignoreConfig --noEmit --skipLibCheck --strict --module esnext --moduleResolution bundler --target es2022 --types node e2e/instance-users-journey.spec.ts` -> pass, no errors
- `pnpm --filter @taskdesk/web exec playwright test --config playwright.config.ts --list e2e/instance-users-journey.spec.ts` -> 1 test listed (instance-users-journey.spec.ts:381)
- Source reads: the spec, playwright.config.ts, users.tsx, pending-actions.tsx, pending-actions/$id.tsx, routes/agent/_layout*.tsx. No file edited, no browser, Docker or DB.

## Not checked
No browser or CI run. Real-browser behaviour of goBack with this router is unverified.
<!-- END REPORT (sha256 6f711e3a28b236a93a57c7c62897d8affea4ae0799895d8da43f44cfe923c3bf) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-809b-e2e-fix-security-opus.md; Claude Opus 5.5; sha256 8ae2ae5bec10d2bed0a7e5e8067fbaae02db2d2a957ad9c15fdd25d876c9b2ed) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:670-809b-e2e-fix-security-opus-2026-10-12
**Reviewed head:** 809b593c24a54b7d63eb6e7dc4978c59d1c75d77
Verdict: CLEAR. There are no blocking findings. This is a static review only; the hosted browser run is still the runtime proof.

Role: an independent Sol-tier security reviewer in a fresh context. I did not author, direct or remediate this change. I worked read-only: I edited nothing, committed nothing, and ran no browser, Docker or database.

## Scope
- Worktree: /Users/heinthura/.codex/worktrees/field-source-conservation/Ticketing.v2. `git rev-parse HEAD` returned 809b593c24a54b7d63eb6e7dc4978c59d1c75d77.
- Comparison base: 1c02fb1a. That is where the prior GPT-6 Sol review returned CLEAR. Delta: `git diff 1c02fb1a..809b593c`.
- Changed files (`git diff --name-only`): only `apps/web/e2e/instance-users-journey.spec.ts` (+18/-1). It contains one commit, 809b593c.
- Surfaces examined:
  - the full delayed-proof test and its helpers (`holdNextRealStepUpResponse`, `openInstanceUsers`, `selectUser`, the new `leavePendingActionToInstanceUsers`);
  - `apps/web/src/routes/agent/_layout/_authenticated/agent/settings/profile/pending-actions/$id.tsx` (`approveAction`, intent capture);
  - `apps/web/src/hooks/use-intent-lifecycle.ts`;
  - `apps/web/src/routes/agent/_layout/_authenticated/agent/god-mode/users.tsx` (`navigateSearch` with `replace: true`, and `resetAction` after the 202);
  - `apps/web/src/fetchers/pending-actions.ts` (the proof POST is `/api/me/step-up`, after `/api/me/step-up/challenges`).
- I also read the prior notes: `670-pending-proof-wire-security-sol.md` (header) and `670-809b-e2e-fix-ordinary-sonnet.md`.

## 1. Route-intent cancellation is still exercised and asserted
Before the fix, the step after the held proof clicked a workspace-switcher button. That button is not on the sidebar-less pending-action detail page, so the run hung until the 240 s test timeout. The fix replaces only that navigation step. Every arming step and every assertion is unchanged:

- **The held request is still in flight when the intent changes.**
  - `holdNextRealStepUpResponse` claims the first `/api/me/step-up` POST. It does `route.fetch()`, resolves `ready` with the real server status, and then waits on `release` before calling `route.fulfill`.
  - The test asserts `ready === 200` before it leaves the page. So the server has issued a valid proof, but the page has not received it.
  - `page.goBack()` over TanStack Router pushState history is a same-document popstate. The app is a Vite SPA with `routeTree.agent.gen.ts`. The held route therefore stays pending.
  - Leaving the detail route unmounts `PendingActionDetailRoute`. The unmount cleanup in `useIntentLifecycle` bumps `generation`. The remount on return is a fresh instance.
  - So the `capturedIntent` held by the in-flight `approveAction` can never be current again, and `if (!isCurrentIntent()) return;` runs before `approve.mutateAsync`.
- **The response is released only after navigating away.** `release` is called only from `delayedApprovalProof.remove()`, in the `finally`. That runs after the helper reaches the Users page and the test has gone back through "My pending actions" → "Review" to the detail page. The ordering is identical to 1c02.
- **The negative assertions are intact:**
  - `expect(approvalRequests).toEqual([])`. This uses a page-level request listener for any POST `/api/me/pending-actions/*/approve`.
  - The person is still active (`getPersonState === true`).
  - `pending_action.state === "pending"` in the database.
  - The "Pending" badge is visible.
- **The new helper adds checks rather than weakening anything.**
  - It is bounded to 8 steps, and each step waits for the URL to change.
  - It ends with `toHaveURL(/\/agent\/god-mode\/users(?:\?|$)/)` and the "Instance users" heading.
  - It cannot pass silently on a wrong page.
  - The history shape is: users `?user=<deactivation>` (the `action=deactivate` param was removed by `resetAction` after the 202 via `replace: true`) → list → detail. Two `goBack` calls land on users with no dialog reopened.

## 1b. The fresh-proof path still binds to the intended target only
The code from `backupCodes[2]` onward is byte-identical to 1c02. It still asserts:
- approve response 200 and "Executed";
- `approvalRequests` is exactly `[/api/me/pending-actions/<id>/approve]`;
- `target_ids` is `[deactivation.id]`, both before and after;
- the person is inactive;
- the grant is revoked with `revocation_reason = person_deactivated`;
- the effective membership row is gone;
- `pending_action` is `executed`;
- `sessions` is 0 and `enabled_keys` is 0;
- the audit rows `pending_action.decided`, `pending_action.executed` and `auth.step_up_issued` exist;
- the outbox has `requested`, `decided` and `executed` events, plus exactly one `identity.deprovisioned` with `sessionsRevoked: 1`, `keysRevoked: 1` and `membershipsEnded: 1`.

The earlier stale-grant block (an obsolete grant proof does not grant admin, `grantRequests` is `[]`, role is null) is also unchanged.

## 2. Secret leakage into artifacts
- `test.use({ trace: "off", video: "off", screenshot: "off" })` is unchanged. There are no automatic failure screenshots, traces or videos.
- The explicit `page.screenshot` calls are unchanged and are all taken before any backup code is typed into the page:
  - users-directory;
  - pending-actions-list;
  - pending-action-detail, captured before `#pending-action-step-up-secret` is filled.
- The new helper takes no screenshot, writes no log and adds no attachment. On failure it only reports URLs and a heading. URLs carry no secret, because proof codes are sent in POST bodies, not query strings.
- One residual point: after `goBack` the remounted detail page is reset by the intent lifecycle (`setSecret("")`). So no stale code remains in the DOM, even if something captured it later.

## 3. Server-side checks and contracts
`git diff --name-only 1c02fb1a..809b593c` lists only the e2e spec. No API, domain, migration, fetcher, route-component, hook, CI or Playwright-config file is touched. The client cancellation logic under test (`use-intent-lifecycle.ts`, `$id.tsx`) is unchanged.

## Findings
- **BLOCKING:** none.
- **NON-BLOCKING 1 (pre-existing; test hardening).** The test cannot distinguish two cases:
  - "same-document navigation, the held proof delivered after the intent changed and was discarded by the client";
  - "document unloaded, the held request aborted".

  In the second case `route.fulfill` throws, the handler swallows the error, and the test still passes. That would be vacuous for the client-cancellation claim, though still safe server-side. The SPA's popstate semantics make the first case what actually happens, and the step it replaced had the same blind spot. A future hardening could do either of these:
  - set a `window` marker before `goBack` and assert it survives;
  - record whether the handler reached `fulfill` or `abort`, and assert it was `fulfill`.
- **NON-BLOCKING 2.** I could not see hosted CI status at 809b593c from this context, because `gh` failed on TLS. The hosted e2e run must be confirmed green on this exact head before merge.
- **NON-BLOCKING 3.** I agree with the ordinary review: setting a Playwright `actionTimeout` would turn this class of missing-locator hang into a fast failure. It is out of scope here.

## Commands run
- `git rev-parse HEAD`; `git log --oneline 1c02fb1a..809b593c`; `git diff --stat` / full diff / `--name-only 1c02fb1a..809b593c`
- `sed`/`grep` reads of the spec, `$id.tsx`, `use-intent-lifecycle.ts`, `users.tsx`, `fetchers/pending-actions.ts` and `apps/web/package.json`
- `gh pr view 670 ...`, which failed with a TLS certificate error, so CI was not observed

## Not checked
- Real-browser execution.
- Hosted CI result at this head.
- Runtime behaviour of `page.goBack()` with this router version.
<!-- END REPORT (sha256 8ae2ae5bec10d2bed0a7e5e8067fbaae02db2d2a957ad9c15fdd25d876c9b2ed) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-8e47-list-refetch-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 3ea2b8119efe1c23453d00aae71290e9e9e4d429cc0ea18a10ab907b75ab9da5) -->
Reviewer model: Claude Sonnet 5.5 (claude-sonnet-5-5)
Context id: fresh Sonnet 5.5 ordinary-review context, PR #670 list-refetch review (2026-10-12); did not author or direct the change
**Reviewed head:** 8e47e787e40c85754d51c33fb8bcc686a432d91c
Delta reviewed: 809b593c..8e47e787 (one commit, 3 files, all under apps/web/src)

## Verdict
APPROVE (ordinary review clear). No BLOCKING findings. Two NON-BLOCKING notes.

## Findings

1. Root cause - CONFIRMED.
   - apps/web/src/query-client/index.ts:75 sets `refetchOnMount: false` in the app default query options.
   - Approve (`pending-actions/$id.tsx:158`, `:193`) and cancel (`pending-actions.tsx:40`) call `invalidateQueries({queryKey:["me","pending-actions"]})`. With the default `refetchType: "active"`, an unmounted (inactive) list is only marked invalidated and not refetched.
   - On remount with `refetchOnMount:false`, TanStack v5 does not refetch even when stale or invalidated. The stale cached first-visit page renders. `staleTime: 0` alone cannot override this.
   - Per-query `refetchOnMount: "always"` overrides the default and refetches on mount regardless of staleness. The analysis is right.

2. Fix minimality and correctness - NON-BLOCKING (clean).
   - Key `["me","pending-actions", cursor ?? null]`, fetcher `getOwnPendingActions(cursor)` and `staleTime: 0` are unchanged. The only added option is `refetchOnMount: "always"`. Pagination is unchanged: each cursor is its own cache entry.
   - Request storms: none. `"always"` fires once per observer mount. There is no polling or interval, and window focus stays off. A first mount with no data does one fetch, not two. The cancel mutation's `invalidateQueries` while the list is mounted still refetches the active query once.
   - Other consumers: a grep for the key shows only the new helper and three `invalidateQueries` calls (list and detail). No badge, count or detail-page `useQuery` shares the key. The detail page uses a different key, so nothing is left inconsistent.
   - `refetchType: "all"` alternative: it would also work, but it eagerly refetches every cached cursor page for the key after each approve or cancel, even if the user never returns. `"always"` is lazy and fetches only on revisit, so it is the better fit. Recommendation: keep `"always"`. Optionally add `refetchType: "all"` to the detail-page invalidations as belt and braces; not needed.

3. Regression test - NON-BLOCKING, non-vacuous.
   - I deleted the `refetchOnMount: "always"` line in a scratch worktree. The test failed with `expected [ { id: 'approved-action' } ] to have a length of +0 but got 1`. I restored the line and it passes.
   - The test uses the app-default `refetchOnMount:false`, an observer subscribe and unsubscribe, an inactive invalidation (asserts no fetch yet), then a re-subscribe that asserts a second fetch.
   - Gap (NON-BLOCKING): the test exercises the helper, not the route component. If `pending-actions.tsx` stopped using `ownPendingActionsQuery` the test would still pass. The hosted e2e covers that wiring. The test also hard-codes the app defaults rather than importing them, so drift is possible but low risk.

4. Server and security - none touched. The diff is three apps/web/src files (new helper, new test, route import swap). No api, db, auth, permission, migration, CI or dependency changes, so this is not in the security-scope path list.

5. Checks - all green (details below).

## Commands run
Scratch `git worktree add --detach` at 8e47e787 under $TMPDIR, node_modules symlinked from the candidate worktree; worktree removed afterwards.
- `git rev-parse HEAD` -> 8e47e787e40c85754d51c33fb8bcc686a432d91c
- `git diff --stat/--patch 809b593c..8e47e787` (read-only)
- grep for `"pending-actions"` query-key consumers in apps/web/src; read query-client/index.ts
- `npx vitest run own-pending-actions-query profile` (apps/web) -> 5 files, 20 tests passed
- Negative control: removed `refetchOnMount: "always"`, `vitest run own-pending-actions-query` -> 1 failed (assertion above); `git checkout` restored
- `npx vitest run` (full web suite) -> 120 files, 497 tests passed
- `npx tsc --noEmit -p tsconfig.app.json` and `-p tsconfig.node.json` -> no errors
- `npx biome check apps/web/src/hooks/queries apps/web/src/routes/agent/_layout/_authenticated/agent/settings/profile` -> 42 files, no findings

## Not checked
- No browser, e2e or runtime run (not permitted). The hosted Playwright journey remains the end-to-end proof of "You have no pending actions."
- Did not run scripts/check-ui-boundaries.mjs or biome over the whole repo.
<!-- END REPORT (sha256 3ea2b8119efe1c23453d00aae71290e9e9e4d429cc0ea18a10ab907b75ab9da5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-8e47-security-rebind-opus.md; Claude Opus 5.5; sha256 b20a4698ea8b0efaaa9ba6b9613c45e28f9845d1726d54e4e5c6bf454a15443d) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:670-8e47-security-rebind-opus-20261012
**Reviewed head:** 8e47e787e40c85754d51c33fb8bcc686a432d91c

**Verdict: CLEAR (no blocking findings).** This is a lightweight exact-head security confirmation. It rebinds the PR #670 security note to 8e47e787.

## Scope

- PR #670, branch `codex/users-pending-ui-selected-20261012`, worktree `/Users/heinthura/.codex/worktrees/field-source-conservation/Ticketing.v2`.
- HEAD verified as `8e47e787e40c85754d51c33fb8bcc686a432d91c`. The working tree was clean (0 entries in `git status --short`).
- Ancestry: `8e47e787` -> parent `809b593c24a54b7d63eb6e7dc4978c59d1c75d77` -> parent `1c02fb1a605496dcfcb661301e21dc2784b3a077`, which is the last GPT-6 Sol clearance. `git log 1c02fb1a..HEAD` shows exactly these two commits.
- 809b593c was already cleared by `670-809b-e2e-fix-security-opus.md` and by a Sonnet ordinary review. Here I examined only the 8e47e787 delta, plus the unchanged e2e spec at 8e47 that serves as the runtime oracle.
- Independence: I did not author, direct or remediate any part of this change.

## Check 1: the diff is client query code plus a unit test — PASS

`git diff --stat 809b593c..8e47e787` touches three files, with 69 lines added and 9 removed:
- `apps/web/src/hooks/queries/own-pending-actions-query.ts` (new)
- `apps/web/src/hooks/queries/own-pending-actions-query.test.ts` (new, a vitest unit test)
- `apps/web/src/routes/agent/_layout/_authenticated/agent/settings/profile/pending-actions.tsx` (switched to the shared query options)

No path outside `apps/web/src/` is touched. Filtering with `grep -Ev '^apps/web/src/'` produced no output. `git diff --quiet 809b593c 8e47e787 -- apps/web/e2e` exited 0, so the e2e directory is unchanged. The commit has no server, API, auth, policy, migration, CI, dependency or e2e change. The detail route `pending-actions/$id.tsx` is also unchanged.

## Check 2: no stale or other-user exposure, and proof controls are not weakened — PASS

- The new `ownPendingActionsQuery(cursor)` keeps the same query key as before, `["me", "pending-actions", cursor ?? null]`. It keeps the same `queryFn`, `getOwnPendingActions(cursor)`, which calls `GET /api/me/pending-actions` through the typed client. It also keeps the same `staleTime: 0`. The only semantic addition is `refetchOnMount: "always"`, which overrides the app default `refetchOnMount: false` in `apps/web/src/query-client/index.ts:75`.
- The server still decides which rows the caller sees, using the session-scoped `/me` endpoint. The client adds no identifier, filter or parameter, so no new path exists to request another user's actions.
- The change makes the list **less** stale. After an approval on the detail page, the list was only invalidated while unmounted. Before this fix it could show cached data containing an executed action as still pending. It now refetches from the server on every mount. In the worst case it shows exactly what the server returns, and the cache key is the same as before, so nothing new is cached.
- Invalidation call sites are unchanged: `pending-actions.tsx:40` and `$id.tsx:158,193` use the `["me","pending-actions"]` prefix.
- The obsolete-proof and fresh-proof controls are untouched. `createPendingActionProof`, the step-up challenge and proof flow, the approve and cancel mutations, the detail route and all server handlers are outside the diff. Refetching a list query does not issue a step-up, approve or grant request.
- The unit test builds the same `refetchOnMount:false` client default. It shows that a list that was invalidated and then remounted triggers a second fetch and shows the new empty data. Without `"always"`, the second fetch would not happen, so the test is not vacuous.

## Check 3: the passing run asserts the security-relevant behaviour — PASS

- `run-summary.txt`: `head 8e47e787e40c85754d51c33fb8bcc686a432d91c dirty=0`, api/web/playwright rc=0, empty container and volume diffs, same-origin `VITE_API_URL=""`.
- `stdout.log`: `✓ 1 e2e/instance-users-journey.spec.ts:381:1 › real Users UI binds delayed proof and approval to its current route intent (13.3s)`, `1 passed (14.8s)`. The 467-byte `stderr.log` contains only Vite config deprecation warnings.
- The spec at 8e47 (identical to 809b) asserts the following:
  - **Stale grant proof:** the step-up response is held until after the user has moved to another user. The test then expects `grantRequests` to equal `[]` and the DB `role` to be `null`, so no obsolete grant fires (lines ~437-460).
  - **Obsolete approval proof:** the approval step-up response is held while the user leaves through history and re-enters through the list. The test then expects `approvalRequests` to equal `[]`, the person still active, `pending_action.state = 'pending'` and the "Pending" badge visible (lines ~615-637).
  - **Fresh proof:** a new backup code and approval give `POST .../approve` = 200, "Executed", exactly one approve request, the person deactivated, the membership retired, sessions and keys revoked, and the audit and event rows present (lines ~639-745).
  - **This fix:** "Back to pending actions" leads to "You have no pending actions." visible (lines 756-762). This is the behaviour 8e47 corrects, and it shows the approved action is no longer listed as pending.

## Findings

- Blocking: none.
- Non-blocking: none.

## Residual risk and what was not checked

- I did not re-run the unit test or Playwright myself, because this review was read-only with no browser, Docker or DB. I relied on the recorded run artifacts, which are bound to the exact head with dirty=0.
- I did not re-review server-side pending-action scoping. It is unchanged in this delta and was covered by earlier Sol clearances.
- Hosted CI status at 8e47 was not checked here.

## Commands run

```
cd /Users/heinthura/.codex/worktrees/field-source-conservation/Ticketing.v2
git rev-parse HEAD
git log --oneline 1c02fb1a..HEAD
git diff --stat 809b593c..8e47e787
git diff --stat 1c02fb1a..809b593c
git status --short
git diff 809b593c..8e47e787
git log -1 --format='%H %P' 8e47e787
git log -1 --format='%H %P' 809b593c
git diff 809b593c..8e47e787 --name-only | grep -Ev '^apps/web/src/'
grep -rn '"pending-actions"' apps/web/src | grep -v test
sed -n 1,80p apps/web/src/fetchers/pending-actions.ts
grep -n 'refetchOnMount\|staleTime' apps/web/src/query-client/index.ts
git show 8e47e787:apps/web/e2e/instance-users-journey.spec.ts | grep -n 'expect\|obsolete\|fresh\|proof\|409\|403\|pending\|goBack\|test('
git diff --quiet 809b593c 8e47e787 -- apps/web/e2e
git show 8e47e787:apps/web/e2e/instance-users-journey.spec.ts | sed -n 395,460p / 598,662p / 748,767p
git diff 809b593c..8e47e787 -- 'apps/web/src/routes/**/$id.tsx' | wc -l
git branch --show-current
ls -la /Users/heinthura/.codex/taskdesk-evidence/2026-10-12 | grep 670
cat .../670-real-users-playwright-8e47e787-claude/run-summary.txt
cat .../670-real-users-playwright-8e47e787-claude/stdout.log
wc -c / tail -3 .../670-real-users-playwright-8e47e787-claude/stderr.log
ls .../670-real-users-playwright-8e47e787-claude/output
```
<!-- END REPORT (sha256 b20a4698ea8b0efaaa9ba6b9613c45e28f9845d1726d54e4e5c6bf454a15443d) -->


<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-80ba-5522-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 c0d688101472d2962f2a351c5b6e4453069ec5b0e86173e7c418f7e5d567e5ff) -->
# PR #670 ordinary review, 80ba782f..55227706

Reviewer model: Claude Sonnet (fresh independent ordinary-review context)
**Reviewed head:** 552277064d6e09b41157b14afc431928f24bff7b
Base (last reviewed head): 80ba782faff9227669b287f91a0041b7bc48133d
Read-only review; no edits, commits or pushes.

## Range
First-parent: 55227706 (merge main), 96eb95ff, 95c2f816, 0faedd7a, 9ec008b7.
Merge 55227706 parents: 96eb95ff + d86d3089 (origin/main). `git merge-base --is-ancestor d86d3089 HEAD` true.
`git diff 96eb95ff 55227706 --stat`: only main's #668 files (sign-in/sign-up forms+tests, ui input.tsx, pairs.json, snapshots, two evidence notes). No touch to users.tsx, pending-actions*.tsx, own-pending-actions-query.ts. Clean, no semantic conflict.

## Files examined
users.tsx, users.test.tsx, pending-actions.tsx, pending-actions/$id.tsx and its test, own-pending-actions-query.test.ts, packages/ui table.tsx and select.tsx, docs/02-design/accessibility.md (Zoom and reflow).

## Commands and results
- `pnpm check:i18n`: all locales in sync with en-US (OK). The 8 keys used (copy.a4730a22cf49, 0e85749a6f40, ec137488beec, 274e10cde2d6, c51407d28beb, 6405179d241b, 2a8367498e23, 2908b4e9c428) are all already used by the adjacent SelectItems; no new keys introduced.
- vitest (apps/web config; needed sandbox off because vite writes .vite-temp): users.test.tsx, pending-actions/$id.test.tsx, own-pending-actions-query.test.ts: 3 files passed, 14 tests passed, 0 failed.
- `pnpm typecheck` (tsc app + node): clean, exit 0.
- Worktree has an untracked `apps/web/e2e/zz-users-ui-acceptance-probe.spec.ts` (not in the PR; make sure it is not committed).

## Analysis
Responsive/classes: `max-sm:hidden` (Tailwind v4, display:none below 640px) on both TableHead and TableCell for Type and Organisation, consistently, so column count stays aligned. The repeated "Type · Organisation" span is `sm:hidden`, so it is shown exactly when the columns are hidden: no information lost, no duplicate at either width. TableCell default `whitespace-nowrap` is overridden by `whitespace-normal` on the first and status cells; link `block min-w-0 max-w-full` plus `break-all` on the email and `break-words` on the name is the right set to let content shrink.
Accessibility: display:none removes th and td together from the a11y tree, so table semantics are intact; the repeated text is outside the link (link name unaffected) and never co-visible with the columns, so no screen-reader duplication. `aria-busy="true"` on the loading `<main>` is a valid global attribute and is correctly applied only while loading. Matches accessibility.md "Zoom and reflow" (no horizontal scroll at 320 px, no content lost). The `overflow-x-auto` wrapper is retained as a fallback.
SelectValue: ui Select is Base UI (`Select.Value.Props`), which accepts children, so the explicit label is valid. Each ternary mirrors its SelectItem label keys exactly.

## Test-to-fix mapping (what fails on revert)
- Select labels (users filters + step-up in users.tsx): "shows the filter and step-up labels..." fails (textContent would be raw `all` / `totp`).
- Link block/min-w-0/max-w-full, td whitespace-normal, email break-all (9ec008b7): "keeps directory row links shrinkable..." fails on each.
- Hidden Type/Org cells (0faedd7a): same test, `max-sm:hidden` td count of 4 fails if reverted.
- Loading skeleton w-full + aria-busy (95c2f816): "renders the loading skeleton in a full-width main" fails.
- Not covered: step-up select in pending-actions/$id.tsx (no test references step-up/totp/backup_code); `max-sm:hidden` on the TableHead cells; the `sm:hidden` repeated span; `w-full` on the list `main` in pending-actions.tsx and on the error/loaded `main` in $id.tsx. The class-contract tests are jsdom-only; real layout was verified by the author's browser probe, which I did not re-run (no browsers per instructions).

## Findings
Blocking: none.

Non-blocking:
1. pending-actions/$id.tsx ~316-320: step-up SelectValue fix has no test (confirmed by grep). Same defect class as the users.tsx step-up fix that is tested. Suggest a small test or accept as residual.
2. users.test.tsx new class test asserts td hidden count but not the th headers or the `sm:hidden` fallback span; a revert of the header classes or removal of the span would pass. Suggest also asserting 2 hidden th and the sm:hidden span text.
3. users.tsx first cell: TableCell default `leading-none` is inherited by the user-name span (no text-size class), so a wrapped long name has line-height 1 at 375 px. Cosmetic; consider `leading-snug` on the name span.
4. Loading `<main aria-busy>` has no accessible status/label, so AT users get no loading announcement; pre-existing pattern, optional improvement.
5. SelectValue ternaries duplicate the item label mapping (drift risk if an option is added); optional refactor to an options map.

## Residual risk
No real-browser or visual run by me; responsive correctness inferred from classes and the existing tests. Dynamic `side` values beyond the existing keys are handled by the same i18n dynamic keys as the desktop cell.

Verdict: APPROVE
<!-- END REPORT (sha256 c0d688101472d2962f2a351c5b6e4453069ec5b0e86173e7c418f7e5d567e5ff) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-5522-security-rebind-opus.md; Claude Opus 5.5; sha256 f8b91619c6d627c5528e188e080db3348e667ba261df77e73ffe0c118536435c) -->
# PR #670 security rebind review — 80ba782f..55227706

- **Reviewer model:** Claude Opus 5.5 (fresh independent security-review context)
- **Role:** security rebind-depth confirmation of the delta since the prior Opus clearance. The reviewer did not author, direct or remediate any of this code. Read-only review: no source, PR or queue edits.
- **Candidate SHA:** `552277064d6e09b41157b14afc431928f24bff7b` (confirmed with `git rev-parse HEAD` in `/Users/heinthura/.codex/worktrees/field-source-conservation/Ticketing.v2`)
- **Comparison base:** `80ba782faff9227669b287f91a0041b7bc48133d` (prior Opus CLEAR head)
- **Merge parents:** `96eb95ff` (PR side) + `d86d3089` (origin/main, #668); merge base `f93e3317`

**Reviewed head:** `552277064d6e09b41157b14afc431928f24bff7b`

## Delta examined

First-parent commits: `9ec008b7`, `0faedd7a` (Users directory at 375 px), `95c2f816` (detail skeleton `w-full`, `aria-busy`), `96eb95ff` (SelectValue labels), `55227706` (merge of main `d86d3089`).

PR-side changed files (80ba782f..HEAD^1): `users.tsx`, `users.test.tsx`, `pending-actions.tsx`, `pending-actions/$id.tsx`, `pending-actions/$id.test.tsx`. No change under `apps/api`, `packages/domain`, `packages/db`, `apps/web/src/fetchers` or `apps/web/src/hooks` in the whole range 80ba782f..55227706.

Main-side changed files (f93e3317..d86d3089): `sign-in-form.tsx`, `sign-up-form.tsx` (+tests), `packages/ui/src/components/input.tsx`, `packages/ui/src/styles/pairs.json`, two visual snapshots, two #668 review notes. `git diff-tree --cc HEAD` shows the only file with a combined resolution is `packages/ui/src/styles/pairs.json` (a generated contrast-pair index; the merge kept both sides' entries).

## Surfaces checked

1. **Step-up method selection semantics** (`users.tsx:878-898`, `pending-actions/$id.tsx:304-329`). The change only adds children to `<SelectValue>`. `Select value={method}` and `onValueChange` (which still coerces to `"backup_code"` or `"totp"`) are unchanged. The submitted value is still the `method` state (`users.tsx:158,186,197`) or `effectiveMethod` (`$id.tsx:136,143`), and that state is set only by `onValueChange` or the factor effect. The label is derived from that same state, so a label change cannot alter the submitted value. The label keys `2908b4e9c428` (TOTP) and `2a8367498e23` (backup code) match the corresponding `SelectItem` children exactly.
2. **Pending-action approve and cancel flows** (`$id.tsx:130-200`). These are byte-identical to the base apart from `w-full` on the `<main>` elements and `aria-busy="true"` on the loading `<main>`. The typed-email guard, the contract checks (`isDeactivationContract` / `isClickContract`), `createPendingActionProof`, the intent-lifecycle capture/isCurrent checks and the cancel path are all unchanged. The loading branch renders no form and no action controls.
3. **Narrow-width disclosure** (`users.tsx:467-479`). The new `sm:hidden` span renders `user.person?.side` (through the same i18n keys) and `user.person?.organisationName ?? "—"` from the same `user` row object. Those are the same fields already rendered in the now `max-sm:hidden` Type and Organisation cells (`users.tsx:481-489`) for the same viewer and the same directory query. No new field, query or permission path is introduced. CSS visibility is not an access control in either direction: the data was already in the DOM.
4. **Obsolete-proof and fresh-proof rules.** `useIntentLifecycle` usage, the `godModeUserActionBinding` intent check (`users.tsx:139-141`), the `isCurrentOperation()` checks after each proof, secret clearing on intent change, and `$id.tsx`'s `isCurrentIntent` checks are untouched by the delta. The existing tests for stale proofs, A→B→A, Back-restored context, unmount and cancel/reopen all pass (see below).
5. **Main merge (#668) interaction.** In `sign-in-form.tsx` and `sign-up-form.tsx`, `<FormControl>` now wraps only the `<Input>` instead of the wrapper `div` (the show-password button moves outside it). This changes label/aria association only. Field binding (`{...field}`), `type`, `autoComplete` and submit handlers are unchanged. In `input.tsx`, one Tailwind selector changes from `[aria-invalid]` to `[aria-invalid=true]`; this is styling only. None of these files is imported by the Users or pending-action routes' proof or approval logic. There is no semantic conflict with #670's step-up or pending-action proof handling, and no API path changed on either side.

## Tests run (at 55227706)

Web (`apps/web`, `vitest run --config vitest.config.ts`): **6 files, 19 tests, all passed**
- `god-mode/users.test.tsx` — 6 (including the stale-proof, Back-restore, unmount and cancel/reopen proof invalidation tests, and the new label and 375 px tests)
- `settings/profile/pending-actions/$id.test.tsx` — 7 (including A→B→A no-approve, stale proof error suppression, no completion into a returned context, delayed cancel, post-unmount no-submit, click-contract empty body, and the new skeleton test)
- `hooks/queries/own-pending-actions-query.test.ts` — 1
- `fetchers/pending-actions.test.ts` — 3 (proof copies only challenge ID and nonce for password, totp and backup_code)
- `components/auth/sign-in-form.test.tsx` — 1; `components/auth/sign-up-form.test.tsx` — 1 (from the main merge)

API without Postgres (`apps/api`, `vitest run --config vitest.config.ts`): **3 files, 21 tests, all passed**
- `tests/api/pending-action-approval-contract.test.ts`, `tests/api/pending-action-payload.test.ts`, `tests/api/scheduler/pending-action-expire-schedule.test.ts`

The Postgres-backed `tests/api-integration/pending-action*` suites were not run. The API is unchanged in this delta.

Note: vitest had to run outside the command sandbox, because the sandbox denies writes to the worktree's `node_modules/.vite-temp`. No source files were written.

## Findings

**Blocking:** none.

**Non-blocking:**
1. `users.tsx:885-889` (and the same pattern at `pending-actions/$id.tsx:316-320`): the trigger label maps every value other than `backup_code` to the TOTP label. When the factor is enabled, `method` can briefly still be `"password"` (its initial state) until the factor effect runs (`users.tsx:115-119`, `$id.tsx:84-86`). During that window the trigger would show "authenticator code" while the state is `password`. This is not exploitable: the window is a single commit before the effect, it needs no user action, and a mismatched method/secret pair fails closed at the proof endpoint. `$id.tsx` also submits `effectiveMethod`. An exhaustive label lookup (label from an options map, with no default branch) would remove the ambiguity.
2. `pending-actions/$id.tsx:316-320`: the step-up `SelectValue` label has no test. The equivalent `users.tsx` change is tested at `users.test.tsx:~305-307`. The ordinary review already noted this; I agree it is test-coverage residual, not a security defect.

## Residual risk

- No browser, visual or Postgres-integration run, by instruction. Responsive behaviour is inferred from classes and jsdom tests.
- `pairs.json` merge resolution was inspected only at the hunk level. It is a generated contrast index with no runtime security effect.
- Review depth is rebind-only. Surfaces outside the delta rely on the prior clearances recorded in `docs/07-planning/security-reviews/670-users-pending-ui.md`.

I read the ordinary Sonnet review (`670-80ba-5522-ordinary-sonnet.md`) only after forming the conclusions above. Its findings are consistent with them.

Verdict: CLEAR
<!-- END REPORT (sha256 f8b91619c6d627c5528e188e080db3348e667ba261df77e73ffe0c118536435c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-5522-c5cc-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 13991dea0ae8e610db5eccdaeb43d2d5f0848f417410fd19b8f80e8cb15dfdc1) -->
# PR #670 ordinary review (5522..c5cc)

Reviewer model: Claude Sonnet (fresh independent ordinary-review context)
**Reviewed head:** c5ccfe58458077c4882937799dfc39010c285145
Base: 552277064d6e09b41157b14afc431928f24bff7b
Mode: read-only (no edits/commits; no browser/Docker)

## Files examined
- apps/web/src/routes/agent/_layout/_authenticated/agent/god-mode/users.tsx (main at :251; meta-line span at :471)
- .../god-mode/users.test.tsx (new assertion ~:315-318)
- packages/ui/src/styles/pairs.json (diff)
- 3 PNGs in apps/web/e2e/visual.spec.ts-snapshots/ (viewed)
- apps/web/src/routes/agent/_layout.tsx (shell); pending-actions.tsx / $id.tsx at 95c2f816 for consistency

## Commands and results
- git rev-parse HEAD -> c5ccfe58458077c4882937799dfc39010c285145
- git log 55227706..HEAD -> 3 commits (4275cf23, ef876b86, c5ccfe58) as claimed
- git diff --stat -- apps/web/e2e -> exactly 3 PNGs (instance-users-directory, pending-action-detail, pending-actions-list). No other snapshot changed.
- vitest run users.test.tsx (web config; needed sandbox off for .vite-temp write) -> 1 file, 6/6 tests passed.
- pnpm check:tokens (rebuilds web dist) -> "check:contrast: 418 declared, source-grounded pairs meet thresholds in light/dark built CSS." Pass. Worktree clean afterwards except pre-existing untracked probe (see N2).

## Findings
1. Correctness of w-full (users.tsx:251): only class change is adding w-full. Route <main> sits in a flex shell (_layout renders Outlet + sibling launcher); flex items default flex-shrink:1, so w-full is a width basis that still shrinks beside a sidebar or at narrow widths; no overflow risk introduced. Identical pattern to pending-actions.tsx:45 and $id.tsx:207 from 95c2f816. Consistent. Not blocking.
2. pairs.json: pure addition (+26 lines): one occurrence id in each of two occurrence lists, plus two identical new entries (span[0] ... text-muted-foreground#0, surfaceContext imported-opaque-wrapper, category body, chain through Card>bg-card). No thresholds/categories of existing entries changed. The id matches the span at users.tsx:471. check:contrast passes with 418 pairs. Not blocking.
3. PNGs: instance-users-directory shows title row with Refresh at far right (page full width), filters, one row "Taylor Staff / taylor@example.test", Type "Staff", Org "—"; labels, not raw enum values. Status cell empty because the fixture user has no admin/suspended badge (badges render only for those) - expected. pending-actions-list shows "Deactivate person · casey.staff@example.test", "Requested from API; expires 1 Oct 2026, 12:15", Review/Cancel at right edge (full width); labels not raw keys. pending-action-detail shows Action "Deactivate person", Status "Pending", full-width card, labelled inputs. All as intended. Not blocking.
4. Test non-vacuous: `document.querySelector("main")?.className` toMatch /\bw-full\b/ fails if class removed. Class-assertion only, not a layout/CLS measure (CLS 0.28 -> 0 rests on the author's browser measurement and G13/G8 e2e, which I did not run). Same style as existing $id.test.tsx assertion. Acceptable.

Non-blocking notes:
- N1: In the directory screenshot the results Card is ~750px wide while the page is 1280px (card not stretched; filter row ~1060px). Presumably pre-existing/intentional; "full-width" holds for <main>/header, not the card. Confirm it is the design.
- N2: Untracked apps/web/e2e/zz-users-ui-acceptance-probe.spec.ts exists in the worktree (not in the commits). Ensure it is not staged/pushed.

## Residual risk
- Did not run Playwright/CLS measurement or regenerate/compare PNGs (browsers disallowed); Linux baselines judged visually only. Narrow-width (375px) behavior of w-full inferred from flex semantics, not measured. Other route mains without w-full (e.g. god-mode/observability.tsx, settings/account/security.tsx) may shrink-wrap similarly; out of scope.

Verdict: APPROVE
<!-- END REPORT (sha256 13991dea0ae8e610db5eccdaeb43d2d5f0848f417410fd19b8f80e8cb15dfdc1) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/670-c5cc-security-rebind-opus.md; Claude Opus 5.5; sha256 430b362062683b238646317cc09dd0f5ba4c7e163392dc4c4f9cec1e52baaf99) -->
# PR #670 security rebind (55227706..c5ccfe58)

Reviewer model: Claude Opus 5.5 (fresh independent security-review context)
Depth: rebind confirmation. Read-only: no edits, commits, browsers or Docker.

- Candidate head: `c5ccfe58458077c4882937799dfc39010c285145`. Confirmed with `git rev-parse HEAD`.
- Comparison base: `552277064d6e09b41157b14afc431928f24bff7b`, the head of the prior CLEAR Opus rebind (`670-5522-security-rebind-opus.md`).
- Merge base with local `origin/main`: `d86d3089636c1ade443a20b04e1212e4a72f42d1`. This is informational; the local ref may be stale.
- Commits in the range: 4275cf23 (`w-full` on the Users `<main>`), ef876b86 (pairs.json manifest occurrence), c5ccfe58 (Linux baseline PNGs).

## Surfaces examined
`git diff --stat 55227706..HEAD` shows exactly 6 files:
- `apps/web/src/routes/agent/_layout/_authenticated/agent/god-mode/users.tsx`: 1 line changed. The `<main>` className gains `w-full`. There is no logic, data, fetcher, mutation, guard or capability change.
- `.../god-mode/users.test.tsx`: +4 lines. One assertion that `<main>` className matches `/\bw-full\b/`. If the class is removed, the assertion fails.
- `packages/ui/src/styles/pairs.json`: +26 lines and 0 deletions. The JSON parses. The change is one occurrence id added to each of the two occurrence lists, plus two matching pair entries for `InstanceUsersPage::.../TableCell[0]/span[0]::text-muted-foreground#0`. That id maps to the mobile meta-line span at `users.tsx:471`. The change is manifest-only, and no existing entry or threshold is altered.
- 3 PNGs in `apps/web/e2e/visual.spec.ts-snapshots/`: `instance-users-directory-linux.png`, `pending-action-detail-linux.png` and `pending-actions-list-linux.png`.

The delta touches no auth, policy, API, fetcher, query-hook, proof, migration, CI or dependency file.

### PNG content check (opened and viewed)
- **instance-users-directory:** one fixture row, "Taylor Staff / taylor@example.test", type Staff, organisation "—". It also shows the filter controls and empty input placeholders.
- **pending-actions-list:** "Deactivate person · casey.staff@example.test", an "api" badge, a fixed expiry of 1 Oct 2026 12:15, and Review/Cancel buttons.
- **pending-action-detail:** action, target `casey.staff@example.test`, Pending status, and the consequence copy. The "Type the exact current email" field and the "Account password" field are **empty**. The visible email hint is the fixture target. The submit button is disabled.

No secrets, tokens, passwords, API keys, session ids, internal hostnames or real personal data appear. All identities use the reserved `example.test` domain.

## Tests run (apps/web vitest; sandbox lifted only so vitest could write its `.vite-temp` config)
| File | Tests |
| --- | --- |
| `src/routes/agent/_layout/_authenticated/agent/god-mode/users.test.tsx` | 6 passed |
| `src/routes/agent/_layout/_authenticated/agent/settings/profile/pending-actions/$id.test.tsx` | 7 passed |
| `src/hooks/queries/own-pending-actions-query.test.ts` | 1 passed |
| **Total** | **3 files, 14 tests, 0 failed** |

## Findings
- **Blocking:** none.
- **Non-blocking N1:** an untracked file, `apps/web/e2e/zz-users-ui-acceptance-probe.spec.ts`, is in the worktree. It is not in any commit in the range. Make sure it is not staged or pushed. It was not reviewed.
- **Non-blocking N2:** the `w-full` test checks the class name only. The CLS improvement rests on the author's browser measurement and the G8/G13 e2e. This is a quality concern, not a security one.

## Residual risk
- I did not run Playwright, the visual comparison or the contrast check (`pnpm check:tokens`). The ordinary review reports that the contrast check passes with 418 pairs.
- I judged the PNGs visually only.
- I relied on the prior Opus CLEAR at 55227706 for all surfaces outside this delta. I did not re-review the auth or proof flow.

I formed this view before reading the ordinary Sonnet review. That review agrees with it.

**Reviewed head:** `c5ccfe58458077c4882937799dfc39010c285145`

Verdict: CLEAR
<!-- END REPORT (sha256 430b362062683b238646317cc09dd0f5ba4c7e163392dc4c4f9cec1e52baaf99) -->
