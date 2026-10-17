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

