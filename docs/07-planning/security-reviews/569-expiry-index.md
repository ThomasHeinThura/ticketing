# PR #569 — pending-action expiry index security review

**Reviewed head:** `357af8dc81e58e7b03aed06817e77fca5997e8e2`
**Frozen unaccepted P1 base:** `45a533e17836421eb66f14541cf8a2ced2f9a3f1`
**Comparison:** exact PR candidate diff from the frozen P1 base, including the P4 expiry-index slice.
**Review:** Full independent GPT-6 Sol security pass; GitHub COMMENT review `5388694156`, submitted 2026-10-02 05:53:33 UTC, after ordinary reviews `5388609265`, `5388626677`, and `5388672809` all returned CLEAR on this exact head.
**Verdict:** CLEAR for the bounded expiry-index slice only. This does not accept the PR or clear the unaccepted P1 parent.

## Independence and scope

The three ordinary reviews were fresh, independent GPT-6 Luna contexts; each states it did not author, direct, or remediate the candidate. Reviews A, B, and C are GitHub `COMMENTED` reviews, not `APPROVED` states. Each inspected the exact source `357af8dc81e58e7b03aed06817e77fca5997e8e2` against frozen base `45a533e17836421eb66f14541cf8a2ced2f9a3f1` and returned CLEAR for the P4 expiry-index slice, with no blocking or non-blocking findings.

The GPT-6 Sol reviewer was a fresh independent context that did not author, direct, or remediate the candidate. It reviewed the exact same head after the three ordinary clears. Scope included all changed paths; migration 0082, Drizzle schema/snapshot/journal; scoped and null-scope partial index predicates; candidate and diagnostic probe queries; scalar database-time cutoffs; keyset ordering and tuple continuation; selected-row caps; locking, post-lock resampling and conditional transition; and transactionally paired outbox/audit behavior. It also inspected the existing lease, event, audit-savepoint, and decision seams relevant to the expiry worker.

## Findings reviewed

- Migration 0082, the schema, snapshot and journal agree; migration order remains 0080 → 0081 → 0082. The scoped `(expires_at, id)` index and null-scope `(expires_at)` diagnostic index retain separate partial predicates.
- Candidate selection and the null-scope diagnostic probe use scalar `(SELECT clock_timestamp())` statement cutoffs. The candidate scan remains ordered and keyset-paginated; the null-scope probe is diagnostic and does not transition those rows.
- The worker retains `FOR UPDATE SKIP LOCKED`, the 100-row transaction batch and 1,000 selected-eligible-action run cap, post-lock time resampling and conditional pending-state update. State transition and decided event remain transactional; the existing AU-14 audit-savepoint behavior is unchanged.
- The plan evidence is a synthetic fixture. The selected-action cap is not a physical executor-row/tuple-read cap, and no production latency budget is established. Normal transactional `CREATE INDEX` can block writes while building on an existing large table, as documented.

## Reviewer execution and separate evidence

The Sol reviewer ran `git diff --check` and one focused disposable PostgreSQL 18 Testcontainers integration run: 1 file / 12 tests, exit 0, from 05:51:35 to 05:51:53 UTC. The original logs and report are retained under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-02/pr569-357af8dc/sol-security/` with directory mode 0700 and file mode 0600. The persistent database was not used; the disposable test container was removed.

The author separately reports a focused PostgreSQL 18 expiry-index regression of 1 file / 12 tests, and a rebuilt image for this exact source with image ID `sha256:854d23f833f817423731dc8736893ba4b90cb116c01d2daacb5d2c79b3e265de`. Its OCI revision label matched the source; runtime UID was 10001; migration completed with exit 0; live and ready returned HTTP 200; and the same persistent root was preserved. This is reported author evidence, not Sol execution. An earlier image had an `unknown` revision label and is not current source-bound image proof. Hosted CI remains independent evidence and is not made green by this note.

## Residual scope and acceptance boundary

This clearance covers only PR #569's P4 expiry-index slice. It does not clear the unaccepted parent P1 or #513, resolve #564's future organization/instance event-scope contract, implement PA-9 invalidation, close the durable AU-14 administrator-notifier obligation, or establish browser verification, H1 approval, G11 acceptance, P4/stage completion, or a phase finalizer. It does not claim physical tuple-read bounds. Required hosted checks and exact-head protected merge gates remain separate. No waiver or merge authorization is implied.
