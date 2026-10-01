# PR #528 — independent GPT-6 Sol security review

**Reviewed head:** `9424583d9219c1a7806184515a1f92d73ef98994`  
**Base:** `8f3f82300c6f400f9318102e181c8332825b5ceb`  
**Reviewer independence:** Fresh GPT-6 Sol context. I did not author, direct, or remediate this candidate.  
**Verdict:** **CLEAR** for this bounded security review. No blocking or non-blocking finding in the pending-action self-read paths. This verdict does not attest incomplete CI or P4 stage completion.

## Scope and security reasoning

Read `AGENTS.md`, the agent workflow, `CLAUDE.md`, SDLC/coding standards, current status and decision log, the pending-actions contract, and the previous Sol blocker on head `632b25a`. Inspected the full base-to-head file list and relevant source, the remediation delta, both Luna review reports at this exact head, and the six real-HTTP/Postgres integration cases. Traced the public routes through the API guard, API-key and session authentication, route policies, `resolveIdentity`/`resolveIdentityFromFacts`, list/detail queries, DTO schema, cursor handling, and audit writer.

The prior blocker is resolved: list and detail each call `resolveIdentity` before any pending-action lookup or viewed audit. Its current database user/person facts reject inactive people and banned users; key facts require an enabled key owned by the authenticated user. Inapplicable customer identities fail closed. An absent identity returns 401 on both routes, while a valid identity receives 404 for a missing or foreign detail ID. The production API-key path supplies the verified key's owner and enabled fact; neither read route accepts a user or key identity from request parameters. The new regression sends real HTTP requests using still-valid keys after deactivating or banning their owners, checks list and detail return 401 without the summary, and checks that no viewed audit exists.

The list, total count, and detail predicates bind to the resolved person ID; list additionally requires `pending` state, while detail permits any state for outcome polling. The requesting-key-name join is constrained to the authenticated user's key and API-key origin. The response maps an explicit schema-validated field allowlist: internal payload/hash, route key, credential ID, step-up token ID, trace, and error are absent. The bounded cursor validates its shape and timestamp and applies the same `(created_at DESC, id DESC)` order as the keyset predicate. Each returned summary awaits a `pending_action.viewed` audit with the current viewer, API-key ID when applicable, and current request trace; audit failure prevents the response.

## Verification and limits

I ran `git rev-parse HEAD`, `git diff --stat`, `git diff --check` (clean), exact remediation diff inspection, and `gh pr list`, `gh issue list`, and `gh pr view` to verify the live head/base and check state. I did not run tests, Postgres, a build, or a performance probe in this reviewer context because the P0 profiling lane has the host CPU. The author reports six focused real-Postgres tests passing and all three API TypeScript configs/OpenAPI checks passing; I inspected the tests but did not reproduce those results. At my live check, the hosted Postgres integration job was still in progress and the PR-template/security-review check was red pending a current committed note. Those gates must be resolved on the exact merge candidate.

This PR adds bounded self-read endpoints only. Approval execution, step-up, expiry/invalidation workers, DELETE retrofit, UI, and P4 stage completion remain outside this review. No screen was changed.

## Review links and note-only continuation

- [Independent Sol security review](https://github.com/ThomasHeinThura/ticketing/pull/528#issuecomment-5923601567).
- [Independent Luna review 1](https://github.com/ThomasHeinThura/ticketing/pull/528#issuecomment-5923566517).
- [Independent Luna review 2](https://github.com/ThomasHeinThura/ticketing/pull/528#issuecomment-5923583090).

Every commit after reviewed source head `9424583d9219c1a7806184515a1f92d73ef98994`
is restricted to this security review artifact. Source or test changes require a fresh
exact-head review at the applicable tier. CI and image build/boot/health are checked
separately on the final merge candidate; this note does not waive any gate.
