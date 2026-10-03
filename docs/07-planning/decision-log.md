# Decision log

Decisions too small for an [ADR](../01-architecture/adr/README.md) but worth recording:
dependency choices, convention changes, scope calls, gate waivers.

Newest first.


### 2026-10-03 · Resolve the P4 break-glass implementation contract

**Decision:** the orchestrator selects the recommended recovery contract in
`auth-and-identity.md` for issue #230 under Thomas's standing instruction to proceed with
recommended decisions and implement complete batches. This is implementation authorization,
not Thomas's P4 design approval, a gate waiver, or proof that a CLI exists.

Use the existing `user.role = 'admin'` authority source, exactly one eligible active staff
identity, a passwd-resolved service process identity with human attribution retained in host
Docker audit records, TTY confirmation outside locks, and the shared promotion advisory lock.
Revalidate displayed state and lock both target user and staff person before granting. Grant,
append-only audit and durable security alerts are atomic; failure rolls back the grant.
Already-admin use is authority-idempotent but audited. Email occurs after commit; failures
report the committed state and aggregate delivery failure, with durable alerts retained.
Register finite notification payloads/templates canonically before their writers. Existing MFA
policy continues to apply; no IdP linking, user creation, activation, or parallel grant path is
introduced. The complete CLI batch needs fresh independent authority/security review before
protected acceptance. Human P4 acceptance remains outstanding.

### 2026-10-03 · Complete the existing cookie CSRF requirement in the P0 implementation batch

**Decision:** implement security-model.md's existing Origin/Referer **and** double-submit
requirement for unsafe custom API requests authenticated by an ambient session cookie.
Session-only authorization is not CSRF protection. Exemption depends on actually resolved
nonambient credentials, not the presence of an Authorization or API-key header.

The bounded implementation contract is authenticated `GET /api/me/csrf-token`, returning
`{token, expiresAt}`, with a signed token bound to the current live session and configured
agent origin, a random nonce and a ten-minute expiry. The HTTP-only host-only cookie is
`__Host-tdk_csrf` on HTTPS (`Secure`, `SameSite=Strict`, `Path=/`, no `Domain`); explicit HTTP
development uses the documented signed `tdk_csrf_dev` fallback. Unsafe session requests
must supply the same token in `X-TaskDesk-CSRF` and a valid same-origin source. Referer may
substitute only when Origin is absent; a supplied malformed, null or foreign Origin cannot
be repaired by Referer. No browser-storage token is introduced. The issuer reuses a valid
token to avoid invalidating another tab; any client retry is limited to a distinct CSRF
failure rejected before mutation, never a generic permission or step-up denial.

BetterAuth's own public authentication endpoints retain their separate origin protections;
the disabled P0 portal API remains unavailable. The custom API boundary must not grant a
new capability or relax any session realm, factor, impersonation or step-up requirement.
Server enforcement, client transport, fixtures and actual negative/positive journeys form
one full implementation batch before bulk review. This records implementation direction,
not independent acceptance or a gate waiver.

**Authorization:** the orchestrator's recommended implementation choices under Thomas's
standing direction to finish all necessary P0 features and proceed with recommended
decisions. The authoritative requirement remains in security-model.md.


### 2026-10-03 · P0 structured logging and metrics dependencies authorized

**Decision:** Thomas explicitly approved adding Pino and prom-client in this chat on
2026-10-03. The P0 runtime implementation uses exact pins `pino` 10.4.0 (MIT) and
`prom-client` 15.1.3 (Apache-2.0), verified against the npm registry and the projects'
official release records. Node 24 satisfies the metrics client's declared engine range.
The registry marks prom-client deprecated in favor of its renamed successor
`@prometheus-io/client`; this entry authorizes the explicitly approved package, and does
not silently add another dependency. Runtime APIs, singleton configuration, labels, token
handling and listener boundaries follow observability.md and api-design.md.

**Scope:** these dependencies support the still-missing P0 logging and metrics runtime.
Installing them alone does not establish instrumentation, a usable metrics listener,
durable AU-14 administrator alerts, acceptance, deployment or phase completion. The full
implementation is batched before independent review.

**Decided by:** Thomas, explicit dependency-approval reply; recorded by the orchestrator.

### 2026-10-03 · Native work-item realtime uses one subscribed socket and key-only outbox hints (#570)

**Decision:** P0 work-item subscriptions use `GET /api/ws` on the agent origin and explicit validated `subscribe` / `unsubscribe` frames for `project:{projectId}` and `work_item:{key}`. The separate legacy user socket continues to deliver notifications, and the legacy project socket continues to serve existing Task-model consumers; neither is the native work-item event path. The native server resolves topic resources from persisted project/work-item relationships and applies the same read capabilities and row/project reach as REST. Missing and unreadable topics have the same denial frame. Agent-host session Host/Origin/portal checks remain those in ADR 0004 and `realtime.md`.

CP-19 takes precedence for the customer portal public edge in P0: every portal `/api` request and websocket upgrade is a generic 404 before auth/session/API-key lookup or other handler effects. This includes `/api/ws` and `/api/auth/*`. The separately configured `portalAuth` instance and its host-only cookie binding are not reachable through that edge and do not enable portal login or realtime. P0 tests the binding directly as an internal configuration property while separately proving the public portal edge stays denied. Portal socket availability requires the later reviewed P3 identity boundary and a corresponding CP-19 change.

Every supported native work-item mutation writes one existing canonical event envelope to `outbox` in its mutation transaction. After commit, best-effort socket fan-out sends only `{type, topic, eventId, at, payload:{key}}`; domain payloads and internal-only comments/changes are never sent to customer subscriptions. Fan-out is an at-most-once invalidation hint, not a new replaying outbox consumer; reconnect refetch and 30-second foreground fallback repair missed messages. Existing event keys, outbox schema, capabilities, feature defaults, and polling assertions remain authoritative.

This resolves the route, topic authorization, projection, deduplication, delete timing, and failure/recovery choices needed by #570. It does not close the owning architecture/feature review rows, claim independent review, or claim P0 completion. The reviewed spec and exact-head implementation still require the ordinary bulk panel and GPT-6 Sol security review.

**Authorization and status:** the orchestrator authorized these bounded recommended defaults on 2026-10-03. This entry records implementation choices, not review or acceptance evidence.

**Recorded by:** GPT-6 Luna implementation lane, 2026-10-03.

### 2026-10-01 · Keep the P0 portal origin disabled until portal identity exists

**Decision:** the two-entry P0 server selects the agent or portal app only from a
validated raw Host matched to the configured public origins. Until the separately reviewed
P3 identity boundary exists, the portal root serves the localized disabled notice, every
portal API and websocket request returns a generic 404 before handler effects, and only
the exact existing GET/HEAD health paths remain available on either configured origin and
on a syntactically valid unknown Host. This exception preserves the loopback probes used by
Docker and deploy.sh; malformed, missing, duplicate, or upgraded authorities are rejected.
Static files come only from the selected output root; missing roots fail closed. The agent
URLs and behavior stay unchanged. See customer-portal.md `CP-19` and phases.md's P0
acceptance matrix. G5 metadata and inventory scope follow the existing
[2026-09-28 gate-scope decision](#2026-09-28--10s-gate-scope-semantics-decided-applicable-now-gates-required-future-stage-gates-activate-with-their-prerequisite):
all generated and inherited routes remain registered and round-trip checked, while only
in-progress or complete inventory routes are claimed active; planned URLs remain planned.

**Why:** selecting a portal bundle by Host alone would expose the current agent auth/API/
websocket surface on the portal origin. ADR 0004 requires two origin-scoped portals, while
P3 owns the portal auth pair and session boundary. The interim response keeps the portal
unavailable without inventing a customer session, flag, capability, environment variable,
database field or permission.

**Recorded by:** orchestrator under the standing approval of recommended implementation
decisions. This records the interim implementation contract; it does not approve H1–H6 or
claim P0 completion.

### 2026-10-02 · Implement P0–P3 features before integrated P4 human review

**Decision:** implement the full related P0–P3 feature set first, then conduct its integrated
bulk review. Early Thomas spec-read, design-review, and H1–H6 approval are not prerequisites
for P0–P3 implementation. Human review is deferred to the integrated P4 review; record it as
deferred and never claim H1 approval before it occurs. Approved contracts and documented
recommendations explicitly authorized by the user are implementation direction now, including
the documented #573 recommendation. If the written contract does not settle a behavior, do
not guess; pause only that decision path and record the unresolved point.

For development and UAT P0 policy-shadow verification, use three issue-free UTC calendar-date
buckets, superseding the earlier approximately seven-day UAT wait for this P0/UAT purpose.
Require source-bound behavior and router coverage across all three dates; matching existing
representative evidence may count, and note-only or mechanical changes that do not affect the
tested behavior do not restart the window. Run performance, unit, integration, and browser
checks as soon as the batch is ready, without waiting for the shadow window. Elapsed time does
not clear known failures; synthetic backfill is not evidence. Prioritize necessary P0 work and
avoid unrelated features.

**Boundary:** this defers human approval; it does not fabricate it, waive automated or
independent review, weaken exact-head/CI/security/stage-finalizer requirements, or authorize an
unreviewed merge. P0–P3 technical stage closure may record the human design review as deferred
to P4 when every other applicable criterion, including automated/browser checks and the
stage-level GPT-6 Sol finalizer, is satisfied. The three-day UAT/P0 rule is not a production
cutover requirement. Separate production/go-live criteria apply only to an actual production
promotion; this decision does not change them.

**Decided by:** Thomas, explicit user instruction, 2026-10-02. See the canonical
[bulk-review and human-review timing rules](../../AGENTS.md#bulk-implementation-and-review-cadence),
[SDLC](../../04-engineering/sdlc.md), and [runbook](../05-operations/runbook.md#policy-shadow-summary).

### 2026-10-02 · Development/P0 policy-shadow verification uses three issue-free UTC dates

**Decision:** for development and P0 verification, use three issue-free UTC calendar-date
buckets for policy-shadow evidence instead of the former approximately seven-day development
wait. Require actual, source-bound coverage showing the tested behavior and relevant routers
were exercised across all three dates. Existing representative three-day evidence counts when
it covers the same source and behavior. Do not automatically restart the window for note-only
or mechanical changes that do not affect tested behavior.

Run performance, unit, integration, and browser checks as soon as the implementation batch is
ready; do not wait for the shadow-soak calendar. Known failures do not become passes through
elapsed time, and synthetic backfill is not evidence. Prioritize necessary remaining P0 work
and avoid unrelated feature scope.

**Boundary:** this changes development/P0 verification cadence only. The separate
production/go-live acceptance criteria, including the roughly seven-day UAT shadow requirement
in the 2026-09-23 runtime policy decision, remain unchanged. A three-date query selects exactly
three UTC date buckets; it does not by itself prove 72 hours or full-day coverage.

**Decided by:** Thomas, explicit user instruction, 2026-10-02 15:10 UTC. See the
[development shadow summary](../05-operations/runbook.md#policy-shadow-summary) and canonical
[agent instruction](../../AGENTS.md).

### 2026-10-02 · Bulk implementation and review cadence

**Decision:** implement related approved slices and known-finding fixes in coherent,
substantial batches. Do not start a standalone review pass for small or mechanical edits or
speculative trials. Run meaningful tests while implementation proceeds, freeze the final bulk
candidate SHA, then perform the applicable independent review panel and required GPT-6 Sol
security review before protected merge. Fix review findings together and review the resulting
delta at its required tier; do not add automatic extra rounds for comfort. Tiny urgent fixes
may join the next batch unless the user explicitly requests isolated delivery.

**Guardrails:** existing risk-based reviewer counts, exact-head discipline, security review,
required checks, stage finalizers, self-review prohibition, no-waiver rule and main protection
remain unchanged. This decision does not authorize unreviewed merges or a downgraded review
tier.

**Recorded:** explicit user direction, 2026-10-02 Asia/Yangon (UTC+06:30).
Canonical rule: [AGENTS.md § Bulk implementation and review cadence](../../AGENTS.md#bulk-implementation-and-review-cadence);
workflow and OpenAI operating guide cross-reference it.

### 2026-10-02 · P0 production advisory floors for ip-address and fast-uri (#557)

**Decision:** raise only the existing pnpm override floors for `ip-address` to `^10.7.1`
and `fast-uri` to `^3.1.8`, and regenerate the lockfile. Registry metadata was reverified
on 2026-10-02: `ip-address@10.7.1` is MIT and requires Node >=12; `fast-uri@3.1.8` is
BSD-3-Clause. The final compatible lock graph resolves `ip-address@10.7.2` and
`fast-uri@3.1.8`. The accepted `main@917c93ad` production audit contained four moderate
`ip-address` advisories and one moderate `fast-uri` advisory; it was not five advisories
from `ip-address` alone. `pnpm audit --prod` reports zero advisories after these floors.

No audit threshold, ignore list, or unrelated override was changed. This is limited to
the two existing transitive packages and does not assert an application-level exploit.
The Hono/WebSocket migration's separate Origin/session-portal limitation remains open
under [#560](https://github.com/ThomasHeinThura/ticketing/issues/560); these dependency
floors do not fix or waive that finding.

**Authorization and status:** Thomas's standing recommended-decision authorization covers
these bounded patched-version floors. Registry metadata, lock consumers, and the direct
production audit were checked; this entry is not independent review or acceptance evidence.

**Recorded by:** GPT-6 Luna implementation lane, 2026-10-02.

### 2026-10-02 · P0 API upgrades use the patched Node adapter WebSocket helper (#557)

**Decision:** `apps/api` owns direct exact runtime dependencies `hono@4.13.12` (MIT),
`@hono/node-server@2.1.3` (MIT), and `ws@8.22.0` (MIT), plus development-only
`@types/ws@8.18.2` (MIT). Remove `@hono/node-ws@1.3.1`: its peer range requires
`@hono/node-server@^1.19.11` and excludes adapter 2.x. Raise the single pnpm override floors
to Hono `^4.13.12` and Node adapter `^2.1.3`. Use `upgradeWebSocket` from
`@hono/node-server`, with one `ws` `WebSocketServer({ noServer: true })` passed to the
existing HTTP `serve()` listener.

The migration preserves authentication before upgrade, user-route precedence, project
reach checks and indistinguishable foreign/missing rejection, `windowId`, JSON events,
ping handling, fan-out, close cleanup and bounded server shutdown. Public static files stay
under the existing public build root, attachments stay private, and the adapter's default
`allowPercentInPath: false` remains in force. The integration coverage exercises the real
Node listener, including auth/reach handshakes and HTTP JSON/CORS/static/health behavior.

**Security limitation:** `session.portal` is absent from the current session schema; runtime
identity currently infers portal from identity side. This change does not add an Origin or
session-portal binding and does not claim that the existing realtime contract is satisfied.
The concrete owner follow-up is tracked in [#560](https://github.com/ThomasHeinThura/ticketing/issues/560),
linked to #38 and #8; the existing High realtime finding remains open.

**Authorization and status:** Thomas's standing recommended-decision authorization covers
these direct dependencies and adapter choice. Registry metadata and licences were
reverified on 2026-10-02. This decision records the implementation direction; it does not
establish runtime acceptance, close the Origin/session-portal gap, waive review gates, or
claim P0 completion.

**Recorded by:** GPT-6 Luna implementation lane, 2026-10-02.

### 2026-10-02 · Identity grant validity is commit-time; SCIM administration PATCH is route-wide elevated

**Decision:** use `IP-22` as the single proposed source-validity and effective-projection
invariant for every TaskDesk-controlled connection-policy, mapping-eligibility, role-eligibility
or role-priority write. At commit, each affected active external grant must satisfy current
source, connection, mapping, scope, role and ceiling rules; the stored effective membership
must be recomputed from all remaining valid sources, including priority-only changes with no
retirements. Retire source history append-preservingly; a retired external grant returns only
after fresh evidence from that same source. Role/config/provider writers use the shared total
lock order, closure re-read and full-transaction retry in IP-22. Preserve direct-grant
independence, source isolation, the existing one-role projection, and the distinction between
authority-cache invalidation and session revocation. No new schema, capability or event key is
introduced by this proposed contract. ADR-0015 remains Proposed.

The existing `PATCH /api/instance/identity-connections/{id}/scim` administration route is
proposed as unconditionally `instance:admin`, elevated and session-only for every write.
It is not usable until its owner defines the strict DTO/edit semantics, parent
`identity_connection.config_version` compare-and-set and dedicated PA-15 operation binding.
Until that contract exists, any mounted write must fail closed with `403 step_up_unavailable`
and make no mutation. [Issue #561](https://github.com/ThomasHeinThura/ticketing/issues/561)
tracks the owner obligation. Do not infer an operation key or reuse OIDC/metrics proof.

**Why:** the current contract left materialized JIT grants or role winners stale after policy
and rank changes, while conditional elevation on one PATCH route depended on request-body
semantics that were not specified. One commit-time invariant closes the repeated lifecycle
class; route-wide elevation removes a body-selected policy branch. The missing SCIM proof
contract remains explicit rather than being guessed.

**Authorization and status:** selected under Thomas's standing recommended-decisions
authorization. This entry does not approve ADR-0015, close owning review rows 81–82, satisfy
Thomas's finished-spec read, waive a gate, or claim implementation, runtime tests, Entra or
browser evidence, independent reviews, H1–H6 or P3 acceptance. See [IP-22](../03-features/identity-provisioning.md)
and [ADR 0015](../01-architecture/adr/0015-membership-grant-provenance.md).

**Recorded by:** orchestrator, 2026-10-02.

### 2026-10-02 · Entra app-role admission applies to every Entra login

**Decision:** extend `IP-27`'s exact Entra app-role and signed `acct=0` admission predicate
from new JIT creation to every Entra connection and login, including existing invite- or
SCIM-provisioned identities when JIT is disabled. Every Entra connection must store one
exact nonempty `required_entra_app_role` in the existing
`identity_connection.jit_policy` at creation/configuration save and before enable; toggling
JIT cannot waive it. A valid protocol-validated token that lacks the configured role or
`acct=0` denies a new session and atomically retires only that external identity's OIDC/JIT
grants. Invalid/unverified tokens or invalid persisted server configuration are not
revocation evidence and mutate no grants. Direct, SCIM and other-connection grants remain
untouched. An already-issued session is not revoked solely by upstream app-role removal;
the admission change takes effect at the next validated login. The app role and `acct=0`
remain IdP admission signals and cannot grant TaskDesk roles, capabilities, scope,
`instance:admin` or `sees_all`. JIT remains a separate person/default-grant creation switch.

**Why:** a login-time admission requirement cannot depend on whether the existing identity
was originally created by JIT; otherwise the same Entra connection has no coherent
admission contract after SCIM or invitation provisioning.

**Authorization and status:** recorded under Thomas's standing recommended-decisions
authorization after the cross-contract source check. This does not approve ADR-0015, close
owning review rows 81–82, establish finished-spec read, waive a gate, or claim
implementation, tests, Entra/browser evidence, H1–H6 or P3 acceptance. See
[IP-27](../03-features/identity-provisioning.md) for the normative rule.

**Recorded by:** orchestrator, 2026-10-02.

### 2026-10-01 · P0 public docs site uses headless Fumadocs and static export

**Decision:** recommend a fresh self-hosted documentation site at `apps/site`, using Next.js static export with headless Fumadocs. `fumadocs-core` supplies source/navigation/search data and `fumadocs-mdx` compiles local MDX; compose interactive controls from `@taskdesk/ui` and existing tokens. Do not import `fumadocs-ui`, copy kaneo's marketing app, or copy Mintlify content. The site is separate from the Vite agent/portal app and does not change its shared route registry.

The proposed exact direct npm dependencies are `next@16.3.8` (MIT), `fumadocs-core@16.15.17` (MIT), `fumadocs-mdx@15.4.5` (MIT) and development-only `@types/mdx@2.0.14` (MIT). Reuse React `19.2.8`, `react-dom`, TypeScript, Tailwind/tokens and `@taskdesk/ui`. Zod `^4.6.5` and MDX tooling are transitive and require resolved-license/advisory inspection at implementation. These are recommendations for a future implementation, not installed dependencies or an authorization to change a manifest or lockfile.

P0's public routes are `/`, `/docs`, `/search` backed by a generated static search index, and a true static 404. If the pinned Fumadocs build cannot produce working static search, remove `/search` from P0 and amend the site contract before implementation; do not ship a nonfunctional search control. Content is limited to verified existing behavior and stays separate from internal `docs/`. The site has no API proxy, auth, personalization, analytics or feedback endpoint.

The separate image is proposed to use `nginxinc/nginx-unprivileged:1.30.5-alpine3.24@sha256:ed04ec1ff34502c339ee5c3ae3f855442398edc1d05591e2b98981dcbbd20b1e`, subject to digest/platform verification and image SBOM/license review at implementation. Its static site origin is planned as `docs.<domain>`, separate from both app origins and the conditional `files.<domain>`. Build, scan, SBOM, sign and publish on protected `main`; do not deploy from CI. Deliver to UAT through the existing pull process and promote to production manually by immutable digest. The docs plan records static serving, proxy and health-check behavior.

**Why:** static export avoids a public runtime service and request-dependent behavior. Headless Fumadocs allows TaskDesk to use its own shared design system without importing a second UI library; an independently hosted docs origin keeps public documentation content away from authenticated application origins.

**Authorization and status:** recorded under Thomas's standing recommended-decisions authorization. This entry does not assert that Thomas read the completed specification, grant H1–H6 approval, waive dependency/review gates, or establish implementation, deployment or stage completion. The proposed dependencies remain uninstalled.

**Recorded by:** docs-site specification author, 2026-10-01.
### 2026-10-01 · G11 failure evidence avoids timed DOM snapshots and raw network secrets

**Decision:** G11's Playwright run retains failure traces with actions, screencast, source,
and attachment data, but disables automatic DOM snapshots during timed samples. Playwright
1.63 also leaves its trace network files empty in this mode. Each benchmark context therefore
attaches a separate bounded, sanitized network summary containing only method, a closed
known-safe benchmark route template (or the fixed label `unrecognized`), resource type,
finite response status, and available finite timing. It may include a boolean request-failure
flag. Dynamic path values are always replaced by fixed placeholders, independent of their
contents; unknown path shapes retain no path detail. It retains no raw request or response
objects, headers, cookies, bodies, full URLs, or query strings, and reports truncation.
Explicit screenshots taken after measured actions and all functional assertions remain
required.
Playwright DOM snapshot serialization was observed
inside hosted metric windows on exact source `13516958be469aa353d9b5f7e0b113880b31ed17`
(run `36860954427`). This measurement change removes competing instrumentation without
changing product budgets, marks, throttles, fixtures, retry policy, row/card counts, or the
paint-visibility contract. Any resulting timing change requires a new hosted canonical run;
the separate diagnostic profile is not acceptance evidence. Disabling DOM snapshots reduces
DOM-state replay detail.

**Why:** hosted source attribution showed Playwright DOM snapshot serialization executing
inside the timed windows, including recursive document traversal. The separate sanitized
network summary restores useful request evidence without copying query strings or credentials
into a HAR. Closed route templates prevent opaque IDs, including all-letter bearer-like values,
from being retained as path text. This changes how G11 measures rendering and is not evidence
of an application speedup or a gate pass.

**Recorded by:** task orchestrator under the bounded G11 measurement-repair assignment,
2026-10-01.

### 2026-10-01 · P0 observability uses bounded internal metrics and operation-bound rotation

**Decision:** follow the P0 target contract in [observability.md](../01-architecture/observability.md),
[api-design.md](../01-architecture/api-design.md), and PA-15 in
[pending-actions.md](../01-architecture/pending-actions.md). Pino and `prom-client` are
planned choices; no dependencies are added by this decision or the documentation PR, and
no runtime behavior is claimed. Logs use allowlisted, redacted structured records with
trace correlation in log/span context only. Metric labels use finite enums or registered
HTTP route templates; work-item and SLA metrics are instance-wide aggregates. Job and
database-operation producers remain withheld until their owners define finite labels, and
plugin-instance identifiers are not approved dimensions.

The target metrics endpoint is exact `GET /metrics` on a separate internal listener at port
9464, not exposed by a host port or Traefik route. Its bearer is 32 random bytes encoded as
43-character unpadded base64url and only a 32-byte digest is stored. Scrapes reread the
current digest from PostgreSQL. Log-level changes use version compare-and-set and a maximum
five-second refresh. Token rotation is elevated, session-only, bound to the exact
`metrics_token_rotate` route/version/server-canonical `{version}` body, and consumes its
one-use confirmation atomically with the rotation CAS. Existing pending-action ID/payload
binding is preserved. Unsupported required verification fails closed. Current source has no
separate Node metrics listener/manifest, P0 metric producers, factor verifier, or SSO step-up
adapter; the existing Hono `/metrics` fixture is a placeholder, not the target listener.

AU-14 keeps the existing audit-failure behavior: safe counter/log reporting is an operational
signal, not the required durable notification to every current instance administrator; that
notification remains unfinished. RUM, tracing, Sentry, deep health, broad dashboards, and
P4 UI remain deferred.

**Why:** aggregate operating metrics are still sensitive, unbounded labels leak inventory,
and a session-wide elevation window cannot bind rotation to fresh action-specific proof.
Separate listener coverage must complement Hono route coverage.

**Authorization and status:** Thomas's standing recommended-decisions authorization covers
this recommended documentation decision. It does not authorize a gate waiver or establish
implementation, runtime acceptance, or H1–H6 completion.

**Decided by:** Thomas, under the standing recommended-decisions authorization; recorded by
the orchestrator on 2026-10-01.
### 2026-10-01 · Entra JIT admission and home-realm routing are connection-bound

**Decision:** before creating a new person or membership through first-release Entra JIT,
validate the selected connection's exact `iss`, `tid` and `aud`, resolve immutable `oid`
under that connection, require the exact nonempty `required_entra_app_role` configured in
that connection's existing `identity_connection.jit_policy`, and require signed `acct=0`.
Missing, malformed or nonmatching role, missing/malformed `acct`, and guest `acct=1` fail
closed before creation. The Entra app registration must assign the app role and request the
optional `acct` claim. This app role is only an IdP admission signal; it grants no TaskDesk
role, capability, organisation, portal scope, or reach. Other provider JIT remains disabled
until its own subject-admission rule is approved. For unauthenticated customer login
initiation, a typed email domain may route to a configured connection; its server-side
single-use state context binds that connection id, customer portal and persisted
`organisation_id`. Callback claims cannot select or change connection or scope. This routing
is not identity or admission proof. After token validation, a cross-connection domain
collision may deny sign-in; a matching domain never admits. `email`, `preferred_username`,
`upn` and their domains are not address-ownership proof, JIT authority, organisation
selection or identity-linking signals. An unbound typed domain may fall through to existing
non-SSO methods without guessing or creating an organisation. Existing SCIM scope/lifecycle
and no-email-account-linking rules are unchanged. Upstream Entra app-role deassignment alone
does not promise immediate revocation of an already issued TaskDesk session.

The portal does not publish a customer provider or organisation list, but its complete
unauthenticated bound and unbound flows are intentionally distinguishable. A person
submitting a domain may infer that it has a customer SSO binding and see the selected IdP's
public redirect destination, including its host or tenant path. TaskDesk's discovery
surface does not return an organisation or connection inventory, names, ids, domain
inventory, discovery configuration, claim mappings or secrets, or disclose whether a
TaskDesk user account exists; anonymous rate limits reduce bulk probing but do not hide this
domain-specific disclosure. The former assertion that equal initial body, status, or timing
made the full flow non-enumerating is withdrawn. A private preflight that verifies control
of an address before domain routing would change the sign-in
journey and needs a separate design decision; it is not implied here.

Add planned trust negatives as subcases of acceptance test 05, including browser coverage of
complete bound/unbound flows and the permitted and prohibited disclosures, and protocol
negatives under existing test 15. The planned `tests/e2e/security/` suite must cover the CSRF
cases before its applicable security gate is claimed; it is not implemented at this
candidate. Preserve all 25 named P3 acceptance tests and the real-Entra completion gate.
Historical owning-review
rows 81–82 remain active until an independent owner reviewer re-checks and closes them. No
gate is waived and no tests are claimed to have run by this design decision.

**Why:** exact token binding plus a connection-specific assigned app role and explicit
member account type establishes a subject-admission predicate without treating mutable
address claims as proof. `jit_policy` already stores per-connection JIT configuration, so the
additional key is documented in the authoritative data model without a new table or TaskDesk
authority. Domain bindings remain useful for login routing and conservative collision
refusal; accepting the limited domain-to-SSO/IdP-destination disclosure preserves the
specified home-realm flow without claiming equal initial response properties hide the
follow-up redirect. This is an explicit threat-model decision, not a waiver of review or
testing gates.

**Decision-maker:** the orchestrator, adopting its recommended reconciliation under Thomas's
standing authorization, 2026-10-01.

### 2026-10-01 · Notification fan-out uses event parents, delivery children and digest groups

**Decision:** retain exactly one `outbox` row per domain event, with
`outbox.event_id = DomainEvent.id` as the parent primary key and consumer idempotency key.
Materialize one `notification_delivery` row per unique
`(event_id, recipient_person_id, channel)` and one in-app row per distinct event/person in
the originating transaction. A delivery child's own stable `id` owns its provider attempt
and `outbox_dedupe_reservation`; it never replaces the event id. Event-time digest
preferences attach children to a `notification_digest` group in that same transaction.
Digest membership seals after its stored local-time window, provider calls are fenced by the
group lease and the member dedupe reservations, and current reach/preferences are checked
again at send time. Child, group and parent retention is child-before-parent, with holds
preserving matching history. Provider-accepted but uncommitted outcomes remain at-least-once.

**Why:** the former contract placed one recipient/channel on the event-envelope primary row,
which cannot represent several recipients or channels without changing the canonical event
identity used by consumers. Separate delivery children preserve the event id while giving
each provider attempt independent uniqueness, retry, lease, reach and retention state. A
single relational digest group provides a sealed aggregate boundary without hiding members
inside JSON or coupling inbox read retention to provider delivery.

**Alternatives:** make one `outbox` row per recipient/channel with a different primary key
(rejected because it changes the existing envelope schema and event-consumer idempotency
assumption); use the in-app `notification` row as the provider queue (rejected because inbox
read retention, visibility and multiple channels have different lifecycles); store all
recipients in one parent payload (rejected because partial outcomes cannot be leased,
retried or held independently); create notification children after commit (rejected because
it breaks NO-8 atomicity); send each digest candidate separately (rejected because it breaks
NO-6's one-summary-message contract).

Parent event requeue reruns only idempotent event-consumer materialization and does not
reset, recreate or resend already materialized notification children. Requeueing an
individual notification keeps its child id and respects any live reservation. Webhook
redelivery remains the explicit per-target action in WH-8.

**Decided by:** Thomas, under the standing recommended-decisions authorization; recorded by
the orchestrator on 2026-10-01.

### 2026-10-01 · Pending-action decisions follow the existing AU-14 mutation contract

**Reconciliation:** denial/cancellation mutations preserve the already-decided AU-14
contract: action state and its outbox event commit together; an audit append failure rolls
back its nested audit savepoint, reports the error and does not undo the committed mutation.
The existing self-read contract remains separate: a summary-rendering read fails if its
viewed audit cannot be written. This introduces no waiver or new exception.

**Why:** the initial decision-route reviews inferred a conflicting fail-closed mutation
rule from PA-11. The authoritative audit/security documents and Thomas's existing AU-14
decision explicitly require mutation success with operator reporting. PR #539's candidate PA-11 text points to
that contract, and real PostgreSQL service/HTTP tests exercise both audit failure and
outbox failure independently. Metric/administrator alerting remains unfinished work.

**Recorded by:** orchestrator, reconciling Thomas's existing AU-14 decision and the
independent ordinary/security reconsiderations for PR #539. No new approval policy is made.

### 2026-10-01 · Pending-action reads require current owner identity

**Decision:** resolve the current database identity before either pending-action self read,
for sessions and API keys. If no valid identity resolves, return 401 before querying an
action or writing a viewed audit. Keep 404 for a valid caller querying a missing or foreign
action. Apply the existing identity resolver's lifecycle, organisation and key-owner rules;
authenticated-self reads do not require a workspace capability.

**Why:** an API key can remain cryptographically valid after its owner is banned or
deactivated. Stored summaries must stop being readable when the current identity becomes
invalid. The existing permission evaluator treats an absent resolved identity as 401;
using the same response for both self routes exposes no action-existence information.

**Decided by:** Thomas, under the 2026-10-01 standing instruction to use recommended
decisions; recorded by the orchestrator after PR #528's independent security finding.

### 2026-10-01 · Pending-action self-read API contract

**Decision:** `GET /api/me/pending-actions` returns only the caller's pending actions,
ordered by `created_at DESC, id DESC`, with the standard opaque cursor and limit (default
50, maximum 200) and `{ data, page, meta }` envelope. `GET
/api/me/pending-actions/{id}` returns the caller's action in any state for polling; another
requester's id returns the same 404 as a missing id. Both use one explicit allowlisted DTO:
id, action, origin, target type and ids, summary, required confirmation, state, timestamps,
invalidation reason, and the own API key's name when available. Payload/hash, route key,
credential id, step-up token id, trace id, and internal error stay private. A read that
renders a summary writes `pending_action.viewed`; an audit failure fails the read.

**Why:** clients need a stable way to discover approval requests and poll their outcomes.
The persistence row contains internal authorization and execution data, so returning it
directly would expose fields that the UI and polling contract do not need.

**Decided by:** task orchestrator, 2026-10-01.

### 2026-10-01 · Versioned task writes use a successor route; legacy PUT stays compatible (#526)

**Decision:** first-party full-task writes use required-precondition `PUT
/api/v2/task/{id}` with the existing authorization chain and locked task-version comparison.
The released `PUT /api/task/{id}` remains supported as a deprecated compatibility operation:
omitting `If-Match` preserves its prior request behavior, while a supplied header is strictly
parsed and enforced under the same lock. Both operations, and every other persisted task-row
writer, atomically advance `task.version`. First-party web and MCP full-task writers use the
versioned route. The legacy route emits `Deprecation: @1790812800`, `Sunset: Thu, 01 Apr 2027
00:00:00 GMT`, and a `successor-version` Link to the v2 operation. Deprecation starts
2026-10-01; removal is allowed only after both the sunset date and two subsequent minor
releases, with no automatic removal. Unversioned third-party legacy clients retain their
existing overwrite risk during migration; #526 protects first-party writers and version-aware
requests, not every legacy client.

**Why:** the stable 2.0 API cannot gain a required request header without a breaking change.
The versioned operation enforces the concurrency contract while the legacy operation remains
compatible and gives clients a dated successor path.

**Alternatives:** make the old header optional only in OpenAPI (rejected because runtime and
contract would disagree); exempt the break in the closed allowlist (rejected because stable
API breaks require a successor version); remove legacy compatibility immediately (rejected
because existing clients need a migration window).

**Decided by:** Thomas under the standing all-recommended-decisions instruction, recorded by
the orchestrating session on 2026-10-01.

### 2026-10-01 · Legacy full-task PUT uses the work-item optimistic-concurrency contract (#526)

**Decision:** while legacy task screens and `/api/task` remain active, full-task
`PUT /api/task/{id}` uses the `api-design.md` `If-Match` version contract. Task responses expose
an integer row version; every persisted task-row update advances it. The PUT checks the
asserted version after locking the task and returns 409 with asserted/current versions on a
mismatch, with no row or event side effects. Every full-task caller must send the version from
the task it read. Existing field-specific status/assignee and move routes remain scoped to
their requested fields and advance the same version. No last-write-wins exception is added
for those fields or for other full-task PUT fields. The owning specification is
`work-items.md` WI-7a.

**Why:** the compatibility endpoint replaces multiple fields from one possibly stale task
snapshot. A row lock alone serializes writes but still permits a late stale replacement to
undo a status or assignee change. A row version checked under that lock preserves the latest
committed change, including when requests finish in the reverse order.

**Alternatives:** keep last-write-wins for legacy PUT (rejected because completion order can
silently revert a concurrent edit); merge selected protected fields in the server (rejected
because intent cannot be distinguished from a stale snapshot without a client revision).

**Decided by:** the orchestrating session under the bounded #526 task-update concurrency
assignment; recorded before implementation.

### 2026-10-01 · G8 requires implemented screens now and activates future routes with implementation

**Decision:** G8 requires screenshot comparison for every exported UI Storybook story and
every `route`-kind inventory row marked in progress or complete. A route first marked in
progress must gain its route registration, deterministic fixture, and committed baseline in
that same change. Routes still marked not started remain planned work and do not need a
baseline before implementation. Every inventory route is part of G8's eventual scope.

**Why:** requiring baselines for future routes before they exist would force feature work
solely to satisfy a gate. Deferring an implemented screen would leave a coverage gap. This
states the active acceptance rule and the activation point explicitly in the UX-gate spec.

**Alternatives:** require every planned route immediately (rejected because not-started
routes do not exist yet); cover only today's active rows without an activation rule
(rejected because future routes could remain uncovered).

**Decided by:** Thomas, under the 2026-10-01 standing instruction to use recommended
decisions; recorded by the orchestrator.

### 2026-09-30 · TaskDesk public links use the Bimats host

**Decision:** use `https://taskdesk.bimats.com` for current TaskDesk website links and the
default OpenAPI server. The former `taskdesk.app` domain is not TaskDesk's domain. Preserve the
separate UAT hostnames already defined by deployment configuration; never infer UAT from
`uat.taskdesk.app`.

Historical decisions, incidents, and review notes keep the hostnames that were accurate when
written. This decision changes current links and defaults prospectively.

**Why:** Thomas confirmed that `taskdesk.bimats.com` is the mapped product host and that the
company domain is `bimats.com`. Current links to `taskdesk.app` and the prior `uat.taskdesk.app`
reachability assumption were incorrect.

**Decided by:** Thomas, 2026-09-30.

### 2026-09-29 · G8 route coverage advances with screen implementation

**Decision:** enable G8 incrementally across the screen inventory. Every route marked in
progress or complete must have a registered application route, deterministic browser
fixture, and committed screenshot baseline in the same change. A registered inventory
route whose rows are all still marked not started fails the scope check. Every exported UI
Storybook story remains covered. Routes still marked not started are planned work and are
not represented as already covered; their G8 requirement activates when implementation
moves them into progress. The eventual scope remains every inventory route.

**Why:** the inventory includes future-stage screens that do not exist yet. Requiring their
screenshots before implementation would force building future features just to satisfy the
gate, while omitting them from the eventual contract would leave permanent coverage gaps.

**Decided by:** Thomas, 2026-09-29.

### 2026-09-29 · OpenAI model routing replaces Claude/`pal-mcp` routing

**Decision:** TaskDesk's active AI workflow moves to an OpenAI-first two-tier model policy.
Every implementation and ordinary-review role previously assigned to Claude Sonnet is now
GPT-6 Luna. Every mandatory final security/critical-review and stage-finalizer role previously
assigned to Claude Opus/Opus 5.5 is now GPT-6 Sol. Reviewer independence, exact-head binding,
review counts, security-scope definitions, branch protection, gate-waiver rules, and stage
exit criteria are unchanged.

`pal-mcp`, `pal-reviewer`, 9Router, and their provider failover chain are retired from the
active TaskDesk workflow. They are not fallback paths. Historical reviews remain valid
historical evidence for the exact heads they reviewed; this decision applies prospectively.

**Supersedes:** the operative portions of the 2026-09-26 and 2026-09-27 decisions that made
`pal-mcp`/9Router the primary ordinary-review/audit/report/alignment path, and every operative
instruction that names Sonnet or Opus as the current required model tier.

**Why:** the active agent environment is moving to OpenAI GPT models and does not provide the
`pal-mcp` workflow. Keeping obsolete routing instructions would create false blockers and make
CI/documentation disagree with the actual execution environment. This preserves the existing
quality model: Luna inherits Sonnet work; Sol inherits mandatory Opus gates.

**Decided by:** Thomas, 2026-09-29.

### 2026-09-29 · Opus 5.5 retained as sampled big reviewer, fed by a GPT review packet

**Decision:** retain one independent Opus 5.5 role as an additional sampled/random reviewer.
It is not the per-PR security gate, not the phase finalizer, and not a replacement for GPT-6
Sol. It reviews selected candidates, batches, or defect classes only.

Before Opus 5.5 runs, GPT-6 Luna or GPT-6 Sol prepares a structured packet with exact SHA(s),
changed files, spec/ADR scope, risk classification, GPT review verdicts, tests/counts, known
residuals/waivers, and explicit claims/questions to spot-check. Opus then samples the real
referenced code and evidence independently.

A sampled Opus finding is actionable: a credible pre-merge blocker stops that candidate; a
post-merge blocker becomes immediate follow-up work. A clean sample never substitutes for the
mandatory GPT-6 Sol gate. Do not delay every PR waiting for Opus 5.5.

**Why:** retain a genuinely different external reviewer for occasional challenge/audit without
making every PR depend on a second full security pipeline.

**Decided by:** Thomas, 2026-09-29.

### 2026-09-28 · #10's gate-scope semantics decided: applicable-now gates required, future-stage gates activate with their prerequisite

**Decision:** #10 ("all 38 declared gates enabled" vs. "every gate whose prerequisite exists
today") is resolved as: **a gate is required, enabled and green once the capability it
protects actually exists in the codebase; a gate for a capability that does not exist yet
(`test:mcp`, portal bundle purity before the agent/portal bundle split, a future-feature's own
E2E) becomes mandatory in the same pull request or workstream that introduces that
capability — not before.** This does not weaken the safety property (nothing is ever
permanently exempted), it only sequences *when* a gate must exist relative to what it
protects.

**Why:** requiring all 38 gates to exist before P0 can close would make P0 logically depend on
P3/P4 features (MCP, the portal/agent bundle split) that the project's own stage definitions
say do not exist yet — an incoherent gate. Requiring nothing until some later stage risks the
opposite failure (a gate perpetually deferred past the point its prerequisite actually
landed). Two independent external status reviews, read and cross-checked against live
GitHub/git state rather than trusted at face value, both converged on the same rule
independently; Thomas confirmed it directly.

**Scope note, also confirmed by Thomas the same day:** G4 (accessibility), G8 (visual
regression) and G11 (performance budgets) are **not** treated as future-gated under this rule.
A real web application, Storybook, and Playwright infrastructure already exist, so their
prerequisite is already present — these three should be enabled, not left indefinitely
skipped, under the rule above. This is a direct consequence of the rule, not an exception to
it.

**Alternatives:** "all 38 gates must exist" (rejected — makes P0 depend on P3/P4-only
features); "P0 closes on the currently-enabled subset regardless of what's missing" (rejected
— no forcing function to ever enable a gate once its prerequisite lands).

**Decided by:** Thomas, 2026-09-28.

### 2026-09-28 · P1/P2 shared-surface ownership (#329) — acknowledged as proposed

**Decision:** the ownership proposal on issue #329 (P1/Copilot-DeepSeek lane owns
`work_item*`/`project*`/`workspace*`/etc.; P2 owns its own tables when it migrates them;
listed shared files are sequential-only — land, push, announce, never concurrent) is accepted
as written, unblocking the P2 migration batch, the audit-log read API, intake/request-type
API slices, the portal submission route, and SLA policy CRUD/pause routes.

**Why:** the proposal had sat unacknowledged since 2026-09-22 despite being cheap to accept,
and was blocking a real, growing queue of P2 work. An external status review flagged it as one
of the cheapest wins available; verified the issue was still open and the proposal
unretracted before acting.

**Alternatives:** amend the proposal (not needed — it was judged sound as written).

**Decided by:** Thomas, 2026-09-28. Recorded on issue #329 directly (closing comment) and
closed there.

### 2026-09-28 · `v2.0.1` GitHub release marked prerelease

**Decision:** the published GitHub release `TaskDesk v2.0.1` (2026-09-27, target `ed250723`)
is now marked `prerelease: true`. It was previously published as a normal stable release
despite the project's own release plan saying the TaskDesk product history should start at
`2.0.0-alpha.1` (P0), with P0 itself not yet closed, and despite `package.json` still
carrying kaneo's inherited `2.22.0` version string — three simultaneous, conflicting version
stories.

**Why:** an unlabeled stable release publicly implies production readiness the project has
not reached. Marking it prerelease is a minimal, reversible correction that doesn't require
deleting release history or reconciling `package.json`/the release plan in the same action.

**Not done, still open:** reconciling `package.json`'s `2.22.0` against the release plan's
`2.0.0-alpha/beta/rc` numbering, and whether future releases should follow the plan's numbering
starting now or from P0's actual close. Left for a dedicated release-governance decision, not
folded into this one.

**Alternatives:** leave it alone (rejected — actively misleading given P0 isn't closed);
delete it (rejected — destructive, and the release may already be referenced/pulled by
something).

**Decided by:** Thomas, 2026-09-28.

## Format

```markdown
### YYYY-MM-DD · Short title
**Decision:** what we are doing
**Why:** the reasoning
**Alternatives:** what was rejected, briefly
**Decided by:** who
```

### 2026-09-28 · All four P0 gate issues (#8, #9, #10, #11) audited against live code; #9 closed; #8/#10/#11 identified as needing an operational or scoping decision, not more implementation

**Decision:** ran a read-only verification of every checklist item on #8, #9, #10 and #11
against the actual code on `main` (not against each issue's own text, which had drifted in
places). Closed #9. Left #8, #10 and #11 open, each with a comment naming exactly what still
blocks it and why more code review will not close it. Corrected `CLAUDE.md`'s overstated claim
about `scripts/deploy.sh local`'s own Traefik path (see below). Dispatched a bounded fix for
that Traefik gap; did not attempt the real external UAT deployment #8 actually needs, since
that needs Thomas's own authorization per the 2026-09-23 entry below it.

**Why:** issue #9's own "done when" bullet (`apps/web/src/components/ui/` empty) was
technically false but for a reason already fully documented and independently tracked in
#403 — leaving #9 open served no purpose except duplicating #403. Issue #8's remaining gap is
a ~7-day live-UAT shadow-mode soak the 2026-09-23 entry already designed for; issue #10's
remaining gap is 12 of 38 CI gates each blocked on a named, unbuilt P1/P9 prerequisite, plus
a stale CODEOWNERS scope line describing a mechanism decided against twice already; issue
#11's remaining gap is that its own "done when" claim was verified through the host's
pre-existing Traefik, not `deploy.sh local`'s bundled one. None of these three closes by
another review round, so recording that plainly here rather than leaving each issue looking
like ordinary unfinished work.

**Alternatives considered:** close #8/#10/#11 anyway on the theory that P0's *code* is done —
rejected, each issue's own "done when" text is explicit and hasn't been met, and silently
redefining "done" without saying so is exactly the kind of drift this log exists to prevent.
Leave #9 open pending a fresh #403 resolution — rejected, #403 already exists and re-litigating
the same gap on two issues helps no one.

**Decided by:** the orchestrating session, 2026-09-28, closing #9 as a reversible housekeeping
call (falls within the standing "take the recommended, non-waiver option" authorization); the
#8 UAT-deployment question and the #10 gate-scoping question are flagged to Thomas directly,
not decided here.

### 2026-09-28 · `GET /api/invitation/{id}` (issue #8, PR #440) kept registered and permanently disabled, not deleted — the reviewed-allowlist breaking-change mechanism is closed for good now that v2.0.1 exists

**Decision:** the route stays in the OpenAPI contract (`deprecated: true`), and its handler
now unconditionally refuses (403) — including for a caller who holds the real
`member:invite` authority its own middleware chain (reused verbatim from
`DELETE /api/invitation/{id}`, the cancel route) checks. It was NOT deleted outright, and
`scripts/ci/openapi-approved-breaks.json` was NOT used to approve its removal.

**Why:** PR #440's Opus delta pass F4 found and fixed a route-classification-guard
fail-open that, applied strictly, required this route to be classified rather than left
"deliberately uncovered" — the state it had been in since 2026-09-22, because none of the
registry's five policy kinds fit its old shape honestly (it returned invitee
email/workspace name/inviter name to any authenticated caller, with no recipient or
workspace-membership check at all — the same data `GET /api/invitation/public/{id}`
already serves, but this one required a credential first). The first plan was to delete
it outright (zero real callers in `apps/web`, an info-leak already). Before that landed,
PR #440's own `test:contract` gate (`oasdiff` against `origin/main`) caught something the
deletion plan missed: a stable `v2.0.1` tag already exists on origin, so
`docs/01-architecture/api-design.md`'s Versioning section requires a real deprecation
window (a new path segment, the old one kept for two minor releases with `Deprecation`/
`Sunset` headers) for a breaking removal, not the reviewed allowlist — that allowlist is
explicitly closed, permanently, from the first stable `v2.0.0`+ tag on. Asked Thomas
directly given this new constraint; he chose to keep the route registered and disable it
in place, rather than build a full deprecation-header mechanism (no existing precedent in
this codebase) or wait out a real deprecation window for a route that was never safe.

**Alternatives considered:** (1) waive the versioning policy for this one route and delete
it anyway — rejected, a real policy waiver only Thomas may authorize, and he chose not to;
(2) build the actual versioned-path-segment mechanism this policy describes, as the first
real instance of it — rejected as disproportionate scope for closing one already-known
info-leak in an unused route.

**How this is enforced:** `apps/api/src/invitation/policy.ts` declares
`"GET /api/invitation/{id}": { capability: "member:invite", scope: "workspace",
scopeSource: "row", reach: "required", sessionOnly: true }` — identical to cancel's own
declaration, and genuinely enforced (same middleware chain runs). The handler still
throws 403 after that middleware passes; the declared capability check is a real,
additional gate in front of an always-refusing handler, not a mismatch between what's
declared and what runs.

**Decided by:** Thomas, 2026-09-28, asked directly (a tight two-option-plus-status-quo
question) after the versioning-policy constraint surfaced mid-fix. See
`docs/07-planning/security-reviews/440-runtime-authorization-wiring.md` for the full
five-round review history on the route-classification-guard mechanism this decision grew
out of.

### 2026-09-28 · Redocly-lint-finding allowlist added (`scripts/ci/redocly-approved-findings.json`) for `GET /attachments/{id}`'s redirect-only response

**Decision:** `test:contract`'s Redocly shrink-only baseline correctly flagged
`operation-2xx-response` as a NEW finding on `GET /attachments/{id}` (PR #450, issue #28)
the first time that check ran to completion on the branch — the route only ever returns
302 (redirect to a five-minute presigned download URL, AT-5/AT-6), never a 2xx of its
own. Rather than silence this with Redocly's own informal `.redocly.lint-ignore.yaml`
mechanism (which `test-contract.mjs`'s own `parseRedoclyReport` explicitly rejects —
`ignored !== 0` fails closed, on purpose), a new reviewed-exception allowlist was added:
`scripts/ci/redocly-approved-findings.json`, the same shape as the existing
`openapi-approved-breaks.json` (operation/rule/reason/decision/pr) but keyed on
`(rule, pointer)` — Redocly's own JSON pointer, unlike oasdiff's output, is already exact
and stable per finding, so there is no separate fingerprint to invent. One entry recorded
for this exact finding.

**Why:** the route's redirect-only design is deliberate and already shipped (attachment
download has worked this way since #450 was first written; `attachment.test.ts` and
`attachment-s3-finalize-race.test.ts` both already assert the 302). A generic Redocly
lint rule cannot distinguish "an operation forgot to document its success response" from
"an operation's only success response is a redirect, and that's the whole contract" — this
is the latter. Changing the actual route to return `200` + a JSON body instead of a real
redirect, purely to satisfy the linter, would be a real protocol change late in an
already-multi-round-reviewed PR, touching every existing test that asserts 302 — a much
larger and riskier change than recording a scoped, reviewed exception for a known false
positive. Asked Thomas directly given the fork (build the allowlist vs. change the
protocol); he chose the allowlist.

**Alternatives considered:** (1) `redocly lint --generate-ignore-file` — rejected, the
project's own tooling hard-fails on any non-zero `ignored` count from Redocly itself, by
design, and the generated file would have silently bundled in all 16 OTHER pre-existing,
already-tolerated findings across the whole spec, not just this one; (2) change
`GET /attachments/{id}` to return `200` with a JSON body containing the presigned URL
instead of a real redirect — rejected as the larger, riskier change, see "Why" above.

**Decided by:** Thomas, 2026-09-28, asked directly (a tight two-option question) after
the finding surfaced on PR #450's first completed `contract - OpenAPI drift` run. See
`scripts/ci/redocly-approved-findings.json` and
`docs/07-planning/security-reviews/450-attachments.md` for the finding and its fix.

### 2026-09-27 · `pal-mcp` FULLY UNSUSPENDED for all reading/ordinary-review/audit/analysis, all branches, all scope — the Opus final security/critical review remains the sole, unreplaced gate

**Supersedes:** the entry immediately below (same day) — that entry's non-security-scope-only
carve-out is now lifted. That entry's own reasoning and test evidence still stand as the
record of what justified going this far; this entry records Thomas going further, not a
correction of it.

**Decision:** `pal-mcp` may now be used for reading, ordinary review, audit, and analysis on
**any** branch and **any** scope, including changes that touch `ci-cd.md`'s
security-review-scope list. This does **not** touch the separate, mandatory final Opus
security/critical review in any way — that gate is Opus-only, always, on every PR in
security scope, never satisfied by `pal-mcp` at any tier or confidence level, regardless of
how much ordinary-review/audit work `pal-mcp` does on the same PR. A security-scope PR now
gets its ordinary review and audit from `pal-mcp` (or Sonnet, at the orchestrating session's
discretion) exactly like a non-security-scope PR does, then still requires the single
required Opus pass before merge, exactly as before.

**Why:** further adversarial testing through the day continued clean (see the entry below for
the concurrency-test detail), and a real, independent `pal-mcp`-lane review of PR #408
(non-security-scope, run after this session's own edits) produced a substantive, correct,
non-blocking technical finding (about a regression test's actual discriminating power) —
concrete evidence the tool is not just "not leaking" but doing real reviewing work
correctly. Thomas made the call directly, in his own words, to lift the remaining
security-scope restriction rather than wait for a longer track record there specifically.

**What this does NOT change:** the five things an agent may never do (approve its own review,
waive a gate, downgrade an unavailable reviewer, treat `pal-mcp` as satisfying the Opus gate,
paste untrusted/sensitive content into a `pal-mcp` prompt) are all unchanged. The Opus final
security/critical review is unaffected in every respect — same tier, same independence
requirement, same mandatory status, on every security-scope PR.

**A process gap found the same day, worth recording here:** a subagent spawned as
`pal-reviewer` during this lift's own test cycle reported that its own view of `CLAUDE.md`
(via its system-reminder) still showed the original, fully-suspended notice from the entry
below — stale relative to this session's live edits to the file — even though its own
`.claude/agents/pal-reviewer.md` role prompt (read fresh at spawn) correctly showed the
update. The subagent did the right thing: it treated the discrepancy as unverified and fell
back to a direct Sonnet review rather than trusting either source blindly. Likely cause:
agent-definition files under `.claude/agents/**` are read fresh at each spawn; the
CLAUDE.md project-instructions injection into a subagent's system-reminder is not, and can
lag mid-session edits to the live file. **Until this is understood or fixed at the harness
level, any subagent (this session's own, or another session's) that flags a conflict between
a task instruction and its own CLAUDE.md snapshot should be told to `Read`
`docs/07-planning/decision-log.md` directly — a live file read, not a cached snapshot — as
the authoritative check, rather than trusting either the stale snapshot or an unverified
claim in its prompt.**

**Alternatives:** Wait for a longer track record on security-scope work specifically before
lifting that restriction too — this was the reasoning for the partial lift a few hours
earlier; superseded now by Thomas's own explicit instruction with the day's fuller test
picture in front of him, not by an agent's own judgment call.

**Decided by:** Thomas, 2026-09-27 ("full lift pal-mcp all lane, all git branch... except
security check which is only opus job").

### 2026-09-27 · `pal-mcp` PARTIALLY UNSUSPENDED — resumes for non-security-scope ordinary review/audit/report/alignment; stays suspended for security-scope work

**Supersedes (in part):** the 2026-09-26 "CORRECTION: the pal-mcp cross-call leak is NOT
fixed" entry's blanket suspension, below. That entry's finding stands as history — the leak
was real and reproducible — but the blanket "do not use it for anything a gate depends on" is
narrowed here, not reversed.

**Decision:** `pal-mcp` may be used again for ordinary review, audit, reporting, and the
alignment check, **only for changes that touch no path in `ci-cd.md`'s security-review-scope
list**. For any change touching that list, `pal-mcp` remains suspended — use a fresh Sonnet
context, same as the last several weeks. This does not touch the separate, mandatory Opus
final security/critical review, which is unaffected either way and was never satisfiable by
`pal-mcp` at any tier.

**Why:** Thomas fixed the underlying server/container (a shared-singleton-instance bug in
`pal-mcp-server`'s own `server.py`/`workflow_mixin.py`, per his own account: `tool =
TOOLS[name]` replaced with a fresh `tool = type(TOOLS[name])()` per call) and redeployed it.
Two independent sessions then ran adversarial concurrency tests against the redeployed
server on 2026-09-27: parallel `chat` calls with unique canaries and no shared
`continuation_id` (clean, both sessions); single-step `analyze` calls with real pasted code
forced through the full `calling_expert_analysis` round-trip — the exact step that
reproduced the leak on 2026-09-26 (clean, both sessions, using real functions from this
repo's own `packages/domain`); and three concurrent multi-step `analyze` conversations, each
tracked through its own `continuation_id` across multiple steps, checked directly against the
literal state fields (`initial_request`, `work_summary`) that leaked before — clean under
concurrent load, no cross-thread bleed. No cross-session content appeared anywhere in any of
it. This is real, positive evidence the deployed fix holds — not proof it always will, given
this same class of bug survived two earlier "fixed" claims (the fusion→failover config
change, and an initial "two clean samples" reading) before recurring on a later adversarial
pass.

**Alternatives:** Full unsuspension — rejected for now; a security-scope change (auth,
permissions, migrations, the CI/gate machinery, the dependency graph) is exactly where a
residual, intermittent leak would do the most damage, and today's evidence, while good, is
one day's sample against a bug with a documented history of intermittency. Keep the full
suspension until a much longer track record accumulates — rejected as unnecessarily
conservative given today's results, and because non-security-scope ordinary review is a
lower-stakes place to rebuild that track record. This partial scope is the middle ground
Thomas chose directly when asked to make the call himself, rather than either agent lifting
its own suspension.

**Decided by:** Thomas, 2026-09-27, after reviewing both sessions' test results directly.


### 2026-09-27 · Release image's Trivy scan set to `ignore-unfixed: true`

**Decision:** `.github/workflows/release.yml`'s two Trivy scan steps (amd64 and arm64) change
`ignore-unfixed` from `false` to `true`. `severity: HIGH,CRITICAL` and `exit-code: '1'` are
unchanged — a HIGH/CRITICAL finding with a vendor-supplied fix available still blocks
publication exactly as before.

**Why:** the release pipeline had failed on every push to `main` since PR #397's investigation
surfaced it — not only over the `perl-base` CVEs #397 already removed, but over roughly 50
additional HIGH/CRITICAL findings across ~18 other Debian packages in the pinned
`node:24.20.0-bookworm-slim` base image, most with **no vendor fix available at this pinned
digest today** (confirmed via a local Trivy scan at PR #397's head, matching the numbers in
its own Opus review's F1 finding). With `ignore-unfixed: false`, every one of those blocks
regardless of whether anything can actually be done about it — an unfixed-upstream finding is
not an actionable finding, and blocking release on it indefinitely does not reduce risk, it
only prevents ever shipping a signed image again.

**Alternatives considered** (all three put to Thomas directly, given this changes gate
semantics and only he can authorize that per `AGENTS.md`/`CLAUDE.md`):
1. **`ignore-unfixed: true`** (chosen) — skip findings with no available fix; a HIGH/CRITICAL
   finding that DOES have a fix still blocks. Standard practice for base-image scanning.
2. An explicit, itemized `.trivyignore` naming each specific CVE with a justification —
   more auditable per-CVE, but more upkeep, and functionally the same outcome as (1) for
   findings that stay unfixed indefinitely.
3. Move to a different/leaner base image — most thorough (would likely eliminate many of
   these packages entirely), but a larger change needing its own testing; not adopted now,
   worth a future look.

**Decided by:** Thomas, 2026-09-27, in response to the orchestrating session's three-option
report — approved option 1 directly ("Go").

### 2026-09-27 · #392 permission-key migration uses expand/contract for rolling Helm updates

**Decision:** migration `0071` copies the legacy `task` permission key into `work_item` and retains `task` during the rolling deployment. A later contract migration may remove `task` only after old binaries are gone and the rollback window has closed.

**Why:** Helm runs the migration in each new pod's init container while old replicas can still serve traffic. Removing `task` before old replicas drain makes those replicas deny permissions they still enforce. Keeping both keys preserves access for old and new application versions.

**Alternatives:** delete `task` in `0071` (rejected because it breaks active old replicas); remove it in a later release immediately (rejected until the old-binary and rollback window has demonstrably ended).

**Decided by:** the orchestrating session, 2026-09-27, after independent ordinary review identified the rolling-update compatibility gap.

**2026-09-27 addendum, after the Opus/ordinary delta reviews of this same commit:** retaining
`task` fixed the direction above (old replicas reading rows a new replica already migrated)
but, on its own, does nothing for the reverse direction — a row an *old* replica writes or
updates *after* migration `0071` has run is still `task`-only, and a new replica reading only
`work_item` will deny it (tracked as issue #398, "D1"; still open, non-blocking, since any
edit through the product's own write path removes `task` — see below). Retaining `task`
also broke a real write path: the settings UI's role editor round-trips whatever the list
endpoint returns, and the update route rejects `task` as an unknown resource, so saving any
already-migrated role 400'd. Fixed in the same commit series by filtering `list-workspace-
roles.ts`'s response to known resources before it reaches the client. The future contract
migration that deletes `task` entirely is tracked as issue #398, not left as an undated
"may remove" — filed the same day this gap was found.

## Format

```markdown
### YYYY-MM-DD · Short title
**Decision:** what we are doing
**Why:** the reasoning
**Alternatives:** what was rejected, briefly
**Decided by:** who
```

### 2026-09-27 · `input-otp`, `react-day-picker`, `react-hook-form` added to `packages/ui` dependencies (issue #9 primitive moves)

**Decision:** `input-otp`, `react-day-picker` and `react-hook-form` are added to `packages/ui/package.json`'s **`dependencies`** (correction, Opus review of PR #394: not `devDependencies` — they're genuine runtime dependencies of the moved primitives, and `check:deps`'s manifest check specifically validates `manifest.dependencies`, so they have to be declared there), at the same versions `apps/web` already pins, to support moving `input-otp.tsx`, `calendar.tsx` and `form.tsx` into `packages/ui/src/components/`. `check:deps`'s `UI_RUNTIME_IMPORTS` allowlist and `docs/01-architecture/monorepo-layout.md`'s boundary diagram are updated to match — `pnpm check:deps` correctly failed until this was done, which is the gate working as intended (a new runtime dependency on a moved primitive is exactly the kind of edge it's meant to catch), not a defect to route around.

**Why:** these three primitives cannot function without their respective libraries (an OTP input, a date picker, and a form-state manager), and all three are already vetted, already-lockfiled dependencies of `apps/web` — this is "the same dependency now used by a second workspace package," not a new supply-chain surface.

**Alternatives:** leave the three primitives in `apps/web/src/components/ui/` rather than move them (rejected — that's the exact "apps/web/src/components/ui is empty" gate issue #9 is not yet closed on, and these are legitimate, reusable primitives, not app-specific glue like `error-display.tsx`/`error-test.tsx`, which correctly stayed behind); vendor a second identical devDependency pin instead of reusing the existing versions (rejected — needless divergence for no benefit).

**Decided by:** the orchestrating session, 2026-09-27, under Thomas's standing delegation for implementation-detail dependency choices that don't change architecture or gate semantics.

### 2026-09-27 · `vitest-axe` + `axe-core` added as `packages/ui` devDependencies (issue #9's axe-clean-test gate)

**Decision:** `vitest-axe` (MIT, `^0.1.0` resolving to `0.1.0`) and `axe-core` (MPL-2.0, `^4.13.0` resolving to `4.13.0`) are added as devDependencies of `packages/ui`, to satisfy issue #9's "every primitive has a story and an axe-clean test" acceptance line. No axe-testing library existed anywhere in this repo before today. **Correction (Opus security review, 2026-09-27):** `axe-core` is not `vitest-axe`'s peer dependency — it's a direct dependency of `vitest-axe` already (`^4.4.2`); `vitest-axe`'s only actual peer is `vitest >=0.16.0`. The explicit `axe-core` devDependency is redundant (imported by nothing directly) but harmless, and raises the installed version above what `vitest-axe` alone would pull in. Two independent lanes working disjoint primitive lists (PRs #389, #390) each needed the library and, working in parallel without knowledge of each other, each added the dependency and a small wrapper helper (`packages/ui/src/test/a11y.ts` and `packages/ui/src/test/axe.ts` respectively). **This has since been reconciled** — #390 adopted #389's `a11y.ts` as canonical and dropped its own `axe.ts`; both PRs now carry byte-identical `package.json`/`pnpm-lock.yaml`/`a11y.ts`/`setup.ts` content, confirmed independently by two separate reviews.

**Why:** the acceptance line requires it; nothing already installed does automated accessibility assertions at the component level (Storybook's `addon-a11y` was considered and explicitly deferred by both lanes as a separate, larger piece — visual/Storybook-level a11y, not the unit-level gate this issue's text asks for first). A small, single-purpose, widely-used MIT library is a normal devDependency add, not a supply-chain risk needing deeper scrutiny — but it does sit on `ci-cd.md`'s security-review-scope path list (`**/package.json`, `pnpm-lock.yaml`, the dependency-graph criterion) purely by file path, regardless of what changed, so both PRs still get a fresh Opus pass before merge per that rule, not a waiver of it. The Opus review confirmed the package integrity (sha512 hashes independently recomputed against the npm registry tarballs), no install/postinstall scripts, no new transitive dependencies beyond what was already in the lockfile, and dev-only usage that never reaches the production Docker image.

**Alternatives:** `jest-axe` (rejected — this repo is on Vitest, not Jest, and `vitest-axe` is its closest Vitest-native equivalent; **correction, Opus review:** it is real and widely used [~1.7M weekly downloads] but its last stable release was October 2022 — "actively maintained" overstates it, "the available option that fits" is more accurate); doing axe assertions by hand against `axe-core` directly with no matcher library (rejected initially, then adopted anyway in a follow-up fix — see the security-review note for why the custom `vitest`-module type augmentation `vitest-axe`'s matcher needed had to be dropped in favor of asserting on `axe-core`'s own `results.violations` directly, after it caused `check:deps` false positives); deferring the whole axe-test gate to a later slice (rejected — it's an explicit, already-open P0 acceptance line, and Thomas wants same-day progress on #9).

**Decided by:** the orchestrating session, 2026-09-27, under Thomas's standing delegation for implementation-detail dependency choices that don't change architecture or gate semantics.

### 2026-09-27 · `pal-mcp` re-tested after Thomas said the leak was fixed — LEAK STILL REPRODUCES, suspension stands

**Decision:** `pal-mcp` remains suspended as the reviewer/auditor of record. Thomas asked this session to resume using it, stating he had fixed the cross-call content leak on the 9Router side. Before complying, a fresh adversarial re-test was run (4 isolated calls, synthetic throwaway content only, no real repo content submitted): 3 of 4 came back contaminated with content never submitted in that call. This is a materially larger, still-adversarial sample than the earlier "2 clean calls" that gave a false "seems fixed" signal in this same session on 2026-09-26 — that earlier all-clear was wrong, and this session is not repeating that mistake by trusting a second unverified "it's fixed" claim.

**What the re-test found, concretely:**
- Two isolated `analyze` calls and one `codereview` call returned real file paths and fabricated review narrative this session never submitted — including nine of this repo's own governance files (`AGENTS.md`, `CLAUDE.md`, `status.md`, the decision log itself, `ci-cd.md`, `agent-workflow.md`, `.github/CODEOWNERS`, `.claude/agents/pal-reviewer.md`, the earlier `376-pal-mcp-governance.md` review note).
- One call returned an absolute file path from a **different host, different OS convention, and a different username** than this session (`/private/tmp/claude-501/-Users-heinthura/.../scratchpad/buggy_test.py` — macOS path, user "heinthura"; this session runs on Linux under `/home/ubuntu` as a different account) — this is genuine cross-session, cross-user leakage on the shared 9Router endpoint, not merely stale state within one session. That call also returned fabricated "issues found" describing a Python function (`is_palindrome`/`binary_search`) that does not exist anywhere in this repo or in the actual submitted content.
- A fourth call, given a fresh `continuation_id` and explicit instruction not to reuse prior context, still pulled back an earlier call's own file from within the same test run — the underlying model itself flagged the contamination as unexpected in its own output.
- One of four calls (a plain `chat` query) came back clean.

**Why this doesn't change the standing rule:** the suspension notice's own condition — "until this is root-caused and fixed at the server" — is unmet. Thomas's fix did not resolve it; the same defect class reproduced within minutes of re-enabling the tool, with new evidence (a different real user's file path) beyond what the 2026-09-26 finding showed. Per CLAUDE.md's own rule ("Downgrade an unavailable reviewer... capacity exhaustion means wait, not substitute") and the standing instruction not to trust an unverified "it's fixed" claim twice, this session is keeping the suspension in force and reporting the new evidence rather than complying with the resume request.

**Decided by:** the orchestrating session, 2026-09-27, acting on the standing suspension policy and its own fresh verification — not overriding Thomas, but declining to act on an instruction that the evidence directly contradicts, and surfacing that contradiction to him plainly rather than silently complying or silently ignoring it.

### 2026-09-26 · `pal-mcp` becomes the primary ordinary review/audit/report/alignment tool; Code Owner review for control-plane files PLANNED THEN SUSPENDED (see the entry immediately below) — `pal-mcp` ITSELF LATER SUSPENDED, THEN PARTIALLY UNSUSPENDED FOR NON-SECURITY-SCOPE WORK (see "CORRECTION: the pal-mcp cross-call leak is NOT fixed" further down, and the 2026-09-27 entry above)

**Supersedes (in part):** the 2026-09-15 "Governance reset" item 2 (routing coding through
`router.technexus.info` did not work out — this decision reopens the same endpoint for
review/audit only, never implementation); the 2026-09-06 "Merge governance" CODEOWNERS
instruction (narrowed here to control-plane files, not reopened at large). **The
Code-Owner-review half of this entry (below) was planned same-day and then suspended before
ever taking effect — see the entry immediately below, which is the operative one for that
half.** **Separately, `pal-mcp` itself — the entry's whole subject, not just the
Code-Owner-review half — was later suspended the same day after a confirmed, reproducible
cross-call content leak; see "CORRECTION: the pal-mcp cross-call leak is NOT fixed" further
down, which is the operative entry for that.** Also superseded:
the 2026-09-24 "GPT-6 Luna
replaces Sonnet for ordinary reviews on active P0 lanes" and #345 temporary
current-model-context fallback entries, both of which this decision's `pal-mcp` path now
makes the default rather than a capacity-driven exception.

**Decision:** `pal-mcp` (MCP tool suite: `analyze`, `codereview`, `secaudit`, `debug`,
`refactor`, `testgen`, `precommit`, `consensus`, `thinkdeep`, `tracer`, `chat`, `apilookup`,
`challenge`), using its `coder` model — **at the time of this entry**, a fusion panel with a
judge on Thomas's own 9Router gateway (GPT-6 Luna as judge, plus Gemini 3.8 Flash, DeepSeek
v4.1 Flash, and GLM 5.3 Flash, 272K context; **changed to a failover chain later the same
day — see the entry below, "9Router `coder` switched from fusion panel to failover"**) — is
now the primary path for bulk reading/context-prep, ordinary review, audit,
reporting, and the project-alignment check, via the new `pal-reviewer` subagent
(`.claude/agents/pal-reviewer.md`). Sonnet keeps coding/implementation against an agreed spec
and becomes the ordinary-review fallback only when `pal-mcp`/9Router is genuinely
unreachable. **The Opus 5.5 final security/critical review is unaffected: still mandatory,
still a fresh independent context, never replaced by `pal-mcp` or any lower tier.**
Separately, `.github/CODEOWNERS` now lists the control-plane files themselves (`CLAUDE.md`,
`AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `docs/04-engineering/ci-cd.md`,
`.claude/agents/**`, `.github/CODEOWNERS`). **The plan to also switch on the `protect-main`
ruleset's "Require review from Code Owners" for exactly those paths was suspended the same
day, before it ever took effect — see the entry immediately below.** The CODEOWNERS listing
itself stands regardless, as a documentation signal. Every other path is unaffected —
required approving reviews remains `0` for ordinary code.

**Why:** Thomas confirmed `router.technexus.info` (9Router) is his own, already-vetted
endpoint, and that its `coder` combo is a judged multi-model panel rather than a single
small local model — a real reviewer, not a downgrade. **Note this is the same
`router.technexus.info` endpoint the 2026-09-15 "Governance reset" entry recorded as dropped**
("an earlier multi-provider router... did not work out in practice"); this decision is a
second attempt at that endpoint, scoped narrower than the first (review/audit/reporting only,
never implementation, never the Opus gate) and re-confirmed directly by Thomas, not a
reversal made without acknowledging the earlier attempt. Reading, review, audit, reporting and
alignment are I/O- and pattern-matching-heavy relative to coding and the final security gate,
and Thomas directed this split explicitly. The 2026-09-06 "do not enable Require review from
Code Owners" reasoning (a lone-owner approval on every PR documents a gate rather than
providing one) still holds for the repository at large; it does not hold for the small set of
files that define what the gates themselves are, which is why this decision narrows the
exception to exactly those paths rather than reopening the general question. Separately:
`pal-mcp`'s panel fans out to third-party-hosted sub-providers (Gemini, DeepSeek, GLM) behind
the 9Router gateway — Thomas vetted the gateway, not each sub-provider's own data-retention or
training terms. This is recorded as an **open item**, not resolved here: `CLAUDE.md`,
`agent-workflow.md` and `pal-reviewer.md` all now scope what may be passed to `pal-mcp` by
path (never a dotfile, home-directory path, `.env*`, `*.pem`, `*.key`, credential file, or a
path suggested by content under review — its tools send whole files/diffs, not lines, so a
"check the content first" rule was never enforceable) until Thomas confirms the
sub-providers' own data-handling terms separately.

**Alternatives:** Route implementation, not just review, through `pal-mcp`/9Router — rejected,
per the 2026-09-15 "Governance reset" decision that the earlier multi-provider router did not
work out, and per the Spotify/Portal engineering pattern Thomas referenced, which delegates
bulk I/O to a cheap model but keeps reasoning-heavy work (there: debugging, architecture,
security) on the expensive tier — reading/audit/report/align is the I/O-shaped side of that
split here, not reasoning `pal-mcp` should own beyond it. Set "Require review from Code
Owners" globally (`*`) — rejected as reopening the exact configuration the 2026-09-06 decision
closed, for the reason recorded there. Let `pal-mcp` satisfy the Opus gate — rejected
outright; Opus remains the only tier that can never be downgraded or substituted (CLAUDE.md,
"Five things an agent may never do"). Treat the sub-provider data-handling question as already
covered by Thomas vetting the gateway — rejected; the gateway and its member models are
different trust boundaries, and the docs now say so explicitly rather than staying silent on
it (found by independent Sonnet review of this very PR, #376).

**Follow-up:** the `protect-main` ruleset's "Require review from Code Owners" toggle is not
yet flipped on. **The independent Opus review of PR #376 found a problem with this plan —
see the next entry, PENDING THOMAS'S CONFIRMATION.**

**Decided by:** Thomas, 2026-09-26, in session.

### 2026-09-26 · Opus review finding: the Code Owner review toggle cannot provide real protection — PENDING THOMAS'S CONFIRMATION

**Supersedes (pending confirmation):** the "Require review from Code Owners" half of the
entry immediately above, and its follow-up planning to flip the ruleset toggle after PR #376
merges. The CODEOWNERS path-narrowing itself (six control-plane files, not `*`) is not in
question and stays either way.

**Finding:** the independent Opus 5.5 review of PR #376 (exact head
`efb29bee3084a3368ba59c2c5d733ea043c34e72`) found that this repo has exactly one collaborator
(`ThomasHeinThura`), and every agent session acts through that same account's `gh` token —
there is no separate identity for GitHub to check a Code Owner approval against. Two concrete
consequences: (1) GitHub refuses to let a sole owner approve their own pull request under a
zero-bypass ruleset, so every future PR touching these six paths would become permanently
unmergeable; (2) the obvious-looking fix — a bypass actor for the repo-admin role — would
bypass all 15 required status checks, not just this one.

**Proposed correction, not yet Thomas-confirmed:** do not enable the toggle; keep
`.github/CODEOWNERS`'s six-path list as documentation only, same status the rest of the repo
already has under the 2026-09-06 decision; never add a bypass actor to route around this. The
docs (`CLAUDE.md`, `AGENTS.md`, `agent-workflow.md`, `ci-cd.md`, `.github/CODEOWNERS`) have
been updated on PR #376 to describe it this way rather than as an enabled gate, so they stop
overclaiming an enforcement that was never actually turned on. A real fix — a separate,
non-admin machine identity for agents — exists but is infrastructure only Thomas can set up;
flagged to him, not implemented here.

**Decided by:** finding is Opus's, from independent review; the correction above is the
orchestrating session's proposed reading of that finding, reported to Thomas for confirmation
or override — not a decision made in his place.

### 2026-09-26 · 9Router `coder` switched from fusion panel to failover; a real file-embedding usage bug found and fixed the same session

**Decision:** Thomas changed `coder`'s configuration on his own 9Router gateway from a fusion
panel with a judge (GPT-6 Luna judging Gemini 3.8 Flash, DeepSeek v4.1 Flash, GLM 5.3 Flash)
to a **failover chain**: GPT-6 Luna primary, falling over in order to the other three only if
GPT-6 Luna is unavailable. `CLAUDE.md`, `AGENTS.md`, `agent-workflow.md`, `pal-reviewer.md`
updated to describe the current configuration; the entry above is left as the historical
record of what was true when it was written, not silently rewritten.

**Why:** an isolated, controlled test of the fusion-panel configuration reproduced a real
cross-call content leak — a single-file `analyze` call with no continuation ID came back
containing an unrelated background task's file list and its own prior prompt text verbatim,
and a separate test by a background lane got back an unrelated Python file from a path under
a different username on a different OS, from a different Claude session entirely. This was
independently reproduced by the orchestrating session itself (not just reported secondhand)
before being escalated to Thomas. After the switch to failover, two follow-up isolated tests
(one with only a file path, one with pasted content) came back clean — no contamination in
either. This is not proof the underlying issue is fully understood or permanently resolved,
only that it did not recur in two more samples; treat `pal-mcp` with continued care rather
than as definitively fixed.

**Separately found and fixed, same session:** the `absolute_file_paths`/`relevant_files`/
`compare_to` parameters described throughout the existing docs as embedding file content or
computing diffs server-side **do not actually do so** — verified directly: a call passing
only a path came back `files_embedded: 0` and asked for the file's actual content in the next
turn; a `precommit` call with `compare_to` asked for a local `git diff` in return, which
`pal-reviewer` has no `Bash` to produce. Every file/diff this session had described `pal-mcp`
as reading itself, it was never actually reading. Pasting file content directly into the
prompt does work and produces accurate, grounded output. `pal-reviewer.md` and `CLAUDE.md`
corrected to instruct pasting content rather than relying on path parameters — this changes
the token-savings model (the orchestrating session/subagent still does the file I/O; `pal-mcp`
offloads the reasoning/synthesis over that content, not the reading) but does not eliminate
the benefit.

**Alternatives:** Keep the fusion-panel mode and add isolation workarounds on this side (e.g.
per-call unique markers to detect contamination) — rejected; the leak is server-side, on
infrastructure this session doesn't control, and cannot be fixed from the client side. Stop
using `pal-mcp` entirely — considered, and was the orchestrating session's interim
recommendation while escalating; superseded by Thomas's config change and the clean
re-tests. Trust the path-parameter mechanism because the tool schemas describe it that way —
rejected; verified directly against actual behavior rather than the documented contract,
per this project's own "verify against the source" practice.

**Decided by:** Thomas, 2026-09-26 (the 9Router config change); the file-embedding finding and
fix are the orchestrating session's, verified directly rather than assumed.

### 2026-09-26 · CORRECTION: the pal-mcp cross-call leak is NOT fixed — `pal-mcp` SUSPENDED as default reviewer

**Supersedes:** the entry immediately above's claim that "two follow-up isolated tests after
the [fusion→failover] switch came back clean." That claim was true of the two samples taken
at the time; it was wrong to read as "the leak is fixed." A third-pass Opus review, testing
specifically for this, reproduced the leak again — same class, after the config change.

**Decision:** `pal-mcp` is **suspended** as the default ordinary reviewer/auditor. Do not use
it for anything a gate depends on. Fresh Sonnet contexts are the ordinary-review path again,
with no fallback framing — this is not "unreachable, use the fallback," it is "suspended,
use the standing tier." `CLAUDE.md`, `agent-workflow.md`, and `.claude/agents/pal-reviewer.md`
all carry a suspension notice at the
top of the relevant sections rather than being rewritten as if `pal-mcp` never existed —
the design is suspended, not deleted, so it can resume once fixed.

**Why:** an Opus reviewer made one fresh, isolated `codereview` call — synthetic content, no
`continuation_id` — and its response contained material from other sessions: this
session's own earlier steps on this PR, and a palindrome/binary-search code review from a
macOS path under a different username, from a different Claude session entirely, first seen
several rounds earlier. The model's own diagnosis: this is workflow-tool step/state history
being shared across separate calls and clients on the `pal-mcp` server side — not something
the `coder` model's fusion-panel-vs-failover routing controls at all. Separately (found by
the same Opus pass): `pal-mcp` is a remote SSE server
(`https://mcp-router.technexus.info/sse`) with no access to this host's filesystem — the
earlier claim that its tools "take arbitrary absolute paths and read them with the host
user's own privileges" was simply wrong; corrected in `CLAUDE.md`.

**What this means concretely:** a `pal-mcp` review result can — and, in reproducible
testing, does — contain another session's findings represented as findings about the code
under review. That is not a tool that can safely gate anything, security-scope or not, until
the sharing is understood and closed. It also means every `## Reviewed by` this session
recorded as `pal-mcp` for review purposes was, on later PRs, always accompanied by a Sonnet
reviewer per this PR's own review record — no gate has been closed on a `pal-mcp`-only
verdict.

**Alternatives:** Keep using it with a "spot-check the output" caveat — rejected; a caveat
does not stop leaked content being reported as a finding about the wrong code, which an
orchestrator under time pressure could act on directly. Blame the fusion-panel config and
declare it fixed by the failover switch — this is exactly the mistake the entry above made;
rejected on re-test. Keep pushing `pal-mcp` as "must-use" per Thomas's instruction to
continue trying it — the orchestrating session judged this a case where a live, reproducible,
unresolved cross-session data leak overrides a productivity instruction, and is reporting
this plainly rather than complying quietly; Thomas's actual decision on whether/how to keep
using `pal-mcp` is still his to make, with this finding in front of him.

**Decided by:** finding is Opus's (third-pass review), reproduced and cross-checked by the
orchestrating session; the suspension is the orchestrating session's own call, reported to
Thomas directly, not something to leave ambiguous while more real review traffic might flow
through a leaking tool.

### 2026-09-26 · Phase finalizer Opus pass added per stage — additive, not a substitute for per-PR security-scope Opus review

**Decision:** At the completion of each stage (P0 through P7), before it is claimed done, run
one broader Opus red-team pass across everything merged for that stage since the last
finalizer (mirrors the 2026-09-05 "internal red-team pass at the go-live gate" decision,
generalized to every stage instead of only go-live). This is **additive only**: the existing
per-PR Opus security review remains mandatory, unchanged, for every security-scope change
(auth, permissions, migrations, CI/gate machinery, dependency graph) at merge time — no row in
`AGENTS.md`'s review-tier table becomes "n/a" because a finalizer exists.

**Why:** Thomas asked whether batching Opus review to per-phase finalizers (plus security
checkpoints) instead of per-PR could reduce Opus subagent spin-up while keeping quality.
Reducing per-PR Opus review to a phase-boundary-only check would reopen the exact failure
this project exists to avoid: v1's eleven authorization holes shipped past a green test suite
specifically because nothing checked them before they were built on. A hole sitting on `main`
for a whole phase compounds and is harder to find in a finalizer's read of many merges than in
one focused per-PR review. The already-decided lightweight-confirmation row
(2026-09-16 decision, `AGENTS.md`'s review-tier table) already scales per-PR Opus cost down for
small, inspectable security-scope changes — that is the existing lever for reducing overhead,
not skipping the gate. A phase finalizer is a good addition on top of that: it catches
cross-PR interaction the per-PR gate cannot see, which no per-PR review was ever meant to
catch.

**Alternatives:** Replace per-PR Opus security review with phase-finalizer-only review —
rejected for the reason above; this is the specific trade-off Thomas asked about and did not
confirm accepting, so it is not adopted. Do nothing (no finalizer) — rejected; a broader,
periodic red-team pass has independent value already proven at the go-live gate and costs
little extra since it runs once per stage, not per PR.

**Decided by:** Thomas, 2026-09-26, in session (framing — additive, not a replacement —
proposed by Claude and not overridden).

### 2026-09-26 · Remediate the named post-merge review findings

**Decision:** Thomas authorizes separate follow-up pull requests, one at a time, to fix the
specific review findings identified in the 2026-09-26 handoff: #354 S1 (shadow-event
workspace provenance), #341 F1 (error normalization for arbitrary thrown values), #362
L1–L4 (assignable-people query scope and filtering), #367 D1 (documentation wording), and
#371 (persist decline actor so customer reopen is limited to system auto-declines, using the
existing issue's data-model entry and migration). The orchestrator's proposed order is #354,
#341, #362, #367, then #371: address the P0 security and reliability risks first, followed
by query correctness, wording, and the schema change. This authorizes the listed fixes only;
it does not authorize an API route for intake or extend #372's prerequisite scope.

Each follow-up must use the ordinary-review count required by the risk classification in
`AGENTS.md`, with independent reviewer contexts, and a separate exact-head Opus 5.5 final
review before merge. Use the available GPT-6 Luna context for implementation and ordinary
review when Sonnet is unavailable, without representing it as Sonnet or Opus. Keep the PR's
source finding and review record together; add regression tests for behavioral findings, and
documentation validation for #367's wording finding. Security-scope changes and the migration
remain subject to their full review tier and normal protected-PR gates. This decision does not
waive checks, permit self-review, or authorize direct pushes to `main`.

**Why:** These findings were recorded by reviewers of already merged work. Leaving the
workspace-provenance S1 and error-boundary robustness defect unfixed would retain known
security and reliability gaps; the assignable-people and intake records are also explicitly
owned by existing issues. Thomas has now authorized fixing these concrete findings through
the repository's ordinary follow-up flow.

**Alternatives:** Leave all post-merge findings as backlog; treat the pasted handoff as a
gate waiver; or batch unrelated changes into one PR. Rejected: the listed findings are
authorized for narrow, individually reviewed follow-up PRs, with all review and merge gates
preserved.

**Decided by:** Thomas, 2026-09-26, in session.

### 2026-09-25 · Intake: a customer may reopen only a submission the system auto-declined

**Decision:** A customer may `reopen` a submission only if it was declined automatically: the `IQ-15` clarification-window auto-decline run by `reminder-scan`. A decline made by a staff member (`IQ-16`) is final for the customer. Whether staff can reopen a declined submission is not decided; `IQ-6` has no such action today. Enforcing the customer rule needs the submission record to say who declined it: a new `SubmissionRecord` field and a data-model column, tracked in #371. Until then no API route calls intake, so nothing can be reopened.

**Why:** `IQ-15` grants reopen only for the auto-decline, and a staff decline carries a reason shown to the customer verbatim (`IQ-16`), so it is a deliberate outcome. PR #328 had read "any decline can be reopened", and flagged that reading openly; Opus asked for the rule to be decided.

**Alternatives:** Customers may reopen any decline. Rejected by Thomas.

**Decided by:** Thomas, 2026-09-25, in session ("Auto-declines only").

### 2026-09-25 · While every lane is stopped, Claude Sonnet subagents may also complete stopped P2 PRs' records so they can be reviewed

**Extends:** the 2026-09-24 entry "2026-09-24 · While the lanes are stopped, Claude Sonnet subagents may make small fixes for already-recorded review findings on stopped PRs; #353 waits for #344" (#366). Its scope, independence, re-review, attribution and end conditions apply here unchanged.

**Decision:** For the stopped P2 lane's open PRs (#327, #328, #330 and #343), the orchestrating session may commission a fresh Claude Sonnet subagent (the "filler") to complete each PR's record:
- fill every missing template section, including `## Implemented by` from the commit authors;
- cite existing reviews **as history, at the SHAs they actually covered**; they never count as the review of a new head;
- bring the branch up to date with `main`.

**Rules for the filler:**
- It states only what the commit history, review notes and PR comments show.
- Anything it cannot verify stays **unknown and unticked, which blocks the merge**. It is never written as `n/a` or as a passed gate.
- It adds no code.
- **Branch updates:** a clean merge from `main`, or a conflict limited to import lists, whitespace or regenerating `tests/api-contract/openapi.json` with `pnpm openapi:write`, is allowed. Any other conflict resolution is a code change. It is either made as a #366 fix, with that fix's reviews, or returned to the lane.
- The filler's commits use the Claude Code identity. `## Implemented by` lists them by SHA, so the commit-author check reconciles.

**Reviews:** each PR then gets fresh reviews at its exact head:
- a fresh ordinary reviewer, never the filler and never the orchestrating session;
- Opus 5.5 wherever a security-scope path is touched. Any #366 fix made on the way needs Opus whatever its paths, as #366 requires.

Every other gate is unchanged, and no gate is waived.

**Why:** Thomas, 2026-09-25 ("yes use sonnet now"), answering whether a Sonnet agent may fill in these four PRs' forms from their history and existing reviews, then run the missing reviews. These PRs had code and some reviews, but PR bodies the template gate rejects, and no lane is left to finish them.

**Alternatives:** Leave them until the P2 lane restarts. Rejected by Thomas.

**Decided by:** Thomas, 2026-09-25, in session.

### 2026-09-25 · Intentional pre-2.0 OpenAPI breaking changes pass only through a reviewed allowlist

**Supersedes (narrowly):** the unconditional failure of `oasdiff breaking --fail-on WARN` added by #355, only for a finding that exactly matches a reviewed allowlist entry, and only before 2.0.0. `api-design.md`'s post-2.0.0 rule is unchanged.

**Decision:** `scripts/ci/openapi-approved-breaks.json` lists each approved break by operation, oasdiff rule, oasdiff finding fingerprint, PR, reason and decision reference. The contract gate passes a breaking finding only on an exact (operation, rule, fingerprint) match against an entry that is NEW relative to `origin/main`'s copy of the file — entries approve only the break in the PR that adds them; delete them after merge, since an entry already on `main` approves nothing there and the gate only warns (does not fail) if a merged entry is left in the file. Every other finding still fails, a new entry matching no finding fails as stale/typo'd, and malformed input, an unreadable base copy, or an unexpected oasdiff exit status all fail closed. The file is in the security-review scope, so every entry is added in the PR that makes the break and needs an Opus review there. From the first stable `v2.0.0` (or later) release tag on origin, the file must be empty, and a non-empty file fails the gate.

**Why:** the API is unversioned until 2.0.0 (`api-design.md`). #355's gate had no way to approve a deliberate break, so #320's list envelope, which is #310's deliverable and already consumed by the web client, could not pass.

**Alternatives:** Skip the breaking check until 2.0.0, rejected because accidental breaks would go unseen. Serve #320's envelope on a new path and keep the array route, rejected because it adds code and a legacy route for an unversioned API.

**Decided by:** Thomas, 2026-09-25, in session ("Reviewed allowlist file").

### 2026-09-24 · While the lanes are stopped, Claude Sonnet subagents may make small fixes for already-recorded review findings on stopped PRs; #353 waits for #344

**Supersedes (temporarily, in part):** the 2026-09-23 entry "Three non-Claude implementation agents take the P0/P1/P2 lanes…" (#336), only its assignment of *fix rounds* to the lane agents and its narrowing of the Claude session to Opus review and merge. The narrowing is suspended for the recorded-finding fixes this entry allows, and applies again when this entry ends. Nothing else in #336 or #345 changes, and neither is rewritten. `CLAUDE.md`'s "Model tiers" note is read with this exception.

**Decision:**
1. While **every** lane agent (P0, P1, P2 and P3) is stopped, the orchestrating Claude session may, on a stopped lane's PR, commission fresh Claude Sonnet subagents to make **small fixes for findings a review has already recorded**.
   - **Scope:** no new features, and nothing beyond the recorded finding. A finding that needs a design change, a migration or a new shared contract is not a small fix; it goes back to the lane. One PR at a time. Each fix has a regression test that fails on the unfixed code.
   - **Independence:** a fresh context other than the fixer does the ordinary review of the fix, as #345 and the current-model fallback allow. It records its model and the exact SHA it reviewed. The Opus 5.5 reviewer is a third, separate fresh context. Neither reviewer may be the fixer, and neither may be the orchestrating session.
   - **Re-review:** the fix moves the head, so every earlier clearance on that PR is stale. The PR needs all of its required reviews again at the new head before merge. That includes Opus, even outside security scope.
   - **Attribution:** the fix commits use the Claude Code identity. The PR's `## Implemented by` lists both the lane agent (original work) and the Claude Sonnet fixer (the fix commits, by SHA), so the commit-author check still reconciles.
   - **Unchanged:** every required status check in `protect-main` (15 today), exact-head binding, and no waivers.
2. PR #353 (assign a work item) is **not** merged without its audit-log row. It waits for #344 (`audit_log.project_id` and the project-reach read filter), and #365, which is stacked on it, waits too.

**Why:** Thomas, 2026-09-24. All four implementation lanes stopped with review findings open, including #320's blocking cross-tenant cursor leak. Review-only work can't move those PRs. The audit-row requirement is a real gate, so Thomas kept it rather than waiving it.

**Alternatives:** Keep the orchestrator review-only and leave every PR with findings until the lanes restart. Rejected for small recorded fixes. Waive #353's audit-row item and track it. Rejected by Thomas.

**Scope and end:** this ends everywhere as soon as **any** lane agent restarts, or on 2026-09-30, whichever comes first, unless Thomas extends it. A fix already under review when it ends may finish its gates.

**Decided by:** Thomas, 2026-09-24, in session ("Yes, small fixes only"; "Wait for #344").

### 2026-09-24 · GPT-6 Luna replaces Sonnet for ordinary reviews on active P0 lanes

**Decision:** For the currently active P0 work, use fresh independent GPT-6 Luna contexts
for Sonnet-tier implementation and ordinary reviews when the Sonnet provider is at its
usage limit. This substitution does not change review counts, independence requirements,
or the exact-head rule. Every security-scope candidate still requires its separate final
Opus 5.5 review before merge.

**Why:** Thomas authorized continued P0 work with the available GPT-6 Luna agent while
Claude/Sonnet capacity is exhausted; implementation and ordinary review should keep moving
without representing GPT-6 as Opus.

**Alternatives:** Stop all P0 implementation until Sonnet capacity returns; treat GPT-6 as
Opus or waive the Opus gate. Rejected: implementation and ordinary review may proceed, but
Opus remains mandatory for security-scope work.

**Decided by:** Thomas, 2026-09-24, in session.


### 2026-09-24 · The security-review scope adds `packages/domain/src/identity/**` and `apps/api/src/permissions/**`

**Decision:** `docs/04-engineering/ci-cd.md`'s authoritative security-review scope list gains two globs:
- `packages/domain/src/identity/**`, the P3 identity rules: claim normalisation, SCIM validation and PATCH, role limits and customer reach;
- `apps/api/src/permissions/**`, which holds `resolveIdentity` (#315) and the #8 shadow-mode middleware (#323).

From now on, any PR touching either path needs the Opus 5.5 security review, enforced by CI.

**Why:**
- #346's Opus review (S11) found the identity rules outside the scope, although they decide who gets which roles and reach. The same review found a ReDoS and a fail-open role mapping in that code.
- `apps/api/src/permissions/**` was also outside it. #315 and #323 were only reviewed by Opus because the orchestrating session commissioned it.

This only tightens the gate. It removes nothing.

**Decided by:** the orchestrating session, 2026-09-24, under Thomas's standing delegation. There was one clearly recommended option.

### 2026-09-23 · Require coverage and full-stage smoke contexts in `protect-main` (#10)

**Decision:** The active `protect-main` ruleset now requires the exact `domain coverage (90%)`,
`integration - Postgres 18`, and `e2e - protected-route redirect` status contexts.
`integration - Postgres 18` already ran in CI without blocking merges. The other two jobs are
**first defined by PR #355**. Until #355 merges, no PR can produce those two contexts, so the
ruleset blocks every merge. #355 must merge first. (Corrected by the orchestrating session
from #355's Opus review, S5.)

**Why:** A quality gate is effective only when the merge control requires it. The ruleset
was updated without removing or changing any existing required context; its live state was
verified after the update. Opus review remains required for the security/control-plane
changes on the candidate before merge.

**Alternatives:** Leave these as informational checks. Rejected because merge could proceed
despite failed coverage, database integration, or browser-smoke gates.

**Decided by:** The orchestrating session, 2026-09-23, under Thomas's instruction to continue
P0 and take the recommended option.

### 2026-09-23 · OpenAPI contract tools and inherited-lint ratchet

**Decision:** Add `@redocly/cli` 2.54.2 as an exact development dependency; run Redocly's
recommended rules and compare findings to those generated from the immutable `origin/main`
API contract. Pin `oasdiff` 1.32.1 and verify its Linux x64 release archive with the
published SHA-256 on every run; fail on `WARN`-level breaking changes against `origin/main`.

**Why:** P0 #10 and this document already require OpenAPI lint and breaking-change detection.
The inherited spec has five identical-path errors, six ambiguous-path warnings, four missing
4xx-response warnings, and one missing license warning. Comparing to the base branch allows
existing contract issues to be tracked without letting new ones enter unnoticed; the
candidate cannot widen the baseline. The official oasdiff release publishes the binary outside npm, so
the check pins and verifies the upstream artifact rather than adding an unverified package.

**Alternatives:** Leave the contract check drift-only; disable inherited lint rules; use an
unpinned network installer. Rejected: these either leave the documented gate incomplete,
hide all future findings in those categories, or do not verify the downloaded tool.

**Decided by:** Thomas, 2026-09-23 (selected recommended option).

### 2026-09-23 · Domain coverage gate thresholds

**Decision:** Enforce minimum 90% statements, lines, and functions for `packages/domain`;
report branch coverage but do not threshold it.

**Why:** The existing CI/CD contract says 90% coverage for the domain package, and current
coverage is above 90% for these three dimensions. Branch coverage is useful diagnostic
information, but applying the same threshold would silently redefine the documented gate
which would change what the documented gate means. (An earlier draft of this entry cited
88.77% branch coverage. At #355's head, branch coverage is 95.15%, so branches are reported
but not given a threshold, deliberately and not because the branch number fails.)

**Alternatives:** Apply 90% to branches too, or leave the threshold unspecified. Rejected:
the former exceeds the existing contract without a stated reason; the latter would leave
the documented gate unenforced.

**Decided by:** Thomas, 2026-09-23 (selected recommended option).

### 2026-09-23 · Current-model ordinary-review fallback when Sonnet is unavailable; Opus remains mandatory

**Supersedes (narrowly):** the reviewer-provider clause in the 2026-09-23 temporary fallback (#345), only when a fresh Claude Sonnet context is unavailable.

**Decision:** The orchestrating session may commission a fresh, independent context using the currently available model for ordinary review of lane work. Record the actual model, exact candidate SHA, checked evidence, verdict, and findings. This does not change reviewer independence or the review count required by risk classification. It never substitutes for the final Opus 5.5 review on security-scope work; such a candidate waits for Opus before merge.

**Why:** Claude Sonnet is unavailable in the current session, while P0 work should continue. The user explicitly authorized the current model as the ordinary-review fallback and reaffirmed that Opus remains the final reviewer.

**Decided by:** Thomas, 2026-09-23, in session.


### 2026-09-23 · Provision a local staff person during post-boot password signup

**Decision:** The `/sign-up/email` user-create hook ensures an internal staff `person` row exists before a local password signup completes. It does not assign a person to an OAuth callback; the identity connection must determine portal and organisation when that provisioning path is implemented.

**Why:** The boot seed only covers users present at startup, so later local signups otherwise resolve to `missing_identity` (#315 S7). Treating every external callback as internal staff would invent portal and organisation authority. The route-specific local-signup hook follows the current boot-seed rule while leaving external identity provisioning to its declared connection.

**Decided by:** Thomas, 2026-09-23, by approving #324's signup-or-lazy-resolution acceptance and continuing this implementation.

### 2026-09-23 · Storybook 10 compatibility spike for `packages/ui`

**Decision:** Pin `storybook` and `@storybook/react-vite` to `10.6.0` in
`packages/ui`; keep `@tailwindcss/vite` available to the package's Storybook config. The
representative Button story builds on the current stack: Node `24.20.0`, React `19.2.8`,
Vite `8.2.1` (Rolldown), and TypeScript `7.0.2`.

**Why:** `pnpm --filter @taskdesk/ui build-storybook` completed successfully. Its output
reported Vite `8.2.1` and emitted a Rolldown runtime chunk. A TypeScript 7 no-emit check of
the Storybook config and story passed. The dev server also started; `GET /` returned `200`
and `/index.json` listed all three Button stories. Storybook's Vite builder needed the
Tailwind Vite plugin declared directly in `packages/ui` because pnpm does not expose
`apps/web`'s dependency to that workspace package. Build emitted a non-blocking warning for
the 1.1 MB preview chunk.

**Alternatives:** A separate app-level Storybook setup would not exercise the design-system
package boundary used by primitive stories.

**Decided by:** Storybook 10 is already selected by `tech-stack.md`; the pin and compatibility
result were recorded by the implementing agent, 2026-09-23.

---

### 2026-09-23 · The P3 identity gate covers all 25 named acceptance tests

**Decision:** Before the P3 identity gate closes, all 25 acceptance tests named in `identity-provisioning.md` must pass against a real Microsoft Entra test tenant. The phase, release, security-evidence and issue #39 gate wording changes from 17 tests to 25.

**Why:** The spec now names 25 acceptance tests. The additions include OIDC configuration, session revocation, and regressions for Entra quirks. Gating only the original 17 would leave security-relevant behaviour unproven against the provider P3 is meant to support.

**Alternatives:** Keep the 17-test subset. Rejected, because it is not the complete acceptance suite.

**Decided by:** Thomas, 2026-09-23. A lane agent drafted the entry. Thomas confirmed the decision to the orchestrating session in session on 2026-09-23, and the orchestrator recorded it.

### 2026-09-23 · SCIM duplicate conflicts share one generic external 409

**Decision:** Every SCIM identity conflict returns an identical generic `409`, with no existing-resource id and no conflict class. That covers same-connection conflicts, cross-connection conflicts, and conflicts across organisations. The provisioning event may keep the internal distinction.

**Why:** If a same-connection duplicate returned the existing id and a cross-connection conflict didn't, a caller could tell whether an identity exists inside another tenant boundary. The IdP can reconcile through its own next list or filter request.

**Alternatives:** Keep IP-32's existing-resource id in the detail. Rejected, because it lets the caller tell the two conflict types apart.

**Decided by:** Thomas, 2026-09-23. A lane agent drafted the entry. Thomas confirmed the decision to the orchestrating session in session on 2026-09-23, and the orchestrator recorded it.

### 2026-09-23 · Manual release tags the selected `main` SHA without version-bump commits

**Decision:** A maintainer manually dispatches a release with a SemVer version and a full source SHA already reachable from protected `main`. The workflow creates the matching Git tag and GitHub release at that SHA and publishes its signed multi-architecture image. It does not create a version-bump commit or edit `CHANGELOG.md`, package version files, or chart version files. The existing automatic `edge` cadence remains as documented in `release-plan.md`.

**Why:** Thomas selected “tag and release the chosen SHA” and rejected a version-bump change through a PR. The release must identify the exact tested source while preserving protected `main` and the changelog/version files.

**Alternatives:** A PR that changes version files was rejected, as was automatic version-file mutation by semantic-release. Stable promotion remains a separate operator action after UAT verification.

**Confirmed by:** Thomas in the 2026-09-23 session response.

---

### 2026-09-23 · Until the lane agents' review capacity returns (2026-09-30), a fresh Claude Sonnet context does the ordinary independent review

**Supersedes (temporarily):** the 2026-09-23 entry "Three non-Claude implementation agents take the P0/P1/P2 lanes…". That entry says the lane agents review each other. The agents have reported no ordinary-review capacity until 2026-09-30T15:27Z.

**Decision:** Until the agents' capacity returns, the orchestrating Claude session commissions a **fresh Claude Sonnet context** as the ordinary independent reviewer for lane-agent PRs. Claude Sonnet was the project's ordinary-review tier before 2026-09-23, so this is not a downgrade. It stays independent, because no Claude context authored these PRs. Every other rule in that entry is unchanged:
- the reviewer's model and the exact SHA it reviewed are recorded;
- the attestation is spot-checked against the commit authors;
- an Opus 5.5 review is required for security scope;
- the exact head must be green;
- no waiver is allowed without Thomas.

From 2026-09-30 the agents review each other again.

**Why:** Otherwise every lane PR stalls for a week. The capacity rule forbids downgrading or fabricating a review, and this does neither.

**Decided by:** the orchestrating session, 2026-09-23. Thomas expressed no preference when asked, so the recommended option applies under the standing delegation.

### 2026-09-23 · Workspace audit reads are filtered by project reach (AU-10)

**Decision:** A reader of the workspace audit log (`workspace:manage_settings`) sees rows that are not project-scoped, plus rows for projects they can reach under the application's normal reach rules. That includes per-workspace `sees_all` (#319/#334). They never see rows for projects outside their reach. `audit_log` gains a nullable `project_id` with no FK, which follows `workspace_id`'s precedent, and it is recorded for every project-scoped action. The implementation is tracked in #344. **It must land before the first project-scoped audit writer merges.** Until then, PR #343's unfiltered workspace read exposes nothing extra, because no rows are project-scoped yet.

**Why:** PR #343's Opus review (S1) and the 2026-09-05 security review ("Logging and audit access scope") found that a manager with no project access would otherwise read those projects' `before`/`after` payloads. That is the same reach rule the rest of the application enforces.

**Alternatives:**
- Restrict audit reads to owner, admin or `sees_all`. Rejected: managers would lose audit access entirely.
- Accept unfiltered reads as AU-10's text allowed. Rejected: that is the gap the security review flagged.

**Decided by:** Thomas, 2026-09-23, in session. He chose the recommended option.

### 2026-09-23 · Three non-Claude implementation agents take the P0/P1/P2 lanes; the Claude session does Opus 5.5 security review and merge only

**Supersedes (in part):**
- `CLAUDE.md`'s "Model tiers" statement that non-Claude specialist agents for coding "did not work out and are not part of this project's process";
- the earlier entry recording that the DeepSeek/GLM-routed implementation agents were dropped (line ~1187).

Neither older text is rewritten.

**Decision:** From 2026-09-23, implementation and Sonnet-tier work on the P0, P1 and P2 lanes is done by three agents that Thomas runs:
- GPT-6 Luna;
- DeepSeek 4.1 Flash, through GitHub Copilot;
- mimo-v2.26 Flash, through Cline.

Sonnet-tier work means implementation, fix rounds and ordinary reviews. The Claude Code session's role narrows to two things:
- the **final independent Opus 5.5 security review** of every security-scope PR (`docs/04-engineering/ci-cd.md`'s path list), run in a fresh context separate from the author;
- **merging** fully-green candidates through the protected flow, under the 2026-09-15 delegated merge authority.

**The gates are unchanged.** Every PR still needs all of the following on its exact head:
- an **independent ordinary review**, meaning a different agent or context from the author, with its actual model identity recorded in `## Reviewed by`;
- the Opus 5.5 security review, where the change is in security scope;
- every required check green;
- no waived gate.

A waived gate still needs Thomas. The Claude session merges only after verifying each gate itself, never on another agent's report of green. An agent never approves its own work, whatever its vendor.

**How independence is verified, stated honestly.** Independence rests on the PR's own attestation. The Claude session checks that attestation at merge; it is not a cryptographic guarantee. Before every merge, the session checks:
- `## Implemented by` names the authoring agent and model.
- `## Reviewed by` names a **different** agent and model, gives the exact SHA it reviewed, and has its verdict recorded on the PR.
- The same agent or tool is never both author and ordinary reviewer, and a reviewing agent can't clear a fix round it wrote itself.
- For security-scope PRs, the Opus 5.5 review is always a fresh Claude context commissioned by this session, never one of the three lane agents.
- The commit authors (`git log --format='%an <%ae>' main..HEAD`) are spot-checked against `## Implemented by`.

**Commit identity rule, from 2026-09-23.** Each lane agent commits under its own distinct git author identity that names the tool, as Cline already does (`Cline (…) <agent@taskdesk.local>`). No lane agent may commit as `Claude Code <noreply@anthropic.com>`, which is this session's identity. PR #336's review found that several agent-authored PRs (#326, #331–#335) were committed under that identity. Where that has already happened, the PR's `## Implemented by` must name the real authoring agent, and the mismatch is noted on the PR before merge. A PR whose attestation and commits can't be reconciled does not merge.

If any of these is missing, the PR does not merge. It waits, and the PR says what is missing.

**Why:** Thomas's instruction on 2026-09-23. Claude's spend limit was being reached repeatedly mid-lane, and it is better spent on the Opus-tier review that nothing else on the project can do.

**Decided by:** Thomas, 2026-09-23, in session. The orchestrating Claude session recorded it. Thomas then separately confirmed that the three agents do the **ordinary independent reviews** as well as the implementation, reviewing each other's PRs. He answered that one explicit question after PR #336's first review asked for it, choosing it over keeping ordinary reviews on a fresh Claude Sonnet context. Opus 5.5 stays the security reviewer.

### 2026-09-23 · Sequence #8 shadow-mode tables after #322's migration

**Decision:** Preserve #322's `0068_workspace_role_is_system` migration and its snapshot
as index 68. Move #8 Slice 2's hand-written shadow-evidence migration to
`0069_policy_shadow_tables`, append index 69, and chain its snapshot to the new 0068
snapshot. Keep the shadow-table Drizzle declarations outside `database/schema.ts`, as the
original #323 decision specifies; update their migration references.

**Why:** #322 merged first, so its existing migration and deployed ordering stay intact. The
unmerged #323 candidate collided with it on both numeric prefix and journal index. Giving
the shadow tables the next forward-only slot removes the collision without rewriting either
migration's contents or folding the shadow tables into #308's shared schema lane.

**Alternatives:** Rewrite or renumber #322's migration — rejected because it is already on
`main`. Fold the shadow tables into the canonical database schema — rejected because that
would change the recorded lane boundary and generate a different migration than #323's
hand-written table contract.

**Decided by:** the orchestrating session, 2026-09-23. It adopted the #323 lane's migration-sequencing fix, which #323's Opus S9 required. This is an implementation sequencing detail, not an owner decision.

### 2026-09-23 · #8 Slice 2's shadow mode: an env switch, two Postgres evidence tables, read-only row-scope exposure

**Decision:** The shadow-mode policy middleware (#8 Slice 2) is built from three parts.

- **Switch.** `TASKDESK_POLICY_SHADOW` is `off` (the default) or `on`. When it is off, the middleware is a no-op with zero queries. UAT runs with it on. This is an interim bridge, in the same pattern as `TASKDESK_STORAGE_DRIVER`, until the `*_feature_flag` tables in `plugin-architecture.md` exist.
- **Evidence.** Two tables, registered in `data-model.md`:
  - `policy_shadow_tally` holds per-day counts per `(route_key, outcome, reason_code)`, agreements included. Every request that reaches a router while shadow is on is counted.
  - `policy_shadow_event` holds non-agreeing outcomes, with the addendum's attributable fields. It stores ids only, never bodies, headers or secrets, and is capped at 50 rows per `(day, route_key, outcome, reason_code)`.
  - Writes happen after the response and can never change it.
  - Retention is 30 days. The writer prunes old rows itself, because no jobs runner exists yet (`apps/api/src/jobs/` is absent). The pruning moves to a job when the runner lands.
- **Row scope.** The existing middleware (`workspace-access-middleware.ts`, `require-work-item-reach.ts`) exposes the ids it has already loaded through read-only `c.set(...)`, with no new query and no behaviour change. A route that still has no evidence is logged as `unevaluated`, with a reason code, never skipped.

**Why:** The #8 addendum requires evidence that is "queryable for at least the whole soak window, not only in container stdout". `observability.md` sends application logs to stdout, kept for "whatever the collector keeps", and the deployment has no queryable log store. So a small Postgres store is the only option that meets the requirement. A per-day tally keeps coverage and summary counts cheap. A capped event list keeps the attributable detail bounded. Without read-only row-scope exposure, almost every project-scoped or work-item-scoped route would be `unevaluated`, and the 7-day soak would prove nothing.

**Alternatives:**
- Structured stdout logging only. Rejected: it fails the addendum's retention rule.
- Reusing `audit_log`. Rejected: it has the wrong shape, being hash-chained, append-only, 12-month retention, and "who changed what".
- Building the `*_feature_flag` tables first. Rejected for now: that is a P4 governance piece of its own, and it would block #8 on unrelated work.

**Coverage in this slice:** `public`/`delegated` routes are fully evaluated. Workspace
`capability` policies are evaluated when the legacy middleware exposes the target workspace;
request-sourced policies use `RequestScope`, while row-sourced policies use `RowScope`. A
denied request whose scope was not exposed is `unevaluated: row_scope_unavailable`;
`scope_source_unavailable` is reserved for the shadow's own construction artifacts
(`scope_mismatch`/`scope_source_mismatch`), never a fabricated disagreement. Evaluations
dropped under saturation are recorded as `unevaluated: shadow_saturated` under the
affected route's own router group, so a saturated router reads as not-clean. Project/work-item capability
policies without reach facts, other scopes, `self` and `portal` policies, and requests with no
resolved identity are also recorded as `unevaluated`, each with a specific reason code. This is
fail-safe, because a router with any `unevaluated` requests is not clean and cannot cut over.
Widening coverage is follow-up work (Slice 2b). Because the shadow evaluation runs after the
response, 2b may load the missing reach facts with extra reads without adding request latency.

**Decided by:** the orchestrating session, 2026-09-23, under Thomas's standing delegation. There was one option that meets the recorded requirement. The Slice 2 lane surfaced the gaps.

### 2026-09-23 · P3 ordinary reviews may use fresh GPT-6 contexts when Sonnet is unavailable

**Decision:** For the P3 identity/portal candidate, use two fresh, independent GPT-6 reviewer
contexts in place of Sonnet ordinary reviewers when Sonnet capacity is unavailable. Record
the substitution in the pull request and keep the required independent Opus security review
as a separate final gate; this decision does not authorize merge without Opus.

**Why:** The implementation can be reviewed by available independent contexts without
holding ordinary review idle, while preserving the security review's required model tier.

**Alternatives:** Wait for Sonnet before ordinary review. Deferred by Thomas's explicit
instruction for this candidate only. Treat GPT-6 as Opus or waive the security review.
Rejected: Opus remains mandatory and cannot be replaced by this decision.

**Decided by:** Thomas, 2026-09-23.

### 2026-09-23 · Built-in role names are reserved; a built-in grant needs a genuine seeded row (`workspace_role.is_system`); existing data is reported, not rewritten (#318)

**Decision:** Every `BUILT_IN_ROLES` key is reserved as a custom workspace role name. It is normalised the same way as the existing `owner` check and gets the same refusal. The legacy check (`require-workspace-capability.ts`) and the adapter (`resolve-identity.ts`) grant a built-in role's capabilities only to `owner`, or to a `workspace_role` row with `is_system = true`, through one shared predicate (`isGenuineBuiltInRoleGrant`). Migration `0068` adds `is_system` and **backfills `true` for every existing `viewer`/`member`/`admin` row**. `seedDefaultWorkspaceRoles()` repeats that repair on every boot. Without the backfill, every existing admin, member and viewer would have lost their built-in capabilities on deploy. PR #322's ordinary review found this; CI had missed it because it always migrates an empty database.

**Existing custom rows that use a built-in name are reported, not rewritten.** This is option A. `apps/api/scripts/audit-reserved-workspace-role-names.ts` is read-only, and it is run once against UAT at the next redeploy. The runtime rule already neutralises every collision, so a report is enough. An admin-facing "rename this role" affordance (option C) belongs with #40, the P4 roles UI.

**Known residual, stated plainly:** a custom row named `viewer`/`member`/`admin` can exist in live data today, and there are two ways it could have got there. Before S4, better-auth's `create-role` accepted any name. **Until #322 deploys**, the native routes on `main` also allow it: delete the seeded row while it is unassigned (`delete-workspace-role.ts`), then recreate the name as a custom role (`create-workspace-role.ts`). #322's Opus review reproduced this on `main`'s tip. #322 closes the path once it deploys. The name-based backfill marks such a row genuine. That preserves the access it already had on `main` through the bug being fixed, so it grants nothing new. After the backfill, though, the audit script can no longer tell such a row apart from a genuine seeded row. This was confirmed by #322's delta review, from `git log -p` and the installed better-auth source. No evidence of exploitation exists.

**Why:** A role row's name was being trusted as proof that it is a built-in role, and that allowed escalation (#315 Opus S2). The row's provenance has to be stored somewhere. `UNIQUE (workspace_id, role)` plus seeding at creation make the name trustworthy for the three seeded names in existing data, but for nothing else.

**Alternatives:**
- A report plus a startup log line (option B). Deferred: it is not needed for safety.
- Silently renaming or reassigning colliding roles. Rejected: #318 forbids touching anyone's role silently.
- Backfilling nothing. Rejected, because it strips every existing admin's capabilities.

**Decided by:** the orchestrating session, 2026-09-23, under Thomas's standing delegation. The runtime fix makes option A sufficient.

### 2026-09-23 · The API connects as a non-owner, non-superuser role; append-only is enforced by grant first, trigger second (#296)

**Supersedes (in part):** the 2026-09-23 entry "`audit_log` is append-only by trigger, not
by grant — this deployment has exactly one Postgres role". Its premise, one role, stops
being true with PR #308. The triggers from `0067` stay as a second layer. They are not
removed.

**Decision:** Every shipped deployment (`compose.yml`, `charts/taskdesk/**`, `deploy/**`)
uses two Postgres roles:
- **Migration/owner role.** `TASKDESK_MIGRATION_DATABASE_URL` connects as the role that
  owns every table. It is used **only by a separate one-shot migrate process**
  (`TASKDESK_ROLE=migrate`): a compose `migrate` service, or a `migrate` initContainer on
  the Helm `taskdesk` Pod. Kubernetes finishes an initContainer before the Pod's own containers
  start. That replaced a pre-install hook Job, which timed out on a fresh install because it ran
  before the chart's ServiceAccount and bundled Postgres existed (Opus delta D2). The process runs the migrations and the grant step, then exits. **The
  long-running API and jobs processes never receive this URL.** The API refuses to start if
  it is present in its environment (`assertNoMigrationUrlInApiProcess`), because closing a
  connection pool does not remove a credential from the process environment
  (`/proc/self/environ`). This was found by PR #308's Opus review, S1.
- **Application role.** `TASKDESK_DATABASE_URL` connects as `taskdesk_app`. It is not a
  superuser, it owns nothing, and it has DML only. On `audit_log` and `activity` it has
  `INSERT` and `SELECT` only, with no `UPDATE`, `DELETE` or `TRUNCATE`.

Grants are applied by the migrate process (`ensureApplicationRole`), which runs as the owner right
after `migrate()`. They are not applied by a migration file. The app role's password is sent as a
pre-computed **SCRAM-SHA-256 verifier**, never as plaintext, and errors from that step carry no
query text. Without this, a failed or DDL-logged `CREATE ROLE … PASSWORD` would write the password
to the API and server logs (Opus S2). It does `REVOKE ALL`, then precise `GRANT`s,
plus `ALTER DEFAULT PRIVILEGES`, so it is idempotent. It re-derives the grants from the
live table list and `APPEND_ONLY_TABLES` on every migrate run. The API process then **refuses to start**
(`assertApplicationRoleIsNotPrivileged`) if the connected application role, or any role it can reach,
does any of the following. "Reach" means through membership or `SET ROLE`, checked transitively with
`pg_has_role(…, 'MEMBER')`. The refusal conditions are:
- it is a superuser;
- it can create roles, bypass row-level security, or start replication;
- it is a member of `pg_write_server_files`, `pg_read_server_files`,
  `pg_execute_server_program`, `pg_signal_backend`, `pg_database_owner`,
  `pg_write_all_data` or `pg_read_all_data`;
- it owns anything in `pg_class`, `pg_proc`, `pg_namespace` or `pg_type`.

The role create-and-grant step runs under a transaction-scoped advisory lock, so two
replicas booting at once cannot race. Two things are deliberately **not** refused, because neither can defeat the
append-only or no-DDL controls this check exists for (PR #308's review):
- membership in `pg_monitor`, which can read other sessions' statistics and settings but has
  no data or DDL rights;
- ownership of large objects, which the app role can create for itself. Reaching the
  filesystem from a large object needs `pg_read_server_files` or `pg_write_server_files`,
  and those are already refused.

There is **no single-URL mode for the API**. If the API is connected as the table owner, the
privilege check refuses to boot, whatever the environment. Local development uses the same
two steps: run `TASKDESK_ROLE=migrate` once with the owner URL, then serve against the app role.
This is documented in `configuration-reference.md`. For a Helm external database with
`migration.enabled: false`, one role both migrates and serves, and **the Pod fails closed** in
one of two ways:
- if that role can run DDL (the chart's documented setup SQL makes it the schema owner), the
  initContainer succeeds and the `taskdesk` container then refuses to boot on its own privilege
  check;
- if it cannot run DDL, the initContainer itself fails.

In neither case does the API serve as the owner. `charts/taskdesk/README.md` documents this.

**`activity` rows are removed by cascade, and that is decided behaviour** (Opus S4). They
disappear when their work item is hard-deleted, or when a project or workspace delete cascades
to them through migration `0066`'s `ON DELETE CASCADE`. `taskdesk_app` still cannot `UPDATE`,
`DELETE` or `TRUNCATE` `activity` directly. `DELETE` is deliberately **not** revoked on
`work_item`/`project`, per the 2026-09-23 activity addendum's CASCADE decision. So a compromised
API process can erase `activity` history only by deleting the work item, project or workspace it
belongs to. `audit_log` has no such cascade (`workspace_id` has no foreign key), and it records
the deletion itself.

**Why:** The earlier entry recorded a residual risk. The API ran as the superuser table
owner, so a compromised API process could `ALTER TABLE … DISABLE TRIGGER` or `TRUNCATE`
and defeat the audit trail. This closes the first of the two items that entry said must
land. A grant is the control Postgres actually enforces against a non-owner.

The grant step runs in the migrate process rather than as a journal migration, for two reasons:
- a journal migration runs once and can't carry a deployment-specific, rotatable password;
- a future append-only table then gets its restriction automatically, not by someone
  remembering to add it.

**What it still does not stop:** the owner role is still the postgres image's init user,
and so still a superuser at cluster init. Anyone holding
`TASKDESK_MIGRATION_DATABASE_URL`'s credentials can do anything, so that credential must
stay operator-only. The second item from the earlier entry is **still open**: a chain
anchor outside this database, or a keyed hash. There is no `taskdesk_maint`/`audit-purge`
role yet, because that job doesn't exist yet.

**Alternatives:**
- Grants in a Drizzle migration. Rejected: it can't carry the password, and it runs once.
- Keep the single role and rely on triggers. Rejected: the superuser owner can disable them.
- A dedicated non-superuser owner role separate from the image init user. Deferred: it is
  more provisioning work for BYO Postgres, and it doesn't change what the API process can
  do.
- Keep migrations in the API process and narrow every claim to SQL-level compromise only.
  Rejected: it leaves the superuser credential inside the process that serves requests, and
  it would have needed Thomas's recorded risk acceptance.

**Operational consequence:** existing deployments need the new
`TASKDESK_APP_DB_PASSWORD` (compose) or `taskdesk.env.database.app*` values (Helm), and a
redeploy. The redeploy now runs the migrate step before the API:
- `scripts/deploy.sh`'s `upgrade`/`rollback` run `dc run --rm migrate` explicitly first
  (`up --wait` on a one-shot service exits non-zero even on success, Opus delta D1);
- Helm runs it as the initContainer on every rollout. The UAT redeploy needs Thomas's authorization. It is not implied by this entry.

**Decided by:** the orchestrating session, 2026-09-23, under Thomas's standing delegation.
There was one clearly recommended option, the two-role split that AU-3 and `migrations.md`
already specified. Mechanism by PR #308's lane. Recorded before #308 merges.

### 2026-09-23 · P1's UI path: new v2 work-item screens on the new API, then retire kaneo's task stack

**Supersedes (in part):** the mechanism in the 2026-09-16 entry "#23's `task` → `work_item`
migration is one-shot, not the two-phase live-cutover dance". That entry decided an
**in-place rename** of kaneo's `task` table. In practice #261 built `work_item` as a
**separate new table** beside `task` (`schema.ts`: `work_item` "references nothing in kaneo's
original `taskTable`/`columnTable`"), and nothing recorded that change at the time. This
entry records it and adopts it. The 2026-09-16 entry is not rewritten. Its **condition**
still governs the eventual data move: it may be one-shot only if no live deployment runs the
pre-move schema, and that must be re-checked when the move is written.

**Decision:** P1's work-item journey is built as **new v2 screens**: list, board, detail
page and side pane, and the create dialog, per `docs/02-design/screen-inventory.md`. They sit
on the new `/api/work-items` API (#261/#271/#292) and use `packages/ui` primitives only.
kaneo's existing task screens and `/api/task` keep working until the new screens reach
parity. Then any UAT data in `task` is moved into `work_item` once, and the task stack is
retired: routes, screens, `task_activity`, and the `task`/`column` tables. Its
`inherited-uncovered` entries retire with it, coordinated with #8.

**Why:** the new backend (the `work_item` table, the API, WI-6 activity and events) was
built beside kaneo's `task` table, not by renaming it. As of 2026-09-23 the web app uses
`/api/task` in 69 files and `/api/work-items` in none, so none of the P1 backend work is
visible in the UI yet. Building v2 screens matches the specified screen inventory and design
system (AGENTS.md rule 1). Keeping the old screens alive until parity means there is never a
period with no working task UI. `docs/07-planning/lane-prep/p1-core.md` §0/§9 recorded only the migration *mechanics* as
undecided: a one-shot rename or a two-phase cut-over. This entry answers the wider question
that mechanics depended on. Because a parallel `work_item` model now exists, it keeps the
parallel model and does a one-time data move at retirement, instead of an in-place rename. The 2026-09-16 "one-shot
migration" entry's condition, no live deployment yet, still has to be re-checked when the
data move is written.

**Alternatives:** migrate `task` data into `work_item` now and repoint the existing kaneo
screens. That gives the fastest visible journey, but comments, labels, time entries,
relations and attachments all key off `task_id`, so it is a large cutover, and it keeps
kaneo's screens rather than v2's. Or finish the backend first and do the UI later: the
cleanest backend, but nothing new is visible, which is the Oct 3 risk that two external
status reviews flagged.

**Decided by:** Thomas, via `AskUserQuestion`, 2026-09-23. He chose the recommended option.

---

### 2026-09-23 · #8 runtime policy enforcement: shadow until clean, then strict; rename `task:*` first; no permanent exceptions

**Decision:** three rules govern how issue #8's declarative policy registry becomes the
enforcing authorization path. The slicing plan is posted on issue #8.
1. **Shadow first, then enforce only when clean.** A request-path middleware first runs in
   shadow mode: it evaluates every request against the registry and logs any disagreement
   with today's hand-written checks, without ever blocking. A router group switches to
   enforcing only after **zero unexplained disagreements for about 7 days on UAT**. From
   then on it **denies** any request the registry denies. There is no fail-open window
   after cut-over. The hand-written checks keep running alongside until the router's own
   later removal slice.
2. **The `task` router switches last, after a rename.** Its routes are gated today by
   legacy `task:*` statements, while `task/policy.ts` declares `work_item:*` capabilities.
   Seeded roles are re-keyed from `task:*` to `work_item:*` (issue #7's scope) **before**
   that router cuts over. No translation shim.
3. **No permanent exceptions.** Every route must resolve to one of the five policy kinds.
   The enforcement middleware carries no "known exception" list. `GET /api/invitation/{id}`
   (#254) gets a real fix before its router cuts over.

**Why:** a registry that is declared but not enforced is the exact gap #8 exists to close,
and a fail-open window would keep that gap open. Flipping only when clean avoids a false-deny
outage from a classification mismatch; the plan found real ones, including `task:*` versus
`work_item:*` and read routes with no capability check today. A shim and an exception list
would each add security logic that is temporary or precedent-setting.

**Alternatives:** a fixed two-week soak, then enforce regardless (faster, but it could deny
legitimate traffic while a known mismatch is open). Log-and-allow after cut-over (safe for
availability, but it reopens the declared-versus-enforced gap). A translation shim for
`task`. A reviewed permanent exception list.

**Decided by:** Thomas, via `AskUserQuestion`, 2026-09-23, choosing the recommended option
on all three.

---

### 2026-09-23 · gitleaks false positive on `audit_log` secret-refusal test fixtures — dismissed by exact fingerprint

**Decision:** two gitleaks `generic-api-key` findings are added to a new root `.gitleaksignore`.
They are in `tests/api-integration/audit-log.test.ts`, at commit `dc63e85` line 188 and
commit `4f20080` line 545. Each is suppressed by its exact fingerprint
(`commit:file:rule:line`), never by path or by rule. The fixture value (`sk_live_abc123`) is
also changed to an obviously fake `fake-api-key-for-test` at the head, so no new finding can
arise from it.

**Why:** the value is not a secret. It is test input proving that the AU-2 secret check
refuses an `after` payload whose key is `apiKey`. gitleaks scans every commit in a PR's
range, so fixing the head alone could not clear the required `supply chain - secret scan`
check. The findings already live in commits `dc63e85` and `4f20080`, and removing them would
mean rewriting pushed history.

**Alternatives:** close PR #291 and open a fresh single-commit PR with fake values, so the
old commits are never scanned. Rejected: it would need Opus to re-attest a new PR, and the
review history would sit on a closed PR. A path- or rule-wide ignore was rejected outright,
because it would blind the scanner to real secrets in that file.

**Decided by:** Thomas, via `AskUserQuestion`, 2026-09-23 — "Suppress by fingerprint". This
follows the precedent of the CodeQL alert #2 dismissal (2026-09-17).

---

### 2026-09-23 · `audit_log` is append-only by trigger, not by grant — this deployment has exactly one Postgres role

**Decision:** `audit_log` is made append-only by two triggers in migration `0067`:
- `audit_log_append_only` / `audit_log_reject_mutation()`, a `BEFORE UPDATE OR DELETE`
  row trigger. It raises on every row mutation except AU-7's `organisation_id`-to-NULL
  tombstone.
- `audit_log_append_only_truncate` / `audit_log_reject_truncate()`, a `BEFORE TRUNCATE`
  statement trigger. Row triggers never fire on `TRUNCATE`, so without it the owning role
  could empty the table. PR #291's ordinary review reproduced that live.

The integration-test reset truncates every table. It turns triggers off for that one
transaction only (`SET LOCAL session_replication_role = replica`), in test code only. This replaces
the `taskdesk_app` / `taskdesk_maint` role split that AU-3 and `migrations.md` describe.
`UNIQUE (prev_hash)` turns any chain fork into a failed insert. `REVOKE UPDATE, DELETE, TRUNCATE … FROM PUBLIC` stays as defence in depth for a future
lesser-privileged role, but against the table owner today it does nothing. `activity`
gets the same treatment the next time it is touched. AU-3, AU-15 and `migrations.md`'s
"Append-only tables" section are corrected in the same change as this entry (PR #291).
`data-model.md` §11 already was.

**Why:** `compose.yml`, `charts/taskdesk/**` and `deploy/**` provision exactly one Postgres
role. That role owns every table it migrates, so it keeps full DML whatever is revoked. The
two-role split was specified but never implemented anywhere. PR #291's alignment check
verified this against each deployment file. A trigger stops application bugs and every role that doesn't own the table.

**What it does not stop.** This was found by #291's Opus review (S5), and it corrects an
earlier draft of this entry, which overclaimed. In both compose and Helm the API connects as
the table owner, and the official postgres image makes that role a **superuser**. So a
compromised API process can still `ALTER TABLE … DISABLE TRIGGER`, or add a rule that
silently drops audit inserts. AU-15's hash chain does **not** catch that after the fact: the
hash has no key, and no head is anchored outside the database, so the same actor can
recompute the rows that follow or delete the newest ones. This residual risk stays open
until two separate pieces of work land:
- the app role stops being the superuser owner (#296);
- a chain anchor stored **outside** this database (the planned `audit_chain_anchor` / `audit-purge` table lives inside it, so on its own it isn't enough), or a keyed hash, is added.

**Alternatives:** implement the real two-role split now: a lesser-privileged app role owns
nothing, and migrations run as a separate role. Rejected for this slice. It is deployment
and credential work across compose, Helm and `deploy/`, and it would block a schema-and-writer
slice on infrastructure unrelated to it. It can still land later as `audit-purge`'s own
infrastructure work, and then the grant becomes the primary control and the trigger a
second one.

**Decided by:** the orchestrating session, 2026-09-23, under Thomas's standing delegation.
There was one clearly recommended option. PR #291's alignment review drafted the entry and
judged it not a two-way trade-off.

---

### 2026-09-23 · Dependency picks: Recharts for charts, react-grid-layout for the dashboard grid, Playwright screenshots for G8

**Decision:** three new dependencies are chosen for the design system. They are **not
added yet**: each lands in the first pull request that actually uses it, where the
dependency graph gets its own security review (`package.json` and the lockfile are in
security scope).
- **Charts: Recharts** (MIT), wrapped by a `chart` primitive. Series colours come only
  from the token ramp (G3), and every chart ships its accessible `chart-table`
  equivalent (RP-11).
- **Dashboard grid: react-grid-layout** (MIT), wrapped by a `dashboard-grid`
  primitive with a stated keyboard path (RP-15).
- **Visual regression (G8): Playwright `toHaveScreenshot`** (Apache-2.0, dev-only),
  with baselines in the repo. This resolves the "Visual-regression tool for gate G8" open
  decision in `status.md`.

**Why:** Recharts' SVG output makes the per-chart accessible table and token-only colours
easiest to build. Its cost is bundle size, about 100–150 KB gzipped, against about 60–80
for Chart.js. react-grid-layout is built for resize, drag and a persisted layout.
Extending `@dnd-kit` would avoid a dependency but means building resize ourselves.
Playwright keeps baselines in the repo with no outside service, which fits a self-hosted
product, where Chromatic is a paid hosted service. The options, with licence, maintenance
and bundle-size tables checked against npm and GitHub, are in PR #278's body.

**Alternatives:** Chart.js + react-chartjs-2, visx; extending `@dnd-kit`, gridstack.js;
Chromatic. Loki was ruled out as unmaintained (no push since 2024-10-12).

**Decided by:** Thomas, 2026-09-23.

---

### 2026-09-23 · #9's primitive batches cite `ui-extraction-plan.md`; `design-system.md`'s findings close in parallel

**Decision:** pull requests that only *relocate* existing primitives into `packages/ui`
(issue #9's batches, starting with PR #274) cite `docs/02-design/ui-extraction-plan.md`
and issue #9 in their `**Spec:**` field, not `docs/02-design/design-system.md`. At the
same time, a spec-only lane closes `design-system.md`'s six open 2026-09-05 review
findings. Once they're closed, later batches cite `design-system.md` again.

**Why:** `check:reviews` (do-not 15) blocked PR #274 because its Spec field named
`design-system.md`, which still has six open findings. None of them concerns moving an
existing primitive: they cover a chart library, a dashboard grid, bounds on branding CSS
overrides, the icon vocabulary, the visual-snapshot tool, and a timesheet grid. A
relocation PR implements the extraction plan and builds nothing those findings govern.
Editing a Spec field to get past a gate is exactly the pattern `CLAUDE.md` warns about,
so this was put to Thomas, not decided by the session.

**Scope limit:** this covers relocation only. A pull request that adds or changes a
primitive's design, or builds anything the six findings name, still cites
`design-system.md` and is blocked until they close.

**Alternatives:** close the findings first and keep #274 waiting (rejected — about a
day's delay for findings unrelated to the change); re-cite only, without closing the
findings (rejected — it would leave the precedent open-ended).

**Decided by:** Thomas, 2026-09-23 (chose "both").

---

### 2026-09-23 · Activity addendum: `ON DELETE CASCADE`, and Postgres 16 stays supported

**Decision:** extends the entry immediately below. Two details it left open, both found by
PR #275's mandatory Opus 5.5 review (`docs/07-planning/security-reviews/
275-work-item-activity-table.md`, S1 and S5).

1. **`activity`'s composite foreign key to `work_item` is `ON DELETE CASCADE`** (still
   `ON UPDATE NO ACTION`). Work items are hard-deleted today, by cascade, when a workspace
   is deleted (`delete-workspace.ts`) and when a sole owner deletes their account
   (`delete-account-data.ts`); #198's purge will hard-delete expired projects. With
   `RESTRICT`, one activity row made all of those fail, so any workspace that ever had a
   work item could never be deleted. `data-model.md`'s "retained forever" means activity
   has no time-based purge of its own. It does not mean the journal outlives the hard
   deletion of its own tenant. Legal hold (#198) is the mechanism that stops a deletion
   when data must be kept.
2. **Migration `0066` works on Postgres 16 and 17 as well as 18.** Postgres 18 names
   per-column `NOT NULL` constraints and earlier versions do not. So those renames run
   only when the constraint exists. The Helm chart still defaults to Postgres 16, and
   raising the minimum is a separate decision.

**Alternatives:** `RESTRICT` plus an explicit activity delete in every hard-delete path.
Rejected: it gives the same result with more code, and every future delete path has to
remember it. Making Postgres 18 the hard minimum instead of conditional renames.
Rejected for now: it would change a deployment requirement inside a table migration.

**Decided by:** the orchestrating session, 2026-09-23, under the standing delegation
(recommended option).

---

### 2026-09-23 · Work-item activity gets its own `activity` table; kaneo's becomes `task_activity`

**Decision:** the table `data-model.md` §4 names `activity` is built now, as its own small
shared-contract pull request, exactly to that column list (`work_item_id`, `actor_id`,
`actor_type`, `verb`, `field`, `old_value`, `new_value`, `payload jsonb`, `visibility`,
`workflow_version_id` null, `created_at`). Kaneo's existing `activity` table — keyed on
`task_id`, still used by the live legacy task/comment routes — is renamed to
`task_activity` in the same migration. Only its SQL name (and its index/constraint names)
change; its columns, data and every legacy route keep working. Once the table exists, #23's
work-item create and update write paths add their `WI-6` rows. #27 (comments and
activity) builds its reads, visibility filtering and comment linking on top of this table
rather than designing it.

Three details decided with it, by the orchestrating session under the standing delegation
below:

1. **Tenant attribution follows #192.** `activity` carries a NOT NULL `workspace_id`, and
   `(workspace_id, work_item_id)` is a composite foreign key to `work_item (workspace_id,
   id)`, `ON UPDATE NO ACTION` — the same shape #192 decided for `work_item` itself, for
   the same reason. `data-model.md` gains the column in the same change.
2. **Same-instant ordering (closes the question left open by the 2026-09-16
   `reconstructAt` entry).** `activity` gets an internal `seq bigint GENERATED ALWAYS AS
   IDENTITY` column used only as the tie-break for rows sharing one `created_at`. This is a
   narrow, named exception to `data-model.md`'s "surrogate ids are never sequential". That
   rule states no rationale of its own. The argument for the exception is made here, as the
   2026-09-16 entry required: the risk in a sequential id is that it can be guessed or
   enumerated when used as a reference, and `seq` is never a reference, never leaves the
   database, and is never in an API response. The primary key stays a CUID2. `seq` gives a
   **stable, deterministic** tie-break, not true chronology: identity values are assigned at
   insert, not at commit, so two concurrent transactions can commit out of `seq` order. That
   is acceptable, because rows sharing one `created_at` are concurrent by definition and have
   no truer order to preserve. The alternative — inferring order from Postgres transaction
   internals — was rejected: commit order is not visible to readers, and `xmin` wraps
   around.
3. **`audit_log` is not part of this.** It is issue #37's table and lands separately.
   Until it does, work-item mutations disclose the missing `audit_log` row in their PR's
   `Not done` rather than inventing a stand-in.

**Why:** Thomas, 2026-09-23, choosing between three options: this one; extending kaneo's
table in place (rejected — it leaves a hybrid table with two mutually exclusive owners
that has to be unwound at task cutover); and deferring all activity to #27 (rejected —
WI-6 would be unmet for UAT, and edits made before #27 lands would have no history).

**Decided by:** Thomas, 2026-09-23 (the table choice); the orchestrating session (details
1–3).

---

### 2026-09-23 · Standing delegation: take the recommended option; ask only on a real trade-off

**Decision:** when there is one clearly recommended option, the orchestrating session takes
it without stopping to ask. It records the choice (here, or in the relevant spec) and tells
Thomas afterwards, with how to reverse it. It asks Thomas only when two or more options are
each genuinely recommendable, with trade-offs of their own.

**What this does not cover:** waiving a gate, merging a candidate whose `## Gates` table
cites a waiver, downgrading a required reviewer, and destructive or irreversible actions.
Those stay Thomas's, unchanged.

**Why:** Thomas, 2026-09-23 — a question he would answer "the recommended one" is pure
delay under the current delivery pressure.

**Decided by:** Thomas, 2026-09-23.

---

### 2026-09-23 · `PATCH /api/work-items/{key}`: `If-Match` required; its 409 body is route-specific

**Decision:** two judgment calls from PR #271, written down so they are not copied as
silent precedent. (1) `If-Match` is **required** on this route, not optional.
`api-design.md` says `PATCH` "may" send it, but `WI-7` says "every other field write is
version-checked", and a write with no asserted version has nothing to check. The domain
rule is stricter, and it wins. (2) Its 409 returns `{message, assertedVersion,
currentVersion}` so the UI can offer a resolution (`WI-7`). This is a one-off for
work-item version conflicts, **not** a new codebase-wide error shape. The codebase's
existing gap against `api-design.md`'s RFC 9457 envelope (every route returns `text/plain`
errors today) is pre-existing and is not changed here.

**Decided by:** the orchestrating session, 2026-09-23 (implementation judgment within
WI-7).

---

### 2026-09-23 · The default Opus reviewer is now Opus 5.5

**Decision:** the required final independent security / critical review runs on **Claude
Opus 5.5** by default, replacing Opus 5. Review records written from now on (the PR's
`## Security review` `**Model:**` line and the committed note under
`docs/07-planning/security-reviews/`) name the version actually used — `Opus 5.5` — rather
than a bare `Opus` or the old `Opus 5`.

**What does not change:** the tier itself. It is still Opus, still a fresh context that did
not author, direct or remediate the change, still never downgraded to Sonnet when capacity
is short (the candidate waits instead). Ordinary review and the alignment check stay on
Sonnet. The CI template check matches `^Opus`, so `Opus 5.5` already passes it — no gate
change. Older review notes that say `Opus 5` are historical records and are not rewritten.

**How it is dispatched:** the `Agent` tool's `model` parameter takes a tier (`opus`), not a
version string. `opus` resolves to the current Opus build, which on 2026-09-23 is Opus 5.5
(`claude-opus-5-5`). If a later build replaces it, this entry is superseded by a new one
rather than edited.

**Why:** Thomas's instruction, 2026-09-23. Opus 5.5 is the current Opus build and costs
less than Opus 5, so the same review tier is cheaper to run.

**Alternatives:** keep pinning reviews to Opus 5 (rejected — the tier param cannot pin a
superseded build, and there is no reason to prefer it).

**Decided by:** Thomas, 2026-09-23.

---

### 2026-09-22 · F1 addendum: `project.slug`'s claim must be permanent, not live-scoped

**Decision:** extends the "F1: `project.slug` becomes globally unique" entry immediately
below. The uniqueness constraint that entry decided on is enforced through a permanent
`project_slug_claim` registry (once a slug is claimed, by any project, it is claimed
forever — surviving that project's own rename or deletion), not merely a `UNIQUE` index on
`project.slug` scoped to currently-live rows.

**Why:** the first implementation of the entry below (migration `0064`, a bare `UNIQUE`
constraint on live `project.slug`) was found incomplete by a second mandatory Opus
delta-confirmation pass (finding D1, full record in
`docs/07-planning/security-reviews/23-work-item-create-read-list.md`): `work_item.key`
claims (`work_item_key_claim`) are, by this codebase's own established and already-accepted
design, held forever and never released — so any scheme that lets `project.slug` become
reclaimable again (via a project rename or a workspace hard-delete) reopens exactly the
cross-tenant collision the original decision existed to close, just on a delay. Reproduced
and closed live: both the rename-then-reclaim and the workspace-delete-then-reclaim paths,
previously exploitable, are now rejected with a clean `409` at project-creation time. A
third mandatory Opus review round (delta-confirmation on this fix specifically) probed
adversarially for orphaned-claim griefing, a fourth exploit path, and backfill completeness,
and found the fix holds: **CLEAR WITH FINDINGS (non-blocking)**.

**Alternatives:** the delta-confirmation review that found D1 named three candidate
closures without picking one, explicitly leaving the choice to Thomas — the same way the
original F1 resolution below was his call, not the orchestrator's. This session first wrote
this entry attributing the choice to "technical necessity" rather than asking him, and
mischaracterized the alternatives in doing so; both were corrected before this entry
reached its current form.

The three real options the review named: **(1)** the permanent claim registry, built here.
**(2)** defense-in-depth only — catch a key collision in `create-work-item.ts` and retry
with the next number, skipping burned keys, without making `project.slug` permanent. This
closes the permanent-DoS defect but leaves a residual, lesser risk the review itself
flagged: an attacker who burns a large key range under a slug can still slow down (not
permanently break) a later same-slugged project's item creation. **(3)** restrict slug
mutation once a project has any work items, and make workspace deletion soft rather than
hard, so a claim never outlives a traceable owner — avoids permanent slug loss, at the cost
of new restrictions on rename/delete behaviour that don't exist today.

The closing Opus round separately noted a fourth option this entry's earlier draft
overstated as nonexistent: deriving `work_item.key`'s prefix from an immutable value (the
project's own id) instead of the mutable `slug`, which would close D1 with no permanent
registry at all, at the cost of abandoning human-readable keys. Option (1) is the only one
of the four that preserves human-readable, slug-derived keys while still closing the gap
completely — that qualifier, not an unqualified "only construction," is the accurate claim.

**Decided by:** Thomas, 2026-09-22 (asked directly via a tight multi-option choice, after
this session's own first attempt to self-authorize the choice was caught and corrected).

---

### 2026-09-22 · #261's mandatory Opus review F1: `project.slug` becomes globally unique

**Decision:** `project.slug` gets a real, instance-wide unique constraint. `work_item.key`
(`{project.slug}-{number}`) keeps its existing global unique index as originally designed —
the fix is on the `slug` side, not the `key` side.

**Why:** PR #261's mandatory Opus security review found that `work_item.key`'s global
uniqueness was built on an assumption a comment in `apps/api/src/database/schema.ts` stated
as fact but that was never actually true or enforced: "`project.key` is already unique per
instance" — this codebase's own loose shorthand (also seen in the `lastTaskNumber` naming
drift two lines above that same comment) for the value that is actually `project.slug`. It
is not unique — `project/schema.ts` validates it as a bare `z.string()` with no uniqueness
check anywhere, DB or application-level. Reproduced live: two different
workspaces each creating a project slugged `ACME` collide on their first work-item key,
and the second workspace's project is permanently unable to create a work item afterward
(the counter advances on every retry but the insert always collides on the same key). It is
also exploitable as a targeted attack — an attacker can advance their own same-slugged
project's counter to deliberately burn a specific key in a victim's project, no advance
knowledge of the victim required beyond a guessable slug.

**Alternatives:** scope `work_item.key` uniqueness per workspace (`UNIQUE (workspace_id,
key)`) instead of globally — rejected by Thomas in favor of the global-slug-uniqueness fix,
which keeps the simpler global-key design the schema already assumed, at the cost of
`project.slug` becoming a single first-come-first-served namespace across the whole
instance rather than per-tenant. Existing rows with colliding slugs need a migration-time
resolution (deduplicate/suffix) before the constraint can be added.

**Decided by:** Thomas, 2026-09-22 (asked directly via a tight two-option choice after the
mandatory Opus review flagged this as blocking and a genuine architecture call, not
something to guess at).

---

### 2026-09-22 · #192 addendum: a third composite FK anchoring `work_item.workspace_id` to `project`

**Decision:** extends the "#192's tenant-attribution decision: Option A+D" entry
immediately below. In addition to the composite FK already decided there
(`work_item.type_id` → `work_item_type`), `work_item` also gets a second composite foreign
key, `FOREIGN KEY (workspace_id, project_id) → project (workspace_id, id)`, with the same
`ON UPDATE NO ACTION` (never `CASCADE`) as the `type_id` FK, for the same reason.

**Why:** the original entry made `work_item.workspace_id` NOT NULL but named no database-
level constraint anchoring it to anything — as originally decided, any `workspace_id` value
could be written to a `work_item` row with nothing to stop it, which would have left the
column's own stated purpose (writable RLS, #198's purge) resting on nothing but the future
write path's own discipline — exactly the class of gap this migration exists to close by
construction rather than by convention. The implementing agent added this FK on its own
reading of an existing schema comment ("the same double-composite-FK technique
`state`/`parent_id` use") and flagged the addition explicitly rather than merging it
silently. An independent alignment review found that comment's literal precedent does not
actually license a second FK the way it was read — `state`/`parent_id` each carry exactly
one composite FK apiece, not two anchoring a single column — so the addition, while sound
engineering, was not something the original decision text authorized. Reviewed with Thomas
directly rather than merged on the implementer's own authority, per this project's decision
hierarchy.

**Alternatives:** ship the original entry's literal text only, leaving `workspace_id`
DB-unenforced, and file a follow-up issue for the integrity gap as separately-decided later
work — rejected because the gap is real today, on the same migration already doing this
class of hardening, and there is no reason to defer closing it to a second migration.

**Decided by:** Thomas, 2026-09-22 (asked directly, after an independent alignment review
flagged the addition as outside the original decision's literal scope).

---

### 2026-09-22 · #192's tenant-attribution decision: Option A+D

**Decision:** `work_item` gets a denormalised, NOT NULL `workspace_id` column (set from
`project.workspace_id` at insert), `work_item_type` gets a new `UNIQUE (workspace_id, id)`
index, and `work_item.type_id` is rescoped to a composite `FOREIGN KEY (workspace_id,
type_id) → work_item_type (workspace_id, id)` with `ON UPDATE NO ACTION` (never `CASCADE`
— see the "Why" below). Separately, `workspace` gets a NOT NULL `organisation_id` foreign
key to `organisation`, backfilled from the single internal organisation the boot seed
already guarantees exists. Both land in one bounded, pre-write-path schema migration.

**Why:** `work_item.type_id` was the last unscoped cross-tenant reference — PR #191 already
composite-scoped `state_id` and `parent_id` the same way. Fixing it alone would still leave
two other committed designs blocked on the same missing information: `multi-tenancy.md`'s
RLS prototype needs the tenant on the row to write a policy against, and #198's
legal-hold-aware purge needs to know a project's organisation to know whether it's under
hold. One migration releases all three. `ON UPDATE NO ACTION` rather than `CASCADE` is
load-bearing, not stylistic — PR #191's own O1 finding proved a composite FK with
`CASCADE` on a mutable referenced column can silently move a row across a workspace
boundary when that column changes elsewhere; this design deliberately makes a work item's
`type_id`/`workspace_id` pair immutable rather than reactive.

**Alternatives:** application-level enforcement only (Option B, the spec's own named
primary control) — cheaper, and #192 alone would close on it, but it leaves the RLS
backstop and #198's purge blocked on a separate future decision, and it makes an
inconsistent row possible rather than impossible. A trigger (Option C) was rejected on the
same precedent that killed a similar trigger in PR #191 S5: a check-then-act trigger
against another table's live state is racy under ordinary `READ COMMITTED`, and
`SERIALIZABLE` doesn't close that particular race either.

**Consequences:** the future write path (#23) must set `work_item.workspace_id` on every
insert — the column is NOT NULL, so this fails closed rather than silently. Changing a
`work_item_type`'s workspace becomes impossible by construction, which is intended. RLS
becomes *writable* by this change; it is not itself delivered here. This is a pre-launch
migration, so `migrations.md`'s two-phase-rollout rule does not apply — re-verify that
exemption still holds at implementation time, per the decision log's own standing
condition, rather than assuming it from this entry.

**Decided by:** Thomas, 2026-09-22 (asked directly, per issue #192's own "no agent may pick
this — it creates a trust boundary" condition).

---

### 2026-09-22 · #146's fix direction: continue hardening `pr-body.mjs`, not a parser rewrite

**Decision:** issue #146 (CRITICAL — `sections()` let a comment-hidden or genuinely-visible
duplicate `##` heading silently overwrite an earlier section, defeating the whole
PR-template mechanical gate) is fixed by extending `pr-body.mjs`'s existing hand-rolled
visibility-check pattern one level up (the same `isRawSpanVisible`/`markerAndWordingGenuine`
approach already used for `###` checklist headings, now applied to `##` section headings),
plus a new fail-closed `DuplicateSectionError` for a genuinely-visible duplicate. The
alternative the issue itself raised — replacing `pr-body.mjs`'s hand-rolled
position-tracking/regex approach with a real Markdown parser (`remark`/`micromark`) — is not
taken up now.

**Why:** the ready fix is low-risk and immediately mergeable (117/117 `pr-body.test.mjs`,
of which 4 are new for this fix; 451/451 full
CI-script suite, verified fail-against-old/pass-against-new), and it applies a pattern this
file has already had extensively adversarially reviewed one level down, rather than
inventing a new approach. The gate is live and exploitable on `main` today, so shipping the
tested fix now closes real exposure immediately. A parser rewrite is a larger, slower
architectural project with its own review surface; nothing about today's fix forecloses it
later if the file's hand-rolled approach keeps needing new rounds.

**Alternatives:** hold the fix and scope a `remark`/`micromark` rewrite first — rejected for
now: bigger effort, delays closing a live critical gate-defeat bug with no offsetting safety
benefit today.

**Decided by:** Thomas, 2026-09-22 (asked directly, given the issue's own text required his
call before any fix merged).

---

### 2026-09-17 · #187's fix is project-only soft-delete; the general purge-job/legal-hold infrastructure is out of scope, tracked separately as #198

**Decision:** issue #187 (the live `project` table has no soft-delete window, so
`work_item.project_id`'s `ON DELETE CASCADE` from PR #185 makes the existing hard-delete
route destructive once #23's write path exists) is closed by a narrower fix than its own
original wording asked for. `project` gets its own nullable `deleted_at`/`purge_after`
columns and its delete route becomes a soft delete (an `UPDATE`, never a `DELETE`) — nothing
else. The general hard-purge job that would actually act on `purge_after` (a scheduled job,
a `legal_hold` table, and — if done consistently — retrofitting `organisation`'s already-
existing but unused columns and adding the same pair to `workspace`) is filed separately as
issue #198, not built as part of this fix.

**Why:** #187's own text asked for the fix to match "organisation's/workspace's existing
pattern." Research before implementing found that pattern doesn't actually exist in code:
`organisationTable` has had `deleted_at`/`purge_after` since PR #179, but no route or job
anywhere sets or reads them; `workspaceTable` doesn't have the columns at all, and its own
delete route's comment explicitly defers soft delete to a later phase. Building the job
scheduler, the `legal_hold` table, and retrofitting three tables consistently is real,
separate, cross-cutting infrastructure — bundling it into #187 would turn a bounded defect
fix (stop an ordinary user action from destroying work items with no recovery window) into a
new-feature PR. The narrower fix fully closes the actual defect on its own: no `DELETE` is
ever issued on this path, so `work_item`'s CASCADE never fires, with or without a purge job
existing yet — the same state `organisation`'s columns have already been in, harmlessly,
since PR #179.

**Alternatives:** build the full purge-job/legal-hold infrastructure as part of #187 (rejected
— disproportionate scope for a CASCADE-safety fix, and would also require deciding
`workspace`'s and `organisation`'s own soft-delete rollout, a separate call); leave #187 as
just a documentation note without a code fix (rejected — the CASCADE risk is real and
closable now, independently of when #198 lands).

**Decided by:** the orchestrating session, as a routine implementation-scoping call within
its delegated authority (same category as the #23 first-slice scoping decision) — not a
new product or architecture decision, since the target design itself (30-day soft
delete, a separate purge job) is already settled in `docs/03-features/projects-and-
engagements.md` (`PR-16`) and `docs/01-architecture/data-model.md`'s Retention table; only
the build sequencing was undecided.

---

### 2026-09-17 · CodeQL alert #2 (`js/insufficient-password-hash`, `verify-api-key.ts`) dismissed as a false positive

**Decision:** alert #2 is dismissed. The hashed value is a machine-generated API key (64
characters, `crypto.getRandomValues`-backed, ~365 bits of entropy), not a human password;
`verify-api-key.ts` hashes it with bare SHA-256 and looks it up by indexed DB equality. A
slow KDF (bcrypt/scrypt/argon2) would not add real protection given the key's entropy, and
is actively incompatible with an indexed equality lookup (a per-row random salt means you
cannot look a candidate up without first re-deriving against every stored row). The
`@better-auth/api-key` plugin this app builds on does the identical bare-SHA-256 verification
internally for its own default key storage, while the same library correctly uses `scrypt`
with a per-user salt for actual user passwords elsewhere — confirming the two are treated,
correctly, as different problems by the library's own authors.

**Why:** same reasoning class as alert #9 (2026-09-16, entry below) — CodeQL's generic
`js/insufficient-password-hash` rule pattern-matches on identifiers like "key"/"hash", not on
entropy or access pattern, and cannot distinguish "hash of a low-entropy human password" from
"hash of a high-entropy machine token used for an indexed lookup." Full technical writeup is
on issue #177.

**Alternatives:** leave the alert open indefinitely (rejected — #177 exists precisely so this
doesn't sit untriaged forever); apply a KDF anyway for defense-in-depth (rejected — it would
force a linear per-row re-derivation at every authenticated request, a real performance/DoS
regression, for a token whose entropy already makes brute force infeasible).

**Decided by:** Thomas, via `AskUserQuestion`, 2026-09-17 — "Dismiss as false positive
(recommended)." Same dismissal governance as alert #9: treated as gate-adjacent, so the
technical case (however well-supported) was presented and the dismissal action itself waited
for his explicit answer rather than being self-issued.

---

### 2026-09-17 · `work_item_key_claim`: a real UNIQUE-constraint registry replaces a racy trigger for key/alias collision prevention

**Decision:** `work_item.key`/`work_item_key_alias.old_key` collision prevention (issue
#186's S5 finding) is enforced by a new table, `work_item_key_claim` (`key text PRIMARY KEY`,
`work_item_id text NOT NULL`, `UNIQUE(key, work_item_id)`) — a key string is claimed here
exactly once, ever, for the life of the system, claims are never released even after a hard
delete. `work_item.key` and `work_item_key_alias.old_key` both get composite FKs into this
table, so an alias can only ever reference a claim recording *its own* work item as the
original claimant — the cross-item collision S5 exists to prevent has no matching row to
reference, rejected by a real FK with no race window. One trigger remains
(`work_item_claim_key`, on `work_item`), but its body is *only* an unconditional `INSERT` —
no preceding check — so the claim table's real `PRIMARY KEY`, not application logic, is the
sole arbiter of any conflict, atomically.

**Why:** the first attempt at S5 (PR #191's original commit) used a `BEFORE INSERT OR
UPDATE` trigger that checked `work_item_key_alias.old_key` against `work_item.key` directly.
Two independent reviewers proved this had an unlocked TOCTOU race under ordinary READ
COMMITTED concurrency (two ordinary concurrent transactions, no exotic tricks), and the
mandatory Opus review additionally proved `SERIALIZABLE` isolation does not save it either
(only one rw-antidependency edge, so Postgres's serializable snapshot isolation has no
dangerous structure to detect this specific race). A trigger performing a check-then-act
comparison against a different table's live state can never be race-free without additional
locking; a real database `UNIQUE`/`PRIMARY KEY` constraint is race-free by construction and
was judged the correct "change altitude" fix rather than patching the trigger with an
advisory lock. This design also closes, as a side effect, the previously-known but
unaddressed reverse-direction gap (a new `work_item` created with a `key` that already
exists as some alias's `old_key`) — verified live with a regression test.

**Also fixed in the same round** (Opus findings O1, O3, not a separate decision but recorded
here since they're part of the same PR): the composite FKs this same schema introduced for
project-scoping (`work_item`→`state`, `work_item`→`work_item` self-referencing `parent_id`)
had `ON UPDATE CASCADE`, which — because the referenced column set includes the *mutable*
`project_id` — created a cross-tenant write path (updating a `state`'s `project_id` silently
cascaded a work item across a workspace boundary). Changed to `ON UPDATE NO ACTION`. The
claim table's own trigger function also needed a pinned `search_path` (`SET search_path =
pg_catalog, public`) after a live reproduction showed an ordinary session-level `CREATE TEMP
TABLE work_item_key_claim` could otherwise make the check resolve against an empty temp
table and silently bypass it entirely.

**Alternatives considered:** an advisory lock (`pg_advisory_xact_lock`) added to the
existing trigger, the simpler fix one reviewer suggested (rejected — the Opus review's
"change altitude" framing was more persuasive: a lock-based patch on a check-then-act trigger
is still fundamentally a workaround, where a real unique constraint removes the race
condition's precondition entirely, and costs little more to build); leaving the trigger and
accepting the race as a known, documented risk until #23's write-path PR (rejected — the race
is reachable today, by anything that can write these two tables directly, not gated behind
any not-yet-built application layer).

**Decided by:** the orchestrating session, 2026-09-17, remediating three mandatory-Opus
findings (O1, O2, O3) on PR #191 — a security-scope schema fix, not a new product or
architecture policy. The implementing session that built this design explicitly deferred
recording it here, correctly treating the decision log as orchestrator-owned.

---

### 2026-09-17 · #23's first slice is narrower than "all of #23" — `work_item`/`work_item_type`/`state_template`/`state`/`work_item_key_alias`/`watcher` only

**Decision:** issue #23's first PR builds only `work_item`, `work_item_type`,
`state_template`, `state`, `work_item_key_alias` and `watcher` — the tables every sibling P1
issue (#24, #26, #27, #28, #29, #30) actually reads or writes. `work_item_template`,
`checklist_template`/`checklist_item`, and the `label`/`work_item_label` split follow in a
closely-sequenced second PR, not this one.

**Why:** scoping #23 against `data-model.md` §3-§4 and `docs/07-planning/lane-prep/
p1-core.md`'s own dependency graph found the label restructuring carries a genuine,
unresolved data-migration question (today's `labelTable` is a hybrid — one row is both a
label definition and its task-assignment, `unique(taskId, name)` — restructuring it into a
deduplicated `label` + a `work_item_label` join has no stated tie-break rule for two
same-named, different-coloured labels on two different tasks). That question does not block
`work_item` itself existing, and folding it into the same PR would make an already large,
route/test/MCP-tool-breaking migration (54 route files, 16 integration test files, and
`packages/mcp/src/tools/register.ts`'s hardcoded `/api/task/*` paths, none deferrable) larger
than it needs to be for its own sake. `work_item_relation` (#26) and `comment`/`activity`
(#27) are explicitly NOT #23's tables per the same dependency graph, despite an earlier,
looser reading of `p1-core.md` §0's prose suggesting otherwise — confirmed against the actual
diagram and each sibling issue's own file-surface text.

**Alternatives considered:** building all of #23 in one PR (rejected — defers a hard question
that doesn't need to be solved to unblock #24/#26/#27/#28/#29/#30, and makes the PR
unreviewably large); folding `work_item_relation`/`comment` in too since they're related
concepts (rejected — they belong to #26/#27 by the project's own dependency graph; #23
building them would be exactly the "one issue quietly does another issue's job" pattern this
project's planning discipline exists to prevent).

**Decided by:** the orchestrating session, 2026-09-17, as routine implementation sequencing
within P1's already-approved dependency graph — not a product or architecture decision.

---

### 2026-09-17 · PROPOSED, pending Thomas — #23's work-item state transitions capability-gated only until P2's workflow engine lands

**This entry records a proposal, not a decision.** An independent review of this entry (PR
#184) argued convincingly that it does not actually match the #30 precedent it leans on, and
should not be treated as settled by the orchestrating session alone. Recorded here anyway,
under the "PROPOSED" heading, so the reasoning and the reviewer's objection are both on the
record while this waits for Thomas's actual answer — not silently dropped, and not quietly
promoted to "decided" either.

**Proposal:** `#23`'s state-transition endpoint (moving a work item from one `state` to
another) would check only that the actor has capability to write the work item — no
legality check against a `workflow`/`workflow_transition` (does target state X follow
legally from source state Y for this work item's type) — until P2's workflow engine actually
exists and is wired in.

**Why it looked reasonable at first:** `work-items.md`'s own `WI-9` ("state changes go
through the workflow... never a plain field update") explicitly delegates transition
legality to `workflows.md`, which is staged **P2** — so a literal reading of `WI-9` would
make #23 undeliverable in P1 at all, and assignment (#30) has the same shape ("UI/route
lands in P1, the rule engine ports in P2").

**Why the review's objection holds:** the reviewer checked #30's own issue body directly and
found it carries an **explicit, issue-level P1/P2 carve-out already written into it** — #23's
own body has no equivalent; this proposal would be extending the pattern to a case that was
never actually granted its own exception, not reusing a settled one. The risk shape also
differs: `WI-9` is phrased as an absolute ("cannot be bypassed by a PATCH"), and unlike a
wrong assignment (a minor, easily-corrected annoyance), an unchecked transition touches
`sla_started_at`/`resolved_at` timestamps, roll-up completeness for parent items, and
whatever single-designated-reopen-transition model the eventual workflow engine assumes —
each of which could produce data that is awkward or impossible to reconcile once P2's real
engine arrives, unlike a reassignment which is trivially correctable at any time.

**What is NOT waiting on this:** #23's schema (`work_item`, `state`, `state_template`, etc.)
does not depend on this answer — the state-transition *endpoint*'s legality-checking
behaviour is the only piece blocked. Schema/migration work proceeds in parallel.

**Alternatives:** blocking #23's transition endpoint entirely until P2's workflow engine
exists (real cost: the endpoint simply doesn't ship until P2, which may be an acceptable
trade Thomas prefers given the risk above); the capability-only gate as originally proposed;
some third design neither this session nor the reviewer has proposed.

**Decided by:** nobody yet. Proposed by the orchestrating session, 2026-09-17; objection
raised by an independent review the same day; Thomas's actual answer supersedes this entire
entry when it arrives, per the decision log's own append-only, newest-entry-wins convention.

---

### 2026-09-17 · Two low-stakes #23 migration-data edge cases decided pre-launch, since no live data exists to conflict

**Decision:** (1) the current `task.priority`'s fifth literal value, `"no-priority"` (which
has no slot in `data-model.md`'s ordered four-value `low < medium < high < urgent` enum),
maps to `low` wherever the migration encounters it. (2) the `label`/`work_item_label` split
(deferred to #23's second PR per the entry above) will use "first-created row for a given
name wins as the canonical `label` definition; later same-name rows on other work items
become `work_item_label` joins to it" as its de-duplication tie-break, once that PR is
scoped.

**Why:** both are migration-time edge cases with no real data to migrate — TaskDesk v2 is
pre-launch, and no live deployment exists yet (re-confirmed today, same condition the
one-shot migration decision below already established). A tie-break rule is still worth
recording so the migration's own generated SQL has a stated rationale rather than an
implementer picking silently, but neither is a product-behaviour choice a real user would
ever observe, unlike the workflow-engine question above.

**Decided by:** the orchestrating session, 2026-09-17, as routine implementation convention,
not product policy.

---

### 2026-09-16 · CodeQL alert #9 (`js/insufficient-password-hash`, `packages/domain/src/audit/audit.ts`) dismissed as a false positive

**Decision:** the CodeQL alert flagging `canonicalRowHash`'s `createHash("sha256")` call as
"insufficient password hash" is dismissed, reason `false positive`, via the code-scanning
API (alert #9).

**Why:** the alert's name-based heuristic matched because one of the fifteen concatenated
fields is `apiKeyId` — but that field is a foreign-key reference id, not a credential, and
the function hashes an entire audit-log row for `AU-15`'s tamper-evidence chain, not a
password for storage. A salted or slow KDF (the fix CodeQL's rule normally wants) would be
actively wrong here: `audit-verify` must be able to independently re-derive the same hash
from the same row content to walk and verify the chain, which requires a pure, deterministic
function of its input — the opposite of what a per-use-salted KDF provides. No secret of any
kind reaches this function. Confirmed independently by two reviewers before this decision
was made: an ordinary Sonnet review and the mandatory Opus security review of PR #175 (which
also verified the hash recipe's actual cryptographic soundness in the same pass — see that
PR's `## Security review` section) both concluded the same thing without prompting each
other. Neither reviewer dismissed the alert themselves, correctly treating that action as
gate-adjacent and reserved for Thomas.

**Alternatives considered:** renaming `apiKeyId` or restructuring the field list specifically
to evade CodeQL's name heuristic (rejected, by both reviewers and this decision — that hides
the alert without addressing anything real, and the next genuinely-named sensitive field
would trip the same rule for the same non-reason); leaving the alert open indefinitely
(rejected — the required `CodeQL` status check would then block this PR, and every future
PR touching this file, forever, over a confirmed non-issue).

**Decided by:** Thomas, 2026-09-16 (asked directly, as this is a security-scan-alert
dismissal — the kind of call this project's rules treat as equivalent to waiving a gate,
reserved for him specifically rather than any reviewer's or the orchestrating session's own
judgment, even where that judgment was independently unanimous).

---

### 2026-09-16 · `reconstructAt`'s same-instant tie-break needs a real ordering signal this schema does not yet have — supersedes the auto-increment premise

**Supersedes:** the entry titled "`reconstructAt`'s same-instant tie-break is insertion
order, ascending surrogate key" (2026-09-16, appearing later in this log). That entry is
not rewritten — this new entry corrects it, per this file's own append-only rule.

**Decision:** the superseded entry's premise was false and is withdrawn. It described
`ActivityRow.sequence` as standing in for "Postgres's real auto-increment `activity.id`" —
no such column exists, or can exist, under this schema's own rules. `data-model.md`'s
Conventions state unconditionally: "Primary keys are CUID2 text. Primary keys and
surrogate ids are **never** sequential"; `activity`'s column list (§4) names no
auto-increment/`bigserial`/`identity` column either. The premise was written down without
being checked against the schema it claimed to describe.

Investigated whether `activity.id` — a CUID2, not sequential, but still possibly
correlated with insertion order in practice — could substitute anyway. It cannot, checked
by reading the actual implementation rather than assumed from the name: this codebase's
`createId()` (`@paralleldrive/cuid2` v3.3.0, imported in `apps/api/src/database/schema.ts`)
builds each id as a SHA3-512 hash of `(timestamp, salt, counter, host fingerprint)`,
rendered in base36. The library's own documented design goal is the opposite of what a
tie-break needs — its README states plainly, "k-sortable = insecure," and explains that
CUID2 deliberately hashes away any correlation between an id's value and when it was
generated. Two `activity` rows created microseconds apart get ids in effectively random
relative order. **CUID2 ids in this codebase carry no genuine ordering guarantee.**

`reconstructAt` itself (`packages/domain/src/audit/audit.ts`) needs no code change: its
fold is correct for *any* real total order supplied as `sequence`, for rows sharing one
`createdAt` instant. What was wrong is the claim about where a real caller is supposed to
get that order from — today, **no column this schema actually has can back it.**

**What this means for the impure edge, left open, not decided here:** the `activity`
insert path (part of issue #37's remaining scope — it does not exist yet, per this
module's own doc comment) needs a genuine monotonic signal for same-instant ties. Two
realistic options, neither picked here: **(a)** add a column to `activity` dedicated to
this tie-break only — e.g. `bigserial`/`identity` — as a narrow, explicitly-scoped
exception to `data-model.md`'s "surrogate ids are never sequential" rule (that rule's own
stated rationale is about ids used as references — security, not sortability — which does
not obviously extend to an internal ordering key nobody outside the database ever
observes, but that argument needs to be made explicitly if this option is taken, not
assumed); or **(b)** have the impure edge derive order from something Postgres already
tracks internally (e.g. transaction/commit ordering), which needs its own scrutiny before
being relied on. Whichever the impure-edge implementer picks is a real schema/mechanism
choice and needs its own decision-log entry when it lands — this entry closes the false
premise, not that open question.

**Why:** found by the Opus security review of PR #175 (finding S-4): `types.ts` and the
superseded entry both asserted a mechanism that cannot exist under `data-model.md`'s own
stated schema rules. `check:vocabulary` could not catch this because the false claim lived
only in a doc comment and a decision-log entry, never in a table registration that gate
checks.

**Alternatives considered:** silently editing the superseded entry's text instead of
adding a new one (rejected — the decision log is append-only; per this file's own rule and
`AGENTS.md` do-not 11, an old entry is never rewritten); asserting CUID2 ids are "close
enough" to time-ordered without checking the library's actual behavior (rejected — checked
`createId`'s real implementation specifically to avoid repeating the original mistake);
deciding between option (a) and (b) above here, in this remediation task (rejected — that
is a genuine schema/mechanism design choice for whoever builds the impure edge, with real
tradeoffs on each side, not a routine gap-filling call this task was scoped to make).

**Decided by:** the orchestrating session (via a delegated security-remediation task),
2026-09-16, correcting a factual error in a previous entry rather than deciding new
product or architecture. The open schema question in "What this means for the impure
edge" above is unresolved and needs its own decision when that work is actually built.

---

### 2026-09-16 · The audit hash chain's zero hash is 64 hex `0` characters

**Decision:** the first row in an `audit_log` hash chain (which has no real predecessor to
chain from) uses `prevHash = "0".repeat(64)` — 64 lowercase hex `0` characters, the same
byte-length as a real SHA-256 hex digest — exported as `ZERO_HASH` from
`packages/domain/src/audit/audit.ts`. Every future chain-verification implementation must
use this exact literal, not a re-derived or differently-shaped placeholder.

**Why:** `AU-15` and `data-model.md` §11 both state "the first row chains from the zero
hash" but neither defines its literal value or byte length — found while implementing
`canonicalRowHash` for #37 (PR #175), flagged by that PR's own independent review as
load-bearing and worth a decision-log entry, not just a code comment: any future
independent audit-verify implementation (a restore drill, a second-language reimplementation,
a manual chain check) that guesses a different placeholder would compute a different first
row hash and falsely report the chain as tampered. 64 hex characters matches a genuine
SHA-256 digest's length exactly (rather than, say, an empty string or a shorter sentinel),
which lets every row — including the first — pass through identical validation code with no
special-cased length check for "is this the first row."

**Alternatives considered:** an empty string (rejected — a different length than every real
hash, forcing every consumer to special-case the first row); 32 raw zero bytes instead of
hex-encoded (rejected — `canonicalRowHash`'s own output is lowercase hex, so the input it
takes as `prevHash` should be the same encoding for uniformity, not a second internal
representation nothing else in the chain uses).

**Decided by:** the orchestrating session, as a routine implementation convention filling an
unspecified-but-necessary detail in an already-approved mechanism (`AU-15`) — not a new
security policy or a change to the hash-chain design itself, which stays exactly as
`data-model.md` §11 specifies.

---

### 2026-09-16 · `reconstructAt`'s same-instant tie-break is insertion order, ascending surrogate key

**Decision:** when two `activity` rows for the same work item share the exact same
`created_at` instant, `packages/domain/src/audit`'s `reconstructAt` resolves the tie by
ascending insertion order — the row with the higher surrogate key (`ActivityRow.sequence`,
standing in for Postgres's real auto-increment `activity.id`) is treated as having
happened later, and its `new_value` wins for that field. No other rule (alphabetical by
`field`, actor id, or leaving the order unspecified) is used.

**Why:** unspecified anywhere in the specs — checked `audit-trail.md`, `data-model.md`'s
`activity` table definition, and `comments-and-activity.md` directly, none names a
same-instant tie-break — per `docs/07-planning/lane-prep/p2-domain.md` §9 item 5's finding
of a genuine gap. Insertion order (`activity.id` ascending) is the one secondary ordering
signal a database provides for free without inventing new data, and reconstruction must be
deterministic to be trustworthy — a non-deterministic tie-break would mean two callers
asking "what did this work item look like at instant X" could get different answers for
the same input, which defeats `AU-8`'s whole purpose.

**Alternatives considered:** leaving the order unspecified/non-deterministic (rejected —
reconstruction must be deterministic); ordering by `field` name alphabetically (rejected —
arbitrary, no basis in any spec).

**Decided by:** the orchestrating session, as a routine implementation convention, not a
product-behaviour choice — this fixes a database-tie-break rule that no user ever observes
directly, unlike the SLA policy-move and calendar `none`-state questions `p2-domain.md` §9
also flags, which remain open and need Thomas.

---

### 2026-09-16 · P1's foundational identity schema (`organisation`, `person`, `membership`, `role`) starts as its own bounded PR, ahead of #23

**Decision:** build `organisation`, `organisation_quota`, `person`, `membership` and `role`
— exactly the tables `data-model.md` §2 already specifies, no more — as one small, purely
additive migration PR (new tables only; no existing table renamed, dropped or altered),
seeded with one internal `organisation` and `person` rows backfilled 1:1 from existing
`user` rows. This lands *before* issue #23 (work items) rather than as part of it.

**Why:** the P1 core lane-prep plan (`docs/07-planning/lane-prep/p1-core.md`) charters eight
issues (#23–#30) but none of them is chartered to build this schema, even though #23 needs
`person` for `work_item.assignee_id`/`requester_id` and #25 needs it for
`project.manager_id` — confirmed live: `apps/api/src/database/schema.ts` has no
`organisation`, `person`, `membership` or `role` table today, only the native
`workspace`/`team`/`invitation`/`workspace_role` tables S7/S10 already added and kaneo's
original nouns. `packages/permissions/src/identity.ts`'s `ResolvedIdentity` already declares
`personId`/`organisationId` as non-optional, and no `resolveIdentity` implementation exists
anywhere in `apps/api/src` yet — so this is a real, unowned gap the lane-prep plan's own
shared-contract table did not name, not a restatement of anything already decided. Scoped
deliberately narrow (new tables only, no route or middleware wiring, no change to the
existing `team`/`invitation`/`workspace_role` tables) to keep this reviewable as one bounded
PR rather than folding it into #23's own, separately-scoped migration; reconciling those
existing tables with the new `role`/`membership` shape is real but separate work, tracked as
its own issue (**#173**) so it has an owner to land on rather than staying an implicit gap.

**Alternatives considered:** building it inline as part of #23's own migration (rejected —
#25 needs `person` too, and a schema this foundational deserves its own focused review
rather than being buried in a feature PR); waiting for Thomas to assign it explicitly
(rejected — this is routine implementation sequencing within the already-approved P1
dependency graph and already-settled `data-model.md` schema, squarely within the delegated
merge/prioritization authority below, not a new architecture decision).

**Decided by:** the orchestrating session, 2026-09-16, as a routine sequencing call within
the authority the entry below delegates.

---

### 2026-09-16 · #23's `task` → `work_item` migration is one-shot, not the two-phase live-cutover dance

**Decision:** when issue #23 (work items) generates its first schema migration — renaming
kaneo's `task` table toward `work_item` and restructuring it per `data-model.md` §4 — it is a
single forward migration (rename plus additive columns in one pass), not the
add/dual-write/backfill/cutover/drop two-phase sequence `docs/04-engineering/migrations.md`
prescribes for a column "a running replica may still read."

**Why:** that two-phase convention exists to protect **any running replica that might still
read the old shape during a rolling deployment** — not only "real production data." An
independent review of this entry (PR #172) correctly pointed out that the condition is
narrower than "no production data exists": `charts/taskdesk`'s API `Deployment` sets no
explicit `strategy`, so it inherits Kubernetes' default `RollingUpdate` even at
`replicaCount: 1` — meaning any live deployment, UAT included, briefly runs an old and a new
pod concurrently during a rollout, regardless of whether either pod holds real customer data.
A one-shot rename generated while such a deployment exists would break the still-live old
pod before Kubernetes finishes tearing it down. **The one-shot approach is therefore
conditional, not unconditional: it applies only if, at the moment #23's first migration is
actually generated, no live deployment of any kind (UAT included) yet exists running the
pre-#23 schema — re-verify this live against `status.md`'s current deployment state at that
time, do not assume today's snapshot (v2 UAT not yet deployable) still holds.** If a live
deployment exists by then, the two-phase convention applies after all and this entry's
exception does not. Flagged as a genuine open question by the P1 lane-prep plan
(`docs/07-planning/lane-prep/p1-core.md` §0, §9) because `migrations.md` does not itself
carve out a pre-launch exception — recorded here so #23's implementer has a real answer
rather than discovering this as a blocker mid-migration, or guessing, **and so the condition
above is re-checked rather than silently assumed**.

**Alternatives considered:** the full two-phase dance regardless (rejected — pure overhead
with no live reader to protect *while no deployment exists*, and it would roughly double the
size of #23's first PR for no safety benefit in that case); an unconditional one-shot
exception with no re-verification step (rejected on review — this is exactly what would have
silently broken a live UAT rollout if #23 landed after UAT deployment rather than before it);
asking Thomas (rejected — this is exactly the kind of implementation-sequencing call,
consistent with `migrations.md`'s own stated rationale, that the delegation below covers; it
does not change product behaviour, security posture, or any architecture settled in a spec).

**Decided by:** the orchestrating session, 2026-09-16, as a routine implementation-design
call within the authority the entry below delegates. Applies specifically to #23's `task` →
`work_item` rename, and only while the condition above holds; does not establish a blanket
pre-launch exception to `migrations.md` for
every future migration — a genuinely destructive or reader-breaking change should still be
evaluated on its own facts.

---

### 2026-09-16 · Autonomous continuation authorized past Throttle 1 — prioritize, merge, close, without per-ticket sign-off

**Decision:** once Throttle 1's conditions are genuinely met (verified live, not rounded
up), the orchestrating session may continue autonomously: prioritize work within the
existing roadmap, make implementation decisions consistent with approved specs, create
PRs, commission fresh independent reviews at the tier the change actually warrants,
remediate findings, merge fully cleared PRs through the protected flow, and close issues
once their actual acceptance criteria are verified against live source — all without
stopping to ask Thomas to select each ticket or approve each routine merge. Reserved for
Thomas's own call, unchanged from the existing control-plane rules: new or conflicting
product/security policy, significant architecture changes not settled in the specs, gate
waivers, changes to reviewer/model eligibility, and production rollout or infrastructure
actions requiring his authorization. The implementing agent must not approve its own work;
fresh independent reviewers at the required tier and the mandatory Opus security review for
security-scope changes are unchanged. After each meaningful milestone, report to Thomas:
merged PRs and SHAs, verified acceptance criteria, open blockers, decisions requiring his
authority, and the next autonomous action — a status report is a checkpoint, not a reason
to stop.

**Why:** this extends, and makes durable, the narrower 2026-09-15 merge delegation below
(which covered merging a cleared candidate, not prioritization or issue closure) — Thomas's
own explicit instruction, given directly in this session once Throttle 1 opened, rather than
inferred. Recorded here because status.md's own session-log entry for this wave asserted
this authorization had already been recorded, when it had not been — exactly the failure
this decision log exists to prevent, per this file's own governing rule: "if it isn't in the
decision log, it isn't in force yet, no matter how confidently a later document assumes it."
Found by the independent review of the status.md reconciliation PR for this wave, corrected
in the same change rather than left standing.

**Alternatives considered:** treating the 2026-09-15 merge delegation as already broad
enough to cover this — rejected; that entry is explicitly scoped to merging a candidate
that is already fully green, not to prioritizing which work to do next or closing an issue,
and reading it more broadly than its own text would be exactly the kind of silent
scope-creep this file's hierarchy rule warns against.

**Decided by:** Thomas, 2026-09-16 (given directly in this session's own instructions).
Recorded by the orchestrator, after the fact — see "Why," above, for why this entry exists
retroactively rather than having been written at the moment the instruction was given.

---

### 2026-09-16 · Review tiering is by risk, not by path — and rounds stop when findings stop changing class

**Decision:** the review-tier table in `AGENTS.md` no longer sizes the ordinary-review count
purely from which directory a change touches. Touching a security-scope path (`scripts/ci/**`,
auth/permissions code, migrations) is still what triggers the mandatory Opus security
review — that stays absolute. But the number of ordinary (Sonnet) reviews *before* that Opus
pass now depends on what the change actually does: a bounded fix to CI/gate logic that
changes no authority or gate-semantics invariant gets **one** strong ordinary review, then
straight to a single Opus pass — not the full three-Sonnet-then-Opus tier that was applied
uniformly to anything under a sensitive path. The full three-round tier is reserved for
migrations, API+frontend crossing the same change, concurrency, cross-package integration,
or a change that actually redesigns an authority/gate-semantics invariant.

Also added: an explicit stopping rule for when a mechanism has had several rounds each
finding the *same class* of gap at a narrower scope (one more punctuation mark, one more
Unicode edge case) rather than a genuinely new class of defect — once the design has had its
structural fix, a single further Opus pass closes it; further Sonnet rounds are not queued
"to be safe" first.

**Why:** PR #148 (a CI checker fix for how `**Spec:**` field values are read) went through
eight-plus independent review rounds and a large token spend, each round finding something
real but progressively narrower — from a genuine false-positive bug down to astral-plane
Unicode surrogate-pair edge cases and cosmetic whitespace variants no real PR author would
plausibly type. The path-based tier rule (touches `scripts/ci/**` → always three Sonnet
reviews + Opus, regardless of the change's actual size or semantic risk) was doing its job
of catching real bugs, but its own reviewer-count mechanics amplified an ordinary bounded fix
into a multi-day loop, at real cost, while the project's actual critical-path item (S7, the
last four `organization()` plugin callers) had not been started. Flagged by Thomas after an
external review of the process (independently corroborated by a second review of the
project's live status) — the gates were doing real work, but the cost model applied to a
bounded fix inside a sensitive path was disproportionate to what that fix actually risked.

**Alternatives considered:** dropping the security-scope requirement itself for CI/gate
files (rejected — the Opus pass on PR #148 and prior rounds did in fact find real, non-obvious
defects, so removing the mandatory independent security review for this path class would
remove a control that has demonstrably caught things); a fixed lower reviewer count for
every CI/gate change regardless of what it does (rejected — a genuine redesign of gate
semantics, or a change to an authority invariant, still needs the full tier; risk-grading by
what the change does, not a flat number, is what actually matches cost to risk).

**Correction, same day, caught by this change's own ordinary review:** the first draft of
the table's lightest row set the security-review outcome to a literal `n/a` for a
"test-only file" touching a security-scope path — which silently contradicted the "stays
absolute" claim made three times elsewhere in this same entry and the operative documents.
A reviewer found the exploitable case directly: a test/probe file under `scripts/ci/**` can
itself be part of a gate's enforcement surface (a ratchet threshold, an anti-narrowing
assertion), so weakening one of its assertions is a real gate-semantics change even though
the file is "just a test" — Row 1's own wording would have let an agent wave that through
as automatically safe. Fixed before merge: every row now gets at least a lightweight Opus
pass, never `n/a`; only the depth of that pass and the ordinary-review count above it scale
with risk. Left in the log rather than silently corrected, because it is itself the best
illustration of why the "stop queuing rounds" rule above still requires the review to
actually happen once, not zero times.

**Decided by:** Thomas, 2026-09-16.

---

### 2026-09-15 · Waived-gate candidates are excluded from the merge delegation

**Decision:** the merge delegation recorded below ("Governance reset") does **not** cover
any candidate whose `## Gates` table cites a waived gate. Such a candidate always needs
Thomas's own action to merge — an approval, a comment, or the merge itself — never the
orchestrating session alone.

**Why:** independent Opus security review of the delegation itself (PR #129, exact head
`ec994e5605c9222eaa56b266f48a80a134e7469b`) found that the gate-waiver mechanism
(`scripts/ci/lib/gate-waiver.mjs`) mechanically verifies a waiver was *declared* in the
required form, but has always explicitly and deliberately **not** verified who authorized
it — agents commit through the same repository identity Thomas does. Until this delegation,
the real (if informal) compensating control was that Thomas himself clicked merge, so he
was the last human able to catch a fabricated or premature waiver citation. The delegation
removes that check by default. Excluding waived-gate candidates restores an equivalent
check for exactly the case that needs it, without weakening the delegation's value for the
ordinary case (a fully green, non-waived candidate) it exists to speed up.

A real mechanical check — verifying waiver authorship some way stronger than trusting the
orchestrator's own report — is **not** solved here and is tracked as issue #130, alongside a
related gap in reviewer-identity verification the same review found.

**Alternatives:** leave the delegation as originally written and rely on the "only Thomas
may waive a gate" sentence alone — rejected, that is exactly the class of control ("a rule
that closes a process defect has a test; one that doesn't has a sentence agents route
around") this project's own stated principle warns against, now that the one real backstop
(the merge button) is gone by default. Build the full mechanical authorship check before
merging PR #129 — rejected as disproportionate scope for a documentation-only candidate;
tracked separately instead.

**Decided by:** Thomas delegated the underlying authority on 2026-09-15; this specific
exclusion was identified by independent Opus review the same day and applied by the
orchestrator as the correct, narrower remediation of a review finding on an in-flight
candidate — consistent with "do not waive a gate" rather than an exception to it.

---

### 2026-09-15 · Governance reset: merge delegated to the orchestrator, model routing simplified to Sonnet/Opus, UAT deployment prioritized

**Decision:** four related changes, made together because each depended on the others being
settled:

1. **Merge execution is delegated to the orchestrating Claude session.** It may merge a
   candidate through the normal protected pull-request flow, without asking Thomas per PR,
   once — and only once — every required gate is genuinely green on the exact candidate SHA:
   applicable tests (expected suite/file counts, not just exit code), required independent
   review(s), required security review where the change is in security scope, and every
   required GitHub status check. This supersedes `AGENTS.md`'s and `CLAUDE.md`'s earlier
   "only Thomas merges" wording. It does **not** authorize bypassing branch protection, a
   required check, self-review, or a lane/subagent merging — those restrictions are
   unchanged. A prior, unratified attempt to record this same delegation (dated
   2026-09-11) was drafted directly into `AGENTS.md` and never actually appended here —
   that draft is discarded; this entry is the real one.
2. **Model routing is simplified to Sonnet and Opus only, through this session's own `Agent`
   tool, with the model set explicitly at every spawn.** Earlier exploration of a
   multi-provider router (`router.technexus.info`) and non-Claude specialist subagents
   (DeepSeek/GLM-routed implementation agents) did not work out in practice and is dropped.
   Implementation, ordinary review, and a project-alignment/misalignment check are Sonnet,
   spawned freely wherever there is genuinely independent, bounded work. The final
   independent review for security-sensitive or otherwise critical work is **Opus**,
   spawned as an explicit, separate subagent on the exact candidate SHA — distinct from the
   earlier rule that no subagent could ever be Opus. The earlier rule existed to prevent a
   subagent *accidentally* inheriting Opus from an Opus-orchestrated session; spawning Opus
   *deliberately and explicitly* for the one tier that requires it does not carry that risk,
   and the tool now supports pinning a subagent's model at spawn time. The orchestrator
   decides tiering and reviewer count itself, using the ordinary/broad split already in
   `AGENTS.md`, rather than asking Thomas to classify each PR.
3. **A live UAT deployment is active, near-term priority**, not deferred follow-up.
   `docker build` + container boot + health-endpoint verification is part of "done" for any
   change touching what ships in the image, and the outstanding application-side gaps
   (hardcoded port, missing health endpoints, no static file serving, no
   `storage.filesystem` driver — verify current state, this list may already be out of
   date) become active critical-path work rather than a someday item.
4. **Operational discipline to stop the observed stall/loop pattern**, without weakening any
   gate: do not open another review pass on a candidate whose SHA hasn't changed since the
   last review; keep `status.md` and this log current every session that changes something
   durable, not only "at a stage's end"; do not spawn a subagent without a concrete, bounded
   deliverable; a blocked lane blocks only that lane. Evidence this was a real problem, not
   a hypothetical: at the time of this entry the repository carried git worktrees for the
   same candidate reviewed three and four times over (`board-pr128` through `v4`,
   `board-pr107` through `v4`, `rev-110` through three parallel copies) without those SHAs
   changing between rounds, plus a governance-file rewrite that had been drafted and
   abandoned uncommitted rather than landed.

**Why:** Thomas reported the project stuck in P0 for an extended period, looping on review
and revision without visible forward progress, driven partly by an ineffective
multi-provider/specialist-subagent routing experiment and partly by process friction (stale
control-plane documents, re-review of unchanged candidates, Thomas as the single merge
serialization point after gates were otherwise satisfied). The fix addresses the actual
friction — routing complexity and idle serialization points — while explicitly preserving
every substantive gate: security review is still mandatory, still a fresh independent
context, still Opus; ordinary review is still required and still independent; no candidate
merges with a red required check.

**Alternatives:** keep merge execution with Thomas only — rejected, it was the serialization
point Thomas identified as part of the stall. Allow Opus to be a subagent's *inherited*
default (e.g. any subagent under an Opus top-level session) — rejected, that reintroduces
the accidental-Opus-fan-out risk the original rule existed to prevent; only explicit,
deliberate Opus spawns for the review tier are authorized. Keep the multi-provider router for
auxiliary/non-gated work only — considered and rejected for now as added complexity with no
demonstrated benefit on this project; may be revisited if a concrete need appears.

**Decided by:** Thomas, 2026-09-15.

---

### 2026-09-15 · The 2026-09-12 Foundation Technical Preview target lapsed, unscheduled

**Decision:** No replacement date is set for the Foundation Technical Preview. The
2026-09-12 target in [accelerated-delivery-plan.md](accelerated-delivery-plan.md) and
[status.md](status.md) has passed. This is recorded because the date lapsed, not because
the target itself was wrong to set.

**Why:** [status.md](status.md) already states this target explicitly as *"a target, not a
deadline held under pressure ... the date is explicitly allowed to move."* It moved. What
has not moved is the reason: the P0 organization-plugin retrofit (#82/#110, #118, S7 through
S10) is still in progress, and Throttle 1 has not opened. No calendar pressure authorizes
weakening a security or review gate to hit a date, and none has been applied here — the
date simply was not met, and no one has picked a new one.

**Replacement date:** none. **Unscheduled, pending Throttle 1.** A new target should not be
set until the retrofit's dependency chain (#110 → #118 → S7 → #107 → S10 → Throttle 1) is far
enough along to estimate honestly, rather than restarting the same pressure this entry exists
to avoid.

**Alternatives:** backdating a fictional replacement date — rejected, that would misstate a
decision that has not been made. Silently leaving the lapsed date in place with no record —
rejected, a lapsed target that is never marked lapsed eventually reads as met.

**Decided by:** Thomas, 2026-09-15 (restart handoff instruction). Recorded because the
instruction explicitly asked for this to be tracked on the control plane, append-only, and
kept separate from PR #110's own record.

---

### 2026-09-10 · The inherited event keys are a temporary compatibility vocabulary (`#86`)

**Decision:** `docs/01-architecture/events.md` remains the single authoritative home for
event keys. The 23 event keys the inherited kaneo controllers still publish are registered
there as an explicit **temporary compatibility vocabulary**, each row carrying the target
key it maps to, so the published surface stops being unregistered. They are not a second
permanent event model, they are not extended, and no 24th is added. Natively emitted keys
(today, `workspace.created`) register as current canon in the Catalogue instead. The
inherited emitters are **not** mass-renamed during P0; migrating `task.*` → `work_item.*`
is **P1** work.

**Why:** issue #86 found the API publishing keys from a vocabulary this document did not
declare at all — zero overlap between what the code emitted and what the register listed.
Two things had to be true at once: the gate must be able to say "every published key is
registered" (otherwise `check:events` is vacuous), and P0 must not absorb a rename of every
inherited emitter. Cataloguing the keys with their target mapping satisfies both, and keeps
the eventual migration a mechanical diff against a written table rather than an
archaeological exercise.

**Alternatives:** (a) mass-rename the inherited emitters to the target vocabulary during P0
— rejected, it is P1-sized work on a surface P0 is trying to stop touching, and it would
have widened #6's blast radius; (b) leave the keys unregistered and narrow the gate to the
target vocabulary only — rejected, that is a gate whose green means nothing, which is the
failure class this project exists to avoid; (c) declare the inherited names permanent canon
— rejected, they are kaneo's domain language, not TaskDesk's.

**Decided by:** the orchestrating session, 2026-09-16, as a routine implementation-sequencing
call within the merge/implementation authority Thomas delegated 2026-09-15 ("Governance
reset," below) — this is not a new product or security policy, only how to register an
event vocabulary the code already publishes without absorbing a P1-sized rename into P0.
**Corrects two prior false attributions on this same entry, recorded so neither is
re-derived:** an earlier revision of `events.md` asserted this as a Thomas decision with no
supporting source at all (issue #86 had zero comments, and this log had no entry for it); a
later revision of this very decision-log entry then cited "the orchestrator directive that
superseded the 9Router routing instructions" — a phrase that names nothing else recorded
anywhere in this log or in issue #86, and could not be verified against any actual source.
Neither attribution stands. Raised as issue #86; implemented by PR #91.

---

### 2026-09-10 · S9 closes as documentation-only — `teams.enabled` stays until S10 (Path B)

**Decision:** better-auth's `teams: { enabled: true, … }` config and the nine
`/organization/*team*` routes it registers **stay exactly as they are for as long as the
`organization()` plugin is mounted.** Retrofit stage **S9** therefore closes as a
**documentation-only** stage: its deliverable is the confirmation that nothing in the
repository reaches teams. **S10 removes the flag, the nine routes and the S1 characterization
file that exercises them, in one commit.** The `team` and `team_member` tables are kept — the
target model still wants them (`data-model.md:113-114`) and dropping them is a migration.

**Why:** `teams.enabled` is the single gate for two things at once — it registers the nine team
endpoints (`organization.mjs:403` and `:550`) **and** gates `crud-org.mjs:106`'s default-team
side effect on organization create — with no finer-grained knob to separate them. The S1
characterization oracle drives the plugin's create route over real HTTP, independent of what the
client does, so flipping the flag breaks it regardless of client repointing: reproduced twice
independently as **19 passed / 1 failed** on `expect(teamRows).toHaveLength(1)`
(`tests/api-integration/organization-plugin-characterization.test.ts:316`).

The only way to make the suite green between S9 and S10 would be to edit the characterization.
That is forbidden — S1 must not be broken in order to make the plugin removable — so removing
the flag early would buy a **throwaway intermediate configuration that exists only in the
S9-to-S10 window**, at the cost of editing a characterization whose subject is about to be
deleted anyway. Nothing observable is deferred: native workspace create already writes all nine
contract effects unconditionally (`create-workspace.ts:148-183`, one transaction, no config
check), proven by a green `workspace-write-create-contract.test.ts`.

**Alternatives:** *narrow the S1 oracle's team assertions now* and drop the flag in S9
(rejected — it edits a characterization to accommodate a configuration that lives only between
two stages, and the whole product of that work is discarded at S10); *drop the nine routes but
keep the create side effect* (not available — one flag gates both).

**Decided by:** Thomas, 2026-09-10.

**Recorded here because it was a session instruction.** An independent review of PR #104 found
its ledger text citing "the P0 velocity addendum, §12" — a real instruction, quoted accurately,
but one that exists **nowhere in this repository**, so no reader could check it. A governance
rule cited as though it were a checkable artifact, when it is not, is worse than an honest
"decided in session": it invites the reader to trust a reference they cannot follow. This entry
is that citation's referent, and the ledger now points here.

---

### 2026-09-10 · An unrecognised transition effect kind fails closed (`WF-22`)

**Decision:** An authored transition effect whose `kind` falls outside `WF-19`'s vocabulary
makes the workflow version **invalid**. `resolve_sla` and `reopen_sla` are the automatic
`WF-17`/`WF-18` effects and are never authorable — a `workflow_transition.effects` array
containing either is invalid **by name**. Unknown kinds are refused, never ignored and never
passed through.

**Why:** the specs settled the equivalent question for *guards* — `WF-16` fails closed on an
unrecognised guard `type`, with `guard.unrecognized` as the reason — and said nothing at all
about *effects*. `WF-19` calls the effect vocabulary closed and stops there. A sweep of
`docs/03-features/` and `docs/01-architecture/` for any rule about an unrecognised effect kind
returned nothing, so the guards half of the pair was specified and the effects half was not.

It stopped being hypothetical during PR #75's second independent review. `AutomaticEffect` is
deliberately not a member of `Effect`, so a hand-authored transition cannot declare
`resolve_sla` — and TypeScript genuinely enforces that, proved with a scratch `tsc` run. **But
the barrier is compile-time only and the data is not.** `workflow_transition.effects` is a
**jsonb** column, so the realistic path is `JSON.parse` → `any`, which satisfies the union with
zero type errors. Demonstrated end to end: `JSON.parse('[{"kind":"resolve_sla"}]')` through
`validateWorkflowVersion` returned `{"valid": true, "errors": []}`. A type guarantee protects
the code, not the data.

**Alternatives:** *Ignore unknown kinds* — forward-compatible, letting a newer writer add an
effect an older reader skips, but an effect that silently does nothing is a failure mode this
repository has been bitten by repeatedly, and it would let `resolve_sla` be smuggled in and
quietly dropped rather than refused. *Fail closed only for the two automatic kinds, ignore other
unknowns* — closes the smuggling path while keeping forward compatibility, and was a genuine
contender. Rejected in favour of the stricter rule for consistency with `WF-16`.

**A numbering note, because the instruction said `WF-20`:** that id was already taken by the
transition-event rule, and `WF-1`–`WF-21` are all in use. Using `WF-20` would have silently
redefined an existing rule, so the decision is recorded as **`WF-22`**. The content is exactly
as directed; only the identifier differs.

**Decided by:** Thomas, 2026-09-10 (P0 velocity addendum). Raised as issue #101.

---

### 2026-09-09 · Multi-role membership is invalid — one membership, exactly one role, fail closed

**Decision:** **One workspace membership = exactly one role.** Values like `admin,viewer` or
`owner,admin` are **invalid**. TaskDesk v2 does **not** implement union semantics for
membership role strings — a membership row either names one known role, or it is malformed.
Behaviour on a malformed value must **fail closed**.

**Why:** found by an independent review of PR #80 (the #66 fail-open remediation), which
reproduced it against a real PostgreSQL rather than reasoning about it. `workspace_member.role`
is an unconstrained `text` column, and the still-mounted better-auth plugin route
`POST /api/auth/organization/update-member-role` accepts `role` as **either a string or an
array** and comma-joins an array before persisting. The two authorization surfaces then
disagree on a comma-joined value: the plugin's own `has-permission` splits on comma and ORs
the roles (granting whatever any one of them grants), while TaskDesk's `/api/capabilities` →
`hasWorkspacePermission` does an exact-string lookup and denies everything. Implementing
comma-splitting to match the plugin was considered and rejected: that would encode a
union/OR authorization semantic that has never been specified or reviewed, purely to agree
with an inherited route this project is removing. The chosen fix is to refuse the ambiguity
outright rather than give it a meaning.

**This is a P0 security blocker for retrofit stage S7** (native role writes reuse the same
evaluator; if S7 inherits the single-role-string assumption without enforcing it, or ships
while legacy comma-joined rows exist, the divergence becomes reachable through TaskDesk's own
surface rather than only the inherited one). **It does not block PR #80** once #80's own
scope clears — #80 closes the missing/deleted-row fail-open, a narrower and separate defect
from this one. **S7's release condition is therefore `#80/#66 cleared AND multi-role
cleared`**, each independently reviewed; neither clearing alone is sufficient.

**Alternatives:** comma-splitting / union semantics to match the plugin — rejected, for the
reason above. Silently normalising malformed rows at read time instead of failing closed —
not decided here; it needs its own migration/recovery strategy and is left to the tracked
scope of the work this decision creates, not invented in this entry.

**Decided by:** Thomas, 2026-09-09. Tracked as issue **#82** (P0 security, blocks S7).

---

### 2026-09-09 · Workspace ownership transfer — owner-only, no sixth policy kind, and explicit step-up debt

**Decision:** Ownership transfer is its own explicit capability, `workspace:transfer_ownership`,
**owner-only**. No sixth policy kind was added for it — route policy, the permission matrix,
and effective runtime authority are the same thing, asserted by a policy-layer-only test, not
a parallel mechanism invented for this one action. The transactional fresh-owner re-read
inside the transfer endpoint is retained as **race safety** (the acting owner is re-validated
inside the transaction against a concurrent change), **not** as a substitute for
authorization — it must not be read as already satisfying the elevation question below.

**And the elevation decision:** ownership transfer genuinely *is* the kind of action that
should eventually require a fresh, elevated authentication step — it reassigns ultimate
control of a workspace. But P0 has no step-up mechanism at all, and marking the route
`elevated: true` today would be a policy flag that no code path enforces. **No decorative
`elevated: true` that enforces nowhere.** For now, the control is: session-only access
(not reachable via API key), the owner-only capability above, transactional fresh-owner
validation for the race case, and this entry as the **explicitly documented temporary
step-up debt**. When a real step-up mechanism lands, ownership transfer **must** become
elevated — this is not a closed question, it is a deferred one, recorded so it is not
rediscovered as a surprise later.

**Why:** an unenforced `elevated: true` is exactly the failure this project's own operating
principle warns against — a rule that closes a process defect needs a test, not a sentence,
and a flag nothing checks is worse than no flag, because it reads as protection that is not
there. Session-only access and the owner-only capability are real, enforced controls
available today; claiming more than that would misstate what is actually gated.

**Alternatives:** ship `elevated: true` now as a forward-looking marker — rejected, for the
reason above. Allow `admin` (not only `owner`) to transfer ownership — rejected: ownership
transfer is the single highest-consequence membership mutation in the workspace, and
narrower roles already have narrower capabilities everywhere else in the matrix.

**Decided by:** Thomas, 2026-09-09.

---

### 2026-09-09 · The template gate IS required — twelve status checks, superseding this morning's exclusion

**Supersedes** the third bullet of *"`protect-main` requires eleven status checks; the
template gate is not among them"* (below, same day). That entry said of
`pull request template + security review`: *"It remains a non-required check, so it fails
visibly on every pull request without blocking merge."* **Both halves are now false.** The
entry is not edited — the log is append-only — so this is the correcting record.

**Decision:** `pull request template + security review` is the **twelfth required status
check** on `protect-main` (`22365005`). Twelve contexts, `strict_required_status_checks_policy:
true`, zero bypass actors, `current_user_can_bypass: never`. The `deletion`,
`non_fast_forward` and `pull_request` rules are unchanged. Verified by re-reading the live
ruleset after the write, and independently re-verified by an Opus reviewer who counted the
contexts itself.

**Why:** the earlier entry's own reasoning was that requiring it *"would make the mandatory
Opus security-review gate mechanical, which is what this project exists to do"*, and that
the choice was **"a policy decision for Thomas, not one an agent should take by configuring
a ruleset."** Thomas took it, explicitly and in writing, and instructed that it be added.
That is precisely the event this log exists to record.

**Consequence, stated plainly because it is stronger than it sounds:** the template checker
treats an unticked independent-review checklist item as a **blocker**, and `CLAUDE.md`'s
third absolute means it *cannot* be marked `n/a` — only a completed review at the required
tier closes it. So **no pull request can merge without committed review evidence, including
a documentation-only one.** The repository's `gate-waiver` mechanism
(`scripts/ci/lib/gate-waiver.mjs`) binds a waiver to a gate identifier, a pull request and a
follow-up issue — but it covers the **G1–G13 design gates only** and has no path for the
review item. That is deliberate and is not to be widened to make autonomous merging easier.

**Alternatives:** leaving it non-required, so the red stayed an honest signal that nothing
enforced — rejected by Thomas. Weakening the checker so `n/a` could close the review item —
rejected: that is the "route around a gate" failure this repository exists to refuse.

**Decided by:** Thomas, 2026-09-09, in the Continuous Parallel Execution Directive. Applied
and verified by the orchestrator.

---

### 2026-09-09 · `protect-main` requires eleven status checks; the template gate is not among them

**Decision:** the `protect-main` ruleset (`22365005`) now carries a `required_status_checks`
rule naming the eleven substantive fast-stage jobs — `static`, `unit + component`, `build`,
`registers - env, vocabulary, reviews, skips, overrides`,
`route policy coverage + permission matrix`, `gate checkers + red probes`,
`contract - OpenAPI drift`, `CI matches ci-cd.md`, `supply chain - dependency audit`,
`supply chain - secret scan`, `helm lint + template` — with
`strict_required_status_checks_policy: true` and **zero bypass actors**
(`current_user_can_bypass: never`).

**Why:** until today the ruleset required a pull request, blocked deletion and
non-fast-forward pushes, and required **no status checks at all**. That is why nothing
mechanically stopped a merge, and it is the gap issue #10 called F8. #7's *"Done when"*
clause — *"both tests run in the fast CI stage **and are required**"* — could not be
satisfied without it, so Throttle 1's condition 3 was blocked on a repository setting
rather than on code. Verified by re-reading the live configuration after the write, not by
trusting that the write succeeded.

**Three things deliberately NOT required, each for a reason:**

- **`pull request template + security review`.** Requiring it would make the mandatory Opus
  security-review gate *mechanical*, which is what this project exists to do — and would
  block every pull request until a committed review note exists. That is a policy decision
  for Thomas, not one an agent should take by configuring a ruleset. **It remains a
  non-required check, so it fails visibly on every pull request without blocking merge.**
- **The four `NOT ENABLED` jobs** in `ci-full.yml` (e2e, a11y G4, visual G8, performance
  G11). They are disabled with `if: false` because there is no Playwright suite, no
  deployable application to point one at, and no chosen visual-regression tool. **GitHub
  treats a skipped required check as satisfied**, so requiring them would manufacture a
  green gate over nothing — the trap `ci-full.yml`'s own header warns about and F5 removed
  from the integration job.
- **`integration - Postgres 18`.** `ci-full.yml` narrows `pull_request.types` to
  `[labeled, synchronize, ready_for_review]` and therefore does not run on `opened`.
  Requiring it would block pull requests where it never ran.

**Alternatives:** requiring the display name of the workflow rather than the job contexts —
rejected, because the ruleset binds contexts at the check level and a workflow-level name
would not name what actually blocks. Leaving the rule out until the retrofit finishes —
rejected: the checks are green on `main` today and an unenforced gate is the thing this
repository is built to refuse.

**Decided by:** Thomas, 2026-09-09 (delegated: *"fix all issues and all ci issues"*).

---

### 2026-09-09 · Eight pull requests merged on Sonnet review, with the mandatory Opus gate waived

**Decision:** Thomas authorised the orchestrator to merge on the strength of independent
**Sonnet** review — *"if you review and no issues and very strong review come back just
merge by yourself with gh"* — and to confirm afterwards with GPT-5.6 Sol and Gemini 3.8
Flash. Eight pull requests merged under that authorisation: **#64, #62, #65, #67, #19, #68,
#63, #69**.

**This is a waived gate and it is recorded as one.** `CLAUDE.md`'s third absolute is that an
agent may never downgrade an unavailable reviewer, and its model-tier table says security
review is **Opus, always, every pull request, every stage gate**. **No mandatory Opus
security review ran on any of the eight merged heads.** Five of them touched
security-review-scope paths: #19 (56 paths), #62 (12, all `packages/permissions`), #63 (3),
#65 (2 policy files) and #67 (1). Only Thomas can waive that gate, and he did.

**What was done instead, stated so nobody mistakes it for the review it replaced:** four
independent Sonnet review lanes with six adversarial verifiers over every open pull request
and the status record — six confirmed findings, **zero blocking**, three lanes CLEAR; every
finding then fixed and re-verified; the whole set integrated into one tree and run through
the complete gate matrix before any merge; and each merge verified on `main` afterwards.
Earlier heads of #19 were reviewed by a mandatory Opus session, GPT-5.6 Sol and Gemini 3.8
Flash, but **no head was ever CLEARED by a mandatory Opus review**, and none of those
verdicts transfers to what merged.

**No review note was written and no independent-review checkbox was ticked** on any pull
request. `check:pr-template` still fails on exactly those two blockers, which is why it was
left out of the required checks: the gate stays visibly red rather than being quietly
satisfied. That red is the honest record of this waiver.

**Alternatives:** parking the five security-scope pull requests at frozen SHAs until an
independent Opus review ran — offered to Thomas and declined in favour of post-merge
cross-model confirmation. Ticking the box or writing a note to make CI green — refused
outright; it would have falsified the record, and a review recorded at the wrong tier is
worse than no review because it closes the field that would otherwise stay visibly open.

**Follow-up required:** Thomas's GPT-5.6 Sol and Gemini 3.8 Flash confirmation of `main` at
`5adf25b6`. If either finds a defect, it is now a defect on `main` rather than in a pull
request, and that is the cost this waiver bought speed with.

**Decided by:** Thomas, 2026-09-09.

---

### 2026-09-08 · A merge is charged the union of its per-parent diffs, never a combined diff

**Supersedes one clause** of
[The review binding is over landed commits](#2026-09-08--the-review-binding-is-over-landed-commits-and-a-declared-state-is-not-a-token-match),
below, which said *"the merge is judged on its combined diff — its own conflict
resolution"*. That clause is **withdrawn**. Everything else in that entry stands.

**Decision:** for the review-binding invariant, a merge commit's contribution is the
**union of `git diff-tree <parent> <merge>` over every parent**. A combined diff
(`diff-tree -c`) may **not** be used as the security predicate.

**Why:** a combined diff reports only the paths that differ from *every* parent, which is
intersection-flavoured. If the merge result equals one parent for a path, that path is
omitted — even when it differs from the reviewed first parent. Constructed with plumbing
and measured:

```
A    f.txt = "old"
H1   f.txt = "reviewed"          <- the reviewed head, child of A
M    git commit-tree A^{tree} -p H1 -p A

git rev-list H1..M          ->  M, and only M
git diff --name-only H1 M   ->  f.txt          (the content DID change)
git show M:f.txt            ->  "old"          (the review was undone)
git diff-tree -r -c M       ->  []             <-- the bypass
union of per-parent diffs   ->  f.txt          <-- the fix
```

Because A is an ancestor of H1 there is no side-branch commit in the range to catch it
either: `H1..M` is exactly `{M}`. So the previous attribution would have kept the review of
H1 valid while shipping a tree that differs from it.

**Alternatives:**
- *Keep `-c` and add a second check for the first-parent diff.* Rejected as the same
  answer with more moving parts: the union already includes the first-parent diff, and a
  predicate assembled from two rules is one refactor away from losing one of them.
- *Compare the merge's tree to the reviewed tree instead.* Rejected — that is the net-tree
  comparison GPT-F5 removed, one level down.

**Cost, stated plainly:** the union **over-attributes**. A conflict-free merge is now
charged with the paths its side branch changed, even though it only carried them, and the
same path can be charged to two commits in one range. That is accepted deliberately,
because the only consequence of over-attribution is that a review goes stale and a fresh
delta review is required, whereas under-attribution ships unreviewed content. A predicate
that can omit a path is not usable here however precise it is when it works.

**Decided by:** Thomas, 2026-09-08, on finding **GPT-F6** (HIGH, blocking) against
`b3fd41dbed1bc74cbd666c8b272fb425de5722c8`.

---

### 2026-09-08 · The review binding is over landed commits, and a declared state is not a token match

**Supersedes two sentences** in
[Three gate controls get a syntax](#2026-09-08--three-gate-controls-get-a-syntax-because-existence-proved-nothing),
below, which is otherwise unchanged and still operative. Recorded as a new entry rather
than an edit: the log is append-only, and both sentences were wrong in a way worth having
on the record.

**Decision 1 — the note binding is over LANDED COMMITS, not the net tree.** That entry
said *"nothing outside `docs/07-planning/security-reviews/` may have changed since"* the
reviewed head, and the implementation read that as `git diff <head>..HEAD`. Endpoint
trees are not history, and the gap is a four-commit bypass:

```
H1  code                      reviewed
H2  the note, nothing else     -> green, correctly
H3  modify non-review code
H4  exactly revert H3          -> net tree == H1 + note, the diff range is EMPTY,
                                  and the old review passed again
```

Measured before the fix: at H4 the checker printed *"is bound to reviewed head …; nothing
outside docs/07-planning/security-reviews/ has changed since"* and exited **0**, with two
unreviewed commits landed. Now every commit in `<head>..HEAD` is inspected for the paths
it contributed. **Reverting does not restore a clearance** — the reverted diff is still in
the branch's history, it is what a bisect replays, and a revert can itself be wrong, so a
reviewer has to see both. Merges are attributed honestly: `git rev-list` enumerates the
commits a merge carried individually, and the merge is judged on its combined diff — its
own conflict resolution — so nothing is missed and nothing is double-counted. One
consequence, stated rather than discovered: **merging `main` into a branch after a review
makes the note stale**, because the tree the reviewer read is not the tree that would
merge.

**Decision 2 — `## Screens opened` declares a state; prose that mentions `n/a` does not.**
F9 replaced *"strip `n/a` and see what is left"* with *"does the token `n/a` appear
anywhere in this section"*. That closed the loophole and opened a worse one: it read a
**negation as an assertion**. A lane wrote, honestly,

> I am not marking this n/a — that would misrepresent a real gap

and the checker rejected the section for it. The one author who refused to claim the
exemption was treated as though they had claimed it, and the way to pass was to stop
explaining. The state is now read from the section's **first meaningful line** —
`n/a` / `not applicable`, `BLOCKED — <why>`, or the screens themselves — and a later
mention of `n/a` in explanation carries no state. An explained `BLOCKED` is **accepted as
an honest gap**; a bare `BLOCKED` is rejected exactly like a bare `n/a`.

**Why not read the sentence.** Sentiment and negation analysis were rejected outright:
each is a new class of false positive wearing a cleverer hat, and the finding this fixes
*is* a false positive. A state field is read, not interpreted.

**`BLOCKED` is honest, not permissive.** It means the parser stops calling a declared gap
a false `n/a`. It does **not** mean the pull request is ready: the screens were not
opened, [AGENTS.md](../../AGENTS.md) do-not 18 is unsatisfied, and every other
readiness requirement still applies. CI says so in the accepting run rather than leaving
the reader to infer it.

**Cost, stated plainly:** a remediation pass that reverts its own work still needs a fresh
delta review, and a branch that merges `main` after a review needs one too. Both are the
correct consequence of the invariant being about history.

**Decided by:** Thomas, 2026-09-08, on findings **GPT-F5** (MEDIUM, blocking) and the
**F9 residual** raised against `cdb5f334616818adb94a91ae5b9b11a428854951`.

---

### 2026-09-08 · Three gate controls get a syntax, because existence proved nothing

**Decision:** the security-review scope, the committed review note and a waived gate each
gain a mechanical binding, and the fast-stage PR-template check enforces all three.

1. **Scope is the union of the merge base and HEAD.** A changed path is in security scope
   when it matches [ci-cd.md](../04-engineering/ci-cd.md)'s list *at the merge base* **or**
   at HEAD. Widening takes effect at once; **narrowing does not take effect on the pull
   request that narrows it**, and removing a glob is itself security-sensitive. An
   unresolvable merge base, or a base document that exists and cannot be parsed, fails
   closed.
2. **The note declares the head it reviewed.**
   `**Reviewed head:** ` + a full forty-character SHA, one line per reviewed head. The
   newest declared head must be an ancestor of HEAD and nothing outside
   `docs/07-planning/security-reviews/` may have changed since it. A note-only commit
   recording a head passes; a code commit after it makes the note stale until a fresh
   delta review adds a line for the new head — which is itself note-only, so the gate
   closes instead of looping.
3. **A waived gate cites one entry, by anchor, that declares the waiver.** The `## Gates`
   link cell must carry `docs/07-planning/decision-log.md#<anchor>`, the anchor must
   resolve to exactly one heading, and that entry's body must contain, on one whole line:

   ```
   **Waives gate:** `<gate>` · **PR:** #<pr> · **Follow-up:** #<issue>
   ```

**Why:** all three controls were satisfiable without the thing they were supposed to
establish, and an independent review of `6b32ef3` found each one.

- The scope was read from the working tree — the list the same diff had just written. A
  commit that removed `scripts/ci/**`, `.github/**` and `ci-cd.md` from the list while
  editing `scripts/ci/` matched nothing and printed *"no security-review path touched"*.
  F15 closed "the gate cannot see changes to itself"; reading the list only from HEAD
  reopened it one level up.
- The note check verified a model string and a filename. Both are properties of a body and
  a path, so once a note existed it never expired: reviewed head, note committed, gate
  green — then any amount of further code, gate still green.
- `waived` needed the gate identifier to appear *anywhere* in a 1,400-line document, with
  the `#anchor` optional. The sentence *"G1 is not waived"* authorised waiving G1. That is
  not a weak control, it is an inverted one.

**Alternatives:**
- *Read the prose of a decision entry for intent.* Rejected: that is exactly what produced
  the negation bypass. Intent is declared in a fixed syntax a negation cannot produce.
- *Remove automated `waived` support entirely* — the finding offers this as the fallback if
  honest enforcement is impossible. Rejected because it is possible: a specific entry, an
  exact gate token, this pull request and a follow-up issue are all mechanically
  checkable. What is **not** checkable is who authorised the waiver, and CI now says so in
  the passing message rather than implying it verified authorship.
- *Bind the note by comparing the whole diff to a reviewed tree hash.* Rejected as
  equivalent but less readable: an ancestor SHA plus a note-only delta is the same
  guarantee, and a reader can verify it with two git commands.
- *Let a narrowing take effect immediately and rely on review by convention.* Rejected:
  convention is the thing that failed, three times, on this repository.

**Cost, stated plainly:** every security-review note from now on carries a
`**Reviewed head:**` line, and a remediation pass that touches anything other than the
note requires a fresh delta review before the gate closes. That is the intended cost. It
also means the review artefacts for #13, #16 and #21 — written before this convention —
are not retro-fitted; the check only reads the note the pull request under test links.

**Decided by:** Thomas, 2026-09-08, on findings GPT-F1 (HIGH), GPT-F2 (HIGH) and GPT-F4
(MEDIUM) from the independent review of `6b32ef316c49cc14cc841b32fdcce637a442b813`.
GPT-F3 (MEDIUM) is a defect fix in the same pass and needed no decision: the
unattributable-read baseline now records one fingerprint per read instead of a count.

---

### 2026-09-08 · The mandatory security review covers the gate machinery and the dependency graph

**Decision:** the authoritative security-review path list in
[ci-cd.md](../04-engineering/ci-cd.md) is **expanded** to include the CI and
dependency-control surfaces, in addition to every existing application glob, which are all
kept:

```
.github/**            scripts/ci/**         turbo.json
package.json          **/package.json       pnpm-lock.yaml
pnpm-workspace.yaml   .npmrc                .pnpmfile.cjs
docs/04-engineering/ci-cd.md
```

A change touching any of them requires a recorded independent Opus security review, on the
same terms as a change to `apps/api/src/auth*` or `packages/permissions/**`.

**Why:** the gate could not see changes to itself. PR #19 — the pull request that *builds*
this gate — touched `.github/**`, `scripts/ci/**`, `package.json`, `pnpm-workspace.yaml`
and `pnpm-lock.yaml`, and `check:pr-template` correctly reported *"no security-review path
touched (9 globs from ci-cd.md checked)"*. Its independent review then found, inside that
blind spot: a HIGH where a new `pnpm.overrides` block silently deactivated 30 inherited
pins and let two version floors be breached with `pnpm audit` still green; a HIGH where the
independent-review blocker could be closed by deleting one line from a PR body; and a
fail-open in `scripts/ci/lib/diff.mjs` that turned the security-review requirement into a
green no-op on an undeterminable diff.

A gate that cannot require review of edits to itself is a gate anyone can quietly widen,
and the three findings above are what that looks like in practice rather than in theory.
The two lockfile/workspace entries carry their own argument: deleting a version **floor**
fires no advisory, so `pnpm audit` structurally cannot be the control for it — a human
reading the diff is. `check:overrides` now guards the override *source*, but a source can
be canonical and still wrong.

**Alternatives:**
- *Leave the list as-is and rely on `check:overrides` plus code review by convention.*
  Rejected: convention is what failed. #16, #57 and #19 all passed the previous version of
  the checklist loophole, which is a demonstrated failure mode on this repository, not a
  hypothetical.
- *Add only `scripts/ci/**` and `.github/**`.* Rejected: F1 was a dependency-graph
  regression, not a script defect, and it was invisible to every automated gate.
- *Require review of every path.* Rejected: it would make the requirement routine and
  therefore ignored. The list stays a list of surfaces with a stated reason each.

**Cost, stated plainly:** PR #19 now self-triggers the requirement it adds, so it needs a
committed Opus review note before it can be merge-ready. That is the correct consequence,
not an obstacle to route around, and the note is written from a completed review — never
ahead of one.

**Decided by:** Thomas, 2026-09-08, on the F15 question raised by the independent review of
`b70b3529c81b3d890e430d91ea9dcb98be22583a`
([issuecomment-5586943706](https://github.com/ThomasHeinThura/ticketing/pull/19#issuecomment-5586943706)).

---

### 2026-09-08 · Native organization routes preserve inherited session-only reach

**Decision:** every native route that replaces a better-auth `organization()` route is
**session-only** in the runtime that ships it. A personal API key — on `x-api-key` or as a
`Bearer` token — must not reach workspace, membership, invitation or capability data
through a native route, and must not reach a workspace mutation. Widening that reach is a
deliberate decision for the runtime policy layer to take later, on its own terms, not a
side effect of moving a route.

**Why:** the plugin sets `enableSessionForAPIKeys: false`, so `/organization/*` is
effectively session-only today. The retrofit recorded this as risk **R10** — noted, and
undecided. It stopped being hypothetical the moment native routes existed: at PR #65's
pre-remediation head, all four S2 read routes accepted a valid API key and returned real
workspace, membership and invitation data with a 200. Nobody widened anything on purpose.
The reach came along with the move, and the only reason it surfaced is that the lane was
told to treat a non-session credential on those routes as a stop-and-report event rather
than as behaviour to describe in a policy file.

That is the general shape worth keeping: **a retrofit inherits the old surface's limits,
not just its behaviour.** An effect the previous implementation could not produce is a new
effect, and it needs a decision even when no line of the diff looks like a decision.

**Alternatives:** declare the widened reach as intended and write it into the four policy
files — rejected, because it converts an accident into a contract, and the surface it
widens is exactly the one the mandatory security review exists to read. Defer to #7's
policy layer — rejected: the routes ship before that layer evaluates anything, so
"deferred" would mean unenforced.

**Implemented by:** `apps/api/src/utils/require-session-only.ts` (PR #65, `24d8236`),
reproduced RED→GREEN by sabotage against a real PostgreSQL 18; consolidated onto by PR #67
(`cad15e06`), which had independently grown a second, less precise implementation.
**Status:** IMPLEMENTED-PENDING-VERIFY. No independent review has run on either head.

**Decided by:** Thomas, 2026-09-08.

---

### 2026-09-08 · The instance-admin bypass is not blessed on S4 mutation routes

**Decision:** workspace-role authority is **preserved** on the native S4 workspace
mutation routes. An instance admin does not acquire workspace-scoped mutation authority
their own `workspace_role` row does not grant. `POST /api/workspace` is unaffected — a
caller creating a workspace has no prior scope to be measured against.

**Why:** `hasWorkspacePermission` short-circuits on `isInstanceAdmin` before it reads the
caller's workspace role, so an instance admin who is a member passes that function's check
whatever their role says. Under the inherited plugin a `viewer` could not rename a
workspace, instance admin or not — better-auth has no instance-admin concept at all. So
mounting these writes on the shared path handed a new power to every instance admin as a
side effect of moving a route.

PR #67's inherited batch had already found this and **pinned it as an accepted finding**: a
test named `A2-P17 FINDING (shared evaluator, unfixed here)` asserted `200` for a
viewer-who-is-instance-admin calling `PATCH /api/workspace/{id}`. A test that asserts the
escalation is a test that protects it. It now asserts `403` for update and delete.

**Scope of the fix, stated precisely so it is not over-read:** an additive guard
(`apps/api/src/utils/require-workspace-role-authority.ts`) resolves the caller's authority
from their own workspace-role row on these two routes. The shared `hasWorkspacePermission`
short-circuit is **unchanged** — re-keying it belongs to #7, and #66 owns its second,
worse half (the fail-open fallback to compiled static roles when a `workspace_role` row is
absent, where `admin` diverges on 16 of 16 capabilities). This decision closes the bypass
on two routes. It does not close the evaluator.

**Alternatives:** bless the bypass, on the reasoning that an instance admin can reach the
data anyway — rejected: "can reach it by another path" is not "may do it on this path", and
the instance-admin path has no audit or role trail on these routes. Fix the shared
evaluator here — rejected: it is a shared contract this lane does not own, and a change
there needs its own pull request and its own review.

**Status:** IMPLEMENTED-PENDING-VERIFY at PR #67 `cad15e06`, both directions reproduced by
sabotage (guard neutered → `A2-P17` and the delete case flip to 200; restored → 9/9 green).
**#66 remains OPEN.**

**Decided by:** Thomas, 2026-09-08.

---

### 2026-09-08 · Organization create baseline closes at N=9

**Decision:** the frozen inherited S1 baseline for one default
`POST /auth/organization/create` call is **NINE observable contract effects**:
**eight first-order create effects plus one one-hop durable event consequence.**
`N=9` is the authoritative ruling and is the equivalence obligation S4–S7 inherit.

#### The nine effects

**First-order (1–8)** — performed by the create stack, its configured hooks and its
adapter calls:

| # | Effect |
|---|---|
| 1 | one `workspace` row |
| 2 | one owner `workspace_member` row |
| 3 | three seeded `workspace_role` rows — `viewer`, `member`, `admin`. **No seeded `owner` row** (owner authority is compiled in; see R5 in the retrofit plan) |
| 4 | one `workspace.created` event, whose payload contract is `workspaceId`, `workspaceName`, `ownerId` |
| 5 | one default `team` row |
| 6 | one creator `team_member` row |
| 7 | on the **same creating session** row: `active_organization_id` `null → workspace.id` |
| 8 | on the **same creating session** row: `active_team_id` `null → team.id` |

**One-hop durable consequence (9):** `workspace.created` **eventually** causes exactly one
persisted `notification` row —

```
type          = workspace_created
userId        = creator
resourceId    = workspace.id
resourceType  = workspace
eventData.workspaceName = workspace name
```

Effect 4's payload is the contract at the event-bus boundary precisely *because* effect 9 is
produced from those exact fields.

#### Decision history — recorded in sequence, not collapsed

This ruling reversed itself and reversed back. The sequence is recorded because the
reversals are the reusable lesson, not an embarrassment to be tidied away.

1. **`N=9` was initially selected.**
2. **A temporary `N=8` ruling then superseded it.** Effect 9 was temporarily *excluded* from
   the contract and bounded polling was *rejected* as an oracle technique.
3. **`N=9` was explicitly re-ratified**, after the bounded-eventual design and the
   strengthened `workspace.created` payload were reconsidered — and the re-ratification
   happened **before** the implementation represented by `95dc928`.
4. **`95dc928` implements the final `N=9` ruling.**
5. **The temporary `N=8` ruling was NEVER implemented.** No commit, on any branch, ever
   encoded an eight-effect create contract.

**Why the sequence is preserved verbatim:** a reader who finds only "N=9" cannot tell whether
`N=8` was tried and abandoned or never existed, and the retrofit plan's own history shows the
count being re-discovered one effect at a time (the plan said four; S1 first measured six; the
review at `9a1eb4e` found a seventh; the review at `f3ce193` found an eighth; the
whole-database enumeration that review prompted found the ninth). Collapsing the record is how
that gets re-litigated at S4.

#### Where the count stops — exclusions, so the enumeration is not restarted

Recording "nine" alone is not enough. These are **not** part of the organization-create
equivalence contract, each for a stated reason:

| Excluded | Reason |
|---|---|
| `session.updated_at` | generic Drizzle `$onUpdate` consequence of updating the session row at all — not a separate organization-create decision |
| `notification.created` | downstream notification-subsystem consequence *of* effect 9 |
| `deliverNotification(...)` | downstream delivery behaviour |
| email / webhook / push delivery | downstream notification subsystem |
| `secondaryStorage` session mirror | unreachable — no `secondaryStorage` is configured |
| unconfigured member / team organization hooks | unreachable — not configured |
| session `databaseHooks` | none applicable — only `user` hooks are declared |
| reads on the create path | not persistence effects |
| rate-limit database rows | absent — the limiter is in-memory under the current configuration |

**The stopping rule is: 8 first-order effects + 1 asserted one-hop durable consequence.** No
downstream notification internals are part of the organization-create equivalence contract.

#### Timing is not contractual

**Effect 9 is EVENTUALLY CONSISTENT.** The current inherited implementation often persists the
notification *before* the HTTP response returns, but only because further awaited database work
(`setActiveOrganization`, `setActiveTeam` — effects 7 and 8) happens after `workspace.created`
is published. **That ordering is INCIDENTAL.** `publishEvent` does not await its subscriber, so
a native S4 handler may legitimately do less work after publishing.

**Synchronous pre-response notification persistence is NOT contractual.** The S1 oracle
therefore uses **bounded polling** on effect 9's exact notification identity rather than
asserting immediate visibility. An S4 implementation that persists the row a second later is
conformant; one that never persists it is not.

#### Scope of the ruling

`N=9` is **the frozen inherited S1 baseline**. It is **not** a standing rule that every future
event listener automatically becomes part of the organization-create contract. Every future
listener or consequence requires its own explicit contract decision.

#### Session selection is preserved, not silently dropped

- `active_organization_id` create-time selection is **preserved through S4–S7**.
- `active_team_id` create-time selection is **preserved through S4–S7**.

If S9 later removes or redesigns team semantics, that is an **explicit S9 divergence**. It must
**not** disappear silently during S4.

The characterized request is the **default** create request. `keepCurrentActiveOrganization=true`
gates effects 7 and 8 and remains **outside** this S1 default-path oracle.

#### Evidence — not a new decision

The independent instrument that closed the S1 gate:

- **PR #57 independent review `pullrequestreview-5141105391`** —
  <https://github.com/ThomasHeinThura/ticketing/pull/57#pullrequestreview-5141105391>
- **Reviewed exact code head:** `95dc9280b9011f2d5615be1381d0993360a26368`
- **Verdict:** CLEAR FOR THOMAS MERGE DECISION

This is **evidence for the ruling above, not itself a decision.** PR #57 merged to `main` as
`b4aef999238d8848563860449432db588207c2d4`.

**S1 is complete. Issue #6 is not.** A merged oracle is not permission to start S2, and S4 is
blocked until this reconciliation lands.

**Alternatives:** leaving the count at `N=8` and excluding the notification. Rejected — the
row is durable, is caused unconditionally by an asserted event, and an S4 handler that stopped
producing it would break a real user-visible behaviour with the whole suite green. Asserting
effect 9 synchronously before the HTTP response. Rejected — that would pin an ordering the
inherited implementation only produces by accident, and would fail a conformant S4.

**Decided by:** Thomas, 2026-09-08.

---

### 2026-09-08 · A dispatch that reverses a live contract decision must say so — the `SUPERSEDES` convention

**Decision:** when a new dispatch reverses or materially changes an earlier **live** contract
decision, the dispatch **must begin** with an explicit marker equivalent to:

```
SUPERSEDES PRIOR CONTRACT DECISION:
<the decision being replaced>
```

**Why:** today's `N=9 → N=8 → N=9` sequence demonstrated that an unlabelled reversal makes the
dispatch chain ambiguous **even when the final coding agent ultimately executes the correct
latest instruction.** The code came out right; the record did not. Reconstructing which ruling
was live at which moment then costs more than the marker would have, and the cost lands on
whoever has to certify the result rather than on whoever wrote the reversal.

The marker is cheap, is verifiable in a diff, and makes an unlabelled reversal a visible defect
rather than an invisible one.

**Scope:** this convention applies to future **material architecture/contract reversals**. It
is not required for ordinary refinement, clarification, or additive scope.

**Alternatives:** relying on chronology alone (the later dispatch simply wins). Rejected — that
is exactly what happened here, and it left three plausible readings of the same history.

**Decided by:** Thomas, 2026-09-08.

### 2026-09-06 · Model allocation — the orchestrator may be Opus, every spawned agent is Sonnet

**Decision:** the **top-level orchestrator may remain Opus**. **Every** spawned agent —
subagent, background agent, workflow agent, adversarial prober, review-evidence preparer —
**must be Sonnet**, set explicitly at spawn time. No Opus subagents. No Fable subagents. No
Opus review swarms. If a tool cannot guarantee Sonnet, do not spawn it: do the work in the
top-level session, or defer it.

Sonnet **may** implement, test, reproduce a vulnerability, probe adversarially, and prepare
review evidence.

Sonnet **may not** satisfy a mandatory independent Opus security review, sign off work the
orchestrator authored, downgrade the reviewer requirement, or waive the gate. Neither may the
orchestrator call its own remediation an independent review.

**The mandatory independent Opus security review is unchanged.** When it is required and no
independent Opus capacity is available, the pull request **waits**, marked:

> **SECURITY RE-REVIEW PENDING — OPUS CAPACITY**

Capacity exhaustion means wait, not downgrade. Sonnet is never substituted for speed.

Default scale for analysis: **one** Sonnet implementation agent per active code slice, plus
optionally one adversarial verifier. Sequential focused verification, not fan-out. The
orchestrator synthesises.

**Why:** on 2026-09-06 two thirteen-agent Opus workflows plus two Opus review agents — 28
agents — exhausted the organisation's monthly allowance mid-task. Seven died in flight, and
the ones lost were the expensive ones to lose: five of six adversarial passes, whose entire
purpose was to catch designs that look right. The cost was not tokens; it was the
verification step. One of the two adversarial passes that did run **defeated the design it
attacked**, which is precisely the evidence that the missing five mattered.

**Alternatives:** letting workflows inherit the session model. Rejected — that is the
mechanism that caused this, silently. Dropping the Opus review requirement to fit the
budget. Rejected — that trades a hard security gate for throughput, which is the failure this
project exists to avoid.

**Decided by:** Thomas, 2026-09-06.

---

### 2026-09-06 · The control plane has one owner, and a source-of-truth hierarchy

**Decision:** eight surfaces are **orchestrator-owned**: `AGENTS.md`, `CLAUDE.md`,
`docs/04-engineering/agent-workflow.md`, `docs/04-engineering/ci-cd.md`,
`docs/07-planning/status.md`, `docs/07-planning/decision-log.md`, GitHub issue status and
GitHub Project board status. Background and lane agents treat all eight as **read-only**
unless their task explicitly says they own a specific change.

A lane **reports** — completed work, evidence, findings, a suggested doc correction, a
suggested issue or board transition. The orchestrator verifies it and performs the durable
central update. Two lanes never independently edit `status.md` or this file.

When sources disagree, the order is:

1. the latest Thomas decision recorded in the decision log or a spec
2. an accepted ADR, or an authoritative architecture or feature spec
3. the `AGENTS.md` / `CLAUDE.md` operating agreement
4. GitHub issue acceptance criteria
5. the `status.md` / Project board operational snapshot
6. a pull-request body or comment
7. a temporary orchestration or chat instruction

**A lower source never silently overrides a higher one.** An explicit Thomas instruction
that changes architecture, scope, governance, gate semantics or persistent product
behaviour may guide work immediately, but **must be persisted in the correct spec or here
before dependent code merges**.

No agent may move, rename or delete a planning document, reorganise `docs/`, move an issue
between board columns, close or reopen an issue, or rewrite existing decision history —
unless the task authorises it, or the orchestrator is performing a verified state
transition under these rules. **A useful discovery is not authorisation to reorganise
project memory.**

**Why:** four lanes were editing central state independently while durable decisions from
orchestration sessions went unrecorded, and the result was contradictory sources of truth.
Every new agent reads these files as instructions, so a false statement in one of them is
not a documentation defect — it is a wrong instruction issued to everyone who arrives next.

**Alternatives:** letting each lane update the central record for its own work. Rejected:
it is exactly what produced the drift. Locking the files entirely. Rejected: the record
then rots instead of contradicting itself, which is not an improvement.

**Decided by:** Thomas, 2026-09-06.

---

### 2026-09-06 · `status.md` is a durable snapshot, not a work log

**Decision:** the rule that `status.md` is edited at the end of every agent session is
**withdrawn**. It is updated only on a durable transition: a pull request genuinely becomes
review-ready; a pull request merges; an issue blocks or unblocks; an issue completes; a
throttle state changes; Thomas makes a material decision; or a material repository or
deployment fact changes.

Intermediate progress belongs in pull-request comments and reports.

**Why:** a snapshot edited every session is a log, and a log is read as history rather than
as current truth. The file's job is to answer "what is true right now" for an agent
arriving cold, and per-session churn made that harder to trust, not easier.

**Alternatives:** keeping the per-session rule and relying on discipline about content.
Rejected — the cadence was itself the problem.

**Decided by:** Thomas, 2026-09-06. Supersedes the per-session cadence stated in the
2026-09-06 entry *"Repository setup, and the working mode from here on"*, which remains
below as history.

---

### 2026-09-06 · Merge governance — required approving reviews is zero, and that is deliberate

**Decision:** on `main`, **required approving reviews = 0** and **Require review from Code
Owners = off**. The `protect-main` ruleset blocks deletion and non-fast-forward pushes and
dismisses stale approvals on push. **Only Thomas authorises merges.**

`CODEOWNERS` is **ownership metadata** — it says who to ask, not a mechanical gate.

The security review and design review requirements are **unchanged and remain independent
hard gates**. Lowering the approval count does not lower them, and no agent may
self-approve, waive a gate, or downgrade a required reviewer.

**Why:** the repository has one human. A required approving review from a single-person
team is a rule that can only ever be satisfied by that person clicking approve on work they
are about to merge anyway, and it was being described in three documents as though it were
the control that keeps agents out of `main`. It is not; the control is that only Thomas
merges, and the ruleset enforces the parts a machine can enforce.

**Alternatives:** requiring one approval and having Thomas approve then merge. Rejected as
ceremony that documents a protection it does not provide.

**Decided by:** Thomas, 2026-09-06. Supersedes the "one approval from the code owner"
wording in `ci-cd.md`, `agent-workflow.md`, `CLAUDE.md`, and the 2026-09-06 entries
*"Repository setup, and the working mode from here on"* and *"Small design choices made by
Claude Code while applying the pre-P0 check"*, all of which remain below as history.

---

### 2026-09-06 · A pull request is a slice; the issue is the completion gate

**Decision:** pull-request state, issue state and Project-board state are three different
things and are not derived from one another.

Board columns mean exactly:

| Column | Meaning |
| --- | --- |
| **Ready** | eligible work, implementation not started |
| **In Progress** | implementation or remediation active, **including issues with partial child pull requests already merged** |
| **Review** | the issue's current implementation is complete, all hard automated gates are green, all mandatory independent reviews are complete, and only Thomas's review and merge remain |
| **Blocked** | a genuine hard dependency, external or shared-contract block prevents progress |
| **Done** | the **issue's** Done criteria are satisfied |

A child or slice pull request merging does **not** by itself move an issue to Done. **A
pull request with unresolved CRITICAL or HIGH findings is not in Review state.**

Concretely and settled: **#20 merging did not complete #11**, and **#16 merging will not
complete #6**. Neither carries `Closes` linkage, on purpose. #16 may merge as a reviewed
#6 security-and-removal slice; **#6 remains open until the `organization()` retrofit
completes through S10 and its remaining obligations are met**.

**Why:** GitHub closes an issue when a linked pull request merges, which silently converts
"a slice landed" into "the work is finished". That is how a stage gets claimed early, and
it is the failure this project's throttles exist to prevent.

**Decided by:** Thomas, 2026-09-06.

---

### 2026-09-06 · Throttle 1, stated exactly

**Decision:** Throttle 1 opens when **all five** are true:

1. **#5 complete.**
2. **#6 — the ISSUE — complete.** Not "a #6 slice merged".
3. **#7 complete.**
4. **Route-policy coverage actually executes in CI** — not that a gate script exists.
5. **Adding an unclassified route fails CI**, demonstrated.

**Why:** the previous wording was "#5 merged, #6 merged, #7 merged". Merging is a
pull-request event and these are issues, so the old wording would have opened the throttle
the moment any slice of #6 landed — while `organization()` was still mounted and the
inherited surface still present. Points 4 and 5 are stated separately because a gate that
exists and a gate that runs are different things, and this project has already shipped a
control whose test asserted something other than its name.

**Decided by:** Thomas, 2026-09-06. Supersedes the Throttle 1 wording in `CLAUDE.md` and
in the 2026-09-06 entry *"The P0 working agreement — dependency graph, two throttles,
blocking taxonomy"*, which remains below as history.

---

### 2026-09-06 · better-auth `organization()` is removed in P0 — final

**Decision:** better-auth's `organization()` plugin is **removed during P0**. This is
final and is not reopened without evidence that the target TaskDesk model is itself
internally inconsistent.

The implementation discovery that the plugin is load-bearing — workspace creation,
invitations, members and roles route through it — does **not** reverse the decision.
**Load-bearing means it needs a retrofit, not that it is kept.**

The retrofit is #6 work, runs S1 through S10, and ends with `organization()` unmounted in
P0. S1 is characterisation tests and gates everything after it.

**Why:** I recommended retaining the plugin and was overruled. My error is worth recording
because it is a reusable one: I treated "load-bearing" as evidence for "permanent", when it
is evidence for "needs a plan". The trap the retrofit must avoid is that `tests/` holds
exactly one reference to the plugin, so unmounting it would break workspace creation,
invitations, members and roles while producing a single failing assertion — v1's failure
mode in a new costume.

**Decided by:** Thomas, 2026-09-06.

---

### 2026-09-06 · The OpenAPI baseline is `tests/api-contract/openapi.json`

**Decision:** the **committed baseline** that the drift check compares against is
`tests/api-contract/openapi.json`. The published document at `apps/site/public/openapi.json`
is **generated output** and is not the baseline.

**Why:** `status.md` recorded the destination as unresolved and the drift check as lost,
which left a real gate looking optional. Separating the two answers it: a baseline is a
test fixture and lives with the tests; a published document is a build artefact and lives
with the site. Conflating them is how a drift check ends up comparing generated output
against itself.

**Decided by:** Thomas, 2026-09-06. The baseline currently exists **IN OPEN PR #19**, not
on `main`.

---

### 2026-09-06 · Lane agents record evidence; they do not decide on Thomas's behalf

**Decision:** a lane agent may record **evidence, findings, implementation properties and
recommendations**. It does **not** create durable project decisions on Thomas's behalf.

The four items recorded in the entry below, *"Deployment skeleton — four calls made while
building #11"*, are therefore **reclassified** — the entry stays as history, and this is
its correct reading:

| # | Item | Correct classification |
| --- | --- | --- |
| 1 | `TASKDESK_TRUST_PROXY=2` on this UAT topology | **measured operational fact** |
| 2 | unsafe `X-Forwarded-Proto` behaviour | **measured finding; remediation undecided** |
| 3 | Helm chart fails closed on its secrets | **merged implementation / security property** |
| 4 | `TASKDESK_HSTS_PRELOAD` empty-or-`1` semantics | **configuration correctness fix** |

On item 2 specifically: the measured behaviour stands as fact — `X-Forwarded-Proto` is
passed through verbatim from a trusted peer and set to `http` when absent, so the
application either believes what a viewer asserts or believes every HTTPS request was
HTTP. **The remediation is not decided.** An origin custom header at the CDN is a
**candidate, not the answer**, pending inspection of the actual CloudFront distribution and
origin configuration. That inspection needs Thomas and AWS console access.

On the four application-side gaps #20 recorded as blocking — `TASKDESK_PORT` actually being
read, live and ready health endpoints, Node static file serving, and a `storage.filesystem`
implementation — these are **#11 prerequisites**, or dedicated prerequisite work. They are
**not** automatically #6 or #9 scope. Implementation ownership is assigned when they are
scheduled, not inferred from where they were noticed.

**Why:** the four items were written in the voice of settled decisions by the agent that
made them. Three were not decisions at all — two were measurements and one was a property
of merged code — and the fourth was a bug fix. A measurement recorded as a decision is
hard to revisit when better evidence arrives, and a candidate remediation recorded as a
decision gets implemented without the verification step that would have caught it.

**Decided by:** Thomas, 2026-09-06.

---

### 2026-09-06 · Deployment skeleton — four calls made while building #11

**Decision:** four things were decided in the course of building the deployment
skeleton. None changes a specification; each is a place where the specification did not
reach and the alternative would have been to guess.

**1 · `TASKDESK_TRUST_PROXY=2` on the bimats.com host, from measurement.**
The chain is CloudFront → Traefik → TaskDesk, and **TLS terminates at CloudFront, not at
Traefik** — measured, not assumed: a real request to `ticket-uat.bimats.com` reached the
host's Traefik on the plain `web` (`:80`) entrypoint, scheme `http`. Both hops **append**
to `X-Forwarded-For`: CloudFront appended the viewer address after a deliberately forged
one, and `traefik:v3.6.7` — reproduced in an isolated lab with the same
`forwardedHeaders.trustedIPs` shape — preserved the incoming header and appended its own
peer. Two appending hops, so the client is the second entry from the right. It is set in
`deploy/compose.uat.yml` only, never in the base file, because it is a property of a host
and not of the product. Method and captured values:
[`proxy-topology-evidence.md`](../05-operations/proxy-topology-evidence.md).
*Reversible by:* re-measuring and editing that one line in the overlay.

**2 · `X-Forwarded-Proto` is not trustworthy on that host, and it is not fixed here.**
The same measurements show both failure modes: Traefik passes a viewer-supplied
`X-Forwarded-Proto` through verbatim when the peer is trusted, and sets `http` when none
arrives — because its own entrypoint is plain `:80`. So the application either believes
what a viewer told it, or believes every HTTPS request was HTTP. Which one depends on the
CloudFront distribution's origin request policy, which is not readable from the host. The
fix is an origin custom header at the CDN, and it is recorded as an open item rather than
worked around in a middleware. **Nothing on that topology should issue a secure cookie or
build an absolute URL from the forwarded protocol until it is done.**

**3 · The Helm chart requires its secrets; it does not generate them.**
`charts/taskdesk` shipped `authSecret: ""` and no `NODE_ENV`, and set neither
`TASKDESK_ENCRYPTION_KEY` nor `TASKDESK_PORTAL_URL` at all. The chart now fails to render
with a message naming the missing value and the `openssl rand -hex 32` that produces it,
and documents `existingSecret` as the production form. **Generate-on-install was rejected:**
Helm has no memory, so a `randAlphaNum` default is a new secret on every `helm upgrade`
unless a `lookup` guards it, and `lookup` returns nothing under `helm template`,
`--dry-run` and most GitOps renderers. Silently rotating the session secret signs everyone
out; silently rotating the encryption key makes every stored plugin secret unreadable. A
required value that fails loudly is the safer contract.

**4 · `TASKDESK_HSTS_PRELOAD` is empty-or-`1`, not `0`-or-`1`.**
`configuration-reference.md`'s example `.env` had `TASKDESK_HSTS_PRELOAD=0`. Compose has no
boolean: `${VAR:+…}` fires on any **non-empty** value, so `0` would have selected the
preload middleware and committed the operator's whole apex domain. The example is corrected
to an empty value, and `scripts/deploy.sh` rejects anything that is not empty or `1` rather
than let `0` quietly mean "on". No variable was added or renamed.

**Alternatives:** for (1), setting `2` because the diagram has two boxes — which is what
the issue explicitly warned against, and which would have been *right by accident*; the
measurement is what makes it defensible, and it also produced (2), which the guess would
have missed entirely. For (3), restoring a default value — rejected outright; that is the
CRITICAL this project already fixed once.

**Decided by:** Claude Code (deployment lane, #11), recorded for Thomas.

---

### 2026-09-06 · PR #13 merged before its mandatory security review — deviation recorded, not waived

**Decision:** **PR #13 was merged on 2026-09-06 before its mandatory security review had been
performed.** That was a **process deviation, not an approved waiver.** A post-merge Opus
security review was performed immediately, its findings are recorded on PR #13 and in
[`security-reviews/13-kaneo-import.md`](security-reviews/13-kaneo-import.md), and every
CRITICAL was fixed before Throttle 1. **From now on, a pull request that touches the
security paths listed in [`ci-cd.md`](../04-engineering/ci-cd.md) does not merge until the
required review is recorded on it.**

The review found **three CRITICAL** defects in the merged code. All three are fixed on
`feat/p0-remove-inherited-surfaces`:

1. **A missing `TASKDESK_AUTH_SECRET` silently became a published constant.** `auth.ts`
   passed `process.env.TASKDESK_AUTH_SECRET || ""` and validated the length only when the
   variable was already set. An empty string is falsy inside better-auth, whose own chain
   ends at `"better-auth-secret-12345678901234567890"` — published in its source — and which
   only *throws* for that default when `NODE_ENV === "production"`. TaskDesk is
   self-hosted-first, where `NODE_ENV` is routinely unset, and the Helm chart ships
   `authSecret: ""` with no `NODE_ENV` at all. The documented install therefore signed every
   session cookie with a value anyone can read on npm.
2. **Credentialed CORS reflected any origin** whenever `NODE_ENV` was not exactly
   `"production"` — again including unset.
3. **`bearer()` published the raw session token** in a CORS-exposed response header, which
   chained with (2) into cross-origin session theft with no XSS required.

Plus one HIGH fixed in the same pass: a caught database error in `lookupWorkspaceId`
returned `null`, indistinguishable from "no such row", and eight middleware sources fall
back to a caller-supplied `?workspaceId=` on null — so a transient error downgraded a tenant
check to attacker-controlled input.

**Why:** the point of recording this is that **a skipped gate must be visible and
corrected, never hidden or rewritten.** The three CRITICALs are the argument for the rule
rather than an argument against it: none of them was visible in the pull-request
description, all three were found by reading the merged source, and all three fail open on
exactly the deployment shape TaskDesk ships. A review performed after the merge found real
defects; a review skipped entirely would not have.

Two honest limits on this review, stated rather than glossed: the session that authored
PR #13 also orchestrated the review, so although the five reviewers were separate sessions
with fresh context, this is **not** an outside pair of eyes; and the review covers the
merged diff, not the whole inherited surface, much of which #6 is deleting anyway.

**Alternatives:** recording it as an approved waiver — rejected, because it was not approved
and calling it one would make the next skip easier. Quietly reviewing without recording —
rejected for the same reason, and because
[`CLAUDE.md`](../../CLAUDE.md) already warns that the rules agents route around are the ones
written as sentences rather than gates. The durable fix is mechanical: once #10 lands, the
fast CI job becomes a required status check on `main`, and the security-review section stops
depending on anyone remembering.

**Decided by:** Thomas, 2026-09-06

---

### 2026-09-06 · The P0 working agreement — dependency graph, two throttles, blocking taxonomy

**Decision:** the way P0 is sequenced and parallelised is settled and written into
[`CLAUDE.md`](../../CLAUDE.md) ("The P0 working agreement"), in eight parts:

1. **The dependency graph.** #4 licence is done. **#5 (kaneo import at `42bb8011`) must
   merge before any real application work.** After it, **#6 removals, #10 CI and #11
   deployment run in parallel**; **#7** policy registry may overlap #6; **#8** router
   retrofit waits only for #6's removal surface to settle, because classifying a route that
   is about to be deleted is wasted review; **#9** UI extraction is independent after #5 but
   must not edit the same files as #6 concurrently. **#8 complete plus the P0 exit gates
   green ⇒ P0 may be claimed complete.** The issue dependency links are corrected to match
   and the self-references ("#5 blocks #5", "#8 blocks #8") removed.
2. **Two throttles, doing different jobs.** *Throttle 1* opens parallel development when
   #5, #6 and #7 have all merged — that is, when the dangerous inherited surfaces are gone
   and a route without a policy fails the build. *Throttle 2* governs only whether P0 may
   be **claimed**: #8 green, the Opus security review having read every public and delegated
   policy reason, the permission matrix green for every built-in role, the RLS prototype
   resolved either way, and the remaining exit criteria green. **Throttle 2 gates the claim,
   never the throttle.**
3. **What runs in parallel afterwards** — three to four active branches, one architectural
   idea per pull request: P1 core, P2 domain (pure functions in `packages/domain` **before**
   any HTTP endpoint), P3 identity internals (**before** `/scim/v2/*` is exposed), P4
   governance seams (a configuration seam lands with the thing it configures, never later).
4. **A blocking taxonomy graded by blast radius** — one workstream, a shared contract, a
   soft block, or no block — each with a different response, and one rule common to all
   four: never guess, never weaken a failing test, never route around a gate.
5. **Shared-contract ownership.** `packages/permissions`, identity and context types, the
   organisation/workspace/project schema, the `work_item` base schema, plugin contracts, the
   API error envelope, the event envelope, route-policy types and the migration journal are
   changed by a **small dedicated contract pull request**, never by a feature agent in
   passing.
6. **The spec interaction rule** — proceed / close the open review findings first / stop and
   propose a document change / spec and decision log before code / Thomas reviews an
   entirely new feature. Never silently implement something different from the spec.
7. **The reference restriction** — implementation reads kaneo and Ticketing v1 **only**.
   Plane, OpenProject and the six ITSM systems are closed; that research is finished and
   recorded in `THIRD-PARTY-NOTICES.md` §2.
8. **Authority** — only Thomas authorises merges; never self-approve, never waive a gate,
   never downgrade an unavailable reviewer.

**Why:** every one of the eight closes a failure this project has already seen or has
explicitly named as a risk. The graph exists because #5 replaces the tree, so anything built
first is rework. The two throttles exist because "P0 is done" and "we may now work in
parallel" were being treated as one event, which is how a stage gets claimed on the strength
of the work that opened it rather than the work that finished it (R2, and product principle
7). The blocking taxonomy exists because "blocked" had one word and three blast radii, and
the wrong response to a shared-contract block stops nothing while the wrong response to a
one-lane block stops everything. Shared-contract ownership is R17 — parallel workstreams
reproducing three inconsistent codebases faster than usual — converted into a rule about who
may open which pull request. The reference restriction is the licensing boundary, and it is
easiest to breach late, when an implementer wants to see how somebody else solved something.

**Alternatives:** leaving the sequencing implicit in [phases.md](phases.md) and the
[accelerated delivery plan](accelerated-delivery-plan.md) — rejected, because both describe
*what* P0 contains and neither states which issue may start when, which is the question an
agent actually has at the start of a session. A separate planning document was also
rejected: this is operating guidance for the agent doing the work, and
[`CLAUDE.md`](../../CLAUDE.md) is where an agent is already required to look.

**Decided by:** Thomas, 2026-09-06 — settled, not to be reopened.

---

### 2026-09-06 · The week-2 scope confirmation is a named moment with an owner

**Decision:** at the end of week 2 of any accelerated window, **Thomas writes two lines in
[status.md](status.md): what go-live contains, and what has moved.** Recorded in
[accelerated-delivery-plan.md](accelerated-delivery-plan.md).

**Why:** the flexible-date rule (decision A) is settled and is not reopened here. What it
lacked was a moment: a date allowed to move, with nobody scheduled to say what it now means,
drifts silently because everyone assumes someone else is watching. The existing escalation
("the moment workstream A looks behind") is event-driven and fires only when something looks
wrong; this one fires regardless, which is why it catches the case where nothing did.

**Decided by:** Thomas, 2026-09-06

---

### 2026-09-06 · Repository setup, and the working mode from here on

**Decision:** four things are true about how this repository is operated, and P0 code does
not start until the first two are done.

1. **Branch protection is live.** The ruleset `protect-main` on `main`: pull request
   required, one approval, stale approvals dismissed, force pushes and deletion blocked,
   bypass list empty, squash merge only. **Status checks stay off until GitHub Actions
   exists in P0**, and then the fast CI job is added to that same ruleset as a required
   check — a ruleset that requires a check nobody can run would block every pull request.
2. **The licence files land in their own pull request, before the kaneo import.** `LICENSE`
   (AGPL-3.0), `NOTICE` and `THIRD-PARTY-NOTICES.md` at the repository root. The import is a
   **separate** pull request that opens only after the licence one merges. This is the
   provenance boundary: our licence first, kaneo's MIT code second, kaneo's copyright headers
   preserved. ([licensing-and-attribution.md](../00-overview/licensing-and-attribution.md))
3. **Work is tracked in GitHub Issues, as vertical slices, not per screen.** The markdown
   corpus stays the knowledge; issues track the work. A Project board carries Backlog /
   Ready / In Progress / Review / Blocked / Done. The P0 slices are: licence and provenance
   files; kaneo import at the confirmed SHA; delete `public-project` and the inherited
   integration routers; the router retrofit into the five policy kinds; `packages/ui`
   extraction and Base UI convergence; the CI/CD skeleton; the deployment skeleton; the
   policy registry and route-coverage test on the inherited surface.
4. **The working mode is branch → commit → pull request → Thomas approves → merge.**
   This is [AGENTS.md](../../AGENTS.md) do-not 16 made concrete: an agent may create a
   branch, commit to it and open a pull request; Thomas approves and merges. Work is never
   left uncommitted on a local machine, and nothing reaches `main` without his approval.
   The earlier reading of do-not 16 — that even a branch commit needed approval — produced
   eighty-three uncommitted files on one laptop, which is the failure this rule exists to
   prevent, in the other direction.

**Hard stop:** no P0 code, and no kaneo import, until (2) has merged and (3) exists.

**Decided by:** Thomas, 2026-09-06

---

### 2026-09-06 · Terminology: stage, workstream, step, state — one word each

**Decision:** the P0–P7 sequence is renamed from **phases** to **stages**, and a stage means
a level of **product capability**, not a unit of scheduling. Execution lanes are
**workstreams**. Because "stage" was already carrying three other meanings in the corpus,
those are renamed in the same pass rather than left to collide:

| Term | Means | Owner document |
| --- | --- | --- |
| **Stage** (P0–P7) | A level of product capability, with exit criteria | [phases.md](phases.md) |
| **Workstream** | A lane of work executing against those criteria; several run at once | [accelerated-delivery-plan.md](accelerated-delivery-plan.md) |
| **Step** (1–9) | One pass of the build process for a single feature — formerly "SDLC stages" | [sdlc.md](../04-engineering/sdlc.md) |
| **State** | Where one work item sits in its lifecycle — ADR 0011's loose "stages" corrected | [ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md) |

"Phase gate" becomes **stage gate**; the Definition of Done's `## Phase completion` becomes
`## Stage completion` and its anchor moves with it. `**Phase:**` in each feature spec header
becomes `**Stage:**`. Compound words in the other sense — a *two-phase* destructive
migration, a *multi-stage* Dockerfile, an *operator-staged* key rotation, the *fast* and
*full* **CI stages** — are untouched and stay unambiguous because they are always qualified.

**Why:** the corpus said each phase finishes before the next begins, and simultaneously ran
six lanes at once on the accelerated calendar. Both statements were true about different
things wearing one word. Separating capability from execution dissolves the contradiction
instead of explaining it away, and [product principle 7](../00-overview/product-principles.md)
is restated to constrain what may be *claimed* finished rather than what may be *started*.

**Two consequences worth stating.** The file is still named `phases.md`: renaming it would
touch eighty-seven links for no semantic gain, and the heading inside it says "Stages".
The historical review files under `07-planning/reviews/` are left in the old vocabulary
deliberately — they are a record of what was said on a date, not living guidance.

**Decided by:** Thomas, 2026-09-06 — the four-way disambiguation drafted by Claude Code and
reversible per row.

---

### 2026-09-06 · Security status is reported as a breakdown, never as "complete"

**Decision:** [status.md](status.md) no longer says "Security review: complete". It carries
seven lines, because "complete" was a statement about the *documentation* that read as a
statement about the *product*:

architecture ✅ · threat model ✅ · implementation ⬜ · SAST and dependency scanning ⬜ ·
authorization tests ⬜ · internal red team ⬜ · external penetration test ⬜.

**Why:** five of the seven cannot even be attempted before code exists. A reader — a
customer, a reviewer, a future agent — seeing "complete" would reasonably conclude the
product had been security tested. It has not been; the corpus has been reviewed. The
breakdown makes the difference impossible to misread and gives each row a place to turn
green.

**Decided by:** Thomas, 2026-09-06

---

### 2026-09-06 · The Sep 12 milestone is the "Foundation Technical Preview"

**Decision:** the week-1 milestone is renamed from "UAT ready" to **Foundation Technical
Preview** in [accelerated-delivery-plan.md](accelerated-delivery-plan.md) and
[status.md](status.md). The UAT *environment* keeps its name and its compose overlay.

**Why:** "UAT" promises that users are about to accept something. What week 1 produces is a
de-branded kaneo with sign-in, the policy registry and the CI gates — a foundation, and a
technical audience. Naming it accurately costs nothing now and prevents a stakeholder
arriving on 12 September expecting to accept a product.

**Decided by:** Thomas, 2026-09-06

---

### 2026-09-06 · The engine boundary — plugin, or domain module plus a flag

**Decision:** [plugin-architecture.md](../01-architecture/plugin-architecture.md) gains one
question that decides which shape a feature takes. *Could two implementations of this be
installed side by side and swapped by an administrator?*

- **Yes → a plugin.** SMTP or Teams; S3 or the filesystem; Entra or Okta.
- **No → a domain module plus a feature flag.** SLA, workflow, approvals, assignment, the
  terminology overlay: one implementation, varying only in configuration and whether it is on.

Both still follow the five points of the engine pattern. The rule decides only whether the
swap point is a registry entry or a flag plus configuration rows.

**Why:** "everything is an engine" was being read as "everything needs a plugin kind", which
points at six registries with one member each — ceremony that makes the codebase harder to
read while proving nothing. The rule keeps the promise (nothing hardcoded per customer)
without the ceremony.

**Decided by:** Thomas, 2026-09-06

---

### 2026-09-06 · PostgreSQL RLS is promoted from deferred to a P0 prototype

**Decision:** row-level security becomes a **P0 prototype** on `work_item`, `comment` and
`attachment` — the three tables where a missed `WHERE` leaks another tenant's content rather
than a setting. It is a **backstop beneath** the application layer, never the primary
control: scoped repositories, the route policy registry and reach/authority stay primary,
because they are what gets reviewed and what can express reach versus authority at all.

The prototype answers three questions with measurements instead of opinions: does it survive
connection pooling, what does it cost on the hot list queries, and does it ever disagree with
the application layer — a disagreement being a bug in one of them, which is the point of
having two. **P0 exit:** merged with those answers written down, or dropped with the reason in
this log. An open prototype does not close P0.

**Why:** "the application is the only thing standing between two customers' data" was the
one place the security review had no defence in depth, and the cheapest moment to find out
whether RLS is affordable here is while the schema is three tables old rather than eighty.

**Supersedes:** "No row-level security in Postgres" (2026-09-05), below, and removes RLS from
the deferred list in [roadmap.md](roadmap.md).

**Decided by:** Thomas, 2026-09-06

---

### 2026-09-06 · The person model — one person, one organisation

**Decision:** a `person` belongs to **exactly one organisation**, fixed at creation.

- The **agent portal** serves the internal staff organisation only. Staff arrive through an
  identity connection scoped to that portal, or by email invitation, and are then placed on
  teams and named as stakeholders.
- The **customer portal** serves one organisation per customer company. No customer person
  belongs to two organisations.
- **Email is not an identity key and is not unique per instance.** The key is
  `(identity_connection_id, subject)`; better-auth's default unique index on `user.email` is
  dropped at fork.
- A human who genuinely needs **both** portals has **two `person` rows**, and **may use the
  same address for both** — the rows are keyed per connection and collide on nothing. They
  are never linked, which is `IP-18` applied rather than contradicted.
- **The default is not a second account.** A staff member who needs the customer's view uses
  **God Mode impersonation** — audited twice, capped at thirty minutes (`GM-7`, `GM-8`).

**Known limitation, accepted:** a consultant who is genuinely a contact at two customer
organisations needs two customer-side rows and two sign-ins. **The schema is not being
redesigned for it now:** the cost is a rare person signing in twice, against a many-to-many
identity model that would be paid for on every authorization check.

**Why:** this corrects an earlier concern about "multi-organisation people" that does not
apply, and it corrects the corpus, which said such a person needed *different email
addresses*. That was a needless restriction — the identity key was never the address.

**Recorded in:** [multi-tenancy.md](../01-architecture/multi-tenancy.md#identity-across-tenants)
(owner), [data-model.md](../01-architecture/data-model.md) §2,
[identity-provisioning.md](../03-features/identity-provisioning.md) `IP-33`,
[god-mode.md](../03-features/god-mode.md), [customer-portal.md](../03-features/customer-portal.md),
[glossary.md](../00-overview/glossary.md).

**Decided by:** Thomas, 2026-09-06

---

### 2026-09-06 · Small design choices made by Claude Code while applying the pre-P0 check — all reversible

**Decision:** while applying the ≈200 findings, a handful of gaps had no decision behind
them and could not be left open without leaving a document contradictory. Each was closed
with the smallest option and is listed here so Thomas can reverse any of them in one line.

| Choice | Where it landed | Reverse by |
| --- | --- | --- |
| **All personal API keys are read-only by default**; write capabilities are an explicit, warned opt-in at creation. `is_mcp` adds only the MCP-specific ceilings and is stated to be self-declared, not a security boundary | webhooks-and-api-keys.md `AK-9`, mcp-server.md `MC-14`–`MC-16` | restoring "read-only default applies to `is_mcp` keys only" |
| **Elevated targets are never deletable from a non-session credential**: API-key / MCP / impersonation DELETE of a workspace, organisation, project, API key, webhook, identity connection or auth plugin is `403 session_required`, not `202` | rbac.md, api-design.md, pending-actions.md | allowing 202 for those targets and adding an approval surface for them in P4 |
| **Two better-auth instances, one per portal origin**, constructed together on every reload — each with its own `baseURL`, cookie name (`__Host-tdk_agent_session`, `__Host-tdk_portal_session`), `trustedOrigins` and provider set; the request host selects the instance | auth-and-identity.md, auth-runtime-reconfiguration.md, ADR 0004 | a single instance plus a request-scoped cookie/redirect wrapper — the alternative the docs previously implied without naming |
| **Group-claim overage** (Entra `_claim_names`): the claim is ignored, the JIT default role is provisioned, a `provisioning_event` and a Health warning are raised; no Graph call in the first release | identity-provisioning.md | adding a Graph `memberOf` call under the connection's own credentials |
| **Health deep endpoint** is `/api/instance/health/deep`, capability `instance:admin` only; the metrics bearer token grants `/metrics` alone | api-design.md, security-model.md, observability.md, runbook.md | letting the metrics token read `health/deep` as a delegated route |
| **TaskDesk uses Tailwind's built-in spacing, type, shadow and z-index scales directly, as kaneo does** — the invented `--space-*` / `--text-*` / `--shadow-*` / `--z-*` / layout tokens are removed from design-tokens.md; only colour, radius, motion and the status/priority/SLA colour tokens are ours | design-tokens.md | authoring those token families with values before `packages/ui` extraction |
| **Root `i18n/` stays where kaneo has it** (with `scripts/i18n/*.mjs` and the CI i18n job), not `packages/i18n/` | monorepo-layout.md, i18n.md, repository-bootstrap.md | moving it, and porting the three scripts and the CI step |
| **Assignment**: defaults and UI are P1; the rule *engine* ports with `packages/domain` in P2 | phases.md, 03-features/README.md | moving both to one stage |
| **Prefix `PG` reserved** for a future `pages.md` | 03-features/README.md registry | dropping Pages from P5 |
| **CODEOWNERS** (`* @ThomasHeinThura`, required review on `main`) is the mechanism behind "only Thomas merges" | ci-cd.md | none needed — it is what the Roles table already promised |
| **Semantic-release, commitlint and husky are kept** from kaneo (tech-stack.md already lists them), so `.husky/`, `commitlint.config.js` and `release.config.js` are copied | repository-bootstrap.md | dropping them and the `prepare` script |
| **kaneo's inherited `mcp` and `oauth` routers and the better-auth `organization`, `anonymous`, `deviceAuthorization` and `bearer` plugins are removed at fork**; `admin` is kept only as a session primitive with its routes unmounted; `twoFactor` is added in P0 | inherited-features.md, auth-and-identity.md | per row, with a spec and a security review |

**Why:** an apply pass that stops to ask on every small gap does not finish; one that decides
silently is how v1 drifted. This table is the middle path — decided, visible, reversible.

**Decided by:** Claude Code (Fable), 2026-09-06 — each row stands unless Thomas reverses it.

---

### 2026-09-05 · kaneo snapshot commit: upstream main `42bb8011` — **confirmed 2026-09-06**

**Decision — CONFIRMED by Thomas, 2026-09-06.** Fork from upstream `main` commit
`42bb801114aa1ae499228a53180f0cdbc5607964` (2026-09-05, kaneo CI run 33957941564 green:
lint, i18n, typecheck, unit, build, integration on Postgres 16, docker build) — **not** from
the latest release tag `v2.22.0` (2026-08-21). The SHA is recorded in
`THIRD-PARTY-NOTICES.md` at the repository root, which merges before the import.

**What still gates the import** is procedural, not a decision: the licence pull request must
merge, and the P0 issues must exist. See the repository-setup entry below.

**Why:** the tag predates authorization fixes that landed on `main` two to three days later
— `6de9ea05` "close five workspace-scoping gaps" (08-23), `6bfe74de` "read the raw body in
task permission middleware" (08-24), `a581bdd2` "restore the entitlement check on project
creation" (08-24), `902e3219` "five defects that fail silently", `018f4750` replica-safe
notifications, `cf701d02` the `job_lease` table. kaneo is taken once and never merged
again ([ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md)), so a commit chosen
for tidiness would carry known-fixed authorization bugs into TaskDesk permanently. kaneo's
releases are manual `workflow_dispatch`; no release has been cut since the fixes. The local
clone (`51255e85`, 2026-09-04) is itself 68 commits behind upstream — `git fetch` first.

**Recorded at fork, in [inherited-features.md](../01-architecture/inherited-features.md)
and `THIRD-PARTY-NOTICES.md`:** the full SHA; "main commit, not a tag"; the date; the
upstream CI run id and result; the reason ("post-tag authorization fixes included"); and
the verification steps run before the copy — kaneo's own suite green on that SHA with
pass/fail/skip counts (the attribution baseline for the P0 exit criterion), `pnpm audit`
and Trivy clean at high/critical, and the inherited defaults noted for removal (anonymous
sign-in, OIDC auto-link, five-minute session cookie cache — see the next two entries).
Facts that depend on the SHA (locale count, `job_lease` presence) are stated once, there.

**Alternatives:** the `v2.22.0` tag — rejected, above. Waiting for a `v2.23.0` — rejected;
no release is scheduled and the fork has no upstream relationship to benefit from one.

**Decided by:** Thomas — recommendation drafted by Claude Code (Fable) from the pre-P0
check; **confirmed by Thomas on 2026-09-06**.

---

### 2026-09-05 · Fork-time removal and disable list — the fork is not done until every item is gone

**Decision:** P0 step 1 is not complete, and the route-coverage gate is not trusted, until
each of the following is removed or explicitly disabled in the copied code, with a test or a
grep in `tests/permissions/` proving absence where one is possible. Owner for the doing:
[repository-bootstrap.md](../04-engineering/repository-bootstrap.md) §3; owner for the
verdicts: [inherited-features.md](../01-architecture/inherited-features.md).

1. **Anonymous guest sign-in** — better-auth `anonymous()` is enabled by default in kaneo
   (`apps/api/src/auth.ts:275-281`, opt-out via `DISABLE_GUEST_ACCESS`), with
   `DEMO_MODE` / `hasGuestAccess` / `billingEnabled` exposed to the client
   (`utils/get-settings.ts`). **Removed** — the plugin, the env vars, the settings fields.
   Same reasoning as public boards: an unauthenticated or ephemeral-identity surface does
   not ship dormant in a product whose thesis is that authorization omissions are build
   failures. A `no-anonymous-plugin.test.ts` asserts the constructed better-auth config
   contains no `anonymous` plugin.
2. **OIDC / OAuth automatic account linking** — kaneo ships `accountLinking.enabled: true`
   with `trustedProviders: ["github","google","discord","custom"]` (`auth.ts:235-245`);
   `"custom"` is the `genericOAuth` provider our `auth.oidc` is built on.
   **Disabled explicitly** (`enabled: false`) — the docs' claim that "defaults are off" was
   wrong for the inherited code, and `IP-18` depends on it. The test for `IP-18` reads the
   constructed config, not only the HTTP behaviour.
3. **Session cookie cache** — `session.cookieCache { enabled: true, maxAge: 300 }`
   (`auth.ts:557-560`). **Disabled** — see the revocation entry below.
4. **`deviceAuthorization()` and `bearer()`** better-auth plugins (`auth.ts:535,545`) —
   two authentication surfaces no v2 spec mentions. **Removed at fork**; either returns only
   with a spec and a security review.
5. **`public-project`** — not a router: the inline route at `apps/api/src/index.ts:226`,
   the `project.is_public` column (`schema.ts:328`, two-phase drop per
   [migrations.md](../04-engineering/migrations.md)), `project/schema.ts`,
   `project/response.ts`, `controllers/update-project.ts`, `mcp/tools.ts`,
   **`utils/authorize-asset-access.ts` (the anonymous attachment-read branch)**, the web
   `components/public-project/`, `routes/public-project.$projectId.tsx`, its fetchers,
   hooks and tests. Confirms section C of the confirmed decisions.
6. **The six integration plugins** — `apps/api/src/plugins/{github,gitea,slack,discord,
   generic-webhook,telegram}` (registered in `plugins/index.ts`), their routers, web
   screens, the `integration` and `github_integration` tables, the `octokit` /
   `@octokit/webhooks` dependencies, `NOTIFICATION_SECRET_ENCRYPTION_KEY`,
   `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS`, and their tests under `tests/api/`.
   `plugins/registry.ts` and `plugins/types.ts` are kept as the seed of
   `packages/plugins-contracts`. Confirms section B; corrects the register row that kept
   "`plugins`" as if it were something else.
7. **Billing** — four tables (`workspace_billing`, `trial_grant`, `billing_event`,
   `billing_reminder_sent`), `creem`, `CREEM_*` / `BILLING_*` / `TURNSTILE_*` /
   `KANEO_CLOUD`, `trial-card`, `demo-alert`, `get-settings.ts`'s `billingEnabled`, and
   `tests/api/billing/`.
8. **Sentry** — the `sentry/` folder **and** the 17 code sites (`apps/api/src/instrument.ts`,
   `apps/web/src/instrument.ts`, the Vite source-map plugin, `@sentry/*` dependencies,
   `SENTRY_*` / `VITE_SENTRY_*`), including `components/ui/error-boundary.tsx` **before** it
   moves into `packages/ui`.
9. **`packages/planka-import`** and the `publish-mcp` / `publish-planka-import` workflows.
10. **kaneo's own agent instructions** — `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`,
    `.agents/`, `.coderabbit.yaml`, `skills-lock.json` and eight of the ten `skills/` — never
    copied; TaskDesk's `AGENTS.md` is authored fresh.
11. **The environment surface** — every kaneo variable gets a keep / rename / move-to-God-
    Mode / delete verdict (next entry).

**P0 exit criteria gain these lines** ([phases.md](phases.md) P0 "Done when",
[repository-bootstrap.md](../04-engineering/repository-bootstrap.md) §7): anonymous sign-in
off, account linking off, cookie cache off, no route matching `public-project`, `github`,
`gitea`, `slack`, `discord`, `telegram` or `generic-webhook` in Hono's router, no
`process.env` read outside the approved list.

**Why:** the pre-P0 check read kaneo's source and found three enabled-by-default
authentication behaviours no document knew about. The route-coverage test cannot see a
plugin that is *on*; only an explicit removal list can.

**Decided by:** Thomas (message of 2026-09-05: "the fork is not done until anonymous
sign-in is off and auto-link is off by default"); list drafted by Claude Code (Fable).

---

### 2026-09-05 · Session revocation SLA — the inherited five-minute cookie cache is disabled

**Decision:** `session.cookieCache` is **disabled** at fork. Every request that presents a
session cookie is validated against the `session` table; a revoked or deleted session fails
on the very next request. The **authority** resolution (memberships, roles, `sees_all`)
keeps its Valkey cache of **30 seconds**, invalidated explicitly on every membership, role,
deactivation and connection change — so a *revoked session* takes effect on the next
request, and a *changed authority* takes effect immediately in the normal case and within
30 s if the invalidation message is lost. That is the honest SLA, stated once in
[auth-and-identity.md](../01-architecture/auth-and-identity.md) § Sessions and cited by
`IP-15`, the SCIM de-provisioning tests and `god-mode.md`'s "organisation suspended" row.

**Why:** kaneo enables better-auth's cookie cache for five minutes (`auth.ts:557-560`),
which serves a session from a signed cookie without a database read. No TaskDesk document
mentioned it, and four of them promised "revocation is immediate". A SCIM `active=false`
would have left live portal sessions for up to five minutes. Disabling the cache costs one
indexed primary-key read per request, which the product can afford.

**Alternatives:** keep the cache with `maxAge` ≤ 30 s (rejected — it still contradicts
"immediate" and gains little); keep five minutes and state it (rejected — the identity gate
promises Entra deactivation ends access "within a minute").

**Decided by:** Thomas (message of 2026-09-05: "do not leave 'immediate' in one doc and
'5 minutes' in the inherited config"); drafted by Claude Code (Fable).

---

### 2026-09-05 · Environment surface at the fork — every kaneo variable gets a verdict

**Decision:** kaneo's API reads about eighty distinct environment variables (`KANEO_*`,
bare `AUTH_SECRET` / `DATABASE_URL` / `POSTGRES_*`, `REDIS_*` including Sentinel and
Cluster modes, `S3_*`, `SMTP_*`, `COOKIE_DOMAIN`, `TRUSTED_PROXIES`, `CUSTOM_OAUTH_*` ×11,
`DISABLE_*` ×6, `SENTRY_*` ×5, `CREEM_*` / `BILLING_*` ×6, `TURNSTILE_*`, `DEMO_MODE`,
`DEVICE_AUTH_CLIENT_IDS`, …) and the web bundle substitutes `KANEO_API_URL`,
`KANEO_SENTRY_DSN`, `KANEO_TURNSTILE_SITE_KEY` at container start (`apps/web/env.sh`).
The five-plus-six rule ([configuration-reference.md](../05-operations/configuration-reference.md))
is therefore a **migration**, not a rename. [repository-bootstrap.md](../04-engineering/repository-bootstrap.md)
§2 now carries the table: every variable → **rename** to a `TASKDESK_*` bootstrap variable,
**move** into God Mode (which plugin or setting), or **delete** with its feature. Consequences
recorded there: Redis Sentinel and Cluster modes are dropped (one `TASKDESK_VALKEY_URL`);
`COOKIE_DOMAIN` and the cross-subdomain cookie branch are dropped (`__Host-` cookies per
portal); `TRUSTED_PROXIES` becomes the `TASKDESK_TRUST_PROXY` hop count; `apps/web/env.sh`
is deleted (the web bundle learns its API origin from the page it is served from).
`deploy/.env.example` is **written fresh**; kaneo's root `.env.sample` is not copied.

**Why:** the bootstrap document's de-brand step covered names, strings and assets and never
mentioned environment variables — the largest single body of P0 step-1 work was unitemised.

**Decided by:** Thomas (message of 2026-09-05, item 5); table drafted by Claude Code (Fable).

---

### 2026-09-05 · Migrations: kaneo's history is inherited; removals are additive migrations — confirm with the SHA

**Decision — CONFIRMED by Thomas, 2026-09-06.**
TaskDesk's `apps/api/drizzle/` starts from kaneo's **45 migrations** (`0000`–`0044` at the
snapshot) and their `meta/_journal.json`, exactly as taken. Every fork-time removal
(billing tables, `integration`, `github_integration`, `project.is_public`) is a **new,
additive migration** on top, generated from the post-strip `schema.ts`. There is no
hand-made `0001_initial.sql`; [migrations.md](../04-engineering/migrations.md)'s file
listing is corrected to show the inherited prefix range and the first TaskDesk migration
number.

**Why:** Thomas: "base migrations on kaneo's 45 rather than a fake fresh 0001". The
inherited journal is what kaneo's own integration suite was validated against, so it is the
only baseline the pre-copy test run can be attributed to. **Trade-off, stated honestly:**
every fresh TaskDesk database will replay kaneo's history — creating and then dropping
billing, integration and public-board columns — and kaneo's table and enum names are baked
into the early migrations. The alternative (squash to a generated baseline and regenerate
the journal) is cleaner and is one command; it is reversible until the first TaskDesk
migration is written.

**Also decided:** the `custom/` directory with an "interleaving runner" is dropped from
[migrations.md](../04-engineering/migrations.md) — `drizzle-kit migrate` applies only what
the journal lists. Hand-written SQL (the `work_item.key` trigger, extensions, the
append-only grants) is appended into generated migration files, journal-tracked.

**Decided by:** Thomas (message of 2026-09-05); wording by Claude Code (Fable).

---

### 2026-09-05 · A fresh install uses `storage.filesystem`; SeaweedFS is an opt-in Compose profile

**Decision:** on a new instance the active storage plugin is `storage.filesystem`
(attachment bytes on a named Docker volume under the container's data path) — no storage
configuration, no third hostname, no bucket. SeaweedFS ships in the Compose stack as an
**opt-in profile** (`--profile s3`) with a complete service definition (`weed server -s3`,
an `s3.json` credential file, a bucket-create step in `scripts/deploy.sh`, a health check),
and an administrator points `storage.s3` at it — or at real S3 or Garage — from God Mode.
`files.<domain>` and its Traefik router exist **only** when an operator-owned S3 endpoint
is served behind this Traefik; the installer's DNS pre-flight checks it only then. The
storage plugin's configured public endpoint **must equal** the browser-facing origin, or
presigned URLs will not verify; the bucket's CORS allows exactly the agent and portal
origins.

**Why:** this was already the decision ("`storage.filesystem` works with no configuration,
so a fresh install needs no storage variable at all", environment-variables entry below) —
but [storage-and-attachments.md](../01-architecture/storage-and-attachments.md) still said
`storage.s3` was the default and the deployment stack table started SeaweedFS
unconditionally, with no service definition that could actually run. The two documents are
now aligned to the decision.

**Decided by:** Thomas (environment-variables decision); alignment by Claude Code (Fable).

---

### 2026-09-05 · Do-not 16 — no commit, push or merge without Thomas's explicit approval in the same session

**Decision:** [AGENTS.md](../../AGENTS.md) gains do-not 16, in Thomas's words: *"Commit,
push or merge anything without Thomas's explicit approval in the same session. A report is
not approval."* This **supersedes** the earlier working rule "report first, then commit,
push and update the PR". From now on an agent finishes its work, writes the report, and
stops; Thomas says "commit" (or "commit and push") in the same session, or the changes stay
in the working tree.

**Why:** two closure passes today were committed and pushed before Thomas had read their
reports. For documentation that was harmless; from P0 onward it is code. A rule that is
approval-gated is the only one a memoryless agent cannot argue itself around.

**Noted, not decided:** the narrower form (agents may commit and push to their own feature
branch; merge, `main`, history rewrites and any push *after* an unread report need approval)
keeps branch pushes cheap and keeps the PR description as the place long-running context
lives ([agent-workflow.md](../04-engineering/agent-workflow.md)). Thomas chose the strict
form; the narrow form is a one-line change if the strict form proves too slow. A CODEOWNERS
rule requiring Thomas's review on `main` is added to [ci-cd.md](../04-engineering/ci-cd.md)
so "only Thomas merges" has a mechanism, whichever form is in force.

**Decided by:** Thomas

---

### 2026-09-05 · Third absolute — an unavailable reviewer is not a downgraded reviewer

**Decision:** [agent-workflow.md](../04-engineering/agent-workflow.md) § Model tiers gains
a third absolute next to "never approve your own design review" and "never waive a gate":
when a usage limit, quota, outage or timeout makes the required review tier unreachable
mid-review, the agent **stops and waits**. It does not continue on a lower tier, does not
let the authoring session review its own work "just this once", and does not let a Sonnet
implementation subagent review the code it wrote under any framing. While blocked it
records what is finished and what is unreviewed in the PR description, adds a **Blocked**
entry to [status.md](status.md) naming the tier it waits for, and stops. Proceeding without
the review is a gate waiver only Thomas grants, through the waiver procedure.

**Why:** the failure has already happened twice today (two agents hit limits mid-session).
"Not cost-negotiable" addressed budget, not availability; an agent that cannot reach Opus
reads "cost" as not covering its situation. This is the v1 pattern — the exception that
becomes the rule — named so it cannot be routed around.

**Decided by:** Thomas (message of 2026-09-05, suggestion 3)

---

### 2026-09-05 · Go-live rehearsal gate — two lanes, timed, before the first real tenant

**Decision:** [definition-of-done.md](../04-engineering/definition-of-done.md) gains a
"Go-live rehearsal" section, cited from [phases.md](phases.md) and the accelerated plan's
week-5 gate. Before the first real tenant, internal or external, the first week of a
customer's life is rehearsed once, in order, in a single sitting, against the `realistic`
seed, and timed. **Administrator lane — browser only, ten minutes:** create an
organisation, configure Microsoft Entra for it, invite a customer and have them sign in,
raise a request from the portal, triage it, breach an SLA on purpose and see it where the
spec says, resolve it. Over ten minutes, or any step that needs a terminal or an edited
file, fails the gate. **Operator lane — a shell is expected, improvisation is not:**
install, restore from backup, and upgrade are shell procedures by design (and the one-time
setup token is read from the installer output or the container log); the bar is that each
is completed by following the runbook exactly, with no command the runbook does not name,
and timed. Timings and every hesitation go into the stage review note.

**Why:** the red-team gate tests the security surface; nothing rehearsed the operational
go-live as a sequence. "The first ten minutes sells this product." The original wording
("requires a shell → not done") would have failed by construction, because install,
restore, upgrade and the setup token are shell steps in the deployment design.

**Decided by:** Thomas (message of 2026-09-05, suggestion 2); two-lane wording by Claude
Code (Fable)

---

### 2026-09-05 · `notify.email` (SMTP) is core delivery

**Decision:** the SMTP channel (`notify.email`) is **core**, not a future integration.
Authentication codes (email OTP, magic link), invitations, the first-run and setup flow,
notification email and pending-action notices all depend on it. It is configured in God
Mode → Notifications (host, port, TLS, credentials, from-address, reply-to; "send a test
email"), never by environment variable. The deferred "notification integrations" list is
**chat channels only**, in this future priority order: Microsoft Teams → Slack → Telegram →
Viber. The generic signed webhook stays core in P4. Nothing else changes.

**Why:** already recorded inside the deferred-scope list of the A–N entry ("Email is core")
and consistent across notifications.md, plugin-architecture.md, roadmap.md and god-mode.md
— this dedicated entry exists so that a reader scanning the log's headings cannot miss it or
"helpfully" defer email with the chat channels.

**Decided by:** Thomas (confirmed 2026-09-05)

---

### 2026-09-05 · Unauthenticated invitation lookup stays, as a `public` route

**Decision:** kaneo's `GET /invitation/public/:id` (`apps/api/src/index.ts:240`) — the
pre-sign-in view of an invitation (workspace name, inviter, expiry) — is **kept** through
the router retrofit as policy kind 4 (`public`), rate-limited in the anonymous class,
constant-shape 404 for an unknown or expired id, returning no email address and no member
list. It is listed in the inherited-features register with this verdict.

**Why:** the invitation flow needs the invitee to see what they are accepting before they
authenticate; the alternative (a blind accept) is worse UX for no security gain, since the
id is a ≥128-bit token. Recorded because no document had a verdict for the only other
unauthenticated route in kaneo's `index.ts`.

**Decided by:** Claude Code (Fable) — reversible; Thomas may reverse to "remove" in one line.

---

### 2026-09-05 · Pages needs a spec before P5 step 2; the fixed-report count is twenty

**Decision:** "Pages" stays scheduled in P5 and in the screen inventory but is marked
**spec required** — no `docs/03-features/pages.md` exists; prefix `PG` is reserved in the
[features README](../03-features/README.md) registry and the P5 table notes the missing
spec. It cannot enter build until the spec is written and read (the README's own rule). The
fixed-report count is **twenty** (4 + 3 + 5 + 4 + 4 in
[reports-and-dashboards.md](../03-features/reports-and-dashboards.md)); the word "fourteen"
is corrected in that spec, phases.md, the accelerated plan and vision.md.

**Why:** a scheduled feature with no spec is how scope enters unnoticed; a count repeated in
five documents that the owning spec's own tables contradict is how counts drift.

**Decided by:** Thomas (message of 2026-09-05, item 6); minimal-scope form by Claude Code
(Fable) — writing the spec or dropping Pages from P5 remains Thomas's call.

---

### 2026-09-05 · Pre-P0 check applied — where each class of finding landed

**Decision:** the pre-P0 check (Fable, 2026-09-05; ≈200 verified findings, eight lenses,
audit trail in [reviews/2026-09-05/pre-p0-check-fable/](reviews/2026-09-05/pre-p0-check-fable/))
is applied in the owning documents, not left in a review file. By class:

| Class | Owner document(s) | Headline corrections |
| --- | --- | --- |
| kaneo reality (bootstrap) | repository-bootstrap.md, inherited-features.md, migrations.md, monorepo-layout.md, ADR 0001, tech-stack.md, 08-docs-site/plan.md | exhaustive copy table; env migration table; `public-project` checklist; `plugins` = the six integrations; `job_lease` inherited; `packages/permissions` replaced not extended; kaneo's `tests/`; docs-site claim corrected (open decision) |
| Authorization & security | rbac.md, security-model.md, pending-actions.md, api-design.md, webhooks-and-api-keys.md, mcp-server.md, six feature route tables | CSRF scoped to cookie auth; `orOwner` requires the `*_own` capability; elevated DELETEs from non-session credentials are `403 session_required`; `pending_action` gains `payload`, `route_key`, `invalidation_reason`; personal keys read-only by default; `MC-7` destructive list widened; `Policy` gains `elevated`/`sessionOnly`; audit chain input and serialisation defined; service-key ownership transfers to workspace admins |
| Identity | auth-and-identity.md, auth-runtime-reconfiguration.md, identity-provisioning.md, customer-portal.md, multi-tenancy.md, god-mode.md, ADR 0003 | reload watches `identity_connection` too; account linking off; cookie cache off; Entra claim precedence (`preferred_username`/`upn`), group object ids, overage rule, single-tenant issuer + `tid`; placeholder claiming restricted; `portal_scope` never `both`; home-realm discovery; connection disable revokes sessions; SCIM server is ours, Entra quirks tolerated |
| Data model | data-model.md, events.md, background-jobs.md, ADR 0007/0009, sla.md, workflows.md, approvals.md, storage-and-attachments.md, comments-and-activity.md | `scheduled_transition` table; `first_response_at`; `is_reopen`; legal hold; organisation quotas; comment tombstones; workspace soft delete; tenancy columns on attachment/outbox/imports/custom-field values; `sla.missed`, `approval.withdrawn`; `automation-schedule` job; three `status`→`state` |
| Design | design-system.md, design-tokens.md, ux-quality-gates.md, ui-extraction-plan.md, accessibility.md, motion.md, ADR 0008 | Radix → Base UI everywhere; tokens split into inherited-verbatim vs authored; kaneo's real radii/easings/neutral base; gates with no mechanism marked as human gates or given one; two-entry routing split named as P0 work |
| Operations | configuration-reference.md, deployment.md, container-image.md, traefik-and-domains.md, one-line-install.md, backup-and-restore.md, runbook.md, kubernetes.md, observability.md | ports never in the base compose file; SeaweedFS as a profile with a real definition; single kaneo image; stray variables classified; health paths unified; upgrade through `deploy.sh`; rotation procedure unified; healthcheck buildable |
| Planning | phases.md, roadmap.md, release-plan.md, accelerated-delivery-plan.md, risks.md, 03-features/README.md | marketplace deferral everywhere; 13 unassigned specs placed; inherited-in-week-1 register corrected; Pages; twenty reports; assignment rules P1/P2 resolved; integration routers named in P0 step 1; stage-sequencing exception written into the stage gate |
| Process | AGENTS.md, agent-workflow.md, sdlc.md, definition-of-done.md, ci-cd.md, testing-strategy.md, `.github/pull_request_template.md` | PR template exists and is specified; model, reviewer and security-reviewer recorded per PR; "screens opened" artefact; one stage-gate list; do-not 16; third absolute; go-live rehearsal; `check:reviews`, `.skip`/`.only` grep, identifier and env checks as CI steps |

**Why:** an audit whose fixes do not land is how v1 drifted. Every row in the eight lens
files is either applied in its owning document or named here as a decision.

**Decided by:** Thomas (message of 2026-09-05: "nothing stays only in a review file");
applied by Claude Code (Fable) with Sonnet edit agents and Opus review.

---

### 2026-09-05 · Confirmed decisions A–N, and Microsoft Entra SCIM/OIDC as core delivery

**Decision:** Thomas's confirmed decision document of 2026-09-05 is **product policy**.
Each section is recorded in the document it governs; this entry is the index.

| § | Decision | Recorded in |
| --- | --- | --- |
| A | The four-week plan is a **flexible target**; the whole program may take **three to four months**; a stage or task may finish in **one to three days** where kaneo already provides it. Finish when exit criteria are met; never remove security/quality/test/review gates to hit a date; narrow scope, move work later or move the date, and record it. **An operating rule, not a decision to reopen** | [phases.md](phases.md) (top), [accelerated-delivery-plan.md](accelerated-delivery-plan.md), [status.md](status.md) |
| B | kaneo is a one-time, SHA-pinned source snapshot; inherited code is not trusted TaskDesk code; every inherited router is retrofitted into the five policy kinds before P0 closes | [phases.md](phases.md) P0, [inherited-features.md](../01-architecture/inherited-features.md), [security-model.md](../01-architecture/security-model.md#the-inherited-kaneo-surface--the-p0-seam) |
| C | `public-project` deleted at P0 — routes, handlers, screens, access paths, dormant code; `feature.public_boards` reserved with no implementation | [inherited-features.md](../01-architecture/inherited-features.md), [plugin-architecture.md](../01-architecture/plugin-architecture.md) |
| D | `parent_id` and `owner_team_id` are reach-affecting: own route, `project:manage_members`, audited `project.reach_changed`, both sides authorised, no cross-organisation re-parenting, owner team in the same workspace | [rbac.md](../01-architecture/rbac.md#reach), [teams.md](../03-features/teams.md) |
| E | Service API keys bounded by the creator's expanded authority at creation; elevated; granted set audited; evaluated against their own subset; never an escalation path | [webhooks-and-api-keys.md](../03-features/webhooks-and-api-keys.md) `AK-7`, [auth-and-identity.md](../01-architecture/auth-and-identity.md) |
| F | **MCP uses normal TaskDesk RBAC** — same identity, reach, capabilities, policies, audit, limits, revocation; no `mcp:*` capabilities; personal keys owned by a named human, evaluated against current authority every request; service keys not for MCP (schema `CHECK`) | [rbac.md](../01-architecture/rbac.md#mcp--the-same-rbac-not-a-second-one), [mcp-server.md](../03-features/mcp-server.md) `MC-19`–`MC-22`, [data-model.md](../01-architecture/data-model.md) |
| G | MCP keys read-only by default; writes an explicit, warned, capability-scoped opt-in with stricter limits; all returned content untrusted; no model-supplied approval | [mcp-server.md](../03-features/mcp-server.md) `MC-15`–`MC-18`, `AK-9` |
| H, I, J | **Universal deletion approval**: every user-initiated deletion from any client is a server-held `pending_action` approved by the requesting human in a browser session; bound, single-use, 15-minute expiry, re-authorised at execution; confirmation levels by target; no automation delete action before P4; no MCP hard-purge tool; retention purge of an approved soft delete needs no second prompt | **New:** [pending-actions.md](../01-architecture/pending-actions.md) `PA-1`–`PA-14`; `pending_action` in [data-model.md](../01-architecture/data-model.md) §11; `202` in [api-design.md](../01-architecture/api-design.md); `WI-23`, `AT-7`, `AK-11`, `AM-13` |
| K | `TASKDESK_TRUST_PROXY` is an integer hop count (`0`/`1`/`2`); app port never published; forged `X-Forwarded-For` changes nothing | [configuration-reference.md](../05-operations/configuration-reference.md), [traefik-and-domains.md](../05-operations/traefik-and-domains.md) |
| L | Independent internal red-team pass before internal go-live / real data, covering the listed surfaces; does not replace the external penetration test | [security-model.md](../01-architecture/security-model.md#testing-security), [risks.md](risks.md) R19 |
| M | Customer request visibility `private` / `organisation`, default `organisation`, request types may force `private` (HR, finance, legal, personal data, access, security); out-of-scope colleague gets the constant-shape 404 | [customer-portal.md](../03-features/customer-portal.md) `CP-16`, `organisation.default_customer_visibility` |
| N | **Base UI is the primary primitive standard**; migrate Radix where an adequate equivalent exists; retained Radix in `KNOWN-RADIX.md`, enforced by `check:ui`; feature code imports only `@taskdesk/ui` | [ui-extraction-plan.md](../02-design/ui-extraction-plan.md), [tech-stack.md](../01-architecture/tech-stack.md), [ci-cd.md](../04-engineering/ci-cd.md) |

**And the updated deferred-scope and identity decisions of the same day:**

- **SCIM is core delivery, not a candidate.** Microsoft Entra OIDC for the agent portal
  and organisation-bound Entra OIDC for the customer portal; SCIM 2.0 user
  provisioning/de-provisioning (`active=false` revokes sessions and personal API/MCP keys,
  preserves history); allowlisted group→role mapping only; no `/Bulk` unless Entra
  interoperability proves it necessary; **no other provider in core** (Okta, Keycloak,
  Google Workspace, generic OIDC are future). **Placement:** P0 defines the model, rules and
  acceptance tests (done here); P1/P2 prove identity/membership/RBAC/audit/revocation; **P3
  implements** Entra OIDC both portals, SCIM, the God Mode identity UI and the organisation
  identity UI, and runs the 17 acceptance tests against a real Entra tenant before the
  identity gate closes; P4 hardens operations. Customer connections are configured by
  **instance administrators only** in the first release. Authoritative model:
  `identity_connection`, `scim_connection`, `external_identity`, `scim_group_mapping`,
  `scim_group_member`, `provisioning_event` ([data-model.md](../01-architecture/data-model.md) §2);
  spec [identity-provisioning.md](../03-features/identity-provisioning.md); owner
  [auth-and-identity.md](../01-architecture/auth-and-identity.md).
- **Deferred beyond the current three-to-four-month scope**, with extension points kept and
  nothing else: antivirus (not built or installed); PostgreSQL RLS; AWS Marketplace (prefer
  BYOL/contract when it comes); notification/chat integrations (**Email is core**; then
  Teams → Slack → Telegram → Viber); developer-tool integrations (GitHub → GitLab → Gitea →
  Bitbucket → Azure DevOps); public boards removed completely. Inherited kaneo integration
  routers are **removed at fork**, never kept dormant. Recorded in
  [roadmap.md](roadmap.md#explicitly-deferred-beyond-the-current-three-to-four-month-scope-decided-2026-09-05).

- **Counts after this pass:** screen inventory **136** (was 133 after the first audit; the
  pending-action dialog, Organisation → Identity and Profile → Pending actions added; a
  portal dialog first added then removed because customers cannot delete anything); God
  Mode **nineteen** screens; **31** feature specs (teams.md and identity-provisioning.md
  added to the index).

**Why:** the [external readiness review](reviews/2026-09-05/readiness-review-external.md)
and our own audit agreed: the approved scope was not yet in the repository, and an
implementation agent would have invented a tenancy model for SCIM and a per-client
confirmation for deletion. Both are now first-class models with one authoritative home.

**Decided by:** Thomas

---

### 2026-09-05 · Rule-id prefixes are unique per spec; three collisions renumbered

**Decision:** every behaviour-rule prefix belongs to exactly one document, registered in
[03-features/README.md](../03-features/README.md#rule-id-prefixes--one-per-spec-never-reused).
The consistency check found `AU-1`…`AU-13` defined in both audit-trail and automations,
`SV-1`…`SV-5` in both search-and-saved-views and service-management, and `RL-1`…`RL-5` in
both roles-and-permissions-ui and service-management. **Automations → `AM-n`; services →
`SVC-n`; releases → `REL-n`**; audit-trail, search and roles keep theirs. Every citation was
retargeted (`AM-3`, `AM-5`, `AM-11`, `AM-13`). Two rules the security model cited but nobody
had numbered were added: `AU-14` (audit write failure — mutation succeeds, alert fires) and
`AU-15` (the `prev_hash`/`row_hash` chain, now also columns in `data-model.md`).

**Why:** tests and code comments cite rule ids; a duplicated id makes the citation, and the
test named after it, ambiguous.

**Decided by:** Thomas (convention), applied by Claude Code

---

### 2026-09-05 · Spec closure pass: the corpus was not buildable as written, and is now closer

**Decision:** act on the [planning review](review-2026-09-05.md)'s findings before P0
rather than discovering them in week three. The structural changes, each recorded in the
document it affects:

- **States are workspace-scoped**, with `project_state` for per-project ordering, default
  and enablement — otherwise a workspace workflow could serve exactly one project and
  [ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md) was unbuildable.
- **Transition `guards` and `effects` are closed vocabularies owned by
  [workflows.md](../03-features/workflows.md)**; SLA pausing is an effect, not a policy
  property; "open/closed" is defined once by `state.group`.
- **Five route-policy kinds** in [rbac.md](../01-architecture/rbac.md) replace every
  "(self)", "(portal session)", "(scoped)" and "A | B" in the specs; route coverage
  enumerates Hono's router, not the OpenAPI document; the **built-in role × capability
  matrix** is now written down and is the seed data and the test fixture.
- **`data-model.md` is authoritative**: eight missing tables and ~25 missing columns added
  (`work_item_sla_cache`, `metric_snapshot`, `workspace_feature_flag`, `idempotency_key`,
  `automation`, `dashboard`, `satisfaction_rating`, `running_timer`, `api_key` extension,
  `user_preference`, `canned_response`, `comment_version`, `request_participant`,
  `organisation_request_type`, `backup_run`, …); `status` columns renamed `state` per the
  glossary; priority is an ordered enum.
- **Identifier lists are single-homed**: feature flags (plugin-architecture), jobs
  (background-jobs), events ([events.md](../01-architecture/events.md), new), bootstrap
  variables (configuration-reference), capabilities (rbac).
- **Typed client is Hono RPC**, not spec-generated; **OpenAPI 3.1 is what the toolchain
  emits today**, 3.2 when it can — the docs no longer claim a version the tools cannot
  produce.
- **GitHub Actions** is the CI platform; the PR pipeline is split fast/full; releases are
  cut by manual dispatch; UAT pulls; the migration dry run is an operator step.
- **Teams** has a spec ([teams.md](../03-features/teams.md)); the CAB is a flagged team.
- New week-one documents: repository bootstrap, `packages/ui` extraction plan, migration
  convention, container image, auth runtime reconfiguration, i18n, Helm values contract,
  data protection, inherited-features register.
- Storybook 10 (was 8); 18 locales (was 22); `Fifteen` God Mode screens → eighteen; screen
  inventory recounted (133, with a `kind` column) and checked by CI.

The remaining per-spec findings (~300 medium/low) are tracked in
[reviews/2026-09-05/](reviews/2026-09-05/) and are closed at SDLC step 2 of each feature,
before its build — recorded as **P0 step 0** in [phases.md](phases.md).

**Why:** four independent reviewers converged on the same diagnosis — prose written faster
than the schema, the capability list and the screen register could keep up. Every item
above was a place an implementer would have guessed, and guessed load-bearingly.

**Decided by:** Thomas

---

### 2026-09-05 · Environment variables: five required, six optional, nothing else — and no bootstrap admin email by default

**Decision:** on Thomas's instruction ("I don't like many env values… just db and object
storage and others… we can edit inside the app settings"), the bootstrap surface is cut to
what the app needs *to reach its own configuration*: `TASKDESK_DATABASE_URL`,
`TASKDESK_ENCRYPTION_KEY`, `TASKDESK_AUTH_SECRET`, `TASKDESK_AGENT_URL`,
`TASKDESK_PORTAL_URL`; optional per-process switches only (`PORT`, `VALKEY_URL`, `ROLE`,
`TRUST_PROXY`, `ENCRYPTION_KEY_PREVIOUS` during rotation, `NODE_ENV`). Removed: the files
origin (lives in the storage plugin's config), the log level (God Mode → Observability), the
dev webhook allowlist (a `NODE_ENV=development` behaviour). **The first administrator is
created on a one-time setup page** unlocked by a token printed in the container log, with
`setup_completed_at` as a durable marker; `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` stays only for
headless installs. Object storage stays in God Mode too — `storage.filesystem` works with
no configuration, so a fresh install needs no storage variable at all.

**Why:** everything that varies per deployment is a setting inside the app — that is the
product's founding rule, and every variable that is not key material or a public origin is
one more thing a customer must edit in a file.

**Decided by:** Thomas

---

### 2026-09-05 · Tech stack versions reviewed against current upstream status; MinIO dropped

**Decision:** after checking every pin in [tech stack](../01-architecture/tech-stack.md)
against actual current upstream status (not memory), three changes:

- **PostgreSQL 16 → 18.** 18 has been GA for a year, is the AWS/Azure-recommended default,
  and adds native OAuth auth, SCRAM-over-md5 enforcement, TLS 1.3 cipher control and
  checksums-on-by-default — all security-relevant. 19 is in beta; not a target yet.
- **Valkey 8 → 9.**
- **MinIO dropped as the shipped default self-hosted object-storage backend.** MinIO
  Community Edition's admin console was stripped from the AGPL build in May 2025, image
  publishing stopped in October 2025, and the upstream repository was archived in April
  2026 — the removed functionality is now sold only as a paid product. **SeaweedFS**
  (Apache-2.0, actively maintained) replaces it as the shipped default; **Garage**
  (AGPL-3.0, matching our own licence) is documented as the lightweight alternative. Real
  AWS S3 in production is unaffected either way, because `storage.s3` was always a plain
  S3-API client, never a MinIO-specific one — this is a reference-implementation swap, not
  an architecture change.

Confirmed unchanged after the same check: **Node 24** (Active LTS to April 2028 — correct
pin), **Traefik v3** (currently 3.7.x, no v4), **Keycloak 26** (currently 26.7.x, no
newer major). **OpenAPI 3.1 → 3.2** — see the entry below. Noted for later, action needed
only when kaneo is actually forked in P0: kaneo has begun adding **Base UI**
(`@base-ui/react`) alongside Radix, following shadcn/ui's mid-2026 default switch; we
inherit whatever mix kaneo is using at fork time, per [ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md).
**Superseded the same day by section N of the confirmed decisions (above):** the inherited
mix is *converged on Base UI* during `packages/ui` extraction, with retained Radix
primitives registered in `KNOWN-RADIX.md` and enforced by `check:ui`.

**Why:** an explicit requirement to use "all updated and most secure" versions, and
because a stale pin recorded in a planning document is worse than no pin — it reads as
current when it is not.

**Decided by:** Thomas

---

### 2026-09-05 · OpenAPI target moved from 3.1 to 3.2

**Decision:** [API design](../01-architecture/api-design.md) targets OpenAPI 3.2, the
current release (shipped September 2025) rather than 3.1. 3.2 is a small, strictly
3.1-compatible feature release — structured tag navigation, streaming-friendly media
types, arbitrary HTTP methods, clearer OAuth2 device-flow support — so nothing already
decided about schema-first Zod generation changes.

**Why:** "latest version" was an explicit requirement, and `@hono/zod-openapi` generates
the document, so targeting 3.2 costs nothing beyond confirming the library's support for
it at implementation time.

**Decided by:** Thomas

---

### 2026-09-05 · P0 produces an inherited-features register; inherited-but-unspecified features ship flagged off

**Decision:** P0 step 1 ([phases.md](phases.md)) now includes a one-page
**inherited-features register**: every kaneo feature and notable dependency, a verdict
(*keep — spec exists* / *keep — write a spec* / *remove*), and the kaneo commit SHA taken.
Any inherited feature without a v2 spec is feature-flagged **off** until its spec exists
and it passes the UX gates. The starting table — GitHub/Gitea/Slack/Discord/Telegram
integrations, `workflow-rule` automations, time entries, public project boards, gantt and
calendar views, Planka importer, billing, `valibot`/`nanostores` — is in
[review-2026-09-05.md](review-2026-09-05.md).
**Partly superseded the same day** (confirmed decisions, sections B and C, and the
deferred-scope list): the integration routers and `public-project` are **removed at
fork**, not flagged off; the authoritative register with the final verdicts is
[inherited-features.md](../01-architecture/inherited-features.md).

**Why:** "copy kaneo, strip billing" named what to remove but not what was being kept.
A listing of kaneo's feature folders showed it ships public anonymous boards, an
automation engine, time tracking, five chat integrations and two code-host integrations
that no v2 spec mentions — features we would otherwise ship without a spec, or dead code
we would carry without a decision. It also showed the accelerated plan's deferral register
overstated what was missing (calendar/gantt/time entries/automations are inherited in week
1, not built in month three); that register is corrected.

**Decided by:** Thomas

---

### 2026-09-05 · Release plan: versions start at 2.0.0-alpha.1; `latest` means stable; images are signed

**Decision:** [release-plan.md](release-plan.md) is the release policy. Three points that
change existing documents:

- **Versioning starts at `2.0.0-alpha.1`**, not `0.x` and not a continuation of kaneo's
  `2.22.x` — the product is TaskDesk v2 and [api-design.md](../01-architecture/api-design.md)
  already anchors API stability to "when v2.0 ships". Pre-release identifiers
  (`alpha` → `beta` → `rc`) are flipped on `main` at stage closes; no second long-lived
  branch. `2.0.0` GA is the P4 close — "one image, any customer" — the first sellable
  release; external paying customers and marketplace listing wait for the P7 penetration
  test.
- **`latest` means latest *stable*.** [ci-cd.md](../04-engineering/ci-cd.md) previously
  tagged every merge `latest`; now every merge is `edge` + `sha-<gitsha>`, and `latest`
  moves only when a digest is promoted through UAT. The one-line installer's stable
  pointer follows the same rule. A customer running `docker compose pull` must never get
  an untested build by default.
- **Images are signed** (cosign, keyless) with a build-provenance attestation, and
  `scripts/deploy.sh` verifies the signature before starting a new digest (opt-out flag for
  air-gapped mirrors). Added to [security-model.md](../01-architecture/security-model.md)'s
  dependency controls, alongside a note that the kaneo snapshot taken at P0 is itself a
  supply-chain input to be scanned and pinned by SHA.

**Why:** "we ship continuously" and "we sell a product" pull apart unless the seams are
written down; a stable channel, a support window and a verifiable image are what a
customer — and a marketplace scanner — actually need from a release process.

**Alternatives:** `0.x` versioning (rejected — makes "TaskDesk v2 runs 0.4" a permanent
explanation); a `next` branch for pre-releases (rejected — the second long-lived branch
[ci-cd.md](../04-engineering/ci-cd.md) refuses to have).

**Decided by:** Thomas

---

### 2026-09-05 · Inbound email is a candidate, not P5 — a contradiction corrected

**Decision:** [intake-queue.md](../03-features/intake-queue.md) said inbound email parsing
was "Stage 5"; [roadmap.md](roadmap.md) and [phases.md](phases.md) list it as a candidate,
not scheduled. Two documents against one — intake-queue.md is corrected. `IQ-1` still
names email as a possible source so the data model does not preclude it.

**Why:** found by the 2026-09-05 cross-document review. Recorded because a stage
assignment stated in one spec and denied in the roadmap is exactly how scope creeps in
unnoticed.

**Decided by:** Thomas

---

### 2026-09-05 · CHANGELOG.md added; release notes formalised alongside the auto-generated log

**Decision:** a `CHANGELOG.md` exists at the repo root from today, in Keep a Changelog
format, with an honest "no code released yet" `[Unreleased]` entry rather than fabricated
history. [CI/CD](../04-engineering/ci-cd.md) gains a **Release notes** section requiring a
short human-written summary at every stage close, alongside the entries
`semantic-release` generates automatically, and ties that moment to updating the
[screen inventory](../02-design/screen-inventory.md) and
[feature index](../03-features/README.md) status columns together, so "what shipped"
answers consistently from all three places.

**Why:** an explicit requirement for changelogs, feature-completion tracking and release
documentation. A generated commit log alone doesn't answer "what can I do now that I
couldn't before"; a separate, disconnected release-notes process drifts from what the
screen inventory and feature index say. Tying the three together at one moment (the stage
close, [SDLC](../04-engineering/sdlc.md) step 8) is cheaper than reconciling them later.

**Decided by:** Thomas

---

### 2026-09-05 · The engine pattern generalises beyond the six plugin kinds; the calendar is allowed to move, the pattern is not

**Decision:** [plugin-architecture.md § the engine pattern](../01-architecture/plugin-architecture.md#the-engine-pattern--making-any-feature-pluggable)
states explicitly that every feature — not only the seven current plugin kinds — is
expected to follow the same shape (contract, registry or settings screen, generated
configuration, a feature flag, a validate/test affordance) before its spec is considered
done. Paired with this: the [accelerated delivery plan](accelerated-delivery-plan.md)'s
calendar is explicitly **not** held under pressure — Thomas: *"we can adjust the
timeline... dates are just a number... no pressure"* — while the engine-pattern
requirement and the security gates are the two things that do not flex regardless of the
calendar.

**Why:** an explicit requirement that "every feature, every release" stays pluginable, and
an equally explicit correction that the aggressive calendar in the accelerated plan should
not be read as license to cut the engine pattern or security to hit a date. Recording both
together because they are the same instruction from two directions: flex the number, not
the architecture.

**Decided by:** Thomas

---

### 2026-09-05 · Model tiers for Claude Code's own subagents; security review is Opus, always

**Decision:** within Claude Code's own orchestration of Task/Agent subagents, the main
session plans and reviews on Opus or Fable; implementation subagents write code and tests
on Sonnet 5. Security review is carved out as its own mandatory checkpoint on Opus, at
every pull request and every stage gate, distinct from the general architecture/QA review
even when the same model performs both. Recorded in
[agent-workflow.md](../04-engineering/agent-workflow.md#model-tiers-within-claude-code) and
referenced from [SDLC](../04-engineering/sdlc.md) steps 5 and the stage gate.

**Why:** an explicit requirement driven by cost and setup overhead — running every
mechanical implementation step on the most expensive model multiplies token spend for
narrowly-scoped, spec-driven work without a proportional quality gain, while the review
and security checkpoints are exactly where a stronger model earns its cost.

**Decided by:** Thomas

---

### 2026-09-05 · Reporting is three tiers, not one report builder

**Decision:** [reports-and-dashboards.md](../03-features/reports-and-dashboards.md) now
names three explicit tiers — fixed reports (the existing fourteen, unchanged), selectable
row-and-column reports (a saved [Table view](../03-features/views.md) configuration,
modelled on MS Planner's grid and Plane's spreadsheet view), and customisable reports (a
small ad-hoc builder — filter, group, aggregate, chart — modelled on Azure DevOps
Analytics and Jira dashboards, but deliberately not a query language). All three persist
through the existing `saved_view` mechanism with a different `layout`; no new storage
engine.

**Why:** an explicit requirement distinguishing three genuinely different reporting needs
that one mechanism serves badly. Reusing `saved_view` and the existing filter grammar
keeps tier 3 to "20% of the concepts, 90% of the value" — the same bar already applied to
the automation rule builder and to rejecting formula custom fields.

**Alternatives:** one fully general report/dashboard builder covering all three needs.
Rejected — this is exactly the shape [risk R8](risks.md) (scope creep) warns about, and a
general builder is where OpenProject and Jira both become, in our own words, "visually
exhausting."

**Decided by:** Thomas

---

### 2026-09-05 · AWS Marketplace is the first external sales channel; metering is an optional plugin

**Decision:** pursue an AWS Marketplace container-product listing as the first externally
sellable channel, alongside the existing self-hosted distribution. Usage metering and
entitlement resolution are built as a new `license` plugin kind
([ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md)), off by default,
so the self-hosted, no-phone-home promise is unaffected for every customer who does not
enable it. This effectively resolves the open "whether to sell externally" question in
[status.md](status.md) in the affirmative, with AWS Marketplace as the named first channel;
Azure and GCP marketplaces are recorded as later candidates on the same mechanism, not
committed now.

**Why:** an explicit product requirement. Packaging and seller-registration work is tracked
in [AWS Marketplace listing](../05-operations/aws-marketplace.md) and lands in P7, since it
needs a stable, feature-complete product to list; the plugin mechanism it depends on is
architecture and is decided now so nothing downstream has to be retrofitted.

**Alternatives:** metering compiled in and toggled by an environment variable. Rejected —
inverts the trust model every other plugin already establishes.

**Superseded the same day by the confirmed decisions of 2026-09-05 (above):** the listing
itself is **deferred beyond the current three-to-four-month scope**; a BYOL / contract
listing is preferred over usage metering when the decision is taken; nothing in P7 builds
it. The `license` plugin kind (ADR 0013) remains the architecture for whenever that is.

**Decided by:** Thomas

---

### 2026-09-05 · One-line installer wraps `scripts/deploy.sh`, does not replace it

**Decision:** add `curl -fsSL https://get.taskdesk.dev | bash` as the recommended install
path, documented in [One-line install](../05-operations/one-line-install.md). It downloads
a checksummed release archive and runs the existing `scripts/deploy.sh`, unchanged. The
manual `git clone` path in [Deployment](../05-operations/deployment.md) remains fully
documented and is exactly what the installer automates — there is one deployment
mechanism, not two.

**Why:** the smallest customer should be able to go from a clean machine to a signed-in
session in one command, without cloning a repository or reading `.env.example` first. The
`--dry-run` flag and the documented "download and read before piping" alternative address
the trust question a hosted `curl | bash` script always raises.

**Alternatives:** a `git clone` requirement for everyone. Rejected as an unnecessary floor
for the smallest, least technical self-hosting customer, who is exactly who this product
must also work for.

**Decided by:** Thomas

---

### 2026-09-05 · Ticket lifecycle engine and terminology are formally separated, both fully renameable

**Decision:** formalise, as [ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md)
and [ADR 0012](../01-architecture/adr/0012-terminology-overlay.md), what `work-items.md`,
`workflows.md` and the data model already implied but never stated outright: there is one
lifecycle engine (states + workflow transitions) for every category of work item, with
only a five-value `group` fixed in code and every state name, transition and workflow graph
fully editable per project and per type through settings; and, separately, a bounded set of
domain nouns ("Ticket", "Project", "Cycle", …) is renameable per instance through a new
terminology overlay, independent of state naming. A `terminology_override` table is added
to the data model; no table is needed for marketplace licensing, which reuses
`instance_plugin_config`.

**Why:** confirms, in writing, that nothing about the ticket lifecycle is hardcoded the way
v1's status enum was — a direct requirement — and separates two things that are easy to
conflate: the *stages* a ticket passes through (ADR 0011) versus the *words* used to name
the concepts (ADR 0012).

**Alternatives:** leave the mechanism implicit across existing feature docs, as before.
Rejected once it became a question someone would reasonably ask "why on earth is it like
this" about — exactly the ADR criterion.

**Decided by:** Thomas

---

### 2026-09-05 · Customer self-service lifecycle reconfirmed; withdrawal added

**Decision:** reconfirm that customers create their own requests and act on their own
lifecycle in the portal — this was already the design in `customer-portal.md` and
`request-types-and-catalogue.md` (raise, comment, escalate, approve what's addressed to
them, reopen, rate), modelled deliberately on Jira Service Management's constrained-but-real
customer authority rather than a read-only view. One genuine gap is closed: a customer may
now **withdraw** their own submission before it is triaged (`CP-15`, `IQ-16a`), which was
previously unstated.

**Why:** an explicit requirement to confirm customers are not limited to viewing. The
design already met this; withdrawal was the one missing everyday action — raising something
in error with no way to retract it — worth adding explicitly rather than leaving customers
to rely on a triager noticing and declining it.

**Alternatives:** let customers delete a submission outright. Rejected — deletion removes
the record a triager needs to understand "why did this disappear", where a `withdrawn`
status preserves it.

**Decided by:** Thomas

---

### 2026-09-05 · Documentation corpus created before any code

**Decision:** write the full `docs/` corpus — architecture, design, features, engineering,
operations, planning — before writing a line of application code.

**Why:** the team is one person and three AI agents. Agents have no memory between
sessions, so the repository *is* the memory. A spec-first process is not overhead here, it
is the mechanism by which three agents produce one coherent codebase. It also forces the
hard decisions — tenancy, RBAC, plugins, SLA — to be made deliberately rather than
discovered during implementation.

**Alternatives:** start coding and document as we go — which is what v1 did, producing
excellent documentation *about* a product nobody wanted to use.

**Decided by:** Thomas

---

### 2026-09-05 · Product name provisionally "TaskDesk"

**Decision:** carry v1's name forward for now, as a placeholder.

**Why:** a name is needed for documentation and configuration. Choosing a real one is a
branding exercise that should not block the build.

**Deadline:** before P7, since branding, domains and the documentation site all assume one.

**Decided by:** Thomas

---

### 2026-09-05 · No dates on the roadmap until P1 closes

**Decision:** the roadmap sequences stages but gives no dates.

**Why:** throughput for one human plus three agents is unknown. Dates now would be fiction,
and fiction that gets planned against is worse than no plan. After P0 and P1 there is
evidence.

**Decided by:** Thomas

**Partly superseded the same day:** the roadmap still carries no dates, but a dated
mapping was requested and lives in [accelerated-delivery-plan.md](accelerated-delivery-plan.md)
as a flexible target (section A of the confirmed decisions); the "until P1 closes" condition
no longer applies. Bookkeeping only.

---

### 2026-09-05 · No arbitrary limits on navigation or form size

**Decision:** reject a cap on sidebar entries or on fields per form. Quality is gated by
progressive disclosure and by "does it look like kaneo?", not by counting.

**Why:** kaneo's shell handles a long navigation well — sections collapse, the project list
scrolls, the command palette makes depth survivable. Feature flags remove what a deployment
does not use. An arbitrary number would force bad grouping and would be gamed rather than
respected.

**Alternatives:** a hard cap, as originally proposed. Rejected as constraining the wrong
thing.

**Decided by:** Thomas

---

### 2026-09-05 · Formula and rollup custom fields deferred

**Decision:** custom fields support fixed formats only. No formulas in v2.

**Why:** a formula field is a small programming language — evaluation order, dependency
graphs, error handling, performance. It is easy to start and very hard to finish, and
OpenProject's implementation needed a dedicated error-logging mechanism, which is
indicative.

**Alternatives:** ship a limited formula subset. Rejected — a limited subset generates
immediate requests to extend it.

**Decided by:** Thomas

---

### 2026-09-05 · Round-robin assignment out of scope

**Decision:** no automatic load-balanced or round-robin assignment.

**Why:** it rewards gaming, it assigns work to people who are unavailable, and it removes
the moment of judgement where someone looks at a queue and decides. A default assignee per
project and per request type covers the real need.

**Decided by:** Thomas

---

### 2026-09-05 · Multi-currency conversion out of scope

**Decision:** store currency per row; group by currency in reports; never convert.

**Why:** conversion requires an exchange rate source, a policy on which date's rate applies,
and historical rate storage. Reporting in two currencies separately is honest; reporting a
converted total computed with an unstated rate is not.

**Decided by:** Thomas

---

### 2026-09-05 · Postgres full-text before any search engine

**Decision:** ship with Postgres full-text search. A Meilisearch plugin exists as an option
but is not enabled.

**Why:** one fewer service, one fewer thing to back up, one fewer thing to be inconsistent
with the database. Postgres full-text with a weighted GIN index is genuinely good at our
scale. Adding a search engine is a decision to be made with a measurement, not in advance.

**Decided by:** Thomas

---

### 2026-09-05 · No row-level security in Postgres

**Decision:** tenant isolation is enforced in the application, through scoped repositories
and the policy layer, not through Postgres RLS.

**Why:** RLS moves policy away from the code that gets reviewed, complicates connection
pooling, and cannot express reach-versus-authority. What we do instead is make the omission
detectable — the route coverage test, the permission matrix and the tenant isolation suite.

**Alternatives:** RLS as defence in depth. Not rejected forever; revisit if a customer
requires it for compliance.

**Decided by:** Thomas

**Superseded 2026-09-06 (above):** RLS is promoted to a **P0 prototype** on
`work_item`, `comment` and `attachment` as a backstop. The reasoning here still holds for
why it is not the *primary* control; what changed is that "revisit if a customer requires
it" became "find out now, while the schema is three tables old".

---

### 2026-09-05 · Collaborative editing deferred past P5

**Decision:** no Hocuspocus or CRDT editing in v2. Concurrent description edits use
optimistic concurrency with a clear conflict affordance.

**Why:** it is a whole subsystem — a second server process, Y.js documents, awareness state,
persistence, conflict resolution. Plane runs it, and it is genuinely nice. We have no
evidence that people co-edit ticket descriptions.

**Decided by:** Thomas

---

### 2026-09-05 · kaneo's `public-project` is deleted at fork, not feature-flagged

**Decision:** the anonymous public-board router and screens are removed in P0 step 1. The
flag name `feature.public_boards` is reserved with no code behind it.

**Why:** the security review's point is right — a flag is a runtime toggle, not a deletion,
and an unauthenticated read surface should not ship dormant inside a product whose whole
thesis is that authorization omissions must be mechanically impossible. If public boards
are wanted later they get a spec and their own security review first.

**Decided by:** Thomas — confirmed in the 2026-09-05 decision document, section C: delete
the routes, handlers, screens, access paths and any dormant code; no feature flag; a future
version needs a dedicated spec, separate public routes and a security review first.

---

### 2026-09-05 · Reach-affecting project fields are `project:manage_members`

**Decision:** `project.parent_id` and `project.owner_team_id` move off `PATCH
/api/projects/{id}` onto `PATCH /api/projects/{id}/ownership`, governed by
`project:manage_members`, audited as `project.reach_changed`.

**Why:** both grant reach to people without any role changing; as `project:update` fields
they were a silent reach grant available to a `lead`. Separate route so "one policy per
route" stays true.

**Decided by:** Thomas — confirmed in the 2026-09-05 decision document (drafted by Claude Code at the security checkpoint)

---

### 2026-09-05 · Service API keys are bounded by their creator

**Decision:** a workspace service key's capability subset cannot exceed the creator's
authority at creation (expanded closure), creating one is elevated, and the granted set is
audited. On use the key is evaluated against its own stored subset.

**Why:** the previous wording made `api_key:manage` an escalation primitive — a durable
credential above its creator's authority, outliving their membership.

**Decided by:** Thomas — confirmed in the 2026-09-05 decision document (drafted by Claude Code at the security checkpoint)

---

### 2026-09-05 · MCP destructive tools need out-of-band human approval

**Decision:** `confirm: true` is replaced by a `pending_action_id` the key's owner approves
in the UI; `is_mcp` keys are read-only by default; tool output is marked untrusted.

**Why:** the model supplying `confirm` is the component under a prompt-injection attacker's
influence. The MCP server reads customer-authored text with staff authority; this is the
primary threat on that surface, not an edge case.

**Decided by:** Thomas — confirmed in the 2026-09-05 decision document (drafted by Claude Code at the security checkpoint)

---

### 2026-09-05 · `TASKDESK_TRUST_PROXY` is a hop count; the app port is never published

**Decision:** the variable is an integer number of trusted proxy hops (default `1`), not a
boolean; production compose publishes no port on the application; the installer refuses
to proceed if 5173 is bound on the host.

**Why:** trusting the proxy unconditionally while the port is reachable makes the client
IP attacker-controlled, defeating the auth rate limit, the API-key IP allowlist and the
audit log's `actor_ip`.

**Decided by:** Thomas — confirmed in the 2026-09-05 decision document (drafted by Claude Code at the security checkpoint)

---

### 2026-09-05 · Internal red-team pass at the go-live gate

**Decision:** an independent Opus context runs a red-team pass over the authorization
surface, the portal boundary and the inherited kaneo routes before real customer data
lands — in addition to, not instead of, the external penetration test (R19).

**Why:** the corpus's own thesis: a green suite proves only what someone thought to check.

**Decided by:** Thomas — confirmed in the 2026-09-05 decision document (drafted by Claude Code at the security checkpoint)

---

## Waivers

Gate waivers, recorded per [UX quality gates](../02-design/ux-quality-gates.md).

### 2026-09-05 · Gate activities consolidated before `2.0.0` — recorded as a waiver, pending confirmation
**Gate:** the per-stage manual accessibility pass, fresh-eyes test, four-browser check and k6 baseline ([sdlc.md](../04-engineering/sdlc.md) stage gate)
**Reason:** [release-plan.md](release-plan.md) runs these four **once, before `2.0.0`**, over the whole surface instead of once per stage. That is a gate waiver granted by a planning document; the waiver procedure ([ux-quality-gates.md](../02-design/ux-quality-gates.md)) was not followed when it was written, so it is recorded here to be visible
**Follow-up:** confirm or revert — if confirmed, the stage-gate list in [definition-of-done.md](../04-engineering/definition-of-done.md) says so; if reverted, release-plan.md is corrected
**Approved by:** *pending — Thomas*

```markdown
### YYYY-MM-DD · Waived <gate> in PR #n
**Gate:** G-n
**Reason:**
**Follow-up:** issue #n
**Approved by:** Thomas
```

## Related

- [ADR index](../01-architecture/adr/README.md) · [Risks](risks.md) · [Status](status.md)
