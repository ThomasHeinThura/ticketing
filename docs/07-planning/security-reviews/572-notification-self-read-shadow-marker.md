# PR #572 review record — notification self-read shadow markers

**Reviewed head:** `b80ff7c3ef723a280bb35cfadec0a71b1ad14ae3`
**Base:** `13c2abc033ca1e004344c83308aead714e9521b4`
**Review order:** independent GPT-6 Luna, then independent GPT-6 Sol.

## Independent reviews

1. **GPT-6 Luna — CLEAR.** GitHub COMMENT review [5388588346](https://github.com/ThomasHeinThura/ticketing/pull/572#pullrequestreview-5388588346), submitted `2026-10-02T05:30:02Z`, bound to the exact reviewed head above. The reviewer inspected the two final self-read GET handlers, the caller-keyed notification and preference queries, auth/API-key/session caller binding, shadow comparison behavior, and the new regressions. No blocking or non-blocking code findings. The review did not execute tests or database probes; author-run checks are not represented as reviewer executions.

2. **GPT-6 Sol — CLEAR (lightweight security confirmation).** GitHub COMMENT review [5388604627](https://github.com/ThomasHeinThura/ticketing/pull/572#pullrequestreview-5388604627), submitted `2026-10-02T05:33:43Z`, after the Luna review and bound to the same exact head. The reviewer inspected the complete three-file delta, route policies, both self-read query paths, authentication and API-key/session caller binding, marker placement, comparison semantics, and regressions. No blocking or non-blocking findings. The review ran `git diff --check`; it did not run PostgreSQL, CPU-heavy tests, containers, or API-key requests.

The full reviewer records are preserved outside the repository at:

- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-02/pr572-b80ff7c3/ordinary-review.md`
- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-02/pr572-b80ff7c3/0700/security-review.md`

## Scope and limits

The reviewed change writes `allowed` only in the two authenticated self-read GET handlers, after their existing service reads complete using the authenticated caller's `userId`. An absent marker remains unknown; the change does not infer an outcome from HTTP status or base authentication. The tested unrelated inline workspace denial and handler failure remain `legacy_outcome_unknown`.

This review certifies only the bounded marker delta and its current legacy self boundary. The broader notification resource-reach acceptance contract is **not certified**. This record does not establish UAT source equivalence, a representative soak, notification feature acceptance, cutover safety, P0 completion, production deployment, browser/manual acceptance, or a phase finalizer.

## Author-reported validation and image evidence

The author reports focused shadow integration: 1 file / 23 tests on Testcontainers PostgreSQL 18; permission tests: 14 files / 88 tests; and API typecheck across four configs. These are author-run results, not reviewer executions. GitHub checks observed during review were not all complete, and the PR-template/security check was still failing while review metadata was pending.

The original local image's OCI revision was unknown and remains historical evidence only. The corrected source-bound image was built from the clean exact reviewed source with the existing Dockerfile `GIT_SHA` build argument: image ID `sha256:7b8f74750b41e5e6551cd17611eba5c9ff518c4f76bf5276829e15b074b78bfd`, OCI revision `b80ff7c3ef723a280bb35cfadec0a71b1ad14ae3`, runtime UID `10001`. Disposable PostgreSQL 18 / Valkey 9 migration completed with exit 0; live and ready health probes returned HTTP 200. All disposable containers, network, and ephemeral env file were removed.

Persistent evidence index: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-02/pr572-b80ff7c3/evidence-index.json`. The preserved original evidence states that pre-correction raw build/test/boot logs could not be found; no historical logs were recreated. Full corrected runtime proof and logs are under its `runtime/` directory.
