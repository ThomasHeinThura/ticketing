# Query ownership: identity and instance-user materialization review record

This note preserves the three independent source-review reports verbatim. Source references identify the retained artifact and its first line; the private manifest records exact input bytes, hashes, output byte ranges, and the final note hash.

## Ordinary review A

Source artifact: `identity-users-de4e-ordinary-a-luna.md:1` · SHA-256: `e349fb28a3f9b0b89462eb2e93c4473a32269134c7d43c5607277702e95c49ee`

**Reviewed head:** `de4e3433fc6822b126da06d1e3821b381a964016`

<!-- BEGIN VERBATIM SOURCE REPORT: identity-users-de4e-ordinary-a-luna.md -->
# #580 identity/users materialization — ordinary review A

- Verdict: **CLEAR for the inspected source scope**, with verification limits below. This is review evidence only; it does not accept #580 or authorize integration/merge.
- Candidate reviewed: `de4e3433fc6822b126da06d1e3821b381a964016`.
- Accepted main named for this composition: `fe063765774b73587488b753c91c6477653662cc`.
- Candidate worktree: `/Users/heinthura/.codex/worktrees/remaining580-identity-users-materialization-luna`.
- Independence: fresh reviewer context; I did not author, direct, or remediate the candidate. Requested tier/model: GPT-6 Luna. The serving-model fingerprint was not independently available for verification.
- Scope checked: exact two-file change, query materialization and preservation, caller/re-export/alias exposure, transaction/executor and lock preservation, and the four follow-up OIDC helpers. I read the accepted workflow and coding-standard query-ownership contract.

## Findings

No blocking source finding. The diff changes only `apps/api/src/identity/repository.ts` and `apps/api/src/instance/users/repository.ts`. It converts 73 identity and 13 instance-user select-builder helpers to `async` functions returning `await` of the same complete query chain. Existing projections, predicates, joins, order, limits, executor handles, and row-lock clauses remain in the query expressions; no caller composition or transaction relocation was found. Direct callers already await these results. The four helpers added in the follow-up (`getOidcIdentityForSignIn`, `findOidcIdentityForClosure`, `listActiveOidcGrantsForSignIn`, `listAdmissionFailedOidcGrants`) each have one direct awaited call in `identity/oidc-login.ts`, within the same transaction callback and with the same `tx`. `lockInstanceAdminSerialization` is correctly excluded and remains synchronous, returning its existing `executor.execute(...)` result.

The supplied conservation record binds this exact source and reports all 3,405 entries, with exactly the two owned paths changed and all other entries identical to named main. The source worktree is clean. This is consistent with the observed diff/status.

## Verification and limits

- Inspected the complete base-to-candidate diff and the two final repository files; checked the ordinary source call sites and follow-up OIDC calls with textual search.
- Root-provided `pnpm --filter @taskdesk/api typecheck` receipt is bound to this candidate SHA but has `nativeExit: 1`. Its log shows missing workspace/dependency modules (including `drizzle-orm` and Hono), causing cascading implicit-any diagnostics. This is an environment/setup failure, not a successful typecheck and not evidence of a candidate-specific type error.
- No tests, PostgreSQL, Docker, browser, inventory runtime, or package installation was run by this reviewer. Behavioral and compile verification remain open for the conductor's reserved verification window.
- This verdict is limited to source inspection and cannot replace the second independent ordinary review, the separate auth/lock/security review tier (full GPT-6 Sol required by the task assignment), exact-head CI, or acceptance evidence.

<!-- END VERBATIM SOURCE REPORT: identity-users-de4e-ordinary-a-luna.md -->

## Ordinary review B

Source artifact: `identity-users-de4e-ordinary-b-luna.md:1` · SHA-256: `e8cfeab2bbd775627e63c584822131ada601f7960b85e8afd5a2662bf0ca96d1`

**Reviewed head:** `de4e3433fc6822b126da06d1e3821b381a964016`

<!-- BEGIN VERBATIM SOURCE REPORT: identity-users-de4e-ordinary-b-luna.md -->
# #580 identity/users materialization — ordinary review B

- **Verdict:** CLEAR for the inspected source scope; no blocking or non-blocking source findings.
- **Candidate:** `de4e3433fc6822b126da06d1e3821b381a964016`.
- **Comparison base:** accepted main `fe063765774b73587488b753c91c6477653662cc`.
- **Independence:** fresh reviewer context; I did not author, direct, or remediate this candidate. Requested reviewer tier/model: GPT-6 Luna. The serving-model fingerprint was not independently available for verification.
- **Scope:** complete two-file product diff, query-chain preservation, identity/OIDC/SCIM and instance-user callers, transaction/executor/lock seams, and the relevant query-ownership contract.

## Checks performed

- Confirmed the checkout is at the exact candidate SHA and clean, and that `fe063765` is its parent/base.
- Inspected the full `fe063765..de4e3433` diff. It changes only `apps/api/src/identity/repository.ts` and `apps/api/src/instance/users/repository.ts`; the conversion is the targeted `function` → `async function` and `return` → `return await` change around existing select chains. The 86 reads are 73 identity and 13 instance-user helpers. No changed query predicates, projections, joins, ordering, limits, conflict clauses, lock clauses, SQL fragments, or executor arguments were found.
- Followed the four later OIDC helpers (`getOidcIdentityForSignIn`, `findOidcIdentityForClosure`, `listActiveOidcGrantsForSignIn`, `listAdmissionFailedOidcGrants`) to their single callers in `identity/oidc-login.ts`: each call is already awaited inside the existing transaction callback and passes the same `tx`. Their filters, projections/order and `FOR UPDATE` clauses remain present.
- Reviewed the identity and instance-user admin/SCIM/OIDC use sites with textual search. No caller-side builder composition or new re-export/alias was found. Existing transaction callbacks, retry wrappers, lock ordering and transaction ownership remain in their original callers. `lockInstanceAdminSerialization` remains excluded and synchronous.
- Checked the supplied exact-tree conservation receipt: it binds this SHA and base, reports 3,405 entries, and says the two owned mode/type/blob entries are the only differences. This is consistent with the checkout diff and clean status.
- Read `docs/04-engineering/coding-standards.md` query ownership requirements and the repository workflow/mission guidance. The inspected changes satisfy the await-and-materialize boundary by source inspection.

## Verification limits and retained adverse evidence

No tests, typecheck/compiler, PostgreSQL, Docker, browser/runtime, or inventory runtime were run in this reviewer context. The root-provided API typecheck receipt is bound to the exact candidate but records native exit 1; it is not a pass. The retained installation receipt also records native exit 1 before a usable isolated dependency installation. Per the handoff, the fresh worktree dependency setup and root-reserved heavy verification window remain unresolved, so no product-specific type error can be inferred from the typecheck failure and no compile/runtime behavior is verified here. These adverse facts remain open for the conductor to resolve; this review does not claim a test pass or accept #580/check:queries.

This verdict covers only source inspection at the exact candidate SHA. It is one ordinary review and does not replace the second independent ordinary review, the required full independent GPT-6 Sol security review, exact-head CI, runtime verification, or acceptance.

<!-- END VERBATIM SOURCE REPORT: identity-users-de4e-ordinary-b-luna.md -->

## Full independent security review

Source artifact: `identity-users-de4e-full-security-61-sol.md:1` · SHA-256: `3a38cce988d05b74e55d276021fc33daf5329fbfe3569131700a411bbb3119b1`

**Reviewed head:** `de4e3433fc6822b126da06d1e3821b381a964016`

<!-- BEGIN VERBATIM SOURCE REPORT: identity-users-de4e-full-security-61-sol.md -->
# #580 identity/users materialization — full independent security review

**Verdict:** CLEAR for the exact source scope reviewed. No blocking or non-blocking source findings were identified. This is a full security source review, not merge approval, #580 closure, stage closure, check:queries acceptance, or runtime/SIT acceptance.

**Reviewed head:** de4e3433fc6822b126da06d1e3821b381a964016

**Comparison base:** accepted main `fe063765774b73587488b753c91c6477653662cc`.

**Source worktree:** `/Users/heinthura/.codex/worktrees/remaining580-identity-users-materialization-luna`.

**Reviewer/context:** `/root/identity_users_de4e_full_security_sol`, a fresh independent reviewer context. I did not author, direct, or remediate this candidate. The requested dispatch was `gpt-6.1-sol`, reasoning effort `high`, `fork_turns=none`, as specified in the assignment. The serving model/version fingerprint was not independently exposed or verified in this context; the requested selector is recorded as dispatch provenance, not a serving-identity attestation.

**Review sequence:** I read the supplied ordinary A and B reports at `identity-users-de4e-ordinary-a-luna.md` and `identity-users-de4e-ordinary-b-luna.md`; both record source CLEAR for this head, with their verification limits. Their authenticity/dispatch provenance is the conductor's responsibility, and the assignment identifies both as verified. I independently checked source rather than treating their findings as proof.

## Scope and actual checks

I read the accepted AGENTS, active mission, workflow/review requirements, provider adapter, CI/CD security scope, query-ownership coding standard and shared Executor contract. The candidate changes none of these accepted files. I read the relevant identity-provisioning contracts (IP-1–3, IP-7–10, IP-22 lock/closure rules, IP-26–27 and IP-34), identity architecture and administrator/step-up RBAC contracts. I checked current local Git state and the live open-PR list. This privately composed candidate was reviewed as a local exact source, with no hosted-check/merge-readiness claim.

The complete base-to-head product diff changes only `apps/api/src/identity/repository.ts` and `apps/api/src/instance/users/repository.ts`: 73 identity plus 13 instance-user synchronous select helpers become async and await their complete existing statement. I independently counted the 86 converted exported functions from base and candidate text. For each function I extracted the original return expression and the candidate return-await expression and compared the complete query-expression bytes: all 86 matched exactly after removing the added await. A whole-file textual reversal also matched after reverting async/await, whitespace and formatter-added trailing parameter commas. Thus the SQL/projections, predicates, joins, order, limits, offsets, FOR UPDATE clauses and executor expressions are preserved; this is not merely a sample of the diff.

I independently compared recursive Git tree mode/type/blob records: both trees contain 3,405 entries, and only the two assigned repository entries differ. This agrees with the supplied conservation receipt. I confirmed the candidate has the named main as one merge parent, and `git diff --check` passed. The candidate was clean when inspected.

I searched changed symbols across TypeScript source and used tracked Git searches for repository imports across TS/TSX/JS/module variants, then inspected the exposed callers and re-export seams. Existing callers consume rows with await; no caller-side builder composition, saved/repeated builder execution, changed function alias, or transaction escape was found. The SCIM alias `lockScimProfilePerson as lockScimProfilePersonRow` is invoked with await in its local wrapper. The namespace import in the OIDC mapping integration test accesses an unchanged helper. The membership-projection/person-lifecycle/scim-group-sync re-export modules expose unchanged helpers rather than the converted reads. `getOidcRoleForReconciliation` has no located caller; I do not claim an awaited caller exists for that export. Attachment audit and intake staff-person wrappers await `getActiveStaffPerson`.

## Security analysis

**Materialization, timing and errors.** I inspected the installed Drizzle QueryPromise/select implementation as text: then invokes execute, and the select execute method prepares and runs its statement. The application's database uses the node-postgres adapter; I inspected that adapter's transaction implementation as text, which awaits the callback before commit and rolls back on rejection. The added internal await resolves the same query into rows before the repository promise fulfills. It removes the public builder surface. Every located actual caller already awaits the result, so the query remains ordered before the caller's next statement. An additional promise boundary does not move a query past transaction completion in these callers. Query-construction throws now become rejected async promises, but callers already await within their existing async handlers/transaction callbacks, preserving propagation into their error/rollback paths. No catch/retry swallowing, detached call, callback return change, transaction creation or commit/rollback ownership change was introduced.

**Locks, retries and grant closure.** Transaction helpers keep the exact tx/executor passed by their existing callers, rather than falling back to the shared database. FOR UPDATE and scoped `of` clauses, deterministic grant ordering, and lock-query limits are byte-identical. I followed OIDC closure discovery, parent/closure locking, connection-version revalidation, external-identity locking, active/admission-failed grant reads and reconciliation within the same transaction. The existing retry wrapper still retries the full transaction for closure-change and its defined PostgreSQL conflict codes; the new awaits add no early fulfillment or interception. I inspected the connection-admin, SCIM-admin and OIDC-mapping mutation seams as well as the SCIM lifecycle/profile paths. Existing shared-db snapshot helpers remain shared-db snapshots and are not newly treated as authoritative locked reads. No new lock order, nested transaction, lock release, or network operation under a lock is introduced by this delta.

**OIDC/SCIM trust and tenant boundaries.** The four follow-up OIDC reads each have one direct awaited call in the existing sign-in transaction, using the same tx. Connection/issuer/subject binding, person/side/organisation checks, current configuration/admission validation and source-specific grant filters are preserved. The active/admission-failed grant reads retain person + external identity + connection + jit_default/oidc_group + unrevoked predicates and id order/FOR UPDATE, so this change does not widen retirement/reconciliation to direct, SCIM or another connection's grants. SCIM bearer resolution still awaits the token-digest query and validates connection/resource/scope state; mutation revalidation awaits identity-connection then SCIM-connection locks and compares token hash and persisted scope. SCIM user list/read/PUT/PATCH callers still supply the same authenticated connection/provisioned-via predicates. No provider data acquires an instance-admin/sees_all grant path in this delta.

**Administrator authority and step-up.** Instance directory reads still follow the existing God Mode/current-instance-admin check and safe DTO conversion. For mutations I inspected suspend, sign-out, deactivate and grant-admin flows: the converted target/actor/person/session/setup/admin-list reads remain awaited at the same points inside the original transactions. The shared 2026 advisory serialization, last-admin/self-target guards, active staff/agent-session predicates, setup eligibility, operation-bound proof consumption and audit/notification sequencing are unchanged. `lockInstanceAdminSerialization` remains synchronous with its existing execute return and is explicitly excluded from this change. OIDC mapping step-up challenge/verification reads remain awaited with the same connection + mapping ids and config-version checks; mapping mutations retain current-authority and proof revalidation. No policy entry, capability, route, schema or administrative-authority source changed.

**Serialization and data exposure.** Existing projections, secret-handling and safe response mappers are unchanged. Materialization does not add selected fields, serialize a builder, or introduce an error/log path. This review does not broadly certify every pre-existing identity query, query-location violation, or pending-action lock-order issue; it evaluates the security effect of this exact materialization delta and its caller seams.

## Verification evidence and limits

I ran only lightweight Git/Python/text inspection and the read-only PR-list query. I ran no compiler, Node/AST tooling, tests, PostgreSQL, Docker, inventory runtime or browser. This respects the conductor's reserved heavy-verification window.

I read these conductor-run receipts and logs in `identity-users-de4e-root/` and independently verified each retained log's byte count and SHA-256 against its receipt:

- Initial API typecheck: native exit 1, 234,002 bytes. Missing dependency/workspace wiring makes this failed attempt unsuitable as either a pass or proof of a candidate-specific type defect.
- Initial frozen install: native exit 1, 208 bytes; actual log records `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. This adverse attempt remains retained.
- Corrected isolated frozen install: CI=true, native exit 0, 1,244 packages, recorded 7.103 seconds. Its receipt does not itself carry a source SHA; source/provenance is supplied separately by the setup record and exact-head clean-state records. The setup provenance records preservation of the author-created shared-root symlink and an untouched target. I did not independently observe the installation or attest filesystem history.
- Workspace dependency declaration builds: source de4e, native exit 0, 207 bytes, recorded 1.666 seconds; log records email, permissions and domain builds. This is not a shipped-image build.
- Installed API typecheck: source de4e, native exit 0, 343 bytes, recorded 18.2566 seconds, postClean=true. Raw SHA-256 is `7ff41d5e9de69b9ba024ae1f503e3d255b8cbee5f21606d5a464aefaa266c601`. The log names the API, permissions, tests, RLS prototype and approvals TypeScript configs. This is a verified conductor receipt, not a check executed by this reviewer.

No PostgreSQL or unit-test result was available in the inspected receipt set. No passing runtime, image/boot/health, browser, exact-head CI, release or SIT result is claimed. Those acceptance gates remain the conductor's work; the earlier failures are not erased by the later setup/typecheck pass.

## Findings and disposition

- Blocking source findings: none.
- Non-blocking source findings: none.
- Residual limits: serving-model fingerprint unavailable; dynamic concurrency/error behavior was reasoned from preserved source and installed adapter text, not exercised by this reviewer. Tests and deployment/runtime proof remain separate pending gates. Existing unrelated blockers, including pending-action lock-order work, receive no disposition here.

The exact source is CLEAR at full security-review depth within these stated limits. Any later non-record source change requires review of its effect under the accepted exact-head rules. No merge, issue closure, gate waiver or stage/SIT completion is authorized by this report.

<!-- END VERBATIM SOURCE REPORT: identity-users-de4e-full-security-61-sol.md -->



## Conductor supplement: platform-reported context provenance

This supplement records platform metadata; it does not change any authentic report body, verdict or reviewed source. The conductor inspected only session linkage and model configuration fields from the original local platform session records, together with the dispatched context identities. No hidden serving build/version or cryptographic backend attestation is exposed or claimed. The reports retain their original self-description and fingerprint limits.

- `/root/remaining580_identity_users_builder_plan_luna` — session `01a149b5-80ae-7830-af27-c0f2c53067d2`, parent `01a14000-d9e0-7bb1-b3fd-2c0204a4834c`, provider `openai`; all recorded turn configurations report `gpt-6-luna`, effort `medium`.
- `/root/identity_users_de4e_ordinary_a_luna` — session `01a149bc-1ce3-7311-8950-6ee01f4b2a22`, parent `01a14000-d9e0-7bb1-b3fd-2c0204a4834c`, provider `openai`; all recorded turn configurations report `gpt-6-luna`, effort `medium`.
- `/root/identity_users_de4e_full_security_sol` — session `01a149bf-197d-75c0-ad46-c128e65040ef`, parent `01a14000-d9e0-7bb1-b3fd-2c0204a4834c`, provider `openai`; all recorded turn configurations report `gpt-6.1-sol`, effort `high`.
- `/root/identity_users_de4e_ordinary_b_luna` — session `01a149bd-f7e3-7bc3-afc8-ccd396ea55e9`, parent `01a14000-d9e0-7bb1-b3fd-2c0204a4834c`, provider `openai`; all recorded turn configurations report `gpt-6-luna`, effort `medium`.

The two ordinary contexts and full-security context are distinct from the author and conductor. These configuration records corroborate the explicit model selection and context linkage; they do not extend source review to later changes. Private allowlisted extraction is retained in `identity-users-platform-review-models-root.json`.

**Reviewed head:** `de4e3433fc6822b126da06d1e3821b381a964016`


---

Authentic current-main composition report: identity-users-8c1764-records-composition-luna.md

# Independent composition review — identity/users materialization #580

**Reviewed head:** `8c1764b7321cf828e999ec2bd5a368d176e88330`

**Comparison base:** `fe063765774b73587488b753c91c6477653662cc`

**Direct parents:** product publication `5ea60248f75eeb91757eecd1423af49bd4b33ed8`; accepted main `f0b7e903e45eabbad84ac4285e92e5d1af11a2ca`.

**Reviewer/model:** GPT-6 Luna, as the platform reports this context. Fresh independent context dispatched with `fork_turns=none`; I did not author, direct, or remediate the identity/users candidate or its review records. Role: ordinary review of this records-only composition delta. Read-only; no source edits.

## Scope and checks

I read the accepted repository `AGENTS.md`, `CLAUDE.md`, active mission, agent workflow, queue, status and decision log, plus the identity/users review record and the three incoming records paths.

I independently reconstructed the expected tree by applying the three owned paths from the old publication over accepted main and compared all recursive Git tree mode/type/object entries with the candidate. All 3,407 entries match exactly. The owned set (`apps/api/src/identity/repository.ts`, `apps/api/src/instance/users/repository.ts`, and `docs/07-planning/security-reviews/query-ownership-identity-users-materialization-580.md`) and the three incoming accepted-main records paths are disjoint. Each owned blob is exactly the old publication's blob; both product repository blobs are also exactly the previously reviewed `de4e3433fc6822b126da06d1e3821b381a964016` blobs. The three incoming records paths exactly match accepted main. Parent order is as stated, and the worktree is clean. This independently confirms the supplied conservation receipt's partition claim.

The identity/users note has one earlier provenance-only publication history relevant to this join. Comparing its note at `c5e92aa20d63b36403c165904c079eb03a8410e8` with `5ea60248f75eeb91757eecd1423af49bd4b33ed8` shows exactly 14 appended lines and no deletions; the original 19,841-byte note is an exact prefix. The whole note is then conserved unchanged into this candidate. Its three authentic review reports therefore remain untouched: ordinary A, ordinary B, and full security review all remain explicitly scoped to source `de4e3433fc6822b126da06d1e3821b381a964016`, with their original findings and limits. The supplement claims platform-reported model/context provenance only and expressly does not claim hidden serving identity or extend source review. I independently compared its allowlisted session IDs, agent paths, and model/effort fields against the four cited original session files (builder-plan Luna, ordinary A Luna, ordinary B Luna, full security Sol); those fields match the retained extraction. No private analysis or message content was read or reproduced.

The incoming records are accepted-main bytes. The status/queue checkpoint describes the earlier `de4e` source-bound API five-configuration typecheck and directory/PG evidence while explicitly leaving current publication CI pending; it does not turn those earlier results into current-head runtime or CI acceptance. The incoming #821 records note is dated/cutoff-bound, preserves the distinction between the #820 accepted checkpoint and unfinished product lanes, and scopes its queue/provenance dispositions. The #580 identity review note and its report prefix are unchanged. No incoming record changes product behavior or review authority.

Commands/checks: `git show -s --format='%H%n%P%n%s' HEAD`; recursive `git ls-tree -r` partition reconstruction and comparison; `git diff --name-status` / `--stat` against the parents; exact blob comparisons for the two repositories; note byte-prefix comparison across `c5e92aa2` and `5ea60248`; allowlisted model/context-field comparison against cited session metadata; targeted reads/searches of the incoming records. No tests, builds, browser, database, Docker, runtime or GitHub operations were run.

## Findings and verdict

**CLEAR — records composition only.** No blocking or non-blocking compositional finding. The join is a lossless, disjoint overlay of the two reviewed source sets, and the three newly included records preserve their bounded source and acceptance claims. The unchanged `de4e` source reviews remain valid only for that source; this report does not extend their source review to a later product change.

This review does not establish current-head CI, PostgreSQL, browser, image/boot/health, publication, SIT, whole-#580 completion or merge acceptance. The historical `de4e` check/runtime evidence remains attached to that source. No product tests or heavy checks were rerun.


---

Authentic current-main composition report: identity-users-8c1764-records-composition-luna-correction.md

# Correction to the identity/users composition review

**Reviewed head:** `8c1764b7321cf828e999ec2bd5a368d176e88330`

**Comparison base:** `fe063765774b73587488b753c91c6477653662cc`

**Correction to:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/takeover/identity-users-8c1764-records-composition-luna.md` (original retained unchanged).

## Factual attribution correction

The original report's scope paragraph says: “The status/queue checkpoint describes the earlier `de4e` source-bound API five-configuration typecheck and directory/PG evidence while explicitly leaving current publication CI pending.” This sentence conflates the incoming dated records with later private evidence.

I re-read the exact accepted-main incoming `docs/07-planning/status.md` snapshot (2026-10-17 12:05 UTC) and the corresponding `Identity/users confirmed builders #580` queue row. They support the earlier `de4e` API five-configuration typecheck result and say full Sol is pending. The status explicitly says PostgreSQL/unit/runtime, publication and CI remain pending; the queue says the next work is serialized focused PG/unit and normal publication/current gates. Neither incoming record says directory verification or the later 268-test PostgreSQL result passed. Those later results are separate private evidence supplied to the conductor and must not be attributed to the incoming 12:05 records.

The corrected description is: **The incoming 12:05 status and queue record the source-bound API five-configuration typecheck, leave full Sol pending, and explicitly leave PostgreSQL/unit/runtime, publication and current CI pending. Later directory and 268-test PostgreSQL results belong to separate private source-bound evidence, not these incoming records.**

## Effect on verdict

This corrects my factual description of what the incoming status and queue state. It does not change the composition verdict: the four incoming records remain exact accepted-main bytes, the three owned paths remain disjoint, and the independently reconstructed 3,407-entry overlay remains exact. The incoming records themselves accurately leave those checks pending. The original report's **CLEAR — records composition only** verdict remains valid within its stated scope, but the quoted sentence must not be relied on as a description of the incoming records. No source review, test, runtime or acceptance claim is added by this correction.

This is a bounded attribution correction only. No source files or original report bytes were changed; no tests or heavy checks were run.


---

Authentic current-main composition report: identity-users-8c1764-records-security-sol.md

# #580 identity/users records composition — independent security confirmation

**Reviewed head:** `8c1764b7321cf828e999ec2bd5a368d176e88330`

**Verdict:** **CLEAR — lightweight security confirmation of the records composition.** No blocking composition/security finding. The non-blocking count typo in the authentic ordinary correction is independently dispositioned below.

**Comparison base:** `fe063765774b73587488b753c91c6477653662cc`. Actual ordered parents: product/provenance publication `5ea60248f75eeb91757eecd1423af49bd4b33ed8` and accepted main `f0b7e903e45eabbad84ac4285e92e5d1af11a2ca`. Worktree: `/Users/heinthura/.codex/worktrees/remaining580-identity-users-materialization-luna`.

**Reviewer/model:** `/root/owner807_identity_mainf0b7_security_sol`, independent security context, session `01a149e1-664b-7e11-bda8-e29a42c89cd7`, parent `01a14000-d9e0-7bb1-b3fd-2c0204a4834c`. Original session_meta/turn_context at lines 1/8 report platform model `gpt-6.1-sol`, effort `high`, provider `openai`, CLI `0.162.0-alpha.17.2`. Original parent dispatch at line 59995 records explicit `model=gpt-6.1-sol`, `reasoning_effort=high`, `fork_turns=none`. No separate serving build/version or hidden fingerprint is exposed or claimed. I did not author, direct, remediate or ordinarily review this candidate or its review records. This is the second bounded confirmation assigned to this fresh context; the other concerns the separate #807 composition and creates no authorship relationship to this candidate.

## Scope and sequence

I read accepted AGENTS, active mission, canonical workflow model/review/evidence rules, CLAUDE provider adapter, relevant CI/CD scope, dated status/Blocked and queue/decision context. I read the complete designated identity/users own note, preserving its ordinary A/B and full Sol reports on `de4e3433fc6822b126da06d1e3821b381a964016` and later conductor provenance supplement. I read both `identity-users-8c1764-records-composition-luna.md` and its separately retained `-correction.md` in full. The corrected ordinary verdict is CLEAR on this exact head; its factual attribution correction must accompany the original report.

The review depth is the no-authority-change row: lightweight independent security confirmation of the current join and provenance-only supplement. This is not a new full audit of the 86 materialized identity/instance-user reads. The prior two independent ordinary reviews and full independent security review retain their original full source scopes; source conservation is checked here, rather than silently extending those reviews to changed product code.

## Independent preservation and provenance checks

I independently recomputed the Git merge base and recursive mode/type/blob maps. Exactly three owned paths differ between the common base and old publication: `apps/api/src/identity/repository.ts`, `apps/api/src/instance/users/repository.ts`, and `docs/07-planning/security-reviews/query-ownership-identity-users-materialization-580.md`. Exactly three incoming paths differ between the common base and accepted main:

- `docs/07-planning/integration-execution-queue.md`
- `docs/07-planning/security-reviews/records-after820-20261017.md`
- `docs/07-planning/status.md`

These sets are disjoint. Overlaying the three old-publication entries onto accepted main reproduces all 3,407 candidate entries exactly, including path/mode/type/blob. Both product repository entries also exactly equal their entries at reviewed source `de4e3433fc6822b126da06d1e3821b381a964016`. Candidate HEAD, ordered parents and clean checkout match the assigned source. `git diff --check` against the old publication passes. The direct-parent composition delta is exactly the three records paths, 174 added lines and no product changes.

The note at `c5e92aa20d63b36403c165904c079eb03a8410e8` has 19,841 bytes and is an exact byte prefix of the note at `5ea60248f75eeb91757eecd1423af49bd4b33ed8`. Git confirms 14 added lines and zero deletions, all in that note. The complete resulting note is conserved unchanged into 8c1764. Thus original report bodies, source references, verdicts and limits have not been edited by the provenance supplement or join.

I independently inspected only original session_meta and turn_context fields for the four sessions cited in `identity-users-platform-review-models-root.json`. IDs, canonical agent paths, parents, provider and every recorded model/effort pair exactly match that extraction and the supplement:

- builder-plan context `01a149b5-80ae-7830-af27-c0f2c53067d2`: `gpt-6-luna`, medium (five recorded turns);
- ordinary A `01a149bc-1ce3-7311-8950-6ee01f4b2a22`: `gpt-6-luna`, medium;
- ordinary B `01a149bd-f7e3-7bc3-afc8-ccd396ea55e9`: `gpt-6-luna`, medium;
- full security `01a149bf-197d-75c0-ad46-c128e65040ef`: `gpt-6.1-sol`, high.

All have the declared parent/provider and distinct agent paths. This verifies the supplement's bounded platform-configuration claims; metadata is not cryptographic backend attestation, and it does not prove broader independence merely by naming different sessions. The designated reports' original independence declarations, source scopes and fingerprint disclaimers remain unchanged. The current ordinary composition context's original session metadata likewise reports its canonical path `/root/canned807_6576_mainf0b7_composition_luna` and `gpt-6-luna`/medium on its recorded turns, consistent with its model label. No private transcript analysis or message bodies were read or reproduced.

## Authority and factual-evidence assessment

The actual incoming product-source delta is empty. There is therefore no new OIDC/SCIM trust decision, instance-admin grant path, tenant predicate, query/executor, transaction lifetime, caller await, lock order, route policy or gate implementation at this join. The unchanged two repository blobs retain the original full security scope; this confirmation does not claim to rerun that assessment. The 14-line supplement reports provenance, preserves all original reports and explicitly adds no source-review extension or hidden-serving-identity requirement. It changes neither review eligibility policy nor authority.

I directly checked the incoming 12:05 UTC status and `Identity/users confirmed builders #580` queue row. They record the API five-configuration typecheck, both ordinary clearances and full Sol pending at that dated cutoff, and explicitly leave PostgreSQL/unit/runtime, publication and current CI pending. They do not claim the later directory proof or 268-test PostgreSQL pass. The authentic correction accurately retracts that conflation in the original ordinary prose. Later private proofs, if used by the conductor, require their own original source attribution; this review does not inspect or accept them.

**Non-blocking evidence precision — independently dispositioned:** the correction's Effect on verdict paragraph says “four incoming records.” Actual Git paths and both independent tree reconstructions establish **three**, exactly the status, queue and #821 note listed above. This is a prose count typo in the correction, not a fourth path or a conservation failure. The original ordinary report correctly lists three incoming paths, the supplied conservation receipt also lists three, and my complete reconstruction confirms three. Reliance on the correction must use this explicit three-path disposition and its correct factual-attribution substance. Neither authentic original report nor correction was edited. This typo does not require a new product audit or another ordinary composition round and does not alter the supported CLEAR verdict.

The incoming #821 note and queue/status remain accepted-main dated evidence. Their supplemental queue/provenance dispositions confer no new authority or current-head runtime acceptance. The status continues to retain N1 and other program holds; no inherited lock-order issue, whole-#580 obligation or failed unrelated gate is waived.

## Actual checks, residuals and limits

Actual operations: read-only Git metadata/merge-base/status/diff/numstat/check; complete independent recursive tree reconstruction; exact product-blob and note-prefix comparison; targeted policy/records reads; allowlisted original session model/linkage parsing and extraction comparison; own dispatch metadata verification. The private report was created exclusively with mode 0600 and is the sole write for this candidate.

No compiler/AST tooling, tests, PostgreSQL, browser, Docker/image/health, inventory runtime, live GitHub query/write, source/ref mutation, subagent, retired route, commit, push, merge or waiver was performed. BROWSER VERIFICATION: BLOCKED by the no-runtime review assignment; no screen opened. The original full Sol report remains source CLEAR only and its initial setup failures/later typecheck pass keep their original bindings. No later directory/268-test PG proof or current 8c1764 runtime pass is claimed. The inherited pending-action N1 residual remains unresolved and unwaived outside this source scope.

This confirmation clears the bounded records/provenance composition security concern at the exact reviewed head. Current publication, authentic report transport, exact-head hosted checks, shipping-image/runtime proof and protected acceptance remain conductor obligations. This is not merge readiness, whole-#580 or phase closure, release/SIT/recovery acceptance, or deployment authorization.


**Reviewed head:** `8c1764b7321cf828e999ec2bd5a368d176e88330`
