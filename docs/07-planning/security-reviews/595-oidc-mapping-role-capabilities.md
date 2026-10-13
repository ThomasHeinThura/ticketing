# PR595 — OIDC mapping role capability remediation

**Reviewed head:** `5b3a33771f3c7194b419505137557d14be40dd7c`

This records the fresh independent GPT-6 Sol verdict verbatim below. Product candidate5b
remains the source reviewed; any subsequent commit containing only security-review records
carries it through explicit source equivalence, not a relabeled product review.

Full administrative mapping feature at0796 was inspected by three fresh ordinary Luna
contexts; the subsequent full Sol review blocked its customer capability-validation branch.
The two-file shared invariant remediation5b was independently inspected by fresh Luna A and
B; both P3 delta verdicts clear. Their exact5b P3 sections are in retained private
p3-p4-structural-delta-luna-a.md and p3-p4-structural-delta-luna-b.md. The latter's unrelated
P4 head typo is preserved and is not evidence for a P4 exact-head gate.

Author actual scoped native1file9, identity31, roles23, permissions14files88, API types,
OpenAPI233, Biome and diff checks pass. Neither ordinary delta reviewer reran PostgreSQL.
No required hosted CI, image/boot, provider/browser, integrated P3 or phase acceptance claim.
IP28 login grant reconciliation is a separate complete implementation batch, not included here.
Human H1–H6 review remains deferred to integrated P4.

Original private Sol report SHA-256: `7acbf135c57c7183ede9f6c4f5e1a12cdd16607f6913ce8583e997f2fabbb870`.

---

# Independent GPT-6 Sol security review — P3 OIDC mapping capability repair

**Reviewed head:** `5b3a33771f3c7194b419505137557d14be40dd7c`.
**Delta base:** `0796bb30d80191253e79a6d4479db0c0f9bb448a`; original whole-feature comparison base `f4789aefd3c3d08595642414dda63770d8973f64`.
**Reviewer:** fresh independent GPT-6 Sol context; no authorship, direction, or remediation.
**Verdict: CLEAR for the exact-head security source review. No blocking finding in the mapped administration boundary.** This does not accept IP-28 login reconciliation, hosted CI, or P3 as a stage.

## Scope and checks

Read the repository workflow, IP-34 and linked administration contract, prior full Sol blocker at `0796bb30`, both fresh delta Luna reviews, the exact two-file delta, neighboring mapping GET/POST/PATCH and step-up consumption, and `roleCompositionProblems`/capability-tier rules. Traced current admin/session policy, connection and target checks, role validation, transaction proof/CAS sequencing, source-specific grant retirement, and invalid-config read failure.

`git rev-parse HEAD` matched this reviewed SHA. `git diff --check 0796bb30..5b3a3377` passed. The author reports native 9, identity 31, roles 23 and permissions 88 passing; those are author evidence. I ran no PostgreSQL integration, browser, Docker, provider, or resource-heavy suite under the reserved P4 database window. The new integration regression is therefore inspected but not independently executed here.

The previous blocker was a customer branch returning before validating persisted `role.capabilities`. The new shared predicate runs before **both** customer and agent returns. It requires a JSON array of registered strings, rejects `sees_all`, and applies the authoritative scope composition predicate, which rejects instance-tier authority in organisation/workspace roles. Existing customer key and organisation-scope constraints, agent workspace and max-rank constraints, and admin/owner exclusions remain. The added customer regression exercises a previously valid mapping after persisted `instance:admin`, malformed-object and unknown-capability corruption: read fails closed; enable and display edit return invalid without consuming PA-15 proof; invalid create makes no proof or grant; mapping, config version and provisioning event set stay unchanged. That closes the verified prior class at the shared validation boundary.

## Residuals

The integration test requires PostgreSQL and was not run by this reviewer. Live PR #595 was at this head when checked, with several checks failing or still in progress; this note does **not** state CI green or merge readiness. IP-28 canonical group UUID/login-time grant reconciliation remains a separate pending batch: this administration source review does not make configured mappings take effect at login. Real Entra evidence, runtime/browser checks, and P3 phase finalization remain outstanding.

**Reviewed head:** `5b3a33771f3c7194b419505137557d14be40dd7c`.
