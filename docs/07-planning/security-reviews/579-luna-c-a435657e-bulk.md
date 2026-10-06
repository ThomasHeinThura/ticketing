# Ordinary bulk review C — GPT-6 Luna

**Reviewed head:** `a435657e747b8c12ceb5784e1c991a70a175c51c`  
**Comparison base:** accepted remote main `8ddb9de8d4d242a0832f6f91e12872300480a905`  
**Independence:** Fresh reviewer context C. I did not author, direct, or remediate this candidate. I read the review packet for task constraints and evidence pointers; verdict below comes from my own source/spec inspection and live checks. No prior reviewer verdict is adopted as my finding disposition.

## Verdict

**BLOCK — three blocking contract/security findings remain.** This review does not clear the candidate. The exact-head required CI also has failures/pending jobs described below; that is a factual gate state, not a substitute for source review.

## Scope checked

Reviewed the accepted-main-to-candidate risk surface, including:

- Pino structured logger, allowlist validation/redaction, Prometheus registry and internal `/metrics` listener; God Mode settings/version CAS and token rotation/step-up.
- Local-factor proof issuance/consumption and operation/version/body binding.
- Native WebSocket upgrade host/origin/session checks, topic authorization, reauthorization, event delivery, and persisted-mutation test seams.
- Permission evaluator/identity resolution and relevant route policy, workspace capability, `instance:admin` and `sees_all` rules.
- Shadow evaluation provenance/fail-closed behavior, audit append/failure notification, and migrations/schema journal presence relevant to these paths.
- The browser committed-state claim and two-session receipt referenced by the packet, plus the exact-head hosted jobs available during review.

Normative contracts read: `docs/01-architecture/{auth-and-identity,security-model,rbac,realtime,observability,pending-actions,events}.md`, `docs/03-features/audit-trail.md`, and `docs/04-engineering/ci-cd.md`.

## Blocking findings

### B1 — Work-item topics remain subscribable when their project is archived

`apps/api/src/ws/native-work-item-realtime.ts:110-127` checks the work item’s `archivedAt`/`deletedAt` and the project’s `deletedAt`, but does not check `projectTable.archivedAt`. The corresponding REST reach lookup in `apps/api/src/work-item/require-work-item-reach.ts:130-141` excludes deleted work items, archived work items, and deleted projects, while the canonical work-item live invariant in `apps/api/src/work-item/assert-work-item-live.ts:45-65` excludes both deleted and archived projects. Thus a `work_item:{key}` subscription can be accepted for an item in an archived project, even though the equivalent detail route returns not found. The timer reauthorization repeats the same predicate, so it does not revoke that subscription. This contradicts the realtime contract’s “archived … otherwise unreadable resource” denial and permits events to continue to that topic.

### B2 — Native sockets are not wired to existing authorization/session invalidation signals

`apps/api/src/ws/native-work-item-realtime.ts:154-176` schedules reauthorization only with `setInterval(..., 60_000)`. A search of the candidate’s WebSocket/auth invalidation paths found no native-connection callback on session, identity, membership, role, or project invalidation; `reauthorizeNativeConnection` is otherwise only exported. This means revoked sessions and lost reach remain usable until the next timer tick (up to 60 seconds), and project/role changes have the same stale-subscription window. `docs/01-architecture/realtime.md` requires refresh on the 60-second floor **and** on existing invalidation signals, and says revoked sessions close the socket. Wire the native connections to those signals, retaining periodic reauthorization as fallback.

### B3 — New native realtime failure handling writes raw exceptions outside the safe logger

`apps/api/src/ws/native-work-item-realtime.ts:52-55,262-265` passes caught exception objects to `console.error`. This new runtime path bypasses the Pino allowlist and its redaction, and can serialize arbitrary exception text. `docs/01-architecture/observability.md` explicitly prohibits arbitrary exception text and requires explicit typed allowlisted log events. Replace these calls with finite safe events/counters that omit the exception object. Pino redaction does not protect data sent directly to `console.error`.

## Checks and evidence actually verified

- `git rev-parse HEAD`: exact reviewed SHA above. `git status --short --branch`: clean before and after review.
- Live fast CI run `37191389224`: **12/12 non-review jobs passed**. The separate `pull request template + security review` job failed. Its actual log reports three template problems: the security review note is stale (oldest usable reviewed head `64d3ce895`), G11 is written as `pending`, and the independent-review checklist remains unticked. I make no claim that this check is a source defect or that a reviewer note would waive the underlying gate.
- Live full CI run `37191389219`: at last check, G11 was **failure**, PostgreSQL integration was **in progress**, visual regression/G8 and accessibility were **success**, and protected-route E2E was **failure**. The failed E2E job log was unavailable until the overall run completes, so I do not state its cause or final suite counts. No full CI pass is claimed.
- Exact-head CodeQL run `37191388961`: CodeQL analyses completed successfully for actions and JavaScript/TypeScript. This is analysis completion, not disposition of findings.
- Exact-head optional AI code scan `37191392539`: failed with verified HTTP 402 monthly quota. It yields no security verdict.
- Attempted scoped Vitest invocation for logger, metrics listener/metrics, native realtime, local factor, identity resolution, and permission evaluator tests from repository root. It did not start: `pnpm exec vitest` reported `Command "vitest" not found` (exit 254). I did not install dependencies or reinterpret the unavailable run as a pass.
- Runtime/image/traffic, database, browser, Docker, build, benchmark, and heavy wrappers were not run, consistent with the packet’s coordination limits. The packet’s stated exact-head image/browser evidence and its explicit incomplete private proof remain author-supplied evidence; I did not independently reproduce them. In particular, the incomplete private proof earns no clean-date credit.

## Other reviewed security/contract observations

- Metrics listener is a separate fixed-port listener, accepts exact `GET /metrics`, validates canonical 32-byte base64url bearer syntax, reads the current digest per request, and uses constant-time digest comparison. Its dedicated registry bounds metric names/labels. God Mode token rotation is session-only, requires operation-bound single-use step-up, uses a version CAS, and stores the digest rather than plaintext.
- Settings PATCH and rotation both condition writes on `observability_config_version`; no lost-update defect found by inspection. Audit append failures after committed settings changes increment the bounded counter and attempt durable admin notification.
- Step-up proof checks actor/session/operation/route/version/body hash, expiration, and one-time consumption in the transaction. Password proof is rejected when a factor is required/enabled; unavailable factor paths deny.
- Permission resolution rejects malformed/ambiguous membership and only creates `instance_admin` reach from the user’s actual instance role; workspace capabilities still derive from a workspace-scoped role. I found no path in the inspected identity/evaluator code that mints `instance:admin` or `sees_all` from a workspace role or IdP assertion.
- Shadow observer evidence is separated from native decisions, and unavailable facts remain unevaluated in the inspected path. I found no new shadow observation that turns a native denial into authorization.
- The two-session committed-state browser receipt is referenced and described in the packet, but I did not open a browser or independently rerun it.

## Limits

No code was changed. This ordinary review is not the required GPT-6 Sol security review, is not the P0 phase finalizer, and does not clear known CodeQL alerts. The full hosted run, required Sol review, any browser/runtime proof still outstanding, and independent review-panel requirements remain separate gates.
