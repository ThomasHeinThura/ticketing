# PR #573 — proposed WebSocket Origin contract

**Reviewed head:** `fd5f6afc02cdd1bbff5967ca729a11c433a1169b`
**Comparison base:** `ad1d5238b02532f0a814b3fa586175a7e660f657`
**Scope:** Spec-only proposal in `docs/01-architecture/realtime.md` and
`docs/01-architecture/security-model.md`; current Node WebSocket handlers and
`authenticateApiRequest` behavior were inspected to check the proposal against its actual
transport and credential paths. No implementation, authority code, or CI semantics changed
in the reviewed source.

This record captures independent review evidence. It is not the review itself, an approval
of Thomas's finished-spec read, an implementation acceptance, or a closure of #560.

## Review chronology

1. **Initial ordinary review A — GPT-6 Luna, CHANGES REQUESTED.** GitHub review
   [5388971948](https://github.com/ThomasHeinThura/ticketing/pull/573#pullrequestreview-5388971948),
   submitted `2026-10-02T06:44:26Z`, reviewed initial source
   `f40774e2a2d7beb005776447e53dbe7652b9a805` against the base above. It found one blocking
   specification gap: the contract had not classified an explicit Bearer token that resolves
   an existing session. The review otherwise checked the Host/origin rules, malformed and
   duplicate Origin rejection, API-key compatibility, and the separate stored-portal/two-host
   work. The author addressed this classification in the proposed spec at the reviewed head
   below; this remediation is not independent review evidence.
2. **Ordinary review A — fresh independent GPT-6 Luna, CLEAR.** GitHub review
   [5389064383](https://github.com/ThomasHeinThura/ticketing/pull/573#pullrequestreview-5389064383),
   submitted `2026-10-02T07:00:07Z`, reviewed exactly
   `fd5f6afc02cdd1bbff5967ca729a11c433a1169b` against the base above. Scope included the
   complete two-file diff, mounted WebSocket handlers, API-key verification, request
   authentication, and pinned Better Auth configuration. It confirmed that the proposal
   classifies a session-resolving Bearer path separately from API keys and records the
   unsupported bare session-token case as a 401. Verdict: no findings.
3. **Ordinary review B — fresh independent GPT-6 Luna, CLEAR.** GitHub review
   [5389084770](https://github.com/ThomasHeinThura/ticketing/pull/573#pullrequestreview-5389084770),
   submitted `2026-10-02T07:03:39Z`, reviewed exactly the same head and base. Scope was the
   complete diff in `realtime.md` and `security-model.md`, the #560 contract and cited
   security/auth sources, current WebSocket/authentication code, and Better Auth 1.6.30
   behavior. No blocking finding. It recorded one non-blocking diagram clarity note: label
   the illustrated flow as the cookie case or qualify “no session” as “no valid credential,”
   since the normative contract allows a sessionless API key without Origin.
4. **Full security review — fresh independent GPT-6 Sol, CLEAR.** GitHub review
   [5389137456](https://github.com/ThomasHeinThura/ticketing/pull/573#pullrequestreview-5389137456),
   submitted `2026-10-02T07:11:24Z`, after both ordinary clears and on the same exact head.
   Scope covered the complete two-file diff; repository security, workflow and decision
   context; #560 and ADR 0004; session/portal and HTTP CSRF authority; both mounted Hono
   Node routes; API-key/session arbitration; and pinned Better Auth 1.6.30 signed-cookie
   behavior with `bearer()` absent. Verdict: clear for the proposed specification; no
   blocking security findings. This is a COMMENT review, not approval of the finished spec
   or its implementation.

## Current-source residuals and review notes

- The exact-head proposal resolves the initial Bearer-session classification blocker at the
  specification level only. Current `authenticateApiRequest` trims `x-api-key` and tests
  its truthiness, so a present empty or whitespace-only key can fall through to an
  accompanying valid cookie. It also ignores an unrecognized non-Bearer `Authorization`
  scheme, allowing the cookie path to run. Under the proposal's explicit-credential
  no-fallback rule, implementation must distinguish header presence from a usable value
  and define/test the non-Bearer scheme case. Any resolved cookie session remains subject
  to the proposed Origin check; these are implementation deltas, not a spec-level Origin
  bypass.
- The current proposed real-listener cases name unknown and wrong-port `Host`, but not a
  duplicated/ambiguous `Host`. The normative rule requires the request host to identify
  exactly one configured origin; include the duplicate-host raw-header case when specifying
  implementation tests.
- The current diagram is understood as an illustrative cookie flow. Its generic-looking
  “reject if no session (401)” wording can be labeled as the cookie case or changed to “no
  valid credential” to make the API-key-only exception obvious. This was non-blocking and
  no spec prose was changed in this note-only task.
- The orchestrator's PR description records a certificate-validated OrbStack observation at
  `2026-10-02T06:54:12Z`: the current `/api/ws/user` returned `101` with a valid admin cookie
  for both missing and foreign Origin. That is existing implementation-gap evidence, not a
  reviewer-run test and not a result of this spec PR. Current handlers do not enforce the
  proposed Origin/Host contract.

## Checks and limits

The three exact-head reviews report `git diff --check` passed. Reviewers ran no tests,
build, Docker, PostgreSQL, Playwright, browser, or runtime checks; no such execution is
attributed here. The initial review's blocker is retained as history and is resolved only
in the proposed contract at the reviewed source head.

Thomas's finished-spec read and approval, the three owning High review-section dispositions,
stored `session.portal`, two-host auth-instance/cookie lifecycle, legacy-session migration,
real Node listener tests, browser evidence, implementation, and #560 closure remain pending.
This note does not claim any of them, P0 completion, or merge readiness.
