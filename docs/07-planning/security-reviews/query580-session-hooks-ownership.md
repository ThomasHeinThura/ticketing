# Session-hook query ownership — authentic reviews

**Reviewed source:** `6a23fb3971bd794faddc003fc8617b3fa1e8aa22`

Accepted comparison base: `a6b3d7c5dc8262f6bc091587c00a4fc68233b0c0`. The source changes only `apps/api/src/auth.ts` and `apps/api/src/auth/repository.ts`. Two existing awaited session updates move into finite repository helpers; the same selected executor, predicates, values, guards, error propagation, call order, and surrounding TOTP/OIDC flows remain. This is query ownership relocation only.

Author context `01a14c7f-d171-7883-bbe6-ae0df6f62ff7`: native configured gpt-6-luna/high. Fresh independent ordinary reviewer `01a14ca2-22de-76a1-bb1c-440b9250ee36`: gpt-6-luna/high. Fresh independent security reviewer `01a14ca3-315f-7c62-ae2d-bf8befbb7f9d`: gpt-6.1-sol/high. The three contexts are distinct. These are native configured assignments, not served-weights attestations. The conductor publishes this wrapper and supplies no independent approval.

Both reviewers clear the exact source and identify no findings; the applicable tier is one fresh ordinary Luna review plus the mandatory lightweight Sol confirmation for a security-scope path with no authority or gate-semantics change.

Root-owned local evidence is source-equivalent reuse only: typecheck9 tasks (5 cached), and three complete existing PostgreSQL files with23 tests passed/native0 at `46a1c65ece98714c7b0b16b54c883c2396d7ce6b` plus the exact conserved patch `088d5da0ade80dc955449c4cc9ef83ecdbb5973cdb4a68e252b13612ecb46f1d`. The Sol reviewer independently verified the input equivalence through accepted `bf11c6a9` to base `a6b3d7c5dc8262f6bc091587c00a4fc68233b0c0`. These results were not rerun at source `6a23fb3971bd794faddc003fc8617b3fa1e8aa22`. No hosted check or image result is claimed here.

The unwired query diagnostic remains red: 2719 overlapping instances, 139 paths, 1506 path/line locations; it found zero `auth.ts` rows, is not unique-query progress, and does not establish #580 completion. Existing #231 bootstrap-liveness and NB1 bare-verifier-result residuals remain unchanged and unwaived.

BROWSER VERIFICATION: BLOCKED — backend-only ownership relocation; no screen or route behavior changed. Required exact-publication hosted checks and shipping-image gates remain mandatory. The same Carrier remains unaccepted. #810’s 223.2 ms result against the strict <200 ms target and #811/#773’s thirteen findings and unanswered valuation/midnight/timezone decisions remain open. Signed release, laptop HTTPS SIT, NONEMPTY attachment backup, usable isolated application restore, and fresh final independent audit remain later gates. Preserve owner holds and 626 deferrals; they are holds/deferrals, not completion tasks. No phase, mission, UAT, production, release, or whole-#580 completion is claimed.

The following complete authentic reports are embedded byte-for-byte. The note is the only permitted post-source publication change.

## Ordinary review

Authentic report SHA-256 `b0f840a894e096f45246d8a472a64c9c2019763d11f8efd6eea623341a0200d3`.

---

# Independent ordinary review — #580 session-hook query relocation

**Reviewed head:** `6a23fb3971bd794faddc003fc8617b3fa1e8aa22`
**Comparison base:** `a6b3d7c5dc8262f6bc091587c00a4fc68233b0c0`
**Candidate parent:** `a6b3d7c5dc8262f6bc091587c00a4fc68233b0c0`
**Review role:** independent ordinary review, Luna tier; fresh context `session6a23_ordinary_luna`.
**Model provenance:** dispatched for this task as the ordinary Luna reviewer. This interface identifies the agent as Codex/GPT-6-based but does not expose a more specific runtime model/version string; the Luna assignment is the task-role provenance, not an independently displayed model label.
**Independence:** I did not author, direct, or remediate this candidate. This review used the frozen worktree at the exact head above.

## Scope and checks

Reviewed the complete diff in `apps/api/src/auth.ts` and `apps/api/src/auth/repository.ts`, plus surrounding after-hook control flow, session ownership, the TOTP enrollment transaction, OIDC two-factor provenance binding, cookie deletion and session rejection branches, and repository executor/query-ownership conventions. Checked the current session contract and the CI security-review path list.

Commands actually run (read-only): `pwd`; `git status --short` / `git status --porcelain=v1`; `git rev-parse HEAD`; `git diff --stat`, `--name-status`, and full `--unified=100` diff against the stated base; `git show -s --format=...` for head and `git show <base>:apps/api/src/auth.ts` for the original hook; `git diff --check`; and targeted `cat`, `sed`, and `rg` reads of `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/07-planning/active-mission.md`, `docs/04-engineering/ci-cd.md`, `docs/04-engineering/coding-standards.md`, `apps/api/src/database/executor.ts`, `apps/api/src/auth.ts`, `apps/api/src/auth/repository.ts`, `apps/api/src/pending-action/credential-invalidation.ts`, `apps/api/src/identity/oidc-login.ts`, and `docs/01-architecture/auth-and-identity.md`.

No tests, compiler, formatter, database, browser, or runtime checks were run by this reviewer. No GitHub state was queried. This report does not claim full #580/#589 acceptance, hosted CI, image, SIT, or final-audit acceptance.

## Findings

**Blocking: none. Non-blocking: none.**

The source diff contains only the two assigned files. It removes the inline Drizzle import/schema use from the auth hook and replaces each awaited update with a call to a repository helper. Each helper takes the explicit `Executor` as its first parameter, awaits the same `sessionTable` update, preserves the same `id = sessionId` predicate and field value, and returns `Promise<void>`. The preceding hook continues to select `currentTotpEnrollmentTransaction()` only for `/two-factor/verify-totp`, falling back to `db`; both moved writes receive that same selected handle. Their relative order and guards are unchanged: the portal write still occurs after customer-identity and 2FA rejection branches, while active-organization lookup/write still occurs only for the same sign-up/sign-in/factor-verified paths and only when a membership is found. TOTP transaction enlistment, OIDC provenance arguments, invalid-provenance session deletion, cookies, error propagation from awaited statements, and hook return shape are unchanged.

The repository helper placement and explicit first-parameter executor match `docs/04-engineering/coding-standards.md` and `apps/api/src/database/executor.ts`. Existing repository mutation helpers in this checkout also use awaited `Promise<void>` statements. `git diff --check` produced no diagnostics. Inspection supports a mechanical query-ownership relocation with no authority, hook pass/fail, transaction, or error-path semantic change.

## Verdict and required next tier

**APPROVE — ordinary review clear for the stated mechanical scope.** Because `apps/api/src/auth.ts` and `apps/api/src/auth/**` are security-review paths, the independently determined tier is one strong Luna ordinary review plus a **required lightweight GPT-6 Sol security confirmation** that this change alters no authority or gate pass/fail semantics. This report satisfies only the ordinary-review role; it is not the security confirmation.

**Residual limits:** source inspection only. Runtime behavior and the caller-provided test receipts were not independently reproduced in this review.


## Security confirmation

Authentic report SHA-256 `80e83c340e84fe9279c40e8d3c58c8308d0f591a960d54682e38f1874fd501f4`.

---

# Independent security confirmation — #580 session-hook query relocation

**Reviewed head:** 6a23fb3971bd794faddc003fc8617b3fa1e8aa22
**Comparison base:** a6b3d7c5dc8262f6bc091587c00a4fc68233b0c0
**Candidate parent:** a6b3d7c5dc8262f6bc091587c00a4fc68233b0c0
**Model:** GPT-6.1 Sol
**Role:** fresh independent mandatory security review, lightweight confirmation after ordinary review cleared.
**Context:** /root/session6a23_security_sol; native agent ID 01a14ca3-315f-7c62-ae2d-bf8befbb7f9d; parent 01a14000-d9e0-7bb1-b3fd-2c0204a4834c.
**Model provenance and limits:** I read root-execution/native-review-provenance.json in the retained preparation evidence. It records this native context's configured model/reasoning pair as gpt-6.1-sol/high. My conversational interface identifies Codex/GPT-6-based and does not independently display a more specific runtime version. The model label above reflects the native configured assignment; it is not served-weights attestation. The ordinary report preserves its own interface-specific identity limitation; I do not relabel it. Native metadata separately records that ordinary context as gpt-6-luna/high.
**Independence:** I did not author, direct, or remediate the source. I reviewed the frozen, clean worktree at the exact head above and made no source or ref changes. I read the authentic ordinary report, which approves this exact head with no findings, before issuing this security verdict.

## Scope and independently determined tier

The complete candidate diff changes only apps/api/src/auth.ts and apps/api/src/auth/repository.ts. It relocates two existing session updates into repository helpers and removes now-unused imports. Both paths are mandatory security-review scope under docs/04-engineering/ci-cd.md. Inspection confirms a mechanical relocation with no change to authority, hook acceptance/rejection, or gate pass/fail semantics. The applicable tier is one fresh ordinary review plus this required lightweight Sol-tier security confirmation. A full semantic auth redesign tier is not warranted by this diff.

I read AGENTS.md, the active mission, agent-workflow.md, CLAUDE.md, the CI security-path list, coding-standards.md query-ownership contract, auth-and-identity.md session/portal/local-factor contracts, and the newest status/decision/queue context. I compared the original hook on the base with the candidate, and inspected the surrounding hook, repository, Executor contract, TOTP enrollment/enlistment context, HTTP/direct-server TOTP wrappers, and OIDC two-factor binding.

## Security conclusions

Both new helpers require the selected Executor as their first argument, await the statement, and return Promise<void>; no query builder escapes. The moved SQL remains the same sessionTable UPDATE with the same id equality predicate and the same portal or activeOrganizationId assignment. There is no fallback to a different connection inside either helper, added transaction, changed predicate, swallowed exception, returned update result, or changed route/policy/schema/dependency.

The hook still selects currentTotpEnrollmentTransaction() only for /two-factor/verify-totp and otherwise uses db. It passes that identical selected handle to both writes. The enrollment helper still requires both transaction and enrollment context, the enlisted provider path still uses its nested transaction, and both HTTP and direct-server TOTP entry points retain their existing outer enrollment boundary. Thus the extracted writes stay enlisted on the same handle rather than escaping to shared db.

The portal write remains after the missing-session, customer-identity, and enrolled-factor rejection branches and before OIDC provenance binding. Session deletion, cookie deletion, setNewSession(null), invalid-provenance return, signed challenge/source-marker reads, and source-cookie expiry remain unchanged. The OIDC binder still receives the same session/user/portal and optional TOTP transaction, with its existing identity/connection/session checks. The active-organization write remains after successful provenance handling, under the same sign-up/sign-in/factor-endpoint condition and nonempty first-membership guard. Both call sites remain awaited in their original order. Rejected updates still reject the async hook; no catch or alternate success path was introduced. The hook's return shape is unchanged.

## Checks actually performed and evidence limits

Read-only commands actually run: pwd; git status --short and --porcelain=v1; git rev-parse; git show (head metadata, parent, and base hook); git diff (full two-file diff, name-status, --binary, and --check); cat, sed, rg and rg --files for the named sources/contracts/receipts; shasum -a 256; wc -c; and tail for retained verification summaries. git diff --check emitted no diagnostics. HEAD and its single parent match the declared review source; the worktree was clean. I made no GitHub query or mutation and ran no tests, compiler, formatter, browser, database, Node, or application runtime.

I inspected retained typecheck and PostgreSQL native receipts, raw-log summaries and integrity hashes. Typecheck reports 9 successful tasks, 5 cached, native exit 0; its 3,893-byte log hashes to adf656ec5046e18049cadb60acb96b222cd319127d1e58f945725c635816c765. The three complete PostgreSQL files (organization-active-session, identity/oidc-jit-login, identity-connection-admin) report 23 passed tests, native exit 0 and root duration 12.600 seconds; the 42,641-byte log hashes to 35bc2131306c8c48b7b5f224a0d2afbcfaaa3182dd60363dbd06f31c7604796a. I independently recomputed those byte counts/hashes and checked current source/test hashes against preflight/postflight receipts.

Those checks actually ran at 46a1c65ece98714c7b0b16b54c883c2396d7ce6b plus dirty patch 088d5da0ade80dc955449c4cc9ef83ecdbb5973cdb4a68e252b13612ecb46f1d, not at this new commit. I independently confirmed that 46a1 and bf11c6a9c37c96e121669f08b1f2b30c7a70a71c have identical base trees; bf11 to a6b3 changes only the three named status/queue/review documentation files. The current two-file commit patch hashes exactly to that archived dirty patch, and both current source hashes match the recorded tested files. This supports source-equivalent reuse, not a new execution on 6a23. Retained source-range Gitleaks and normal branch-push receipts each report native exit 0; I inspected those receipts and the empty scan report, without reproducing either command.

## Findings and verdict

**Blocking findings:** none.
**Non-blocking findings:** none.
**Verdict: APPROVE — mandatory lightweight security confirmation clear for the exact reviewed head and bounded mechanical scope.**

Remaining limits: static security review plus inspection of prior source-equivalent verification receipts. This is not an independent runtime reproduction, a comprehensive audit of unchanged auth code, hosted required-status clearance, image build/boot proof, full #580/#589 acceptance, signed-release/SIT acceptance, or final-audit/stage completion. The conductor must still complete applicable publication and exact-candidate hosted/image gates through the normal protected flow.


