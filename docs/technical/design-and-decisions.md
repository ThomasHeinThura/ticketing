# Design and retained decisions

Product decisions and their rationale, original Kaneo design/token/motion contracts, glossary, query ownership and safe schema migration. “Accepted” is the source ADR decision status, not source approval, implementation verification, a passed review or Thomas's acceptance of a phase. ADR 0015 is **proposed with implementation authorized, approval not granted**. Current [AGENTS](../../AGENTS.md), [alignment](../alignment.md) and explicit [integration contracts](../contracts.md) take precedence; this reference restores no historical agent delegation, model assignment or review ceremony.

- [Decision index](#README-index) · [Membership provenance and atomic cutover](#0015-membership-grant-provenance)
- [Original design system](#design-system) · [Exact tokens](#design-tokens) · [Motion and DnD](#motion)
- [Product glossary](#glossary) · [Query ownership](#coding-standards-query-ownership-issue-580) · [Migrations](#migrations)
- [Licensing/source boundary](#licensing-and-attribution) · [Risks and owner decisions](#risks)
- [Precedence and source conflicts](#decision-provenance)

<a id="0001-kaneo-as-foundation"></a>
## 0001 — kaneo as the foundation, taken once, not forked

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0001-kaneo-as-foundation-context"></a>
### Context

TaskDesk v1 was feature-rich and unusable. Its failure was not missing capability; it was
that every UI primitive was hand-written, producing an inconsistent, dense, amateurish
interface that people avoided. Multiple AI-assisted redesign attempts improved details
without fixing the underlying absence of a design system.

We evaluated [kaneo](https://github.com/usekaneo/kaneo) and found an application whose
UI/UX is exactly the standard we want, built on a stack we would have chosen anyway:
Hono, Drizzle, PostgreSQL, better-auth, React 19, TanStack Router and Query, Tailwind v4,
63 primitives, predominantly Base UI (43 of the 63 import `@base-ui/react`; exactly one
imports Radix), dnd-kit, Tiptap, Framer Motion — plus motion design specifications.

kaneo is **MIT licensed**, so we may use its code without restriction beyond attribution.

The question was how to relate to it.

<a id="0001-kaneo-as-foundation-decision"></a>
### Decision

**Take kaneo's code once, as the foundation of a new repository, and then own it
outright. Do not maintain a fork. Do not track upstream.**

Specifically:

- `Ticketing.v2` starts as a copy of kaneo's monorepo structure, API, web application,
  design system, Dockerfile, Helm chart, i18n and tooling configuration.
- **The snapshot is one commit, recorded once** — the SHA, why that commit, the upstream CI
  run it passed and the verification done before the copy live in
  [inherited-features.md](architecture-and-experience.md#inherited-features), not here; this ADR does not name a
  commit, so it cannot go stale against one.
- We immediately de-brand, remove what we do not want (billing, seats, trials, cloud
  abuse mitigations as always-on), and restructure what we need to change (tenancy, RBAC,
  service desk domain).
- kaneo's MIT copyright notice is retained in `THIRD-PARTY-NOTICES.md`, in `NOTICE`, and
  in the headers of files taken verbatim.
- Future kaneo releases are read for ideas and cherry-picked **manually** if genuinely
  valuable. There is no merge relationship.

<a id="0001-kaneo-as-foundation-consequences"></a>
### Consequences

<a id="0001-kaneo-as-foundation-positive"></a>
#### Positive

- We start with a finished design system rather than trying to grow one. This directly
  addresses v1's cause of death.
- We start with a working, coherent codebase: auth, realtime, boards, drag and drop,
  command palette, settings shell, i18n, Docker, Helm.
- Our roadmap is entirely our own. We can restructure the data model for organisations,
  SLAs, approvals and reach/authority RBAC without fighting anyone's upstream.
- One language, one stack, one mental model.
- No merge conflicts, ever.

<a id="0001-kaneo-as-foundation-negative"></a>
#### Negative

- **We do not get upstream bug fixes or features for free.** If kaneo fixes a bug in a
  component we took, we will not know unless we look. Mitigation: a quarterly review of
  kaneo's changelog, with anything relevant cherry-picked deliberately.
- **We inherit kaneo's existing bugs and design debt** without its maintainers' context.
- **We must genuinely understand the code we took.** Copying code you do not understand
  is how you get a codebase nobody can change. Stage 0 includes a deliberate
  read-and-strip pass, not just a `cp -r`.
- Attribution obligations persist forever and must survive refactoring.

<a id="0001-kaneo-as-foundation-neutral"></a>
#### Neutral

- We are free to contribute fixes back to kaneo, and should where it is easy — but we owe
  nothing.
- The relationship is one of inspiration and provenance, not dependency.

<a id="0001-kaneo-as-foundation-alternatives-considered"></a>
### Alternatives considered

**Fork kaneo and track upstream.** Rejected. Every upstream release becomes a merge
against our service-desk additions, forever. Our roadmap becomes coupled to theirs. And
the changes we need — organisations as a tenant boundary, reach/authority RBAC, SLA and
approval domains — diverge so far from kaneo's model that "fork" would quickly become a
fiction while still costing merge pain.

**Use kaneo as an upstream dependency (npm packages).** Rejected. kaneo does not publish
its application as consumable packages, and even if it did, we need to change the data
model, not extend it.

**Extract only the design system and write the rest.** Rejected as unnecessarily
expensive. kaneo's API architecture, auth setup, realtime layer and build tooling are
good and would take months to reproduce at the same quality.

**Continue v1 and redesign the frontend again.** Rejected. Two redesign attempts had
already failed. The problem is structural — no design system, and a three-language,
three-service backend that makes every change expensive. Replacing the frontend alone
leaves the second problem.

**Start entirely from scratch.** Rejected. That was effectively v1's approach, and it
produced a hand-rolled UI. Starting from a finished design system is the whole point.

<a id="0001-kaneo-as-foundation-related"></a>
### Related

- [Licensing and attribution](retained-constraints.md#licensing-and-attribution)
- [ADR 0008 — single design system](#0008-single-design-system)
- [Stages](../roadmap.md)

<a id="0002-single-backend"></a>
## 0002 — One backend, not three

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0002-single-backend-context"></a>
### Context

TaskDesk v1 ran three backend services:

| Service | Language | Role |
| --- | --- | --- |
| `core-api` | .NET 10 / ASP.NET Core | System of record, all persistence, domain rules |
| `bff` | Node 20 / Express | Session handling, view aggregation, WebSocket gateway |
| `worker` | Go 1.26 | SLA scanning, snapshot computation, Valkey pub/sub |

Its own ADR 0001 argued for keeping them. In practice the split cost:

- **Three languages** — three dependency ecosystems, three build pipelines, three sets of
  idioms, three places a contributor must be competent.
- **Service-to-service authentication** between BFF and core-api, using a gateway service
  account with a `x-user-email` header trusted only for that client. This is a bespoke
  security mechanism that had to be designed, documented and defended.
- **Duplicated types** across the boundary, kept in sync by hand.
- **A BFF that did almost nothing** except hold secrets and reshape responses.
- **A worker that polled its own API** rather than reading the database, because it was in
  a different language.

Meanwhile kaneo's single Hono API already contains `croner` for scheduling and a
`job_lease` table for distributed locking — the exact capability the Go worker provided.

<a id="0002-single-backend-decision"></a>
### Decision

**One backend: `apps/api`, Hono on Node, TypeScript.**

- The BFF role is absorbed. Hono *is* the backend-for-frontend: it owns the session,
  queries the database directly, and shapes responses for the UI.
- The worker role is absorbed. Background work runs in-process, scheduled by `croner`,
  made replica-safe by the `job_lease` table. See [ADR 0007](#0007-in-process-jobs).
- v1's .NET domain logic — the SLA engine, workflow engine, approvals, assignment rules,
  service calendars — is **reimplemented** in TypeScript in `packages/domain` as pure,
  I/O-free functions.

Supporting services remain separate processes because they are off-the-shelf: PostgreSQL,
Valkey, SeaweedFS, Traefik, and optionally Keycloak.

<a id="0002-single-backend-consequences"></a>
### Consequences

<a id="0002-single-backend-positive"></a>
#### Positive

- **One language end to end.** Types flow from the Drizzle schema through Zod schemas to
  the Hono client to React, and a server change breaks the client build.
- **No service-to-service authentication to design.** The trust boundary is the browser,
  not an internal hop.
- **One deployment artefact.** One image, one version, one rollback.
- **The domain layer becomes testable.** Pure functions with no I/O can be exhaustively
  unit-tested, which matters because they encode the rules the business cares about.
- **Debugging is a single stack trace**, not a correlation exercise across three log
  streams.
- Far lower barrier for a small team and AI agents to work productively.

<a id="0002-single-backend-negative"></a>
#### Negative

- **The event loop is shared between requests and jobs.** A badly written job can add
  latency to requests. Mitigated by chunking, yielding between batches, and pushing
  aggregation into SQL — but it is a real constraint that a separate worker would not
  have.
- **No language-level isolation.** A memory leak or crash in job code takes the API with
  it. Mitigated by process supervision and by the fact that a crash releases job leases
  within one TTL.
- **We lose .NET's strengths** for CPU-bound work. None of our workload is CPU-bound;
  it is database-bound. If that changes we will have evidence rather than speculation.
- **Rewriting v1's domain logic costs real time** and risks reintroducing bugs v1 already
  fixed. Mitigated by reading v1's tests as a specification and porting them first.

<a id="0002-single-backend-neutral"></a>
#### Neutral

- Horizontal scaling is by running more replicas of the same image. Job leasing and
  Valkey-backed WebSocket fan-out already support this.
- If a workload later genuinely needs isolation, extracting a worker from a well-factored
  `jobs/` directory is a contained change. We are not painting ourselves into a corner,
  we are declining to pay for a room we do not use.

<a id="0002-single-backend-alternatives-considered"></a>
### Alternatives considered

**Keep the .NET core-api, put Hono in front.** Rejected. It preserves the worst part —
two languages and a service boundary with bespoke auth — while adding a third stack.

**Keep the Go worker only.** Rejected. Its entire function is covered by `croner` plus
`job_lease`, and keeping it means keeping a second language and a second deployment for
maybe 800 lines of scheduling code.

**Move to a serverless/function architecture.** Rejected. We deploy on customer
infrastructure and on-premises; a single container behind Traefik is the requirement.

**Modular monolith with enforced package boundaries.** Accepted, in fact — that is
precisely what this is. `packages/domain`, `packages/permissions` and the API feature
folders are enforced module boundaries inside one process. We get the discipline of
services without the distribution.

<a id="0002-single-backend-related"></a>
### Related

- [Architecture overview](architecture-and-experience.md#overview)
- [ADR 0007 — in-process jobs](#0007-in-process-jobs)
- [ADR 0009 — lazy SLA evaluation](#0009-lazy-sla-evaluation)

<a id="0003-better-auth-primary"></a>
## 0003 — better-auth primary, identity providers as runtime plugins

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0003-better-auth-primary-context"></a>
### Context

TaskDesk v1 used two identity providers, wired in at deploy time: Microsoft Entra ID for
staff and Keycloak for customers. Both were configured through environment variables and
a generated Keycloak realm file. Consequences:

- Standing up an environment required minting Keycloak clients first — documented as one
  of the two "deploy traps" in v1's handover notes.
- Changing an identity provider meant editing environment variables and redeploying.
- Keycloak was a **hard dependency**: nothing worked without it, even for a small
  deployment that wanted email and password.

For v2 there is an additional, commercial requirement: **the same image must be sellable
to customers with different identity landscapes**. Customer A uses Entra. Customer B runs
Keycloak. Customer C wants nothing but email OTP. None of them may need a different build.

kaneo already uses [better-auth](https://better-auth.com), which provides sessions,
organisations, MFA, magic links, email OTP, passkeys, API keys, impersonation and a
`genericOAuth` plugin for arbitrary OIDC — all TypeScript-native with a Drizzle adapter.

<a id="0003-better-auth-primary-decision"></a>
### Decision

**better-auth is the primary authentication layer. Every identity provider is a runtime
plugin, configured in God Mode, stored in the database.**

- The product works **out of the box with zero configuration** using email and password,
  plus optional TOTP.
- Any number of OIDC providers can be added at runtime through the UI. Entra and Keycloak
  are **presets** over the generic OIDC plugin — pre-filled endpoint patterns and
  friendlier field labels — not special code paths.
- Each provider instance carries a `portal_scope`, so "Entra for staff, email OTP for
  customers" is a UI choice, not an architecture. An **OIDC identity connection** is scoped
  `agent` **or** `customer` — never `both`, because a customer connection is bound to one
  organisation and an agent connection to none, and one row cannot be both. Only the
  **non-OIDC** auth plugins — password, email OTP, magic link — may be scoped `both`
  ([plugin-architecture.md](architecture-and-experience.md#plugin-architecture),
  [identity-provisioning.md](feature-contracts-p3.md#identity-provisioning) `IP-1`,
  [data-model.md](data-model.md) §2, where `identity_connection.portal_scope` carries a
  `CHECK`).
- Each provider carries just-in-time provisioning rules: which side, which organisation,
  which role a first-time user receives, and optional group-claim to role mapping.
- Every provider has a **Test connection** action that performs a real discovery and token
  exchange dry-run before it goes live.
- **Keycloak is not a dependency.** It is one option among many.

Critically, **authentication is separated from identity resolution**. Once better-auth
establishes a `userId`, everything about what that person may see and do is resolved from
the database on every request. Token claims never carry authority.

<a id="0003-better-auth-primary-consequences"></a>
### Consequences

<a id="0003-better-auth-primary-positive"></a>
#### Positive

- **Zero-configuration first run.** `docker compose up`, sign in, configure the rest in
  the UI. v1 required Keycloak to be working before anything else could be.
- **One image, any customer.** The commercial requirement is met structurally.
- **Adding a provider is a plugin file**, and God Mode renders its settings form from its
  Zod schema automatically. No bespoke admin UI per provider.
- **Keycloak becomes optional**, removing a heavyweight JVM service (2.5 GB of the 11 GB
  v1 production budget) from deployments that do not need it.
- Revocation is immediate, because authority is resolved from the database, not a token.
- MFA, magic links, passkeys and API keys come with the library rather than being built.

<a id="0003-better-auth-primary-negative"></a>
#### Negative

- **better-auth is a younger project than Keycloak.** We are dependent on a smaller
  ecosystem for a security-critical component. Mitigated by: it is open source and in our
  stack, so we can read and patch it; and by keeping the OIDC surface generic so
  migrating away is a plugin swap, not a rewrite.
- **Runtime provider reconfiguration is genuinely fiddly.** better-auth is configured at
  construction, so we must rebuild the auth instance when configuration changes and swap
  it behind a stable reference, with a Valkey message to trigger the rebuild on every
  replica. This is the most delicate code in the auth layer and needs careful tests.
- **SAML is not covered** by better-auth today. Enterprises that require SAML rather than
  OIDC are unserved until we add a SAML plugin (Stage 5) or point them at Keycloak as an
  OIDC-fronting broker — which, pleasingly, the plugin model already supports.
- **A misconfigured provider can lock everyone out.** Mitigated by: `auth.password` cannot
  be removed; the Test action; and a documented CLI break-glass.

<a id="0003-better-auth-primary-neutral"></a>
#### Neutral

- Keycloak remains fully supported and is still the right answer for deployments that
  need LDAP federation, SAML brokering or complex identity flows. It is simply no longer
  compulsory.
- Entra ID is configured as an OIDC provider like any other, which is all it ever needed
  to be.

<a id="0003-better-auth-primary-alternatives-considered"></a>
### Alternatives considered

**Keycloak as the sole IdP, as in v1.** Rejected. It makes a heavyweight service
mandatory for every deployment, it cannot be configured from our UI, and it makes the
zero-configuration first run impossible.

**Environment-variable configuration of providers, as in v1.** Rejected. It forces a
redeploy for a settings change and makes the "sell the same image" requirement
impossible.

**Auth.js / NextAuth.** Rejected. Weaker organisation, MFA and API-key stories, and it is
oriented around Next.js, which the application is not.

**Build our own OIDC layer.** Rejected. Authentication is exactly the wrong place to be
original.

**Keycloak for customers, better-auth for staff — permanently split.** Rejected as an
*architecture*, though it remains perfectly configurable as a *deployment choice*. That is
the point: it should be a setting, not a design.

<a id="0003-better-auth-primary-amendments"></a>
### Amendments

**2026-09-06 — `both` is not available to an OIDC connection.** As first accepted, the
decision bullet above offered every provider instance a `portal_scope` of "`agent`,
`customer` or `both`". Four documents already said the opposite for OIDC connections
specifically, and `identity_connection.portal_scope` carries a `CHECK` that refuses `both`.
The bullet is corrected rather than the rule: an OIDC connection is `agent` or `customer`;
only non-OIDC auth plugins may be `both`. Nothing else in this ADR changes. `IP-1` cites
this ADR and [plugin-architecture.md](architecture-and-experience.md#plugin-architecture) as its source — not
[ADR 0004](#0004-two-portals-two-origins), which never stated the rule.

<a id="0003-better-auth-primary-related"></a>
### Related

- [Auth and identity](safety-and-runtime.md#auth-and-identity)
- [Plugin architecture](architecture-and-experience.md#plugin-architecture)
- [ADR 0006 — plugin registry](#0006-plugin-registry)

<a id="0004-two-portals-two-origins"></a>
## 0004 — Two portals, two origins, one codebase

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0004-two-portals-two-origins-context"></a>
### Context

v1's ADR 0004 was described as its "load-bearing decision": two hostnames, two identity
providers, two independently built bundles, with **no shared chunks**, so that no staff
code ever reached a customer browser.

The intent was sound. The execution had a hidden cost and a hidden false confidence.

**The cost:** two entry points into one source tree with no shared component library
meant the agent UI and the portal UI drifted. The portal was eventually described in v1's
own documentation as "a shell, not a working product" showing fixture data, and had to be
rebuilt from scratch.

**The false confidence:** all eleven authorization holes v1 discovered were **server-side
handler bugs**. Bundle separation prevented none of them. Worse, it encouraged reasoning
of the form "that's fine, that screen isn't in the customer bundle" — which is not a
security argument, because a browser bundle is not a security boundary. The server is.

So the question for v2 was: keep the split, drop it, or keep part of it.

<a id="0004-two-portals-two-origins-decision"></a>
### Decision

**Keep two origins and two sessions. Keep two bundles. Share one source tree and one
design system.**

- `ticket.<domain>` serves the agent bundle. `portal.<domain>` serves the customer bundle.
- Separate cookies scoped to each host, so an agent session and a customer session can
  never be confused. **The mechanism is two better-auth instances, one per portal origin.**
  better-auth derives cookie names, `baseURL` and `trustedOrigins` from *construction-time*
  configuration, never from the incoming request, so one instance cannot issue a differently
  named cookie per host. The auth holder therefore constructs a **pair** on every reload —
  each instance with its own `baseURL` (that portal's origin), its own cookie name
  (`__Host-tdk_agent_session` on `ticket.<domain>`, `__Host-tdk_portal_session` on
  `portal.<domain>`), its own `trustedOrigins` holding **that origin only**, and its own
  provider set (the connections scoped to that portal). **The request host selects the
  instance**; the two are built, validated and swapped together. kaneo's `COOKIE_DOMAIN`
  variable and its cross-subdomain `SameSite=None; Partitioned` cookie branch are **removed
  at the fork** — both are incompatible with a `__Host-` name prefix, and each portal's API
  is served on that portal's own origin, which `/api/portal/*` below already implies
  ([auth-and-identity.md § Sessions](safety-and-runtime.md#auth-and-identity-sessions),
  [auth-runtime-reconfiguration.md](safety-and-runtime.md#auth-runtime-reconfiguration)).
- The portal boundary is enforced **at the identity-provider callback** (a customer
  completing a login on the agent origin gets no session and an audit row) **and on every
  request** (session portal must match request host).
- One `apps/web` source tree with two Vite entries, `entry.agent.tsx` and
  `entry.portal.tsx`, mounting `routes/agent/*` and `routes/portal/*` respectively.
- **Both import the same `packages/ui`.** Primitives are shared; screens are not.
- A build-time check asserts that no module under `routes/agent/` or
  `components/god-mode/` appears in the portal bundle's module graph.
- The API exposes a deliberately narrow, separately reviewed `/api/portal/*` router rather
  than reusing agent handlers with a role check.

And, stated explicitly in the codebase and in review:

> **The bundle split is an information-disclosure control, not a security boundary.
> The security boundary is server-side policy.**

<a id="0004-two-portals-two-origins-consequences"></a>
### Consequences

<a id="0004-two-portals-two-origins-positive"></a>
#### Positive

- Internal route names, admin labels, staff-only feature names and God Mode strings never
  ship to a customer browser. That is a real, if modest, reduction in disclosure.
- Customers download a much smaller application.
- Separate origins give separate cookie scopes, separate CSP, and separate identity
  provider bindings — the last of which is a genuine enterprise requirement.
- Sharing `packages/ui` means the portal cannot drift into a second-class interface, which
  is exactly what happened in v1.
- The narrow `/api/portal/*` router is small enough to review in one sitting.

<a id="0004-two-portals-two-origins-negative"></a>
#### Negative

- **Two builds, two deployment paths, two TLS certificates, two DNS records.** More
  operational surface than a single origin.
- **Local development needs two hostnames**, which means `/etc/hosts` entries or a
  wildcard DNS trick. Mitigated by shipping a `deploy/local` Traefik configuration and a
  documented one-line setup.
- **Cross-portal links are awkward.** A staff member following a link to a customer view
  crosses an origin and needs a separate session. Accepted — it is rare and it is
  arguably correct.
- Some duplication remains in layout shells and navigation, since the two applications
  genuinely have different information architectures.

<a id="0004-two-portals-two-origins-neutral"></a>
#### Neutral

- If we ever wanted to collapse to one origin, the shared `packages/ui` and shared source
  tree make it a routing change rather than a rewrite. The decision is reversible in a way
  v1's was not.

<a id="0004-two-portals-two-origins-alternatives-considered"></a>
### Alternatives considered

**One origin, role-based routing, portal as a route group** — kaneo's shape. Rejected.
It gives up per-portal identity provider binding, ships the entire agent application to
every customer, and makes an accidental leak of an internal string much more likely. The
cost of two origins is real but bounded; the benefit is permanent.

**Two origins and two entirely separate applications** — v1's shape. Rejected. This is
precisely what produced v1's abandoned portal. Two codebases means one of them is always
the neglected one.

**Same origin, path prefix (`/portal`).** Rejected. Cookies cannot be separated by path in
any way that is a security control, so the two sessions would share a scope. It gets the
operational simplicity without the property that motivated the split.

**Single origin with a server-rendered portal.** Rejected. It introduces SSR, a second
rendering model, for no benefit we need.

<a id="0004-two-portals-two-origins-server-side-security-assertion"></a>
### Server-side security assertion

If you find yourself writing "this is safe because it isn't in the customer bundle" in a
review comment, that reasoning is invalid. Ask instead: what does the server do when a
customer session calls this route directly? If the answer is not "the policy middleware
denies it", the code is wrong.

<a id="0004-two-portals-two-origins-amendments"></a>
### Amendments

**2026-09-06 — the cookie mechanism is named.** As first accepted this ADR said "separate
cookies scoped to each host" without saying how one auth library produces two differently
named cookies; the earlier architecture review had already flagged that this is not a
configuration setting. The decision bullet above now names it: two better-auth instances,
one per portal origin, selected by request host, with per-instance `baseURL`, cookie name,
`trustedOrigins` and provider set, and `COOKIE_DOMAIN` removed at the fork. The alternative
— a single instance behind a request-scoped wrapper that rewrites `Set-Cookie` and `Cookie`
names — is recorded in [decision-log.md](retained-constraints.md#decision-log) as the one-line
reversal. Nothing else in this ADR changes.

<a id="0004-two-portals-two-origins-related"></a>
### Related

- [Security model](safety-and-runtime.md#security-model) · [Auth and identity](safety-and-runtime.md#auth-and-identity)
- [Customer portal](feature-contracts-p3.md#customer-portal)

<a id="0005-agpl-licensing"></a>
## 0005 — AGPL-3.0

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0005-agpl-licensing-context"></a>
### Context

TaskDesk v2 is built on kaneo (MIT) and draws design inspiration from Plane (AGPL-3.0)
and OpenProject (GPL-3.0). We need a licence that:

1. Permits building on kaneo.
2. Permits reusing Plane or OpenProject code should we ever choose to.
3. Allows the product to be sold and hosted for customers.
4. Reflects the intent that this is an open project, not a closed one.

MIT would permit everything except (2). A proprietary licence would permit (3) most
freely but forecloses (2) permanently and contradicts (4).

<a id="0005-agpl-licensing-decision"></a>
### Decision

**TaskDesk v2 is licensed under AGPL-3.0.**

- kaneo's MIT code is compatible: MIT may be incorporated into an AGPL work, with the MIT
  notice retained. We retain it in `THIRD-PARTY-NOTICES.md`, in `NOTICE` inside the image,
  and in the headers of files taken verbatim.
- Plane (AGPL-3.0) and OpenProject (GPL-3.0) code may be incorporated. We choose, for
  engineering reasons rather than legal ones, to take ideas rather than code from both.
  See [Licensing and attribution](retained-constraints.md#licensing-and-attribution).

<a id="0005-agpl-licensing-consequences"></a>
### Consequences

<a id="0005-agpl-licensing-positive"></a>
#### Positive

- Maximum freedom to draw on the open-source ecosystem in this space, which is almost
  entirely (A)GPL.
- Aligns with the projects that inspired us; contributing back is frictionless.
- Prevents a third party taking our work, hosting it as a service, and giving nothing
  back — the specific scenario AGPL exists to address.
- Selling and hosting remain permitted. AGPL restricts withholding source, not charging
  money.

<a id="0005-agpl-licensing-negative"></a>
#### Negative

- **Network copyleft applies to the hosted product.** Users who interact with our hosted
  instance over a network — including customers using the portal — are entitled to the
  corresponding source. In practice this means publishing the source of what we deploy,
  including our modifications.
- **Some enterprise customers refuse AGPL software outright**, on policy grounds, without
  analysis. This is a real commercial constraint and it will cost us deals.
- **A proprietary edition is foreclosed** unless we either dual-licence — which requires a
  Contributor Licence Agreement from every contributor **from the first external
  contribution onward** — or perform a clean-room rewrite.
- Any dependency we link must be AGPL-compatible. Notably, this excludes some commercial
  component libraries and some database drivers.

<a id="0005-agpl-licensing-neutral"></a>
#### Neutral

- Internal use within the company triggers no obligation beyond making source available to
  those users, who are colleagues.
- Our own customers hosting their own instance receive the source, which they are entitled
  to modify. That is intended.

<a id="0005-agpl-licensing-the-decision-this-forces-soon"></a>
### The decision this forces, soon

**If a proprietary or dual-licensed edition is ever wanted, a CLA must be in place before
the first external contribution is merged.** Retro-fitting one requires tracking down every
contributor and obtaining agreement, which in practice means rewriting their work.

This is recorded as an open risk in [risks.md](retained-constraints.md#risks) with a decision
deadline of "before the repository accepts its first external pull request".

<a id="0005-agpl-licensing-alternatives-considered"></a>
### Alternatives considered

**MIT / Apache-2.0.** Rejected. Permits a competitor to take the work, host it and
contribute nothing. Also forecloses reusing Plane or OpenProject code, since permissive
licences cannot absorb copyleft.

**GPL-3.0.** Rejected. Copyleft triggers on distribution, not on network use — so a
competitor could host a modified TaskDesk as a service and never publish. For a
server-side product, AGPL is the version of GPL that actually does the job.

**Proprietary / source-available (BSL, Elastic Licence).** Rejected. Forecloses reuse of
the ecosystem we are drawing on, and contradicts the intent of the project. Worth
revisiting only if the commercial model changes materially — and it would require the
clean-room work described above.

**Dual licence (AGPL + commercial) from day one.** Not rejected, but deferred. It is the
strongest commercial position and it is compatible with this decision, provided a CLA is
adopted before external contributions begin. Flagged as the decision to make.

<a id="0005-agpl-licensing-related"></a>
### Related

- [Licensing and attribution](retained-constraints.md#licensing-and-attribution)
- [Risks](retained-constraints.md#risks)

<a id="0006-plugin-registry"></a>
## 0006 — Runtime plugin registry over build-time configuration

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0006-plugin-registry-context"></a>
### Context

Two requirements collide.

**Operational:** v1 configured everything through environment variables and generated
files. Changing an SMTP server or an identity provider meant editing `.env` and
redeploying. Standing up a new environment required minting Keycloak clients first — one
of the two documented "deploy traps".

**Commercial:** the same container image must be sellable to any customer. Customer A uses
Entra; B runs Keycloak; C wants email OTP only; D stores files in Azure Blob; E wants
Slack notifications; F wants none. If any of that requires a different build, a different
image tag or a `docker-compose` edit, the product does not scale commercially.

The naive answers — an environment variable per option, or a customer-specific branch —
both fail. The first produces an unmanageable configuration surface and still requires a
restart. The second produces N codebases.

<a id="0006-plugin-registry-decision"></a>
### Decision

**Anything that varies between deployments is a runtime plugin, configured in God Mode,
stored in the database.**

- `packages/plugins-contracts` defines interfaces only: `AuthProvider`, `StorageBackend`,
  `NotificationChannel`, `Importer`, `SearchBackend`, `AiProvider`.
- Implementations ship inside the image and register themselves into a per-kind registry
  at boot.
- Which implementations are **active**, and with what settings, comes from
  `instance_plugin_config` rows. Secrets in that table are encrypted at rest with
  AES-256-GCM and never returned by the API.
- Each plugin declares a **Zod configuration schema**. God Mode renders its settings form
  from that schema, so adding a plugin adds its administration UI automatically.
- Each plugin implements `validate()` and, where meaningful, `test()` — so an
  administrator can prove a configuration works before relying on it.
- A parallel, simpler axis — **feature flags** at instance, workspace and project level —
  switches whole features off so the interface stays small.

Environment variables are reduced to **bootstrap only**: database URL, encryption key,
auth secret, public origins, port, optional Valkey URL, and a first-run admin email.

The rule, stated for reviewers: *if you are writing `if (customer === …)` or
`process.env.SOMETHING_CUSTOMER_SPECIFIC`, stop and add a registry entry.*

<a id="0006-plugin-registry-consequences"></a>
### Consequences

<a id="0006-plugin-registry-positive"></a>
#### Positive

- **One image, any customer.** The commercial requirement is met structurally rather than
  by discipline.
- **Configuration changes need no redeploy.** An administrator changes SMTP at 09:00 and
  it is live at 09:00.
- **Zero-configuration first run.** The product boots with sensible built-in defaults —
  password auth, filesystem or S3 storage, no notification channels — and everything else
  is configured through the UI.
- **God Mode UI is largely generated**, so plugin authors write a schema, not a form.
- **Test buttons** turn "save and hope" into "save and verify", which is the difference
  between a good administration experience and a support ticket.
- New capabilities arrive as a folder and a registry entry.

<a id="0006-plugin-registry-negative"></a>
#### Negative

- **Configuration is now data, so it must be backed up, versioned and audited like data.**
  A database restore that loses plugin configuration is an outage. Mitigated by including
  configuration in backup verification and by auditing every change.
- **Secrets live in the database**, which raises the stakes on `TASKDESK_ENCRYPTION_KEY`
  and on database access. Mitigated by encryption at rest, never serialising secrets, and
  a documented key-rotation procedure.
- **Runtime reconfiguration is genuinely harder to implement** than reading an environment
  variable at boot — particularly for better-auth, which is constructed once and must be
  rebuilt and swapped when providers change, across every replica. This is the most
  delicate code in the system and needs disproportionate test coverage.
- **A misconfiguration can break the running system**, where a bad environment variable
  would at least fail at deploy. Mitigated by `validate()` on save, `test()` before
  enabling, and `auth.password` being non-removable.
- **More indirection.** Reading the code, "where does SMTP come from?" is now a registry
  lookup rather than a constant. Mitigated by keeping the registry small and obvious.

<a id="0006-plugin-registry-neutral"></a>
#### Neutral

- Feature flags give a tiering mechanism for free: `locked` at instance level lets a
  vendor sell editions without shipping different images.
- Third-party plugins are not supported at launch. The contracts are designed to permit
  them later without redesign.

<a id="0006-plugin-registry-alternatives-considered"></a>
### Alternatives considered

**Environment variables for everything (v1's approach).** Rejected. Redeploy per change,
unmanageable surface, and impossible to expose in an administration UI.

**A configuration file mounted into the container.** Rejected. Better than environment
variables, but still requires filesystem access and a restart, and still cannot be edited
by a non-technical administrator.

**Customer-specific builds or branches.** Rejected outright. N codebases, N test matrices,
N security-patch applications.

**Compile-time feature flags.** Rejected. Same problem, plus the flags become permanent
because nobody dares remove one.

**Full third-party plugin system with dynamic module loading.** Rejected for now as
premature. It adds sandboxing, versioning and supply-chain problems we do not yet have.
The contracts are shaped so this remains possible.

<a id="0006-plugin-registry-related"></a>
### Related

- [Plugin architecture](architecture-and-experience.md#plugin-architecture)
- [ADR 0003 — better-auth primary](#0003-better-auth-primary)
- [God Mode](feature-contracts-p4.md#god-mode)
- [Configuration reference](configuration.md)

<a id="0007-in-process-jobs"></a>
## 0007 — In-process scheduled jobs, no worker service

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0007-in-process-jobs-context"></a>
### Context

v1 ran a Go worker whose responsibilities were: scanning for SLA breaches every five
minutes, computing overview snapshots, caching results in Valkey and publishing events to
a pub/sub channel that the BFF fanned out to browsers.

It cost a third language, a third deployment artefact, a third set of credentials, and —
because it was in a different language from the system of record — it **polled its own
API over HTTP** rather than reading the database.

kaneo's API already ships `croner` for cron-expression scheduling and a `job_lease` table
providing a distributed lock — and the acquire/release SQL that goes with it
(`apps/api/src/scheduler/leader-lock.ts`) — which is precisely the mechanism a worker needs
to avoid duplicate execution across replicas. It ships **no renewal**, so a long handler
loses its lease mid-flight; the heartbeat and the abort `signal` are ours to add.
[background-jobs.md](background-jobs.md) says the same thing, and is the detail.

<a id="0007-in-process-jobs-decision"></a>
### Decision

**Background work runs in the API process, scheduled by `croner`, made replica-safe by the
`job_lease` table.**

- Jobs live in `apps/api/src/jobs/`, each exporting exactly the signature
  [background-jobs.md](background-jobs.md) defines:
  `{ name, schedule, leaseTtl | 'none', handler(signal) }`. `'none'` is the `outbox-drain`
  case, and `signal` aborts when the lease is lost — both are mandatory, not optional.
- Before running, a job acquires a lease with a single atomic
  `INSERT … ON CONFLICT … WHERE expires_at < now()` — kaneo's statement, kept verbatim.
  Long jobs renew mid-flight (**our addition**) so a crash frees the lease within one TTL
  and a 4-hour import under a 1-hour TTL survives.
- **Every handler must be idempotent.** A lease gives at-least-once, never exactly-once.
- Unbounded work is chunked, with an `await` between chunks so the event loop is not
  starved.
- Aggregation is pushed into SQL rather than JavaScript wherever possible.
- Outbox draining is the exception that needs no lease: it claims rows with
  `SELECT … FOR UPDATE SKIP LOCKED`, so every replica can drain concurrently.

<a id="0007-in-process-jobs-consequences"></a>
### Consequences

<a id="0007-in-process-jobs-positive"></a>
#### Positive

- **One less language, one less deployment, one less credential.**
- Jobs **read the database directly** instead of polling an HTTP API — simpler, faster,
  and no service-to-service authentication.
- Jobs share the domain layer, so SLA computation in a job and SLA computation in a
  request are literally the same pure function. In v1 they were two implementations in two
  languages, which is a class of bug we have now eliminated.
- Leasing gives horizontal scaling for free: run three replicas, each job still runs once.
- Job failures appear in the same logs, metrics and traces as requests.

<a id="0007-in-process-jobs-negative"></a>
#### Negative

- **Jobs and requests share an event loop.** A poorly written job adds latency to user
  requests. This is the real cost and it is accepted. Mitigations: chunking, yielding,
  SQL-side aggregation, and a `taskdesk_nodejs_eventloop_lag_seconds` metric with an alert.
- **No process isolation.** A crash in job code takes the API with it. Mitigated by
  supervision and by leases expiring.
- **No independent scaling.** If job volume grows out of proportion to request volume, we
  scale both together, which is wasteful.
- **At-least-once means idempotency is a permanent obligation** on every job author. This
  is easy to get wrong and needs to be a review checklist item.

<a id="0007-in-process-jobs-neutral"></a>
#### Neutral

- Extraction remains cheap. A well-factored `jobs/` directory whose handlers depend only
  on the domain and repository layers can be lifted into a separate process later. We are
  declining to pay for isolation we do not currently need, not making it impossible.

<a id="0007-in-process-jobs-alternatives-considered"></a>
### Alternatives considered

**Keep a separate worker service (v1's approach).** Rejected. Its entire function is
covered by `croner` plus `job_lease` in perhaps 800 lines, and keeping it means keeping a
second language and deployment for that.

**A job queue library — BullMQ, pg-boss.** Rejected for now, but deliberately kept in
reach. They add real capability — priorities, delayed jobs, per-job retry, a dashboard —
at the cost of another dependency and, for BullMQ, a hard Redis requirement. Our current
needs are a handful of cron jobs plus one outbox drain, and `SKIP LOCKED` handles the
outbox well. **Revisit if** we need per-job retry semantics beyond the outbox, user-
triggered long-running jobs beyond imports, or job priorities.

**A managed scheduler — Kubernetes CronJobs, systemd timers.** Rejected. It puts scheduling
outside the application, so a job cannot be enabled, disabled or triggered from God Mode,
and it ties the application to a specific orchestrator.

**Event-driven with a real broker (Kafka, RabbitMQ).** Rejected as vastly disproportionate.
The Postgres outbox plus Valkey pub/sub covers our fan-out needs at our scale.

<a id="0007-in-process-jobs-related"></a>
### Related

- [Background jobs](background-jobs.md)
- [ADR 0002 — single backend](#0002-single-backend)
- [ADR 0009 — lazy SLA evaluation](#0009-lazy-sla-evaluation)

<a id="0008-single-design-system"></a>
## 0008 — One design system package, no bespoke primitives

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0008-single-design-system-context"></a>
### Context

This is the ADR that exists because of why v1 failed.

v1 had no component library. Every button, input, dialog, table and menu was hand-written
in `Frontend/src/ui/`. The consequences, documented in v1's own notes:

- Icons were referenced everywhere and defined nowhere, so several active buttons rendered
  with empty icon paths — visible, clickable, and blank.
- Spacing, sizing and interaction patterns differed between screens because each was built
  independently.
- Accessibility was ad-hoc: focus management, keyboard navigation and ARIA were
  implemented per component, or not at all.
- Two redesign attempts improved individual screens without fixing the cause, because the
  cause was structural.

The verdict in v1's own retrospective was unambiguous: *"No component library: UI
primitives hand-coded, leading to inconsistency; v2 should adopt a mature library."*

Meanwhile kaneo ships 63 primitives — 43 on Base UI, one on Radix (`Slot`) — with Tailwind
v4 tokens, a coherent visual language, dark mode, motion specs and accessibility handled by
Base UI. *(Wording corrected 2026-09-06 against kaneo's source; the ADR originally said
"60+ Radix-based". Decision N of 2026-09-05 makes Base UI the primary standard.)*

<a id="0008-single-design-system-decision"></a>
### Decision

**`packages/ui` is the single source of every UI primitive. Nothing outside it may define
one.**

- `packages/ui` is taken from kaneo's `apps/web/src/components/ui` and extracted into a
  package so that both the agent bundle and the portal bundle import the same primitives.
- Everything visual lives there: components, `tokens.css`, `theme.css`, `motion.css`,
  the Tailwind preset, and the Storybook catalogue.
- Application code — `apps/web/src/components/**` — composes primitives into features.
  It never defines one.
- **Enforced in CI:**
  - A raw `<button>`, `<input>`, `<select>`, `<textarea>` or `<dialog>` outside
    `packages/ui` is a lint error.
  - A hex colour, `rgb()`, or arbitrary Tailwind colour value outside `packages/ui` is a
    lint error. Only token classes are permitted.
  - `dangerouslySetInnerHTML` is banned outside the sanitised rich-text renderer.
  - Every exported primitive must have a Storybook story, or the build fails.
  - Every primitive must pass axe with zero critical or serious violations.
- If a primitive is missing, the answer is **add it to `packages/ui`** — with a story, a
  test and a token-based implementation. Never inline it "just this once".

<a id="0008-single-design-system-consequences"></a>
### Consequences

<a id="0008-single-design-system-positive"></a>
#### Positive

- **Consistency is structural, not aspirational.** Two screens built by two different
  people, or two different AI agents, look the same because they are made of the same
  parts.
- **Accessibility comes from Base UI**, once (decision N, 2026-09-05), rather than being re-litigated per component.
- **Dark mode, motion and theming are token-driven**, so a branding change is a variable
  change.
- **The portal cannot become second-class.** It is built from the same parts as the agent
  workspace. This is the specific failure mode ADR 0004 is guarding against.
- **AI agents produce consistent output.** Given a fixed vocabulary of primitives and a
  lint rule that rejects invention, an agent's UI work is far more predictable. For a team
  of one human and three agents, this is not a nice-to-have.
- Onboarding: Storybook is the catalogue, and it is always current because CI requires it.

<a id="0008-single-design-system-negative"></a>
#### Negative

- **`packages/ui` becomes a bottleneck** when a feature needs something new. Mitigated by
  making it cheap to add a primitive — a template, a story and a test — and by accepting
  that a slightly-too-general primitive is better than a bespoke one.
- **Some designs will be constrained** by what the system can express. This is the trade
  being made deliberately: consistency is worth more to us than any individual screen's
  optimum.
- **Extraction from kaneo has a cost.** kaneo's primitives live inside its web app and
  assume its Tailwind configuration and path aliases. Moving them to a package means
  reworking imports, the Tailwind preset and the build. This is Stage 0 work and is
  budgeted.
- **The lint rules will occasionally be wrong** and will need escape hatches. Escapes are
  permitted with an inline comment naming the reason, and they are reviewed.

<a id="0008-single-design-system-neutral"></a>
#### Neutral

- We are consuming kaneo's design decisions wholesale, including ones we might not have
  made. That is the point — see [ADR 0001](#0001-kaneo-as-foundation). Divergence is
  allowed later, but it happens inside `packages/ui`, once, for everyone.

<a id="0008-single-design-system-alternatives-considered"></a>
### Alternatives considered

**Keep primitives in `apps/web` as kaneo does.** Rejected. Two bundles need to share them,
and a package boundary is what makes the lint rule expressible: "primitives may only be
defined here" requires a "here".

**Adopt a full component library — MUI, Mantine, Ant Design.** Rejected. Each brings a
strong opinion that would fight kaneo's visual language, and we would lose the thing we
came for.

**Design our own system from scratch.** Rejected. That is what v1 did.

**Allow bespoke primitives with review as the control.** Rejected. Review is a person, and
people are inconsistent under deadline. A lint rule is not. v1 had review too.

<a id="0008-single-design-system-related"></a>
### Related

- [Design system](#design-system)
- [UX quality gates](architecture-and-experience.md#ux-quality-gates)
- [ADR 0001 — kaneo as foundation](#0001-kaneo-as-foundation)

<a id="0009-lazy-sla-evaluation"></a>
## 0009 — SLA computed on read, never stored

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0009-lazy-sla-evaluation-context"></a>
### Context

An SLA answers: given this work item, its request type, its priority and its project's
service calendar, when is the deadline, and are we `none`, `ok`, `at_risk`, `breached`,
`met` or `missed`? Those six snake_case values are the vocabulary; they are enumerated on
`work_item_sla_cache.state` in [data-model.md](data-model.md) and described in
[sla.md](feature-contracts-p2.md#sla).

The obvious implementation stores a `sla_due_at` timestamp on the work item when it is
created, and a scheduled job flips a `sla_state` column as deadlines pass. Most ticketing
systems do this.

v1 did **not**. It computed SLA state lazily on read, from
`sla_started_at + policy target` evaluated against the service calendar. This turned out to be
one of v1's better decisions and is worth preserving deliberately rather than by accident.

<a id="0009-lazy-sla-evaluation-decision"></a>
### Decision

**SLA state is a pure function of stored facts, computed on read. No `sla_due_at` column.
No `sla_state` column.**

```ts
computeSlaState({
  slaStartedAt,    // work_item.sla_started_at — submission.created_at on acceptance,
                   // otherwise work_item.created_at. Never created_at directly: that is
                   // exactly the clock restart sla_started_at exists to prevent.
  firstResponseAt, // work_item.first_response_at, null until the first public staff
                   // comment — the stored fact the first_response metric stops on
  resolvedAt, priority, workItemTypeId,
  policy,          // the version effective at slaStartedAt
  calendar,        // windows + holidays + timezone
  pauses,          // [{ startedAt, endedAt }]
  now,
}): { dueAt, consumedMinutes, remainingMinutes, state }
```

- Lives in `packages/domain/src/sla/`. Pure, no I/O, exhaustively unit-tested.
- All durations are in **covered minutes** — time inside the service calendar's windows,
  excluding holidays and excluding paused intervals. Never wall-clock.
- The policy **version effective at `slaStartedAt`** is used, so changing a policy does not
  retroactively rewrite whether past tickets were met.
- The `first_response` metric stops at `firstResponseAt`; the `resolution` metric stops at
  `resolvedAt`. Both are stored facts, which is what makes "a pure function of stored
  facts" true rather than aspirational.
- The only persisted SLA artefact is `work_item_sla_cache`, holding the *last observed
  state*. It has exactly two readers: `sla-scan`, to detect an edge and fire an event once,
  and **list filters and sorts**, which cannot express the computation in SQL (see the
  Negative section below). It is **never** read by the detail endpoint or the API to answer
  "what is the SLA state?" — those always recompute, and where the two disagree the
  computed value wins.

<a id="0009-lazy-sla-evaluation-consequences"></a>
### Consequences

<a id="0009-lazy-sla-evaluation-positive"></a>
#### Positive

- **Changing a policy or a calendar requires no backfill.** Every open item is instantly
  evaluated against the new configuration. A stored-deadline design would need a migration
  job touching every open row, and would get it wrong for items straddling the change.
- **Nothing can drift.** There is no timer to miss, no state column to become
  inconsistent with reality after a restore, a clock change or a daylight-saving
  transition.
- **A missed scan delays a notification, not the truth.** If `sla-scan` does not run for
  an hour, the UI still shows correct SLA state; only the breach email is late. In a
  stored-state design, a missed scan means the data is wrong.
- **Exhaustively testable.** A pure function over plain data can be tested across
  timezones, DST boundaries, holidays, pauses and policy versions without a database.
- **The same function serves the API, the UI, reports and the scan job.** One
  implementation, one behaviour. v1 had two — C# and Go — and they could disagree.
- Pausing ("waiting on customer") is trivially expressible as an interval to subtract,
  rather than as a stored-deadline adjustment that must be recomputed.

<a id="0009-lazy-sla-evaluation-negative"></a>
#### Negative

- **You cannot `ORDER BY sla_state` or `WHERE sla_due_at < now()` in SQL.** This is the
  real cost. Filtering and sorting a large list by SLA state requires either computing in
  application code over a candidate set, or maintaining a denormalised column.

  Mitigation: `work_item_sla_cache` is maintained by `sla-scan` **for query purposes
  only**, refreshed every five minutes, and clearly documented as eventually consistent.
  Lists that filter by SLA use it; the work item detail view and the API always compute
  fresh. Where the two disagree, the computed value wins.

- **Computation cost on large lists.** Rendering 200 work items means 200 calendar
  evaluations. Mitigated by memoising calendar window expansion per calendar per day and
  by the function being genuinely cheap — arithmetic over a small window array.

- **Historical reporting needs care.** "What was our SLA attainment in March?" must
  evaluate each item against the policy version effective at its `sla_started_at`, not
  today's.
  The design supports this correctly; the reporting queries must remember to.

<a id="0009-lazy-sla-evaluation-neutral"></a>
#### Neutral

- Reports over closed periods read `metric_snapshot` aggregates rather than recomputing,
  so the per-item cost does not appear in dashboards.

<a id="0009-lazy-sla-evaluation-alternatives-considered"></a>
### Alternatives considered

**Store `sla_due_at` at creation, flip `sla_state` in a job.** Rejected. Every policy or
calendar change needs a backfill; a missed job makes the data wrong rather than merely
late; DST and holiday changes silently corrupt stored deadlines; and it invites two
implementations to drift apart.

**Store `sla_due_at` but recompute `sla_state` on read.** Rejected as the worst of both:
still needs backfill when a policy changes, still has a stored value that can be wrong.

**A Postgres generated column.** Rejected. Service calendar evaluation — weekday windows,
holidays, timezone, pauses — is not expressible in a generated column without a large,
untestable PL/pgSQL function, which is exactly the code we want in TypeScript where it can
be unit-tested.

**A materialised view refreshed periodically.** Rejected. This is `work_item_sla_cache`
with more machinery and less control over refresh granularity.

<a id="0009-lazy-sla-evaluation-related"></a>
### Related

- [SLA feature](feature-contracts-p2.md#sla) · [Service calendars](feature-contracts-p2.md#service-calendars)
- [Background jobs](background-jobs.md)
- [ADR 0002 — single backend](#0002-single-backend)

<a id="0010-route-policy-registry"></a>
## 0010 — Every route declares its policy; CI enforces it

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0010-route-policy-registry-context"></a>
### Context

TaskDesk v1 discovered **eleven authorization holes** during pre-go-live review. Its own
handover document records the lesson:

> *"Four of the worst defects were invisible to green tests… the lesson that repeated:
> 11 auth holes invisible to the test suite → mutation-test every check."*

Examples included: a customer-side account able to request an internal CAB approval; an
approver's email address returned to unauthenticated callers; and `/reports/*` having no
access control at all, so customers could read the entire SLA portfolio across every
customer.

The common shape of every one of these is **omission**. Nobody wrote a bad check. Someone
added a route and did not write a check at all. No test failed, because a test only fails
for behaviour someone thought to assert.

This is not solvable by care. v1's team was careful and had a review process and a green
test suite.

<a id="0010-route-policy-registry-decision"></a>
### Decision

**A route cannot exist without declaring the capability it requires. CI proves it.**

<a id="0010-route-policy-registry-1-policy-declaration-is-part-of-route-definition"></a>
#### 1. Policy declaration is part of route definition

Each feature folder has a mandatory `policy.ts`:

```ts
export const workItemPolicies = {
  'POST  /api/work-items':            { capability: 'work_item:create', scope: 'project' },
  'GET   /api/work-items/{key}':      { capability: 'work_item:read',   scope: 'work_item' },
  'PATCH /api/work-items/{key}':      { capability: 'work_item:update', scope: 'work_item' },
  'GET   /api/public/branding':       { public: true, reason: 'rendered on the login page' },
} satisfies PolicyMap;
```

The route factory refuses at module load to construct a route with no policy entry — so
the failure is at boot, not at request time.

The boot-time route-factory refusal is an explicit runtime requirement. A coverage/matrix test passing during a build is a different guarantee and cannot prove the real server enforces authorization or refuses an uncovered route at boot. Integrate the actual request-handling path; tests of a detached policy fixture are insufficient.

<a id="0010-route-policy-registry-2-route-coverage-test"></a>
#### 2. Route coverage test

`tests/permissions/route-coverage.test.ts` enumerates every route in **Hono's router**
(`app.routes`) and fails if any lacks a policy. A public route must supply `public: true` **and
a `reason` string**, making "this is public" a deliberate, reviewable act rather than an
absence.

> **Correction, 2026-09-06 (#7).** This section originally said "the generated OpenAPI
> document". Reading kaneo's real source settled it the other way, and
> [rbac.md](permissions.md) already carries the corrected
> wording: the OpenAPI document cannot see the routes registered inline in `index.ts`, the
> `/auth/*` mount, the websocket upgrades or `/metrics` — and `createRoute({ security: [] })`
> edits the document with **zero runtime effect**, so the document and the enforcement can
> disagree silently. Those are precisely the surfaces v1 leaked through. The decision — every
> route declares its policy, CI proves it — is unchanged; only the thing being enumerated is.

> **Addendum, 2026-10-01 — separate listener coverage.** Hono `app.routes` remains the
> enumeration source for Hono routes, including delegated `/auth/*` and `/ws` mounts. The
> internal `GET /metrics` surface is a separate Node listener on port 9464 and is absent
> from `app.routes`. Its runtime constructor must export a manifest containing its exact
> method, path, port and delegated-policy key. Permission coverage compares the constructed
> listener against that manifest and fails on an unclassified listener route, orphaned
> policy, or changed/extra method/path. The manifest and test extension are planned until the
> listener is implemented; the existing Hono `/metrics` fixture is not evidence that it
> exists. OpenAPI remains insufficient for either surface.

<a id="0010-route-policy-registry-3-permission-matrix-test"></a>
#### 3. Permission matrix test

`tests/permissions/matrix.test.ts` executes every built-in role against every route and
asserts allow or deny against a checked-in fixture. Changing who may do what changes the
fixture, and the change appears as a diff in the pull request.

<a id="0010-route-policy-registry-4-negative-e2e-suites"></a>
#### 4. Negative E2E suites

Playwright tests that attempt forbidden things and assert failure: cross-tenant reads
return 404, a customer cannot approve their own request, a customer cannot de-escalate
priority, a viewer cannot write, a revoked session cannot act.

<a id="0010-route-policy-registry-consequences"></a>
### Consequences

<a id="0010-route-policy-registry-positive"></a>
#### Positive

- **The v1 class of bug becomes a build failure.** Adding a route without a check is
  mechanically impossible to merge. This alone justifies the decision.
- **Authorization is legible.** The complete answer to "who can do what" is a set of
  small, greppable files, rather than being distributed across middleware chains and
  handler bodies.
- **Changes are visible in review.** Widening access shows up as a fixture diff, which is
  exactly where a reviewer's attention should be drawn.
- **AI agents cannot forget.** An agent adding an endpoint gets a red build until it
  declares a policy. For a team where most code is agent-written, this is decisive.
- The matrix fixture doubles as documentation, and it cannot go stale.

<a id="0010-route-policy-registry-negative"></a>
#### Negative

- **Ceremony on every new route.** Two lines, but two lines every time, and it will feel
  like bureaucracy on the tenth endpoint of a quiet afternoon. That is the point.
- **The matrix fixture grows large** — roles × routes. Mitigated by generating it in a
  compact grouped format and by only asserting built-in roles, not every custom role.
- **False confidence risk.** A route can declare `work_item:read` and still leak a field
  it should not. Policy coverage proves a check *exists*, not that it is *correct*. This
  is why explicit response schemas and negative E2E tests are also required — the controls
  are layered on purpose.
- Refactoring route paths means updating policy keys, which is friction.

<a id="0010-route-policy-registry-neutral"></a>
#### Neutral

- The `scope` field means the check knows *what* to evaluate against — project, work item,
  workspace — so resolution logic stays in one evaluator rather than being re-derived per
  handler.

<a id="0010-route-policy-registry-alternatives-considered"></a>
### Alternatives considered

**Middleware that requires a capability, applied per router.** Rejected. It is what v1
effectively had. It is easy to add a route to the wrong router, or to a router with a
weaker guard, and nothing detects it.

**Deny by default with an explicit allowlist of public routes.** Partially adopted — this
*is* deny by default. The addition is that the allowlist must be exhaustive and machine
verified, rather than implicit.

**Mutation testing of authorization checks**, which v1's retrospective suggested. Not
rejected, but insufficient alone: mutation testing verifies that existing checks are
tested, and says nothing about a check that was never written. Worth adding later as a
second layer; policy coverage is the first.

**Trust code review.** Rejected. v1 had review. Review catches what a reviewer thinks to
look for, and the failure mode here is precisely something nobody thought about.

<a id="0010-route-policy-registry-related"></a>
### Related

- [Security model](safety-and-runtime.md#security-model) · [RBAC](permissions.md)
- [Testing strategy](retained-constraints.md#testing-strategy)

<a id="0011-ticket-lifecycle-engine"></a>
## 0011 — One generic lifecycle engine for every work item, not per-category logic

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0011-ticket-lifecycle-engine-context"></a>
### Context

An incident, a service request, a change, a problem, an epic, a story, a task and a bug
all move through a sequence of named states that someone can act on, be gated by a role,
and eventually count as "done" for SLA and reporting purposes. Nearly every ITSM and
ticketing system we reviewed — v1 included — answers this by giving each category its own
fixed status enum, hand-coded: `open / pending / resolved / closed` for tickets,
`new / in_progress / review / done` for tasks, wired into the application in `switch`
statements and template strings. Renaming a state, or adding one, means shipping a code
change.

That is precisely the rigidity the product must not repeat. One customer wants
"Diagnosing → Awaiting Parts → Fixed"; another wants "Triaged → In Build → Verified →
Released"; a third is happy with kaneo's default "To Do / In Progress / Done". None of
that is a product decision we get to make once, centrally, in code.

At the same time, SLA calculation, board columns, "what's still open" filters and
cross-project reporting all need to ask one question that must have a stable answer
regardless of what a state is called: *is this work item effectively not started, in
flight, paused, done, or abandoned?* A completely free-form graph with no shared
vocabulary cannot answer that question portably.

`work-items.md`, `workflows.md` and the `state_template` / `state` / `workflow` /
`workflow_version` / `workflow_transition` tables in [data model](data-model.md)
already describe the mechanism. This ADR exists to say, explicitly and in one place, what
problem that mechanism is solving and what is — and is deliberately not — hardcoded.

<a id="0011-ticket-lifecycle-engine-decision"></a>
### Decision

**There is exactly one lifecycle engine, used by every work item type, service or
delivery alike. Its states and its transition graph are data. Only the state's `group` is
fixed vocabulary, and it exists solely to make cross-cutting logic possible.**

- A **state template** (`state_template` table) belongs to a **workspace** — the shared
  catalogue a workspace-scoped workflow's transitions reference
  (`workflow_transition.from_state_template_id`/`to_state_template_id`), so one workflow
  can serve every project that adopts it. Each **project** owns its own concrete
  **states** (`state` table, project-scoped), each mapped to exactly one template via
  `state.state_template_id`; work items reference a project's concrete row
  (`work_item.state_id`), **never** a template directly. A template has an
  admin-supplied `name` and `colour` and is assigned to exactly one of five **groups**:
  `backlog · unstarted · started · completed · cancelled` — a concrete state's group is
  its mapped template's group; `state` carries no separate `group` column. The five
  groups are the entire fixed vocabulary in the system — nowhere in the codebase does a
  literal state name like `"Resolved"` or `"Open"` appear in domain logic. SLA
  resolution, "is this done?" checks, board column defaults and portfolio reporting all
  key off `group`, never off `name`.
- A **workflow** (`workflow` / `workflow_version` / `workflow_transition`) attached to a
  work item type defines which state-**template**-to-state-**template** moves are legal,
  optionally restricted to a role, with a note policy and guards — see
  [Workflows](feature-contracts-p2.md#workflows), which also specifies exactly how a
  template reference resolves to the acting work item's project's own concrete `state`
  row at runtime. Editing templates and transitions is a settings screen, not a deploy.
- This is the *only* lifecycle mechanism. There is no separate "ticket status" system
  distinct from a "task status" system, and no per-category branch of workflow logic.
  Incident, service request, change, epic and bug all flow through the same
  `state_template` / `state` + `workflow` tables, exactly as
  [work-items.md](feature-contracts-p1.md#work-items) already argues for the work item
  table itself.
- **Removing a state template archives it** (`state_template.archived_at`: hidden from
  the picker a project uses to adopt a new state, still referenceable by every project's
  concrete `state` rows already mapped to it). **Removing a project's concrete state**
  works the same way one level down (`state.archived_at`; `work_item.state_id` is
  `ON DELETE RESTRICT`).
- **Renaming, adding or removing state templates — and reshaping the transition graph
  between them — is a workspace-settings action**; **which templates a project has
  adopted as its own concrete states, in what order, and which is its default is a
  project-settings action** (`state` rows, `PR-17`). Both take effect immediately, with
  the workflow editor's validation panel (see [workflows.md](feature-contracts-p2.md#workflows))
  refusing a change that would strand in-flight work items or leave a project unable to
  reach a template its workflow requires.
- **Transitions carry `guards` and `effects`** — two closed vocabularies owned by
  [workflows.md](feature-contracts-p2.md#workflows). Effects are how a transition sets or
  clears an assignee, pauses or resumes the SLA clock, or schedules a follow-up transition
  ("pending until Thursday" — persisted as a `scheduled_transition` row). There is no second place where lifecycle side-effects live:
  [sla.md](feature-contracts-p2.md#sla) and [assignment.md](feature-contracts-p1.md#assignment)
  cite the vocabulary, they do not define their own.

The settled model is workspace `state_template` plus project-scoped concrete `state`, with workspace-scoped reusable workflows. Do not move concrete states back to workspace scope or make workflows project-scoped. Earlier contradictory drafts are superseded by the Decision above.

- The **noun** used to describe a work item, a project, a cycle and so on (`"Ticket"` vs
  `"Issue"` vs `"Case"`) is a *separate* concern, covered by
  [ADR 0012](#0012-terminology-overlay). This ADR is about the **states** a work item
  passes through; ADR 0012 is about the **names of the concepts** themselves.

<a id="0011-ticket-lifecycle-engine-consequences"></a>
### Consequences

<a id="0011-ticket-lifecycle-engine-positive"></a>
#### Positive

- **One thing to build, test, secure and document.** kaneo's simple per-project states,
  Plane's state groups and OpenProject's type × role × status transitions unify into one
  engine instead of three half-features.
- A customer relabels "Resolved" to "Fixed", or inserts "Awaiting Vendor" between
  "In Progress" and "Resolved", entirely in the UI. This is the concrete answer to "not
  hardcoded like v1."
- Reporting, SLA and board logic are portable across every project and every customer,
  because they are written against five stable groups, never against names.
- Seeded default workflows (see [work-items.md](feature-contracts-p1.md#work-items)'s default
  types) give a good out-of-the-box experience without constraining anyone who wants
  something else.

<a id="0011-ticket-lifecycle-engine-negative"></a>
#### Negative

- **The group is a leaky abstraction.** An administrator adding a state must still decide
  which of five buckets it belongs to, which is a small extra cognitive step the raw name
  doesn't require. Mitigated with a required, explained field in the state editor and a
  sensible default (a newly-added state defaults to `started`, the least surprising
  choice) plus the "stuck item" validation from `workflows.md` catching bad wiring before
  publish.
- **Idiosyncratic grouping reduces cross-project comparability.** If one project marks a
  "Waiting on customer" state as `started` and another marks an equivalent state
  `cancelled`, portfolio reports diverge in meaning. Mitigated by documenting the intended
  semantics of each group prominently in the editor, not by constraining the choice.
- **Five groups will occasionally not fit.** A state that is "on hold" is neither cleanly
  "started" nor "cancelled". This is accepted as the cost of having *any* shared
  vocabulary; the alternative (no groups) breaks SLA and reporting entirely, which is
  worse.

<a id="0011-ticket-lifecycle-engine-neutral"></a>
#### Neutral

- This ADR changes nothing about what `work-items.md`, `workflows.md` or the data model
  already specify. It exists so the decision — one engine, data-driven states, one fixed
  five-value vocabulary — is recorded as a decision rather than left implicit across three
  documents.

<a id="0011-ticket-lifecycle-engine-alternatives-considered"></a>
### Alternatives considered

**A fixed status enum per work item category, as v1 and most reviewed ITSM tools do.**
Rejected outright — it is the specific rigidity this product exists to not repeat.

**A fully free-form state graph with no group vocabulary at all.** Rejected. SLA
resolution and "what's still open" reporting need a portable answer to "is this done?"
that survives an administrator renaming things; without groups, every customer's renaming
would silently break SLA and reporting.

**Separate lifecycle engines for service work (tickets) and delivery work (tasks/epics),
mirroring the Jira-classic vs. Jira-Service-Management split some competitors have.**
Rejected for the same reason `work-items.md` rejects separate ticket and task entities:
it produces duplicated views, duplicated reporting, and an eventual clumsy bridge between
the two.

<a id="0011-ticket-lifecycle-engine-related"></a>
### Related

- [Work items](feature-contracts-p1.md#work-items) · [Workflows](feature-contracts-p2.md#workflows)
- [Data model](data-model.md) · [ADR 0012 — Terminology overlay](#0012-terminology-overlay)
- [Competitive inspiration](retained-constraints.md#licensing-and-attribution)

<a id="0012-terminology-overlay"></a>
## 0012 — Terminology overlay: renameable nouns, separate from renameable states

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0012-terminology-overlay-context"></a>
### Context

Every tool we studied has opinions about what to call things, and bakes those opinions
into every string in the product. kaneo says "Task". Plane says "Issue" and "Cycle".
OpenProject says "Work package". Jira Service Management says "Request" to a customer and
"Issue" to an agent. v1 said "Ticket" everywhere, in the UI, in email templates, and in
support documentation, and changing it would have meant a find-and-replace across a
codebase.

We ship **one image to every customer** ([ADR 0006](#0006-plugin-registry)). Two
customers may reasonably want the same product to say "Ticket" and "Case" respectively, or
"Sprint" instead of "Cycle", without either commissioning a fork or waiting for a release.
This is a distinct problem from [ADR 0011](#0011-ticket-lifecycle-engine), which makes
*state names* ("Resolved", "Fixed") fully data-driven per project. ADR 0011 covers the
states a work item passes through. This ADR covers the **nouns** used to name the concepts
themselves — work item, project, cycle, epic — which are hardcoded today in every system
we looked at, our own v1 included.

<a id="0012-terminology-overlay-decision"></a>
### Decision

**A bounded, enumerated set of domain nouns is overridable per instance (and, where it
matters, per workspace), rendered through the existing i18n layer as an override on top of
the built-in translation — never a second templating system, and never an arbitrary
free-text key.**

- `terminology_override` (`scope: instance | workspace`, `workspace_id` nullable,
  `term_key`, `locale`, `singular`, `plural`) stores administrator-supplied labels for a
  **fixed, enumerated list of term keys** defined in code —
  `work_item`, `project`, `cycle`, `module`, `epic`, `sprint` *(alias of `cycle`)*,
  `request`, `submission`, `service`, `change` — not an open dictionary. Adding a new
  overridable noun is a small, reviewed code change to the enumeration; it is never an
  admin typing an arbitrary key.
- Overrides are entered in **God Mode → General → Terminology**, with a live preview
  panel showing a sample screen re-rendered with the new nouns before saving — the same
  discipline the request-type form builder already applies to its live preview
  ([request-types-and-catalogue.md](feature-contracts-p2.md#request-types-and-catalogue)).
- Rendering resolves **`workspace override → instance override → built-in locale
  string`**, per locale, mirroring the feature-flag precedence already established in
  [plugin-architecture.md](architecture-and-experience.md#plugin-architecture).
- **The API is never affected.** Every response, resource path and OpenAPI schema uses the
  stable internal key (`work_item`, `project`, …) permanently. Only the *rendered label* in
  the UI, in outgoing email and in notification text changes. A customer's API integration
  does not break when they rename "Ticket" to "Case".
- Portal-facing terminology (see `customer-portal.md`'s `CP-5`: *"request", not "work
  item"*) is itself just the default override applied to the `customer` portal scope — a
  special case of this mechanism, not a separate one.

<a id="0012-terminology-overlay-consequences"></a>
### Consequences

<a id="0012-terminology-overlay-positive"></a>
#### Positive

- A customer says "Case" instead of "Ticket", or "Sprint" instead of "Cycle", entirely in
  the UI, with no rebuild and no support ticket to us.
- Reuses the i18n pipeline that already exists rather than inventing a second one — an
  override is simply another translation source, resolved with higher precedence than the
  shipped locale file.
- Because the term-key set is enumerated in code, it is exhaustively tested: a snapshot
  test can assert every screen re-renders correctly under a worst-case override (very long
  strings, a plural that looks nothing like the singular) without needing to enumerate
  every possible customer's actual words.
- Distinguishes the product from every reviewed competitor, none of which expose renaming
  of these nouns to an administrator at runtime.

<a id="0012-terminology-overlay-negative"></a>
#### Negative

- **Grammar does not follow automatically across locales.** An override supplied for
  `en-US` says nothing about how the equivalent noun pluralises or declines in `de-DE` or
  `ja-JP`. Mitigated by scoping overrides per locale (an admin who cares about a non-English
  deployment sets the override once per locale they support) and by falling back cleanly
  to the shipped translation for any locale with no override.
- **Support and documentation drift from what the customer actually sees.** A screenshot in
  our own docs says "Ticket"; the customer's screen says "Case". Mitigated by keeping the
  default English noun and the internal key visible in tooltips and `aria-label`s, so a
  support agent can always ask "what does your instance call a Ticket?" and orient
  instantly, and by our public documentation always using the default vocabulary and
  saying so.
- **A half-considered rename can produce an ungrammatical UI** ("1 Case" vs "1 Cases" if an
  admin leaves the plural equal to the singular). Mitigated by the live preview surfacing
  exactly this before save, not by restricting what an admin may type.

<a id="0012-terminology-overlay-neutral"></a>
#### Neutral

- This is additive to, and independent of, [ADR 0011](#0011-ticket-lifecycle-engine).
  A deployment can rename every state without touching terminology, rename terminology
  without touching states, or both.

<a id="0012-terminology-overlay-alternatives-considered"></a>
### Alternatives considered

**Per-customer build-time string replacement or a forked locale file per customer.**
Rejected — recreates the N-codebases problem [ADR 0006](#0006-plugin-registry) exists to
eliminate, and forked locale files drift the moment either the base translation or the
customer's fork is updated.

**An unrestricted, admin-defined dictionary of arbitrary keys.** Rejected. An unbounded
surface cannot be typed, cannot be exhaustively tested, and reliably ends with half the UI
overridden and half not, which reads as broken rather than customised.

**Treat a customer's preferred vocabulary as a new locale (a "fake language").** Rejected —
it conflates translation (a linguistic concern, owned by `i18n/`) with branding (an
instance-configuration concern, owned by God Mode), and would require maintaining a
complete parallel locale file per customer rather than a handful of noun overrides.

<a id="0012-terminology-overlay-related"></a>
### Related

- [ADR 0011 — Ticket lifecycle engine](#0011-ticket-lifecycle-engine)
- [ADR 0006 — Plugin registry](#0006-plugin-registry) · [Plugin architecture](architecture-and-experience.md#plugin-architecture)
- [God Mode](feature-contracts-p4.md#god-mode) · [Customer portal](feature-contracts-p3.md#customer-portal)

<a id="0013-marketplace-metering-plugin"></a>
## 0013 — Marketplace listing and usage metering are an optional plugin, never a default

- **Status:** Accepted — *addendum 2026-09-05:* the marketplace listing itself is deferred
  beyond the current three-to-four-month scope, and when it comes, a **BYOL / contract**
  listing is preferred over usage metering. This ADR's decision (metering is an optional
  plugin, never a default) stands unchanged; only the expected first listing type moved
- **Date:** 2026-09-05
- **Deciders:** Thomas

<a id="0013-marketplace-metering-plugin-context"></a>
### Context

The product should be listable on AWS Marketplace — and, later, possibly Azure or GCP
marketplaces — so a customer can discover, procure and pay for it through infrastructure
they already trust and already have a billing relationship with. Cloud marketplace
container listings typically expect one of: a flat bring-your-own-licence (BYOL) listing
with no usage reporting, or a metered listing that reports consumption to the
marketplace's own metering service (AWS Marketplace Metering Service, for a paid tier
billed per hour or per seat) so the vendor gets paid through the marketplace rather than
billing the customer directly.

This collides with something the product has promised since
[ADR 0006](#0006-plugin-registry): **one image, any customer**, self-hosted, AGPL, with
no phone-home. A customer who has never heard of AWS Marketplace must get an identical
image, behaving identically, with nothing reporting anywhere. Building marketplace
metering *into* the application as a standing feature would either force it on everyone or
require an environment variable to turn it off — both of which are exactly the pattern
[ADR 0006](#0006-plugin-registry) exists to prevent.

<a id="0013-marketplace-metering-plugin-decision"></a>
### Decision

**Marketplace entitlement and usage metering is a plugin, of a new kind: `license`.**

- `license.none` — the default. No entitlement check, no metering, no network call to
  anywhere related to licensing. Feature availability is governed entirely by the existing
  `instance_feature_flag` mechanism from
  [plugin-architecture.md](architecture-and-experience.md#plugin-architecture), configured directly by whoever
  administers the instance. This is what every self-hosted deployment runs unless someone
  deliberately changes it.
- `license.aws-marketplace` — an optional plugin an administrator enables and configures
  with AWS Marketplace product and customer identifiers. Once active, it:
  - Resolves the buyer's entitlement (which tier they purchased) via the AWS Marketplace
    Entitlement Service.
  - Emits usage records to the AWS Marketplace Metering Service on a schedule, exactly like
    any other scheduled job — `croner` plus the `job_lease` table from
    [ADR 0007](#0007-in-process-jobs), no bespoke scheduling mechanism.
  - Sets `locked` instance feature flags to match the purchased tier, reusing the same
    locking mechanism [ADR 0006](#0006-plugin-registry) already defined for vendor
    tiering — **no new tiering mechanism is introduced.**
  - Implements the same `validate()` / `test()` contract as every plugin (
    [plugin-architecture.md](architecture-and-experience.md#plugin-architecture)): a test emits a zero-value
    heartbeat usage record so an administrator can confirm metering actually works before
    relying on it for billing.
  - Credentials are stored exactly like any other plugin secret: encrypted at rest, never
    returned by the API.
- `license.azure-marketplace` / `license.gcp-marketplace` are left as future entries of the
  same kind, added without redesign if and when those listings are pursued.
- **The container image is identical everywhere.** The image published to AWS
  Marketplace's ECR repository is the same artefact published to Docker Hub. Marketplace
  packaging (a CloudFormation quick-launch template, a listing description, a security
  self-assessment, buyer-facing documentation) is process and packaging work, tracked in a
  dedicated operations document, not an application-level concern — see
  [AWS Marketplace listing](operations-and-distribution.md#aws-marketplace).

<a id="0013-marketplace-metering-plugin-consequences"></a>
### Consequences

<a id="0013-marketplace-metering-plugin-positive"></a>
#### Positive

- **The self-hosted, AGPL promise is kept exactly.** No plugin, no phone-home, ever, unless
  an administrator explicitly enables one — which is the same trust model every other
  plugin kind already has.
- **One image serves every route to market.** A free self-hosted user, a customer who
  procured through AWS Marketplace, and a future Azure Marketplace customer all run the
  same build.
- **No new tiering mechanism.** Marketplace-driven entitlement rides on the `locked`
  feature-flag mechanism that already exists for exactly this purpose.
- Future marketplaces are additive — a new plugin in the `license` kind — not a redesign.

<a id="0013-marketplace-metering-plugin-negative"></a>
#### Negative

- **Marketplace container-product listings expect artefacts beyond the application**: a
  CloudFormation quick-launch template, a documented security posture (AWS Marketplace
  Vendor Insights / ISV workload qualification, per current AWS requirements — see the
  operations document for specifics as they stand at listing time, since marketplace
  requirements move faster than this ADR should be revised), and a committed support and
  patch cadence. This is real, ongoing sales-engineering work, not a one-time task.
- **AGPL's network-copyleft obligation lands on the buyer, not us**, and is easy for a
  buyer to miss: a company that procures our AGPL image through AWS Marketplace and then
  offers *their own* users a service built on it must, in turn, make the corresponding
  source available to those users. The Marketplace listing description and the buyer-facing
  documentation must say this plainly. See
  [Licensing and attribution](retained-constraints.md#licensing-and-attribution).
- **Metering correctness is a billing-integrity problem, not just an engineering one** — a
  missed or duplicated usage record either underbills us or overbills a customer.
  Mitigated by idempotent usage records (see the outbox pattern already used for
  webhooks — [data model](data-model.md)), by the `test()` heartbeat, and by treating a
  failed metering send as a job-retry case rather than a silent drop.

- **Metering integrity is contractual, not technical, in a self-hosted AGPL product.** The
  buyer is the instance administrator and may lawfully modify the source, so AWS's
  "buyer cannot bypass metering" requirement cannot be met structurally. Recorded as
  **R18** in [risks.md](retained-constraints.md#risks); the recommended resolution is a BYOL /
  contract listing where the plugin resolves entitlement only and meters nothing.
- **AGPL §6 applies to the Marketplace image**, not only §13: shipping the image to a buyer
  is distribution, so the corresponding source for that exact build is linked from the
  listing — the same SHA the image's provenance attestation names.
- If a metered dimension is ever chosen: `MeterUsage` (aggregate, seat-based) runs under a
  lease on one replica like any other job; `RegisterUsage` (per running task) must run
  **unleased on every replica** at start — the opposite of the lease model — and the plugin
  says which it does.

<a id="0013-marketplace-metering-plugin-neutral"></a>
#### Neutral

- Whether an AMI-based listing is pursued alongside, or instead of, a container-product
  listing is a packaging decision with no bearing on this plugin architecture, and is left
  to [AWS Marketplace listing](operations-and-distribution.md#aws-marketplace).

<a id="0013-marketplace-metering-plugin-alternatives-considered"></a>
### Alternatives considered

**A separate "Marketplace edition" build with metering compiled in.** Rejected — recreates
the N-codebases problem [ADR 0006](#0006-plugin-registry) exists to eliminate, and means
a security patch must be built and released twice.

**Metering on by default, disabled via an environment variable for self-hosted
deployments.** Rejected. It inverts the trust model: the default behaviour of every other
plugin in this system is "does nothing until an administrator configures it," and licensing
telemetry is exactly the kind of thing that must not default to on.

**List only on AWS Marketplace via an AMI, skipping a container-product listing
entirely.** Not rejected, genuinely open — recorded as a packaging decision for the
operations document, since it does not change anything decided here.

<a id="0013-marketplace-metering-plugin-related"></a>
### Related

- [ADR 0006 — Plugin registry](#0006-plugin-registry) · [Plugin architecture](architecture-and-experience.md#plugin-architecture)
- [ADR 0007 — In-process jobs](#0007-in-process-jobs)
- [AWS Marketplace listing](operations-and-distribution.md#aws-marketplace)
- [Licensing and attribution](retained-constraints.md#licensing-and-attribution)

<a id="0014-limited-home-realm-disclosure"></a>
## 0014 — Customer home-realm routing accepts limited domain-specific disclosure

- **Status:** Accepted
- **Date:** 2026-10-01
- **Source decision attribution:** Thomas; recorded accepted in the original source. This is not a new standing delegation or dependency authorization.

<a id="0014-limited-home-realm-disclosure-context"></a>
### Context

The customer portal starts OIDC login from a visitor-submitted email domain. A configured
customer SSO binding routes the visitor to its selected identity provider; an unbound domain
continues through available non-SSO methods. The complete unauthenticated flows therefore
cannot be indistinguishable: the redirect destination and subsequent navigation can reveal
whether the submitted domain has an SSO binding and can expose the IdP's public destination,
including a public tenant path.

The earlier full-flow non-enumeration claim was contested because matching the first
response's body, status, or timing does not hide this later routing. Preserving home-realm
routing while claiming that an anonymous observer learns nothing about the binding would be
misleading. A different privacy boundary is needed for the specified first-release journey.

The source records an accepted limited-disclosure design boundary. That record is not runtime evidence or clearance for unrelated decisions.

<a id="0014-limited-home-realm-disclosure-decision"></a>
### Decision

The customer portal accepts a limited, domain-specific disclosure during unauthenticated
home-realm routing. A visitor who submits a domain may infer whether it has a customer SSO
binding and may see the selected IdP's public redirect destination. The portal does not
publish an organisation or connection list, a general discovery/configuration inventory, or
organisation names, connection identifiers, secrets, claim mappings, or TaskDesk account
existence through this flow. The anonymous rate limit reduces bulk probing; it does not hide
the binding or restore non-enumeration. Equal initial response body, status, or timing is not
a privacy guarantee for the complete flow. The feature authority for this boundary is
[identity provisioning, IP-29](feature-contracts-p3.md#identity-provisioning-oidc-login).

This disclosure does not grant identity or TaskDesk authority. The typed domain selects only
which unauthenticated OIDC flow starts. Server-side single-use state pins the selected
connection, customer portal, and persisted `organisation_id`; the callback cannot reselect
the connection or change scope. JIT admission still requires the selected connection's exact
`iss`/`tid`/`aud`, immutable `oid`, its configured signed app-role value, and signed `acct=0`.
Guests and missing proof fail closed. Domains and address-like claims do not admit, link, or
scope accounts; a validated cross-connection domain collision can only deny. These existing
identity and admission rules remain defined by `IP-9` and `IP-27`.

A genuinely private preflight that verifies the visitor's right to learn the SSO route is a
separate future journey design. It must specify uniform pre-proof behavior, email delivery,
recovery, abuse controls, and full-flow acceptance evidence before replacing this decision.

<a id="0014-limited-home-realm-disclosure-consequences"></a>
### Consequences

<a id="0014-limited-home-realm-disclosure-positive"></a>
#### Positive

- Home-realm routing remains available without publishing a provider or customer inventory.
- The privacy boundary names what the public flow reveals and what it continues to protect.
- Domain routing remains separate from connection-pinned identity admission and organisation
  authority.

<a id="0014-limited-home-realm-disclosure-negative"></a>
#### Negative

- Anonymous visitors can probe submitted domains to infer customer SSO bindings and observe
  the selected IdP's public destination. Rate limiting limits volume but cannot remove this
  disclosure.
- Deployments that require hiding domain-to-SSO associations cannot use this journey without
  adopting a separately specified private preflight.
- The full bound and unbound login flows are observably different, which must remain explicit
  in privacy claims and acceptance evidence.

<a id="0014-limited-home-realm-disclosure-neutral"></a>
#### Neutral

- This decision adds no route, table, configuration field, provider, or identity capability.
- Planned whole-flow browser coverage records the permitted binding/IdP disclosure and
  prohibited inventory, configuration, secret, and account-existence disclosure. This ADR
  does not claim those tests have been implemented or run.
- The 25 named P3 acceptance tests and real-Entra interoperability remain required; current consolidated independent design/integration/security review and Thomas's acceptance remain separate states.

<a id="0014-limited-home-realm-disclosure-alternatives-considered"></a>
### Alternatives considered

**Require complete non-enumeration while keeping domain-driven IdP routing.** Rejected because
the selected IdP redirect and later navigation make the binding observable; parity of the
initial response cannot satisfy that claim.

**Verify an email address before looking up or routing by its domain.** Deferred as a separate
journey design. It could protect the route lookup behind address proof, but changes the login
flow for SSO users and requires explicit behavior for delivery, recovery, abuse controls, and
uniform pre-proof responses. Those requirements and acceptance cases are not specified here.

**Publish a provider picker or customer/connection inventory.** Rejected because it exposes
more information than the domain-specific routing decision requires and violates the portal's
no-list boundary.

<a id="0014-limited-home-realm-disclosure-related"></a>
### Related

- [Identity provisioning, IP-9, IP-27 and IP-29](feature-contracts-p3.md#identity-provisioning)
- [Customer portal](feature-contracts-p3.md#customer-portal)
- [Security model](safety-and-runtime.md#security-model)
- [ADR 0003 — better-auth primary](#0003-better-auth-primary)
- [ADR 0004 — two portals, two origins](#0004-two-portals-two-origins)

<a id="0015-membership-grant-provenance"></a>
## 0015 — Membership grant provenance and effective-role projection

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** Thomas (approval required; not granted)

> **Proposed, not approved.** Thomas authorized implementation of the documented recommendation; this does not approve the ADR, close findings or accept the 25 named identity tests. The migration must stop on every unresolved legacy row. Current AGENTS governs the single consolidated phase review.

<a id="0015-membership-grant-provenance-context"></a>
### Context

TaskDesk must reconcile direct administrator membership, a per-connection JIT default,
OIDC group mappings, and SCIM group mappings without turning independent sources into a
capability union. The existing target `membership` has one `role_id`, while its
`derived_from` placeholder can record only one SCIM source. Deleting that row when one group
is removed can erase authority another independent source still justifies; retaining it can
leave stale authority. OIDC group overage or omission also cannot safely be treated as the
last known current group set.

OIDC and SCIM are connection-scoped. OIDC group evidence is refreshed at a validated login;
SCIM evidence changes when an authenticated synchronization request arrives. There is no
upstream callback that makes every provider's removal instantly observable. A person can
have explicitly linked identities from more than one connection, so one connection's
claims cannot stand in for another's evidence. The current 30-second authority-cache bound
and immediate next-request session-table check remain distinct controls. A connection's
`max_role_rank` is its current ceiling: a committed decrease must retire that connection's
now-ineligible external grants and recompute stored authority atomically, while leaving
sessions valid and distinct from authority-cache invalidation.

This changes the authoritative RBAC storage contract and is expensive to reverse, so it
needs an ADR before implementation.

<a id="0015-membership-grant-provenance-decision"></a>
### Decision

**Proposed:** keep `membership` as one materialized effective role per
`(person_id, scope, scope_id)` and add an append-preserving `membership_grant` provenance
ledger. The grant ledger records `direct`, `jit_default`, `oidc_group`, or `scim_group`
source rows; it is never read as a list of roles and never produces capability union.

Add a separate `oidc_group_mapping`, keyed by `(identity_connection_id,
external_group_id)`, because an OIDC-only connection need not have SCIM configured. OIDC
group ids are immutable provider object ids; names are nullable display snapshots only.
OIDC and SCIM mappings may describe the same upstream object but remain separate grant
evidence.

<a id="0015-membership-grant-provenance-grant-provenance-and-validation"></a>
#### Grant provenance and validation

- A direct grant carries its `direct_origin` (`admin`, system-written `system_backfill`, or system-written `project_creator`, decision log 2026-10-14);
  only `admin` carries `granted_by_person_id`. Direct grants alone may set `sees_all`.
- A JIT-default grant names its external identity and connection but no group mapping.
- An OIDC-group grant names its external identity, connection, and exactly one OIDC mapping.
- A SCIM-group grant names its external identity, connection, and exactly one SCIM mapping.
- External grants have no direct-grant fields and force `sees_all=false`. A source CHECK
  enforces this exact discriminator shape. `system_backfill` is available only to the
  forward migration, never to an API request.
- The writer validates current person and parent lifecycle, connection, mapping, person side,
  role scope, actual resource-owning organisation, forbidden capabilities, and `max_role_rank`
  using the shared [IP-22 source-validity invariant and parent-first total lock/retry protocol](feature-contracts-p3.md#identity-provisioning).
  Cross-row rules are not represented as if a SQL `CHECK` could enforce them.
- Every source addition or retirement preserves a grant row. A role or mapping change
  retires the old grant and inserts a new one; no in-place role escalation changes its
  provenance.

<a id="0015-membership-grant-provenance-effective-membership-selection"></a>
#### Effective membership selection

For one person and scope, consider only active grants whose source remains valid, whose role
still exists in that scope and under the current connection ceiling, and whose external
identity is active. If a direct grant exists, it alone chooses the effective role. Otherwise
the valid external grant with greatest role rank wins. At equal rank,
`scim_group > oidc_group > jit_default` applies only when the tied grants have the same
`role_id`. Distinct role ids tied at the highest rank fail closed for that scope: materialize
no external effective membership and show an operator-visible conflict for an
administrator to resolve. Role-id sorting and capability union are forbidden. `sees_all`
is true only when the selected direct grant explicitly carries it.

The shared validity predicate, configuration/mapping/role transition matrix, lock-and-retry
protocol, source isolation, atomic projection/cache update, event/audit behavior and
existing-session distinction are defined once in
[IP-22](feature-contracts-p3.md#identity-provisioning); this proposal uses that invariant for
effective grant selection. Role-priority edits reproject all affected holders even when no
grant retires, and a ceiling increase never restores retired grant history without fresh
evidence from the source that owns it. ADR-0015 remains proposed with implementation authorized, approval not granted. The legacy-row gate and current consolidated independent phase review still apply.

The effective row has a unique `(person_id, scope, scope_id)` key. Before adding that
constraint, migration work audits duplicates and requires a deterministic,
owner-approved repair. A future cut-over first performs a read-only provenance preflight
over **every** legacy membership row before any DDL, backfill, uniqueness constraint, or
effective projection. A row can be classified only from durable evidence establishing its
exact source and the required grant fields: an explicit administrator grant (including an
invitation only where inviter, target, and grant are unambiguously linked), a
connection-bound JIT default, or a specific SCIM group membership. A valid
`derived_from` link may prove a SCIM group source; `derived_from IS NULL` does not prove a
direct grant because invitation, JIT, and SCIM memberships may also have null provenance.
Any ambiguous or unclassified row, including one with null `derived_from`, stops the
**entire migration before DDL or data changes** and requires explicit owner-approved,
per-row reconciliation. Never guess a direct grant, discard a row, or create a partial
effective projection. Migration proceeds only after every row is classified and duplicate
repairs are owner-approved. DDL, complete grant backfill, effective projection, and
constraints then run in one transaction; any failure rolls the whole cut-over back to the
unchanged pre-migration schema and membership data. Non-transactional DDL is not permitted
for this cut-over. Recovery supplies the missing approved classifications, reruns the
read-only preflight against unchanged legacy data, then retries the complete migration. The
existing lookup index remains.
`membership.derived_from` stops being written and stays null during transition; remove it
only in a documented forward migration after the grant ledger is authoritative.

The implementation's read-only inventory is
`apps/api/scripts/preflight-membership-provenance.ts`. It requires an explicit
`TASKDESK_DATABASE_URL` (never the local fallback), a caller-supplied new output path, and
writes a create-only mode-0600 report. Each entry contains the legacy membership id, a
SHA-256 digest over the source-relevant membership fields, and either the exact validated
SCIM source chain or a finite unresolved reason. The command prints only counts and the
private report path. Exit 0 means every row had a self-proving source chain; exit 2 means
at least one row remains unresolved; exit 1 means the preflight itself could not complete.
The report's `allRowsSelfProving` flag is not cut-over authorization: duplicate-projection,
role/scope/source validity and approved-reconciliation checks remain required.
It does not write to the database, accept owner classifications, backfill grants, or run
DDL. An unresolved report is evidence for owner reconciliation, never permission to guess.
The owner reconciliation file format is
`taskdesk-membership-provenance-reconciliation/v1`: it contains an `approval` object with
`approverPersonId` and `approvalReference`, plus exactly one decision for every unresolved
membership id. Each decision repeats `rowDigest` and lists the complete grant set, using the
`membership_grant` discriminator fields, a private `evidenceReferences` list and a non-empty
`rationale`. Evidence references point to the operator's durable source material and are
never copied into application logs. A human decision may select only
`direct_origin: admin`; `system_backfill` remains migration-only. Its validator rejects
missing, duplicate, unknown, stale, empty, or malformed decisions. This validates the
record's completeness and shape, not the truth of the cited owner evidence. Before use, the
cut-over runner must verify the approver is a current instance admin, validate every source
reference and role/scope under lock, reject duplicate projection keys, repeat the preflight
while all participating writers are blocked, and perform grant backfill, projection, and
constraints atomically. The startup and `db:migrate` paths use
`apps/api/src/database/migrate-membership-provenance.ts` for the 0089–0092 transition.
That runner applies the accepted prefix first, then takes parent-first exclusive locks for
organisation, workspace, person, role, and membership; recomputes the inventory under
those locks; validates the complete private owner record, current admin actor, exact
legacy role/scope/person targets and duplicate projection keys before executing any
cutover SQL. It executes 0089–0092, inserts the direct-grant backfill and validates the
effective projection in one transaction, including migration-journal rows. Failure rolls
back all cutover DDL, backfill, indexes, and journal entries. The v1 runtime currently
accepts owner-attested `direct/admin` legacy grants only: the pre-0089 schema has no durable
OIDC/JIT source ledger to validate, so external-source claims remain refused. Null
`derived_from` is never treated as direct. Duplicate projection keys stop the transition and
must be resolved before retry; the runner does not delete or choose a duplicate row.
This source description supplies no evidence that a persistent database was cut over.

For a populated installation, pass the owner file explicitly to the migration process as
`--membership-provenance-reconciliation <private-file>`; `pnpm --filter @taskdesk/api
db:migrate -- --membership-provenance-reconciliation <private-file>` and the one-shot
`TASKDESK_ROLE=migrate` process use the same runner. The file must be a regular file with no
group or other permissions and is capped at 4 MiB. New empty installations need no owner
file. A session-level advisory lock serializes all TaskDesk migration runners, while the
parent/table locks protect the legacy rows and their role/person targets through commit.

**Repair of a database already past the cutover.** A database that applied 0088 to 0119 without
running the cut-over (the schema spine) has the grant tables but unprojected memberships. The
same runner treats that as the same gate, restricted to the memberships that no active grant
projects: it refuses with a pointer to the preflight and writes nothing unless the owner
reconciliation file covers every such row, then validates and inserts the direct/admin grants in
one transaction under the parent-first locks. A projected database is a no-op, so the repair is
idempotent. The operator procedure is in the
[runbook](operations-and-distribution.md#runbook-startup-refuses-incomplete-grant-projection-database-already-at-0119).

<a id="0015-membership-grant-provenance-legacy-row-classification-and-reconciliation-gate"></a>
##### Legacy-row classification and reconciliation gate

The preflight emits a private, deterministic inventory keyed by legacy `membership.id`,
including person/scope/scope id/role/`sees_all`/`derived_from`, the row's current values,
the exact evidence references and a digest of those values. It reads the entire legacy
table and the durable invitation, external-identity, connection, SCIM-group-member,
mapping and audit records needed for candidate sources. A classifier accepts a row only
if **one** source has an unbroken identity, target, role, scope and time linkage to the
row. An invitation is direct only when its accepted grant links the same inviter, person,
scope and role; an invitation email or accepted state alone is insufficient. A JIT
candidate needs a connection-bound external identity and a recorded default grant for
that same target and role. A SCIM candidate needs the exact group-member/mapping/identity
chain; a `derived_from` value alone is insufficient if that chain is broken. Historical
OIDC data lacking a source-specific link cannot be inferred from a current group claim.
Any zero-candidate, multiple-candidate, mismatched, duplicate or inconsistent row is
ambiguous, even when `derived_from` is null. Classifying a source also validates all
required target grant fields against the current canonical parents; an invalid target
stops the cut-over rather than being silently omitted.

For each ambiguous row, the owner supplies an explicit per-row reconciliation record:
legacy membership id and preflight digest, selected source kind, every required source
reference and direct origin/actor where applicable, the exact evidence and rationale,
and an explicit disposition for duplicate effective keys. The owner may require a
separate documented legacy-data correction before migration; a reconciliation cannot
invent external-identity or group provenance. A direct `system_backfill` classification
requires affirmative owner evidence that a direct administrative grant really existed;
it is never the default for a null `derived_from`. Keep the approval record private and
auditable; do not put identity payloads or email addresses in a migration log. The
preflight validates each record against fresh database evidence and its digest; changed
rows or stale records fail closed. It must account for every legacy row exactly once and
for every duplicate-key repair explicitly before the write phase. Run the final preflight
and transactional cut-over against one stable snapshot with writers blocked or an
equivalent serializable boundary, so classification cannot become stale between the two.
The migration cannot succeed with an unresolved inventory item; the operator receives a
bounded count and private ids for reconciliation, not a partial migrated database.

`scim_group_member` remains the SCIM group ledger. It points to its corresponding grant and
to the effective membership when one exists; under an equal-rank conflict both membership
pointers are null. Group removal retires only the matching SCIM grant and recomputes the
effective row. Removing one source never removes another source's valid grant.

<a id="0015-membership-grant-provenance-reconciliation-and-revocation"></a>
#### Reconciliation and revocation

- Every Entra login, whether or not JIT is enabled, checks the selected connection's exact
  configured app-role/`acct=0` admission rule before issuing a session; this also applies to
  existing invite- and SCIM-provisioned identities. A valid negative admission denies a new
  session and retires only that identity's OIDC/JIT grants; invalid/unverified tokens and
  invalid persisted configuration do not mutate grants. JIT remains a separate
  person/default-grant creation switch. This rule is IP-27 and the app role is never TaskDesk
  authority.
- Every validated OIDC login then reconciles only that external identity's OIDC groups from a complete,
  well-formed object-id `groups` array and refreshes its permitted JIT-default grant. It
  writes the grant delta, effective projection, provisioning event and audit rows in one
  transaction, commits, publishes cache invalidation, and only then issues the session.
- A valid token with absent, malformed, or overage groups supplies no group grants. Retire
  that identity's previous OIDC group grants; keep only an allowed JIT default and other
  independent grants; raise the existing provisioning event and operator warning for
  overage. Record `claim_missing` for absent/malformed groups, `claim_removed` for removals
  from a complete valid array, and `claim_overage` for the Entra overage form. Do not call
  Graph or retain stale groups. An invalid/unverified token causes no
  grant mutation. A valid token that fails current admission denies a new session and
  atomically retires only that identity's OIDC/JIT grants.
- Connection A's login neither applies A's group ids to connection B nor retires B's grants.
  B's upstream removal is observable only at B's next validated login, SCIM update, or
  administrative disable/change. Same email does not link identities; explicit linking
  remains the separately audited `IP-18` process.
- Mapping disable/change or mapped-role deletion immediately retires grants from that
  mapping and invalidates authority after commit. OIDC re-enable waits for later validated
  same-connection OIDC login with complete matching groups and current IP-27 admission;
  SCIM updates cannot restore OIDC grants. SCIM re-enable waits for later authenticated
  same-connection SCIM evidence; OIDC login cannot restore SCIM grants. Neither source
  revives historical rows merely because an administrator enables a mapping.
- Connection disable/delete revokes sessions issued through it and retires that connection's
  external grants, while preserving direct grants and grants from other connections.
- Global SCIM `active=false` marks the person inactive, revokes sessions and keys, and retires
  every external grant, including those from explicitly linked connections. Under the
  default `end_memberships` policy it also retires direct grants and removes effective rows.
  Under `keep_memberships`, direct grants/effective rows remain dormant while the person is
  inactive; external grants do not remain latent. Reactivation re-derives external authority
  only from current SCIM groups or a later validated OIDC login; revoked history is never
  restored automatically.

For every authority-changing write, use IP-22's total lock order and closure rediscovery/
retry; validate current caller, source/mapping/role and new configuration under those locks;
commit grant deltas, the materialized projection, and safe provisioning/audit records
together under the existing AU-14 audit-failure exception; then publish cache invalidation
after commit. If invalidation is lost, the documented 30-second authority-cache bound
remains. Ordinary role/policy edits change effective authority after invalidation but do not
revoke a live session. Session-table revocation is checked on the next request for lifecycle
transitions that explicitly revoke sessions. A failed transaction issues no new OIDC session
and publishes no partial grant state. Parent lifecycle changes use the same transaction: invalid
external target eligibility retires with existing `mapping_changed`; customer portal closure
also revokes customer sessions under the portal lifecycle rule. Direct grants remain independently
recorded, and restoring a parent or reopening the portal does not revive retired external grants
without fresh same-source evidence. This is the proposed storage rationale, not ADR approval or
runtime acceptance.

Use existing provisioning event keys `group.member_added`, `group.member_removed`,
`group.mapping_changed`, `connection.changed`, `request.denied`, and `auth.failed`.
Ceiling-policy retirement uses `group.mapping_changed`; connection configuration uses
`connection.changed`. The configuration mutation also writes the existing
`identity_connection.changed` event envelope/outbox row under EV-1. Bounded event detail may carry
source kind, connection id, external identity id, mapping id, affected scope/role ids and a
reason; it never stores raw claims or tokens. Grant rows and audit history keep the evidence
needed to explain changes without exposing provider payloads.

<a id="0015-membership-grant-provenance-consequences"></a>
### Consequences

<a id="0015-membership-grant-provenance-positive"></a>
#### Positive

- Removing one external source cannot erase a direct or independent grant.
- One materialized role preserves TaskDesk's established no-union RBAC rule.
- OIDC group removal and app-role removal become effective at the next validated login for
  that connection, while invalid tokens cannot revoke somebody else's current authority.
- Operators can inspect which source granted and retired authority; SCIM and OIDC retain
  separate evidence even for the same upstream group.
- Locks and a unique effective-row key define the concurrency boundary explicitly.

<a id="0015-membership-grant-provenance-negative"></a>
#### Negative

- This adds tables, indexes, migration/backfill work, and another projection that must stay
  transactionally consistent with the grant ledger.
- An upstream OIDC removal remains active until that connection's next validated login;
  without SCIM, TaskDesk cannot observe an upstream change between logins.
- Equal-rank distinct-role conflicts intentionally remove external effective access until
  an administrator fixes the mapping.
- `keep_memberships` retains direct grants as dormant rows for inactive people, which needs
  careful enforcement at every resolver and administrative screen.

<a id="0015-membership-grant-provenance-neutral"></a>
#### Neutral

- The named P3 acceptance inventory remains 25 tests. Grant provenance, login reevaluation,
  concurrency, and migration evidence are subcases; this ADR does not claim they exist or
  have run.
- The 30-second authority-cache bound, current MFA policy and step-up requirements remain
  governed by their existing contracts; this proposal adds no MFA or step-up exception.
- No external identity source can grant `instance:admin`, `sees_all`, customer-to-staff
  movement, a role above its connection ceiling, or scope outside its connection.

<a id="0015-membership-grant-provenance-alternatives-considered"></a>
### Alternatives considered

- **Keep only one `membership.derived_from` value.** Rejected: it cannot represent multiple
  independent valid sources, so one source's removal either erases another's authority or
  leaves stale authority.
- **Store multiple role names or union capabilities on `membership`.** Rejected: violates
  the established exactly-one-role contract and creates implicit capability unions.
- **Treat the last OIDC group claim as current until another is supplied.** Rejected: absent,
  malformed, or overage claims would retain stale privilege; invalid claims could also be
  mistaken for safe removal evidence.
- **Query Microsoft Graph during login overage.** Rejected for the first release: expands
  credentials, dependencies, failure modes, and network authority. Overage fails closed for
  group grants and is surfaced to an operator.
- **Revoke all of a person's grants when any connection changes.** Rejected except the
  explicit global `person.active=false` lifecycle transition: connection A is not evidence
  about B, and unrelated direct/SCIM grants must remain independent.

<a id="design-system"></a>
## Design system

`packages/ui` — extracted from kaneo, owned by us, the only source of UI primitives.

<a id="design-system-foundations"></a>
### Foundations

| | |
| --- | --- |
| Base | shadcn/ui, `new-york` style |
| Primitives | Base UI (`@base-ui/react`); Radix only per `packages/ui/KNOWN-RADIX.md` |
| Colour base | neutral |
| Styling | Tailwind CSS v4, CSS variables |
| Variants | class-variance-authority |
| Icons | lucide-react — the only icon source |
| Typography | Locally bundled Geist Variable / Geist Mono Variable (`@fontsource-variable`) |
| Motion | Framer Motion, tokenised |
| Catalogue | Storybook 10 |
| Charting | Recharts (Thomas, 2026-09-23 — see [decision log](retained-constraints.md#decision-log)) |
| Dashboard layout | react-grid-layout (Thomas, 2026-09-23 — see [decision log](retained-constraints.md#decision-log)) |

<a id="design-system-package-layout"></a>
### Package layout

```
packages/ui/
├── src/
│   ├── components/          the primitives
│   ├── styles/
│   │   ├── tokens.css       colour, spacing, radius, shadow, z-index
│   │   ├── theme.css        light/dark variable assignment
│   │   └── motion.css       duration and easing tokens
│   ├── hooks/               use-media-query, use-controllable-state, …
│   ├── lib/                 cn(), variant helpers
│   └── tailwind-preset.ts   consumed by apps/web
├── .storybook/
└── package.json
```

`apps/web` imports the preset and the components. It defines no primitives of its own.

<a id="design-system-the-primitives"></a>
### The primitives

Taken from Kaneo; every exported primitive requires a Storybook story and axe verification. This is a requirement, not a claim that those checks passed.

List regenerated from `ls apps/web/src/components/ui` (63 files, checked 2026-09-06), not
from memory. kaneo names two of these differently than shadcn convention (`menu`, not
`dropdown-menu`; `preview-card`, not `hover-card`) and has `calendar` where the doc
previously said `date-picker`/`date-range-picker` — use kaneo's real names below.

**Layout** — `sidebar` `breadcrumb` `separator` `scroll-area` `frame` `group`

**Forms** — `button` `input` `textarea` `checkbox` `checkbox-group` `radio-group` `select`
`combobox` `autocomplete` `switch` `toggle` `toggle-group` `slider` `input-otp`
`input-group` `number-field` `shortcut-number` `calendar` `field` `fieldset` `label` `form`

**Overlays** — `dialog` `alert-dialog` `sheet` `popover` `preview-card` `tooltip`
`context-menu` `menu` `menubar` `command`

**Display** — `card` `badge` `avatar` `table` `progress` `circular-progress` `meter`
`pagination` `timeline` `skeleton` `empty` `alert` `kbd`

**Disclosure** — `accordion` `collapsible` `tabs`

**Feedback** — `toast` `spinner` `error-boundary` `toolbar`

Twelve primitives this document previously listed **do not exist in kaneo** and are not
"taken from kaneo": `resizable`, `aspect-ratio`, `multi-select`, `date-picker`,
`date-range-picker`, `drawer`, `hover-card` (kaneo: `preview-card`), `dropdown-menu`
(kaneo: `menu`), `avatar-group`, `data-table`, `code`, `user-menu`. If a service desk needs
one of these, it is new work — build it from kaneo's primitives, mark it **authored, not
extracted** in "What we add for TaskDesk" below, and budget it; do not assume it ships free
with the extraction.

<a id="design-system-error-boundary"></a>
#### Error boundary

`Avatar` is the shared root/image/fallback primitive; the app adapter at
`apps/web/src/components/avatar/` owns API-origin resolution for uploaded `/api/...` URLs.
`error-display`, its one-line fallback wrapper, `/test-error` harness, and first-session
loading shell are application compositions, not shared primitives.

`ErrorBoundary` from `@taskdesk/ui` catches errors thrown while rendering its descendants.
Callers must provide a `fallback` component that receives the `Error` and a `resetError`
callback. The fallback owns recovery messaging and layout; calling `resetError` retries the
children. Keep application-specific fallback content in the app and use this primitive for
the shared catch-and-reset behavior. Error boundaries do not catch errors from event
handlers or asynchronous callbacks.

<a id="design-system-navigation--app-shell-composites-extracted-separately"></a>
### Navigation — app-shell composites, extracted separately

`nav-main` `nav-projects` `workspace-switcher` live at kaneo's `apps/web/src/components/*`,
not `components/ui/` — they are feature composites, not primitives (`nav-projects.tsx`
imports dnd-kit and is project-aware, which the rule below forbids in a primitive). They
move to `apps/web/src/components/app-shell/` alongside the extraction, not into
`packages/ui`. `user-menu` does not exist in kaneo (kaneo has `user-avatar.tsx`, a smaller
primitive) — build the menu from `avatar` + `menu`, marked **authored, not extracted**.

<a id="design-system-what-we-add-for-taskdesk"></a>
### What we add for TaskDesk

New primitives needed by a service desk. They live in `packages/ui` like everything else,
and they must look as though they shipped with the system.

| Primitive | Purpose |
| --- | --- |
| `sla-badge` | `ok` / `at-risk` / `breached` / `met` / `missed` / `none`, with remaining time |
| `sla-bar` | Consumed-time progress bar with a threshold marker |
| `priority-select` | Urgent / High / Medium / Low, with the escalate-only variant for customers |
| `state-select` | State picker that offers only legal transitions for the current role |
| `person-picker` | Avatar + name + role, scoped to the project roster |
| `approval-card` | Approver, status, expiry, decision affordance |
| `capability-matrix` | The grouped tick-box grid used to edit a role |
| `plugin-config-form` | Renders a form from a Zod schema — the God Mode workhorse |
| `visibility-toggle` | Public / internal, used on comments and attachments |
| `duration-input` | Hours and minutes, storing integer minutes |
| `calendar-window-editor` | Weekday coverage windows for a service calendar |
| `form-builder` | Drag-to-arrange request type form designer |
| `chart` | Wraps Recharts. `bar` / `line` / `number` variants for `reports-and-dashboards.md`'s three chart types |
| `chart-table` | The accessible table equivalent `RP-11` requires, rendered alongside every `chart` instance |
| `dashboard-grid` | Wraps react-grid-layout. Resizable, draggable dashboard widgets whose layout persists (`RP-15`) |

`capability-matrix` is a controlled renderer for already-loaded capability metadata and
selection state ([roles-and-permissions-ui.md](feature-contracts-p4.md#roles-and-permissions-ui),
RL-1–RL-3). It has no independent loading or error state: its caller owns data fetching,
saving, and any resulting feedback. It has no visual variants or size options in the
feature spec; grouped rows use the shared design tokens at the default density.

**`chart`'s contract:** series colours are drawn only from a fixed token ramp
(`--chart-series-1` … `--chart-series-n` in `tokens.css`), never a colour Recharts or a
caller picks freely. Register actual chart-series foreground/surface uses under the full shipped-source G3 inventory; no Button/Badge/Input-only coverage limitation is retained. `chart` never renders alone: every instance renders its `chart-table`
alongside it (visually hidden by default, reachable by keyboard, per `RP-11`), not as an
optional companion a screen may skip. A screen that renders a `chart` without its
`chart-table` fails `G4`.

**`dashboard-grid`'s keyboard path**, stated the way
[`accessibility.md`](architecture-and-experience.md#accessibility-keyboard) states dnd-kit's
for board drag, because react-grid-layout's own drag/resize handles
(`react-draggable`/`react-resizable`) are mouse- and touch-first with no keyboard
equivalent of their own: focus a widget's drag handle, `Enter` to enter move-or-resize
mode, arrow keys to move the widget by one grid cell, `Shift`+arrow keys to resize it by
one grid cell, `Enter` to confirm the new position and persist it, `Escape` to cancel and
restore the prior position — with live-region announcements at each step, the same shape
as the board-drag path. Without this, `dashboard-grid` lands in the Known-exceptions
table by default, which `RP-15` does not allow for a P4-governed feature.

`time-and-cost.md`'s timesheet ("a week grid, person by day, with inline entry, keyboard
navigation between cells") is not a thirteenth new primitive. It composes the existing
`data-table` (see "Twelve primitives ... do not exist in kaneo" above — `data-table` is
authored, not extracted) with an editable-cell variant: each body cell renders an
inline `duration-input` on focus/click rather than plain text, and column headers are the
seven weekdays rather than record fields. This is chosen over a dedicated `grid-editor`
primitive because the two components would share every structural concern — column
headers, row virtualisation for a long roster, keyboard navigation between cells — and a
timesheet is, structurally, a table whose cells happen to be editable, not a distinct
widget shape the way `dashboard-grid` (see below) is.

<a id="design-system-adding-a-primitive"></a>
### Adding a primitive

1. Check kaneo first. If it exists there, take it rather than writing it.
2. Build on a Base UI primitive where one exists. Do not reimplement focus management.
3. Tokens and density slots — no literal colours or arbitrary token values; density-sensitive
   rows, fields, and repeated cards use the shared `td-density-*` classes from
   `packages/ui/src/styles/density.css`. `check:tokens` enforces the declared slot inventory.
4. Use `cva` for variants. Support `className` passthrough and `asChild` where sensible.
5. Forward refs. Spread `...props`.
6. Write the Storybook story: default, every variant, every size, disabled, loading,
   error, and a long-content case.
7. Write the test: renders, keyboard-operable, axe clean.
8. Support light and dark.
9. Support `prefers-reduced-motion` if it animates.

The build fails if an exported component has no story.

<a id="design-system-caller-supplied-labels"></a>
### Caller-supplied labels

`packages/ui` has no `i18n` dependency (rule 1's "know nothing about the domain" — a
translation catalogue is an app concern), so a primitive that renders its own control —
a close button, a clear button, a chip's remove button — cannot read a translation key
for that control's accessible name itself. It takes the name as a required string prop
instead, the same pattern `toggle`, `kbd` and `switch` already use for `aria-label`. The
caller, which has `react-i18next` in scope, passes `t("…")` for it, so the rendered
accessible name is whatever the app's translation catalogue says — unchanged from when
the primitive read it directly. Name the prop after what it labels (`closeLabel` for a
close control, `removeLabel` for a remove control); when a single primitive renders more
than one such control, give each one its own prop rather than reusing one name across
controls that do different things. Make the prop required at the type level so a missing
label is a build-time error, not a silent blank `aria-label` — a discriminated union on
the prop that controls whether the labelled element renders at all (e.g.
`showCloseButton`) narrows that requirement to exactly when the control is actually
rendered.

<a id="design-system-composition-rules"></a>
### Composition rules

```
packages/ui/components/       primitives          — know nothing about the domain
apps/web/src/components/      feature composites  — know about work items
apps/web/src/routes/          screens             — assemble composites
```

A primitive that imports a type from the domain is in the wrong place.

```tsx
// ✗ never
<button className="rounded bg-blue-500 px-3 py-1.5">Save</button>

// ✓ always
<Button variant="default" size="sm">Save</Button>
```

<a id="design-system-application-shell"></a>
### Application shell

Taken from kaneo unchanged.

**Agent** — collapsible sidebar with workspace switcher, primary navigation and project
list; topbar with breadcrumb, search, notification bell and user menu; command palette on
`⌘K`. Below the shared `app` breakpoint (900 px), the sidebar becomes an icon rail.

**Portal** — the same shell, dramatically simplified: a short navigation list, no
workspace switcher, no command palette by default. Same components, less of them.

<a id="design-system-icons"></a>
### Icons

`lucide-react`, and nothing else. Never an inline SVG, never a second icon library,
never an emoji as an icon.

v1 shipped buttons with empty icon paths because icons were referenced from a map that
had gaps. Importing icons directly makes that failure impossible for **code** — a missing
icon there is a compile error. But `project.icon`, `work_item_type.icon` and
`request_type.icon` ([data model](data-model.md)) are **data**, chosen
at runtime by an administrator, not by a developer importing a named component — the same
class of gap v1 hit, just moved from code to configuration.

So: a stored icon value is a **lucide icon name** (e.g. `"circle-alert"`, the kebab-case
name `lucide-react` exports as a component), validated against a checked-in allowlist —
`packages/ui/src/lib/icon-names.ts`, generated from the installed `lucide-react` version
so it can never name an icon that package does not ship. The icon picker offers only
allowlisted names; nothing writes a `project.icon`/`work_item_type.icon`/
`request_type.icon` value outside that list. When a stored name is not on the current
allowlist — a downgraded `lucide-react` version, or a row written before an icon was
renamed upstream — it renders the documented fallback icon (`circle-help`), never a gap
and never a compile error at runtime.

<a id="design-system-theming"></a>
### Theming

Light and dark, driven entirely by CSS variables in `theme.css`. A component never
branches on theme; it uses semantic tokens (`bg-background`, `text-muted-foreground`)
which resolve per theme.

Instance branding overrides a small, bounded, named set of CSS variables at runtime,
injected from `/api/public/branding`. No rebuild. This is the same list named in
[`plugin-architecture.md`](architecture-and-experience.md#plugin-architecture-branding) and
[`configuration-reference.md`](configuration.md) —
one list, cited in three places, not three lists that can drift apart:

| Variable | Backs |
| --- | --- |
| `--brand-accent` | Accent colour — primary buttons, links, focus rings |
| `--brand-logo-light` | Logo shown on a light background |
| `--brand-logo-dark` | Logo shown on a dark background |
| `--brand-login-background` | Login page background image or colour |
| `--brand-favicon` | Favicon |

Nothing outside this list is accepted. An administrator cannot submit an arbitrary CSS
variable name or value — `/api/public/branding`'s write path rejects any key not in the
table above, server-side, before it reaches `instance_branding`. This is a styling-
injection surface otherwise: an unbounded "custom CSS variable override" lets an
administrator write anything the theme engine will interpolate into the page.

Runtime validation for `--brand-accent` uses the same WCAG AA threshold described for `G3`
([`ux-quality-gates.md`](architecture-and-experience.md#ux-quality-gates-g3--contrast)), against both the light
and dark `--background` it will pair with. A submission that fails AA contrast is not
silently accepted — God Mode shows the computed ratio and a warning before save, the same
shape as any other validated form field. `G3`'s own CI check only ever sees the committed
tokens; this runtime check is God Mode's job, not CI's, because the value does not exist
until an administrator saves it.

<a id="design-system-storybook"></a>
### Storybook

Runs at `pnpm --filter @taskdesk/ui storybook`, deployed alongside the documentation site,
and is the canonical catalogue. Every primitive appears with all its states.

Visual snapshots run against Storybook so an unintended visual change to a primitive fails
the build rather than being discovered on a screen three weeks later — see
[G8](architecture-and-experience.md#ux-quality-gates-g8--visual-regression) for the selected Playwright in-repository baselines.

<a id="design-system-attribution"></a>
### Attribution

`packages/ui` contains substantial verbatim kaneo code under MIT. Copyright headers stay.
See [Licensing and attribution](retained-constraints.md#licensing-and-attribution).

<a id="design-system-related"></a>
### Related

- [Design tokens](#design-tokens) · [Design principles](architecture-and-experience.md#design-principles)
- [Motion](#motion) · [Accessibility](architecture-and-experience.md#accessibility)
- [ADR 0008](#0008-single-design-system)


<a id="design-system-application-compositions"></a>
#### Application compositions

`packages/ui` contains reusable primitives only. App-owned avatar URL resolution stays in
`apps/web/src/components/avatar/`; API-aware error display/fallback compositions live in
`apps/web/src/components/errors/`; and the first-session shell placeholder lives in
`apps/web/src/components/app-shell/`. The `/test-error` diagnostic remains route-local.
The extracted legacy `apps/web/src/components/ui` directory must remain empty; G1c in
`ux-quality-gates.md` is enforced by `scripts/ci/check-ui.mjs`. Density class and contrast-pair
ownership are defined in `design-tokens.md` and enforced by G2/G3. Authored palette matching remains provisional until visual comparison in the consolidated phase review and Thomas's acceptance; numeric contrast alone is not visual acceptance.

This is the disposition of #403's five former app-specific files: `avatar.tsx` became the
adapter in `components/avatar/`; `error-display.tsx` and `error-fallback.tsx` live in
`components/errors/`; `error-test.tsx` is the `/test-error` route module; and
`loading-skeleton.tsx` lives in `components/app-shell/`. Their app behavior is retained, but
none is a permanent exception to G1c. Avatar visual treatment still requires original-Kaneo comparison; pending review is not a directory-placement exception.

<a id="design-tokens"></a>
## Design tokens

Semantic colors and theme values are tokens. Repeated rows, shared form controls and
`CardPanel` use the registered density classes. Layout spacing, type, shadow and z-index use
Tailwind's built-in scales directly, as selected in the 2026-09-06 design decision. G2 does
not claim a repository-wide ban on arbitrary-value syntax or one-off radii; it enforces the
explicit token and density contracts below.

Tokens live in `packages/ui/src/styles/`:

- `tokens.css` — the primitive scales
- `theme.css` — semantic assignment per theme
- `motion.css` — duration and easing

This document is split by provenance, because the two halves carry different weight:
**inherited** tokens are copied verbatim from kaneo's `apps/web/src/index.css` and must not
drift from it; **authored** tokens are new work TaskDesk is adding, with no kaneo source to
check against.

<a id="design-tokens-two-layers"></a>
### Two layers

**Primitive tokens** are raw values with no meaning: `--color-neutral-500`. **Semantic
tokens** give them a job: `--color-muted-foreground`, `--radius-md`.

Application code uses **only semantic tokens**, via Tailwind classes. This is what makes
theming and rebranding a variable change rather than a search-and-replace.

kaneo's real chain is two semantic hops, not one — a `:root` value, then a `@theme inline`
alias that gives Tailwind its class:

```
--color-neutral-800  →  --foreground  →  (@theme inline) --color-foreground  →  text-foreground
```

---

<a id="design-tokens-inherited-from-kaneo--verbatim"></a>
### Inherited from kaneo — verbatim

Everything in this section is copied exactly from `apps/web/src/index.css` at extraction.
Do not round the numbers or "clean up" the curves — matching kaneo bit-for-bit is the point
of [H1](architecture-and-experience.md#design-principles).

<a id="design-tokens-colour-base"></a>
#### Colour base

Base scale is **neutral** (Tailwind's `neutral-*` ramp), not zinc. Accent is overridable at
runtime by instance branding.

<a id="design-tokens-semantic-assignments"></a>
#### Semantic assignments

| Token | Tailwind class | Light | Dark |
| --- | --- | --- | --- |
| `--color-background` | `bg-background` | `--color-white` | `color-mix(neutral-950 96%, white)` |
| `--color-foreground` | `text-foreground` | `--color-neutral-800` | `--color-neutral-100` |
| `--color-card` | `bg-card` | `--color-white` | `color-mix(background 98%, white)` |
| `--color-popover` | `bg-popover` | `--color-white` | `color-mix(background 98%, white)` |
| `--color-muted` | `bg-muted` | `--alpha(black / 4%)` | `--alpha(white / 4%)` |
| `--color-muted-foreground` | `text-muted-foreground` | `color-mix(neutral-500 90%, black)` | `color-mix(neutral-500 90%, white)` |
| `--color-border` | `border-border` | `--alpha(black / 8%)` | `--alpha(white / 6%)` |
| `--color-input` | `border-input` | `--alpha(black / 10%)` | `--alpha(white / 8%)` |
| `--color-ring` | `ring-ring` | `--color-neutral-400` | `--color-neutral-500` |
| `--color-primary` | `bg-primary` | `--color-neutral-800` | `--color-neutral-100` |
| `--color-secondary` | `bg-secondary` | `--alpha(black / 4%)` | `--alpha(white / 4%)` |
| `--color-accent` | `bg-accent` | `--alpha(black / 4%)` | `--alpha(white / 4%)` |
| `--color-destructive` | `bg-destructive` | `--color-red-500` | `color-mix(red-500 90%, white)` |
| `--color-destructive-strong` | `bg-destructive-strong` | `--color-red-700` | `--color-red-700` |
| `--color-destructive-strong-foreground` | `text-destructive-strong-foreground` | `--color-white` | `--color-white` |

There is **no `--color-danger`** — kaneo's breach/error role is `--destructive`. Every
colour above also has a `-foreground` counterpart for text placed on it
(`--destructive-foreground`, `--accent-foreground`, `--muted-foreground`, `--card-foreground`,
`--popover-foreground`, `--primary-foreground`, `--secondary-foreground`), listed once here
rather than doubled in the table. Destructive action fills use the additional authored,
provisional `--color-destructive-strong` / `--color-destructive-strong-foreground` pair so a
solid destructive button can pass AA independently of the softer status color.

<a id="design-tokens-status-colours"></a>
#### Status colours

Reserved. Do not use them decoratively — their scarcity is what makes them legible.

| Token | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `--success` / `--success-foreground` | `emerald-500` / `emerald-700` | `emerald-500` / `emerald-400` | Met SLA, completed, healthy |
| `--warning` / `--warning-foreground` | `amber-500` / `amber-700` | `amber-500` / `amber-400` | At-risk SLA, pending approval, degraded |
| `--info` / `--info-foreground` | `blue-500` / `blue-700` | `blue-500` / `blue-400` | Neutral informational |

(`--destructive` / `--destructive-foreground` carries the breached/failed/blocked role —
see the semantic table above. There is no separate `--danger` token.)

<a id="design-tokens-chart-series"></a>
#### Chart series

`--chart-1` … `--chart-5` are reserved for chart primitives. **Different in light and
dark** — copy both, do not average them. Register actual chart-series pairs in the full shipped-source G3 inventory; no primitive-only coverage limit applies:

| Token | Light | Dark |
| --- | --- | --- |
| `--chart-1` | `orange-600` | `blue-700` |
| `--chart-2` | `teal-600` | `emerald-500` |
| `--chart-3` | `cyan-900` | `amber-500` |
| `--chart-4` | `amber-400` | `purple-500` |
| `--chart-5` | `amber-500` | `rose-500` |

<a id="design-tokens-code"></a>
#### Code

`--code` (background), `--code-foreground`, `--code-highlight` — used by the code/`kbd`
family and the rich-text renderer's code blocks. `--code-foreground` is an alias of
`--foreground` in both themes; `--code` and `--code-highlight` are theme-specific mixes —
copy them from `index.css` rather than re-deriving.

<a id="design-tokens-radius"></a>
#### Radius

One root token plus four `calc()` derivations — **do not** hand-write four independent
px values, and do not copy shadcn's older 0.5rem-based scale:

```
--radius:     0.625rem                              (10px)
--radius-sm:  calc(var(--radius) - 4px)              (6px)   inputs, badges
--radius-md:  calc(var(--radius) - 2px)              (8px)   buttons, cards ← the default
--radius-lg:  var(--radius)                          (10px)  dialogs, popovers
--radius-xl:  calc(var(--radius) + 4px)              (14px)  large surfaces
```

There is **no `--radius-full` token** in kaneo. Where a fully-round corner is needed
(avatars, pills), use Tailwind's `rounded-full` utility directly rather than inventing a
token for it.

<a id="design-tokens-easing"></a>
#### Easing

kaneo defines **exactly two** easing curves, in the `@theme inline` block. There is no
third curve and no spring in CSS:

```
--ease-out:     cubic-bezier(0.23, 1, 0.32, 1)
--ease-in-out:  cubic-bezier(0.77, 0, 0.175, 1)
```

See [Motion](#motion) for which interactions use which curve.

<a id="design-tokens-reduced-motion"></a>
#### Reduced motion

Adopted verbatim from kaneo's rule, which deliberately does **not** collapse every duration
to zero — it keeps the opacity feedback and drops only movement and container morphs:

```css
@media (prefers-reduced-motion: reduce) {
  [data-slot="popover-popup"],
  [data-slot="select-popup"],
  [data-slot="menu-popup"],
  [data-slot="menu-sub-content"],
  [data-slot="tooltip-popup"],
  [data-slot="dialog-popup"],
  [data-slot="alert-dialog-popup"],
  [data-slot="command-dialog-popup"],
  [data-slot="sheet-popup"],
  [data-slot="toast-popup"] {
    transition-property: opacity !important;
  }

  [data-slot="sidebar-gap"],
  [data-slot="sidebar-container"],
  [data-slot="sidebar-group-content"],
  [data-slot="sidebar-menu-badge"] {
    transition: none !important;
  }

  /* dnd-kit writes the shuffle transition inline, so this needs !important. The
     dragged element still tracks the pointer; only the reflow is neutralized. */
  [data-kaneo-sortable] {
    transition: none !important;
  }
}
```

Carry the full `data-slot` list across unchanged — it is the enumeration of every popup
that must keep its fade — and keep the dnd-kit `!important` note; it is a real gotcha, not
decoration.

---

<a id="design-tokens-authored-by-taskdesk"></a>
### Authored by TaskDesk

Nothing below exists in kaneo. It is new design-system work the extraction does not give
us for free, and it must be written and reviewed like any other design system change.

<a id="design-tokens-priority-and-sla-colour-tokens"></a>
#### Priority and SLA colour tokens

```
--color-priority-urgent    --color-priority-high
--color-priority-medium    --color-priority-low

--color-sla-ok        --color-sla-at-risk    --color-sla-breached
--color-sla-met       --color-sla-missed     --color-sla-none
```

**Provisional values**, derived from kaneo's existing amber/emerald/red/blue families so
they sit next to kaneo rather than introducing a new hue:

| Token | Provisional source |
| --- | --- |
| `--color-priority-urgent` | `--destructive` (red-500 family) |
| `--color-priority-high` | `--warning` (amber-500 family) |
| `--color-priority-medium` | `--info` (blue-500 family) |
| `--color-priority-low` | `--muted-foreground` (neutral) |
| `--color-sla-ok` / `--color-sla-met` | `--success` (emerald-500 family) |
| `--color-sla-at-risk` | `--warning` (amber-500 family) |
| `--color-sla-breached` / `--color-sla-missed` | `--destructive` (red-500 family) |
| `--color-sla-none` | `--muted-foreground` (neutral) |

These authored values are provisional. Original-Kaneo visual comparison, numeric contrast and actual phase evidence remain required; this source supplies no accepted extraction or palette review.

<a id="design-tokens-spacing-z-index-type-scale-shadow-layout--deleted"></a>
#### Spacing, z-index, type scale, shadow, layout — deleted

The previous version of this document invented `--space-0..20`, `--z-base..--z-tooltip`,
`--text-xs..2xl`, `--shadow-sm/md/lg` and a set of layout tokens
(`--sidebar-width`, `--topbar-height`, `--detail-pane-width`, `--content-max-width`). None
of these exist anywhere in kaneo (`grep -c` for each prefix in `index.css` is 0) — they
were presented as extraction but were invented.

**Retained design contract:** TaskDesk uses Tailwind's built-in spacing,
z-index, type and shadow scales directly, exactly as kaneo does, rather than wrapping them
in a bespoke token layer. Component authors reach for `p-4`, `text-sm`, `z-50`,
`shadow-sm`, etc.; there is no `--space-*`/`--z-*`/`--text-*`/`--shadow-*` indirection to
maintain or drift from kaneo. If a real need for a semantic layout token
(`--sidebar-width`, `--detail-pane-width`) is found during extraction, add it here with a
value at that point — do not carry the old placeholder numbers forward.

Density-aware spacing uses three shared classes in `packages/ui/src/styles/density.css`:
`td-density-row` defaults to `py-3` and becomes `py-2` under the existing
`html.compact-mode`; `td-density-field` defaults to `py-2` and becomes `py-1.5`; and
`td-density-card` defaults to `p-4` and becomes `p-3`. These are Tailwind built-in values,
not a new spacing-token layer. Apply them only to registered repeated rows, field controls,
and shared card content panels. The `compact-mode` root class remains the
existing persisted user preference. G2 rejects direct vertical padding/gap utilities on a
registered slot; ordinary layout spacing remains unrestricted.

<a id="design-tokens-density-slot-inventory-g2"></a>
#### Density slot inventory (G2)

| Class | Declared use | Comfortable | Compact |
|---|---|---|---|
| `td-density-row` | Repeated data rows in shared list/table compositions | `py-3` | `py-2` |
| `td-density-field` | Shared form field control/label group | `py-2` | `py-1.5` |
| `td-density-card` | Shared card content panels (`CardPanel`) | `p-4` | `p-3` |

This is the P0/P1 starter inventory; additions require updating this table and the checker in
the same implementation slice. Colors and visual matching remain provisional until consolidated review and Thomas's acceptance; the numeric contrast gate remains required throughout.

<a id="design-tokens-motion"></a>
#### Motion

See [Motion](#motion) for the full rule. `--ease-spring` is **not valid CSS** —
`spring(1, 100, 15, 0)` is Framer Motion notation — so it does not live in `motion.css`.
It moves to `motion.ts` as a Framer Motion transition object instead:

```ts
export const springSettle = { type: "spring", stiffness: 100, damping: 15, mass: 1 };
```

`--ease-in` is **dropped**: kaneo's `plans/001-motion-tokens-and-easing.md` prescribes only
`--ease-out` and `--ease-in-out` (verified against the plan directly — it never defines an
`--ease-in`), and `index.css` defines the same two curves and no third. Motion.md's
"leaving uses `ease-in`" rule is corrected there to use one of the two real curves.

Reduced motion for `--duration-*` follows the same rule stated in the inherited section
above — durations are not all collapsed to `--duration-instant`; movement and container
morphs drop, opacity feedback stays.

<a id="design-tokens-contrast-g3"></a>
#### Contrast (G3)

Every foreground/background pair meets **WCAG AA**: 4.5:1 for body text, 3:1 for large
text and non-text indicators.

Most of kaneo's surface tokens are translucent or computed — `--alpha()` (a Tailwind v4
build-time function) and `color-mix()` — so a script reading the CSS source text cannot
produce a contrast ratio directly. The checker must:

1. Resolve colours from the **built** stylesheet, e.g. render each theme in headless
   Chromium and read `getComputedStyle`, rather than parsing source CSS.
2. Evaluate `--alpha()` and `color-mix()` by **compositing the translucent token over its
   effective backdrop** (the surface it is actually painted on in that pair), not in
   isolation.
3. Check every manifest entry in its declared theme(s) and fail on a violation. Theme-specific
   interaction classes may be represented by separate entries.

`packages/ui/src/styles/pairs.json` is the machine-readable inventory for styled TSX/JSX
sources under `packages/ui/src` and `apps/web/src`, including shared primitives and
application compositions. The checker fails when a newly observed pair has no inventory
entry. Each entry records
`fg`, `bg`, `category` (`body`, `large-text`, or `non-text`), `minRatio`, its declared
`themes` (one or both; interaction variants may have theme-specific entries),
`usage` (the real component/story/screen owner), `foregroundClass`, `backgroundClass` (the
actual surface class for each theme, including alpha/interaction modifiers), and `backdrop`
when either computed color is translucent. The source inventory covers every shipped
TSX/JSX component and Storybook story under `packages/ui/src` and `apps/web/src`, including
application compositions. It follows actual component/caller surfaces and fails on
unresolved or unbound foreground occurrences; unit-test and spec renderers are excluded
because they do not establish shipped screen surfaces. Adding a styled source or a new
foreground/surface combination requires its measured occurrences and actual pairs in the same
gate batch. Example:

```json
{
  "fg": "--color-foreground",
  "bg": "--color-background",
  "category": "body",
  "minRatio": 4.5,
  "themes": ["light", "dark"],
  "usage": "packages/ui/src/components/button.tsx",
  "foregroundClass": "text-foreground",
  "backgroundClass": { "light": "bg-background", "dark": "bg-background" },
  "backdrop": "--color-background"
}
```

The inventory lists actual combinations, not every theoretical cross-product. The gate
compares observed declared pairs across the full shipped source set against the manifest;
new or unclassified use fails until it has an explicit entry. Repeated equivalent numeric
pairs are deduplicated only after each occurrence has a current source-bound surface proof.
The runner builds and loads the
web CSS in Chromium, resolves the computed colors in each theme and interaction state,
composites alpha over the recorded opaque backdrop, then computes WCAG 2.1 contrast. For
autofill, only the built `:has(:autofill)` selector is substituted with a probe attribute
because headless Chromium cannot synthesize autofill; its production class, declaration,
variables, and cascade are still measured. Body text uses 4.5:1; large text
and non-text indicators use 3:1.

Status must never be conveyed by colour alone. An SLA badge carries an icon and a label as
well as a colour.

<a id="design-tokens-typography"></a>
### Typography

Geist Variable and Geist Mono Variable for keys, IDs and code. `apps/web` imports the
fonts from the installed `@fontsource-variable/geist` packages; they are bundled locally,
with no runtime font CDN request. The fallback stack is `ui-sans-serif, system-ui,
sans-serif` for body text and `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
"Liberation Mono", "Courier New", monospace` for keys and code.

Weights: 400 body, 500 emphasis, 600 headings. Nothing heavier — kaneo does not use bold
type for hierarchy, it uses size and colour.

Work item keys (`SUP-1234`) always render in Geist Mono, so they are recognisable and
selectable as a unit.

The type scale itself is Tailwind's built-in `text-*` utilities (see "Spacing, z-index,
type scale… deleted" above) rather than a bespoke `--text-*` token set.

<a id="design-tokens-breakpoints"></a>
### Breakpoints

```
sm   640px    md  768px    app 900px    lg  1024px    xl  1280px    2xl 1536px
```

The meaningful application breakpoint is **900 px** (`app:` / `--breakpoint-app`), below
which the agent sidebar collapses to an icon rail and the portal switches to a bottom bar.
It is defined in `packages/ui/src/styles/theme.css` so responsive compositions use one
shared breakpoint.

<a id="design-tokens-enforcement"></a>
### Enforcement

`pnpm check:tokens` runs the static G2 checker and built-CSS G3 browser checker. G2's
intentional scope is semantic color/theme parity plus direct fixed spacing overrides on the
registered density slots; it does not lint every Tailwind spacing, radius or z-index utility.
G3 checks the full shipped component/story source inventory described above. The current CI
implementation is `scripts/ci/check-tokens.mjs` and `scripts/ci/check-contrast.mjs`.

The static G2 checker fails on:

- A hex colour, `rgb()`, `hsl()`, `oklch()`, `color-mix(` or `--alpha(` outside
  `packages/ui/src/styles/`
- A fixed vertical padding/gap utility on a registered `td-density-*` slot
- A used foreground/background combination missing from `pairs.json` or a declared pair
  failing contrast in either theme, per the Chromium compositing rule above
- A token referenced but not defined

<a id="design-tokens-adding-a-token"></a>
### Adding a token

1. Is an existing token close enough? Almost always yes — use it.
2. If not, add the **primitive** to `tokens.css`.
3. Add the **semantic** alias to `theme.css` for both themes.
4. Extend the Tailwind preset so it has a class.
5. Check contrast.
6. Document it here, under "Authored by TaskDesk" unless it is copied from kaneo.

Adding a token is a design system change and gets reviewed as one.

<a id="design-tokens-related"></a>
### Related

- [Design system](#design-system) · [Motion](#motion)
- [Accessibility](architecture-and-experience.md#accessibility) · [UX quality gates](architecture-and-experience.md#ux-quality-gates)

<a id="motion"></a>
## Motion

Original Kaneo motion is the source. The retained rules below preserve the seven referenced specification subjects; a sibling checkout is not a prerequisite and this reference does not claim those files are present in a particular checkout:

| Spec | Subject |
| --- | --- |
| `001-motion-tokens-and-easing.md` | Duration and easing tokens, reduced-motion strategy |
| `002-scope-transitions.md` | Transitions between scopes: workspace, project, item |
| `003-instant-command-palette.md` | Command palette responsiveness |
| `004-press-feedback.md` | Press and tap affordances |
| `005-reduced-motion.md` | `prefers-reduced-motion` handling |
| `006-fluid-micro-moments.md` | Micro-interactions |
| `007-board-reflow.md` | Kanban card reflow on drag |

This document summarises the rules and states the ones specific to TaskDesk.

<a id="motion-the-rule"></a>
### The rule

**Motion explains a relationship. If it does not explain something, delete it.**

Good: a dialog scaling out of the button that opened it, so you know where it came from.
A card settling into a new column, so you know the drop worked. A row sliding away, so you
know it was removed rather than never having been there.

Bad: a fade because the screen looked abrupt. A bounce because it seemed fun. A staggered
list entrance on every route change, which turns a 50 ms navigation into a 400 ms one.

<a id="motion-tokens"></a>
### Tokens

```css
--duration-instant:   0ms;
--duration-fast:    100ms;   /* hover, press, tooltip */
--duration-normal:  200ms;   /* dropdown, popover, toast */
--duration-slow:    300ms;   /* dialog, sheet, route */

--ease-out:     cubic-bezier(0.23, 1, 0.32, 1);    /* things arriving — kaneo's value, verbatim */
--ease-in-out:  cubic-bezier(0.77, 0, 0.175, 1);   /* things moving — kaneo's value, verbatim */
/* kaneo defines exactly these two curves (apps/web/src/index.css). "Leaving" reverses
   --ease-out through the transition rather than adding a third curve; the drag-settle spring
   is a Framer Motion transition object in motion.ts, because spring() is not valid CSS. */
```

Arriving and leaving use `ease-out` — fast start, gentle finish. Moving uses
`ease-in-out`. These are the two easing curves defined by the design system.

<a id="motion-what-animates"></a>
### What animates

| Interaction | Duration | Easing | Property |
| --- | --- | --- | --- |
| Hover | fast | out | background, border |
| Press | fast | out | `scale(0.98)` |
| Tooltip | fast | out | opacity, 2 px lift |
| Dropdown / popover | normal | out | opacity, `scale(0.96 → 1)` |
| Dialog | slow | out | opacity, `scale(0.96 → 1)`, backdrop fade |
| Sheet / drawer | slow | out | transform on axis |
| Toast | normal | out | slide + fade |
| Board card drop | normal | spring | transform |
| Board reflow | normal | in-out | layout (`layoutId`) |
| Row add / remove | normal | out / out | height + opacity |
| Route change | fast | out | opacity only |
| Accordion | normal | in-out | height |
| Skeleton → content | fast | out | opacity crossfade |

<a id="motion-what-does-not-animate"></a>
### What does not animate

- **Data arriving.** Numbers do not count up. Charts do not draw themselves in.
- **Route changes**, beyond a brief opacity crossfade. Navigation must feel instant.
- **Focus rings.** They appear immediately. Delaying a focus ring is an accessibility bug.
- **Anything above 300 ms.** If it feels like it needs longer, it needs rethinking.
- **Long lists.** No staggered entrance for a 200-row table.

<a id="motion-reduced-motion"></a>
### Reduced motion

kaneo's rule, adopted verbatim: **drop movement and container morphs, keep opacity**. A
fade that disappears is a regression for the very users the preference serves; a slide or a
re-flow that disappears is the point. kaneo does this with selectors, not by zeroing every
duration:

```css
@media (prefers-reduced-motion: reduce) {
  /* popups keep their opacity feedback, lose their movement — the data-slot list is in index.css */
  [data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="popover-content"],
  [data-slot="menu-content"], [data-slot="tooltip-content"] {
    transition-property: opacity !important;
  }
  /* containers that re-flow do not animate at all */
  [data-sidebar], [data-kaneo-sortable] { transition: none !important; }
}
```

The `!important` on `[data-kaneo-sortable]` is deliberate — dnd-kit sets inline transitions.
(The earlier block here declared custom properties outside any selector, which is invalid
CSS and did nothing; corrected 2026-09-06.)
Framer Motion uses `useReducedMotion()` to switch to instant variants.

Critically, **reduced motion removes the animation, not the affordance**. A dialog still
appears; it simply appears without scaling. Nothing becomes unusable, and nothing becomes
invisible.

Required: run the full E2E suite with `reducedMotion: 'reduce'` and assert that every journey remains operable; this is not a passing-test claim.

<a id="motion-drag-and-drop"></a>
### Drag and drop

The one place where motion is genuinely functional rather than decorative.

- The dragged card lifts: `scale(1.02)` plus Tailwind's `shadow-md`, at `--duration-fast`.
- The source position collapses; other cards reflow with `layoutId` at
  `--duration-normal`.
- A drop indicator marks the insertion point — a 2 px accent line, no animation.
- On drop, the card settles with the Framer Motion `springSettle` transition from
  `packages/ui/src/lib/motion.ts`.
- On invalid drop, it returns to origin at `--duration-normal` with `--ease-in-out`, and a
  toast explains why. Never a silent snap-back.

Under reduced motion the card jumps without the spring, and the drop indicator does all
the communicating.

<a id="motion-performance"></a>
### Performance

- Animate **`transform` and `opacity` only**. Anything else means layout or paint on every
  frame.
- Height animations use a measured `max-height` or Base UI's collapsible (its height is exposed through Base UI's own CSS variable, not `--radix-collapsible-content-height`), never
  `height: auto`.
- `will-change` is applied at interaction start and removed at end, never left on.
- Budget: 60 fps. A dropped frame during a board drag is a bug, and is caught by the
  performance assertion in CI.

<a id="motion-loading"></a>
### Loading

Skeletons, not spinners, and skeletons that match the shape of what is coming — a table
skeleton has rows, a card skeleton has a title bar and a body block. A centred spinner
tells the user nothing about what they are waiting for.

Skeletons pulse at `--duration-slow` with a shimmer. After 10 seconds a message appears
("Still loading — this is taking longer than usual") with a cancel affordance.

Spinners are reserved for **in-button pending states** on a mutation, where the shape is
already known.

<a id="motion-related"></a>
### Related

- [Design tokens](#design-tokens) · [Design principles](architecture-and-experience.md#design-principles)
- [Accessibility](architecture-and-experience.md#accessibility)
- kaneo's `plans/` directory

<a id="glossary"></a>
## Glossary

Terms mean exactly this throughout the codebase, the UI and these documents. If you need
a new term, add it here first.

<a id="glossary-tenancy-and-structure"></a>
### Tenancy and structure
| **State** | Where one work item sits in its lifecycle ([ADR 0011](#0011-ticket-lifecycle-engine)) |
| **Person** | Someone in exactly one organisation. Not the same as a better-auth `user`: the identity key is `(identity_connection_id, subject)`, and one human may hold two `person` rows — staff-side and customer-side — under the same email |

| Term | Meaning |
| --- | --- |
| **Instance** | One deployment of TaskDesk. Owns instance-level settings, identity providers, and the God Mode surface. |
| **Organisation** | A tenant boundary. Customers belong to an organisation. Cross-organisation reads return 404. |
| **Workspace** | A container for projects, members and roles. An instance may have many. Inherited from kaneo. |
| **Team** | A grouping of staff within a workspace, with capacity. Owns queues and saved views. |
| **Project** | A dated engagement with a start, an end, a backlog and optional cycles. |
| **Managed service** | An indefinite engagement with a support level (L1/L2/L3) and a cover window. Has no end date and no cycles. |
| **Engagement** | Umbrella term for *project or managed service* when the distinction doesn't matter. |

<a id="glossary-work"></a>
### Work

| Term | Meaning |
| --- | --- |
| **Work item** | The universal unit of work. Everything is a work item: ticket, task, bug, story, epic, change, problem. |
| **Work item type** | Determines which fields, workflow and SLA policy apply. Configurable per workspace. |
| **Ticket** | A work item of a service-desk type (Incident, Service Request, Change, Problem). Not a separate table. |
| **Key** | Human-readable identifier, `PROJ-123`. Unique per instance, stable forever. |
| **State** | Where a work item sits in its workflow. Belongs to a state group. |
| **State group** | `backlog` · `unstarted` · `started` · `completed` · `cancelled`. Reporting groups by this, not by state name. |
| **Column** | A board column. Maps to one state. |
| **Relation** | A typed link between two work items: `relates`, `blocks`, `duplicates`, `precedes`, `requires`. |
| **Parent / child** | Hierarchy. Modelled separately from relations, deliberately. |

<a id="glossary-service-desk"></a>
### Service desk

| Term | Meaning |
| --- | --- |
| **Request type** | A customer-facing template: a name, an icon, a form, a target work item type, a workflow and an SLA policy. |
| **Catalogue** | The set of request types a given customer can see in the portal. |
| **Intake** | The queue of submissions that have not yet become work items. |
| **Submission** | A customer's raw request before triage. Has its own reference (`SUB-123`) and its own message thread. |
| **SLA policy** | A named set of goals. Each goal is (request type × priority) → duration, measured in covered time. |
| **Service calendar** | Which hours count as covered: 8×5, 12×5, 24×7, plus holidays. |
| **Covered time** | Elapsed time counted only within the service calendar. All SLA durations are in covered time, never wall-clock. |
| **SLA state** | `ok` · `at-risk` (75% consumed) · `breached` · `met` · `missed` · `none`. |
| **Approval** | A request for a decision from a named approver, with an expiry. Blocks a transition if the workflow says so. |
| **CAB** | Change Advisory Board. An internal approval gate on change-type work items. |

<a id="glossary-access"></a>
### Access

| Term | Meaning |
| --- | --- |
| **Reach** | *Which* engagements a person can see. One of the two RBAC axes. |
| **Authority** | *What* a person may change. The other RBAC axis. Never derived from reach. |
| **Capability** | A single named permission, e.g. `work_item:assign`. The atom of authorization. |
| **Role** | A named, editable set of capabilities, stored as a row. Admins create and edit roles in settings. |
| **Policy** | The capability requirement declared by a route. Every route must have one. |
| **Side** | `staff` or `customer`. Determined by the directory, never by a token claim. |
| **Portal** | `agent` or `customer`. Which of the two front-ends. Each has its own origin and session. |
| **God Mode** | The instance administration surface. Requires the `instance:admin` capability. |
| **Impersonation** | An instance admin acting as another user. Always audited, always banner-visible. |
| **Identity connection** | One configured external identity source (Microsoft Entra first), bound to exactly one portal and — for customers — exactly one organisation. Owns OIDC settings and, optionally, a SCIM connection. |
| **SCIM** | System for Cross-domain Identity Management — the inbound API a directory uses to create, update and *deactivate* people before or without a login. Core P3 delivery for Entra. |
| **External identity** | The durable link between a person and an identity provider: issuer + immutable subject (+ SCIM `externalId`). Email is an attribute, never the key. |
| **Pending action** | A server-held, single-use record that a named human approved one exact destructive operation (every deletion; destructive MCP calls). Nothing is deleted without one. |

<a id="glossary-configuration-and-extension"></a>
### Configuration and extension

| Term | Meaning |
| --- | --- |
| **Plugin** | A runtime-registered implementation of a capability contract — an auth provider, storage backend, notification channel, importer. |
| **Registry** | The in-process map of plugin id → implementation, populated at boot from built-ins and from DB configuration. |
| **Provider config** | A DB row holding one plugin's settings for this instance, edited in God Mode. Secrets encrypted at rest. |
| **Feature toggle** | A per-project or per-workspace switch that hides a whole feature. |
| **Lifecycle engine** | The one state + workflow mechanism used by every work item type — service or delivery alike. See [ADR 0011](#0011-ticket-lifecycle-engine). |
| **Terminology overlay** | Admin-renameable label for a fixed, enumerated set of domain nouns (work item, project, cycle, …), per instance or workspace. Never changes an API key or a stored value. See [ADR 0012](#0012-terminology-overlay). |
| **License plugin** | A `license.*` plugin resolving marketplace entitlement and reporting usage. `license.none` by default — nothing reports anywhere unless an administrator enables one. See [ADR 0013](#0013-marketplace-metering-plugin). |

<a id="glossary-engineering"></a>
### Engineering

| Term | Meaning |
| --- | --- |
| **Primitive** | A UI component in `packages/ui`. The only legal source of UI building blocks. |
| **Fetcher** | A typed function calling the API, in `apps/web/src/fetchers/`. |
| **Query hook / mutation hook** | TanStack Query wrappers in `src/hooks/queries` / `src/hooks/mutations`. |
| **Route registry** | The single declaration of every URL in the app, with a round-trip test. |
| **Permission matrix test** | The CI test asserting every role × route allow/deny. |
| **UX gate** | A CI check enforcing a design rule. See [UX quality gates](architecture-and-experience.md#ux-quality-gates). |

<a id="glossary-terms-we-do-not-use"></a>
### Terms we do not use

| Don't say | Say |
| --- | --- |
| Issue, task, card, ticket *(as a table name)* | **Work item** |
| Status | **State** |
| Tenant | **Organisation** |
| Permission *(as a role)* | **Capability** for the atom, **role** for the set |
| Client | **Customer** |
| Agent *(as a person)* | **Staff**. "Agent" means the agent *portal*, or an AI agent. |

<a id="coding-standards"></a>
## Query ownership contract

Non-query coding, UTC timestamp/raw-Date and performance clauses are maintained in [retained coding standards](retained-constraints.md#coding-standards). Query and transaction boundaries below are not proof that a checker is wired or all queries are currently scoped.

**Repositories own queries.** Controllers, middleware and services never build a query. A
repository call that can return cross-organisation data receives the resolved identity and
applies the caller's reach in the statement predicate. An additional workspace or project id
must be checked against that identity; an id alone is not authoritative scope. Repository
location alone does not guarantee scoping. The ownership rule and conventions are under
[Query ownership](#coding-standards-query-ownership-issue-580) below. `check:queries` (issue #580) is planned
but not currently wired, and will enforce query locations rather than tenant-predicate semantics.

<a id="coding-standards-query-ownership-issue-580"></a>
#### Query ownership (issue #580)

- **Where queries may live.** Drizzle/SQL statements are written only in these places, and
  the final `check:queries` enumerates them exactly, with no wildcard over `database/`, no
  per-site allowlist and no baseline:
  1. repository modules, recognised by their own name: `**/repository.ts`,
     `**/*.repository.ts` and `**/repository/**` (this includes feature repositories that
     happen to sit under `database/`, for example
     `apps/api/src/database/repositories/notification-delivery.repository.ts`);
  2. the persistence infrastructure, an explicit list of files under `apps/api/src/database/`:
     `schema.ts`, `relations.ts`, `index.ts`, `executor.ts`, `resolve-database-url.ts`,
     `wait-for-database.ts`, `prepare-database-startup.ts`, `migration-schema.ts`,
     `migrate-membership-provenance.ts`, `ensure-application-role.ts`,
     `assert-application-role-is-not-privileged.ts`,
     `assert-no-migration-url-in-api-process.ts`, `append-only-tables.ts` and
     `scram-sha-256.ts`.
  A new file under `database/` is not allowed to query until it is either named as a
  repository or added to that list in a reviewed change. Controllers, middleware, services,
  routes and scheduler code call repository functions. Startup SQL outside `database/` (for
  example `utils/migrate-*`) moves into the list above or into a repository.
- **Transactions.** A service may open `db.transaction(...)` as orchestration. Every statement
  inside it goes through a repository function that accepts the handle. Opening a transaction is
  not query construction; running a statement outside a repository is.
- **Executor.** `Executor` (`apps/api/src/database/executor.ts`) is the shared connection or a
  transaction handle. A repository function that always runs inside a caller's transaction takes
  `executor: Executor` as its first parameter. A function that is callable both inside and
  outside a transaction takes `executor?: Executor` as its last parameter and resolves it with
  `executorOrDefault(executor)`. A function that never joins a transaction may use the shared
  connection directly. A repository never opens, commits or rolls back a transaction it was
  handed.
- **Tenant scoping.** A repository query that can return cross-organisation data uses the
  resolved identity and applies the caller's reach in the statement predicate. An additional
  workspace or project id is checked against that identity and also appears in the predicate;
  supplying an id alone does not prove the caller's reach. `forIdentity(identity)` remains the
  accepted illustration/convention for scoped repositories, without claiming a literal fluent
  API or universal `ScopedQuery` type guarantee is implemented. See [multi-tenancy](safety-and-runtime.md#multi-tenancy-query-scoping)
  and the [security model](safety-and-runtime.md#security-model-5-secrets-never-serialise-queries-are-never-unscoped).
- **Results.** Repository functions await their statement and return rows, DTOs or scalars,
  never an un-awaited query builder, so a caller cannot keep composing the statement.
- **Raw SQL and fragments.** Raw `execute`/`sql` statements follow the same rule. SQL fragment
  helpers (for example a project-scope predicate) live in repository modules and are composed
  there.
- **Out of scope.** `apps/api/scripts/**` (dev and seed tooling, not shipped in the image).

**Domain is pure.** No Drizzle import, no Hono import, no `Date.now()` — pass `now` in.
This is what makes it testable.

<a id="migrations"></a>
## Migration convention

How the schema in [data-model.md](data-model.md) becomes SQL, how it is applied, and how recovery works. Intended migration behavior is distinct from current runtime evidence.

<a id="migrations-kaneos-history-is-inherited"></a>
### kaneo's history is inherited

TaskDesk's `apps/api/drizzle/` **starts from kaneo's 45 migrations** (`0000_confused_pixie.sql`
through `0044_needy_triathlon.sql`) and their `meta/_journal.json`, exactly as taken at the
snapshot commit. There is **no hand-made `0001_initial.sql`**: the first TaskDesk migration is
`0045_…`, generated like every one after it.

Every fork-time removal — the four billing tables, `integration`, `github_integration`,
`project.is_public` — is therefore a **new, additive migration** on top of that history,
generated from the post-strip `schema.ts`, not an edit to an inherited file. Inherited files
are never touched.

**Trade-off, stated honestly:** every fresh TaskDesk database replays kaneo's history —
creating and then dropping billing, integration and public-board columns — and kaneo's table
and enum names are baked into the early migrations. The alternative (squash to a generated
baseline and regenerate the journal) is cleaner and is one command. Inheriting wins because
the inherited journal is what kaneo's own integration suite was validated against, so it is
the only baseline the pre-copy test run can be attributed to
([repository-bootstrap.md](retained-constraints.md#repository-bootstrap) §0). **This choice is recorded from
Thomas confirmed this on 2026-09-06: inherit the 45, no squashed baseline.** It remains
reversible until the first TaskDesk migration is written.

<a id="migrations-files"></a>
### Files

```
apps/api/drizzle/
  0000_confused_pixie.sql          inherited from kaneo, unchanged
  …                                45 inherited files, 0000 … 0044
  0044_needy_triathlon.sql
  0045_taskdesk_remove_billing.sql the first TaskDesk migration — generated, never hand-edited
  0046_…
  meta/                            drizzle-kit's journal, inherited and appended to
  snapshots/
    2.0.0.sql                      pg_dump --schema-only at each stable release (upgrade matrix)
```

- Generated migrations come from `pnpm db:generate` against `schema.ts` and are committed. Inspect the actual SQL, not only the schema diff, within the current integrated implementation and consolidated phase review.
- **Hand-written SQL is appended into a generated migration file**, so the journal tracks it.
  There is no `custom/` directory and no interleaving runner: `drizzle-kit migrate` applies
  only what `meta/_journal.json` lists, and wrapping it in an entrypoint does not give it a
  second directory to scan. The `work_item.key` trigger, the extensions and the append-only
  grants each land at the end of the generated migration that introduces the table they
  concern.
- **Forward-only.** No down migrations exist. To undo, write a new migration that reverses
  the change. This is why destructive changes are two-phase (below).

<a id="migrations-applying-at-boot"></a>
### Applying at boot

The container entrypoint, before the API listens:

```
1. connect with the application role
2. SELECT pg_advisory_lock(7263849)          -- one constant for the whole product
3. run pending migrations in journal order, each in its own transaction
4. SELECT pg_advisory_unlock(7263849)
5. mark readiness true; start the HTTP listener and the scheduler
```

- Every other replica starting concurrently blocks at step 2 and proceeds after the first
  has finished — they then find nothing pending. No replica serves traffic against an
  unmigrated schema: readiness is false until step 4.
- A failing migration exits the process non-zero **without** unlocking a partial state (the
  failed statement's transaction rolled back); the deploy stops at that replica, the
  previous digest keeps serving, and the operator reads the log. Resume by fixing forward.
- `drizzle-kit migrate` does none of this on its own; the entrypoint wraps it.

<a id="migrations-two-phase-destructive-changes"></a>
### Two-phase destructive changes

Renaming or dropping a column that a running replica may still read:

1. Add the new column; dual-write from the application (release N).
2. Backfill in a migration or a job; switch reads to the new column (release N+1).
3. Drop the old column (release N+2).

At every intermediate point the previous image still works against the current schema —
which is what makes a **rollback of the image** safe while the schema stays.

<a id="migrations-the-workitemkey-assignment"></a>
### The `work_item.key` assignment

Not a generated column. On insert, a trigger does

```sql
update project set last_work_item_number = last_work_item_number + 1
  where id = new.project_id returning last_work_item_number into n;
new.number := n;  new.key := (select key from project where id = new.project_id) || '-' || n;
```

The `UPDATE … RETURNING` serialises concurrent inserts on the project row — deliberate: two
inserts in one project must not collide, and a per-project row lock is the cheapest correct
mechanism. The trigger writes `number` and `key` only: it touches neither `version` nor
`updated_at`, so it can never be mistaken for a concurrent edit by optimistic locking or by
the activity feed. A cross-project move re-keys (new number in the new project) and writes a
`work_item_key_alias` row so the old key redirects.

**Firing order against `work_item_claim_key` (#191).** `work_item` also carries
`work_item_claim_key`, the `BEFORE INSERT OR UPDATE OF "key"` trigger that populates the
`work_item_key_claim` registry (see that table's comment in `schema.ts`). When more than one
`BEFORE ROW` trigger is defined for the same table and event, PostgreSQL fires them in
**alphabetical order by trigger name** — not declaration order, and not migration order. This
key-assignment trigger must be named so it sorts BEFORE `work_item_claim_key`; otherwise the
claim trigger runs first and reads `NEW."key"` before this trigger has set it. Verify the
actual order with `SELECT tgname FROM pg_trigger WHERE tgrelid = 'work_item'::regclass ORDER
BY tgname;` against the migrated schema before shipping either trigger.

<a id="migrations-append-only-tables"></a>
### Append-only tables

`audit_log` is append-only by absence of an endpoint, by two triggers, AND (issue #296) by
grant — three independent controls, not one:

- **Triggers, migration `0067`:** `audit_log_append_only` (`BEFORE UPDATE OR DELETE ... FOR
  EACH ROW` / `audit_log_reject_mutation()`), which raises on every UPDATE/DELETE attempt
  except `AU-7`'s `organisation_id`-to-NULL tombstone; and `audit_log_append_only_truncate`
  (`BEFORE TRUNCATE ... FOR EACH STATEMENT` / `audit_log_reject_truncate()`), which raises
  unconditionally, because a row-level trigger never fires for `TRUNCATE` at all. Required verification must attempt `TRUNCATE`, not only row mutations.
- **Grant, issue #296:** the application role `taskdesk_app` holds `SELECT, INSERT` and no
  `UPDATE, DELETE` on `audit_log` (and on `activity`) — no `TRUNCATE`, no DDL, either. This
  was the primary control this section originally described as unbuilt (decision log,
  2026-09-23, "`audit_log` is append-only by trigger, not by grant") — it is now built.

The two are deliberately redundant: the trigger closes the gap for any role that DOES hold
UPDATE/DELETE (a future maintenance role, an operator connected directly), and the grant
closes it for `taskdesk_app` specifically, which no longer has the privilege to attempt the
mutation the trigger would otherwise have to reject. `AU-7`'s tombstone survives the grant
restriction: it fires from `audit_log.organisation_id`'s own `ON DELETE SET NULL` foreign-key
action when a row is deleted from `organisation`, and Postgres enforces a referential action
using the privileges checked when the constraint was created, not the deleting session's own
grants on the referencing table. Required database tests must distinguish direct child DML from the parent foreign-key action.

**`activity` grant restriction covers direct DML .** `activity.work_item_id` is `ON DELETE CASCADE` to `work_item`
(migration `0066`), and `taskdesk_app` holds ordinary `DELETE` on `work_item` and `project`
(neither is append-only). **Decided behaviour, not a regression, not revoked:** deleting a
work item, or a project or workspace whose deletion cascades to its work items, removes that
work item's `activity` rows as a side effect of the cascade — the table owner runs it, with
no privilege check against `activity` itself, exactly the same mechanism that lets `AU-7`'s
tombstone through above. The `SELECT, INSERT`-only grant on `activity` stops a direct
`UPDATE`/`DELETE`/`TRUNCATE` issued against `activity`; it was never a claim that `activity`
rows are immortal once their parent work item is gone. Verify both direct-DML denial and permitted parent-cascade behavior against a real database.

**Mechanism (issue #296).** Not a grant hand-written into each table's own generated
migration, as this section once proposed. That approach could not carry `taskdesk_app`'s
password (deployment-specific, rotatable) and could not stay correct once a table's
append-only status changes without a further migration. Instead `ensureApplicationRole`
(`apps/api/src/database/ensure-application-role.ts`) runs as the **migration/owner role**,
in the separate, one-shot **migrate step** (`TASKDESK_ROLE=migrate`; see "Two processes,
never one credential in both" below) immediately after Drizzle's `migrate()`: it
creates/repairs `taskdesk_app` (never a superuser, never a table owner — enforced further by
`assertApplicationRoleIsNotPrivileged` in the separate serving process), then re-derives
every table's grant from `APPEND_ONLY_TABLES`
(`apps/api/src/database/append-only-tables.ts`) — `SELECT, INSERT` for a table named there,
`SELECT, INSERT, UPDATE, DELETE` for every other ordinary table — and sets
`ALTER DEFAULT PRIVILEGES` so a table a *future* migration creates gets the ordinary grant
automatically. `activity` has the same required grant restriction as `audit_log`; the retained requirement adds the same trigger-based treatment when that table is touched. Check actual trigger coverage rather than assuming a grant is a trigger.

**Two processes, never one credential in both.** The migrate step above and the API's own serving boot used to be one function in
one long-running process, which meant that process had to be started with
`TASKDESK_MIGRATION_DATABASE_URL` — the owner/superuser credential — in its environment for
its whole life, reachable by any process-level compromise regardless of what the code did
with the connection afterwards. They are now two separate entry points, selected the same way
`TASKDESK_ROLE=web`/`jobs` already are
(`docs/05-operations/container-image.md`): `TASKDESK_ROLE=migrate` runs migrations and
`ensureApplicationRole` against the owner connection and exits; the ordinary serving process
(`web`/`jobs`/`all`) never receives that variable at all, and refuses to start if it ever
does. In compose this is a one-shot `migrate` service the `taskdesk` service `depends_on`
(`service_completed_successfully`); in Helm it is an initContainer on the `taskdesk`
Deployment's own Pod (a `pre-install` hook Job was tried first, and removed — it ran
before the chart's own ServiceAccount and bundled Postgres existed, so a fresh
`helm install` timed out; an initContainer has no such ordering problem, since Kubernetes
itself guarantees every initContainer completes before that Pod's own containers start).
See [configuration-reference.md](configuration.md) for the
exact variables and the local-development path.

The retention purge running as a separate `taskdesk_maint` role from the `audit-purge` job's
own connection is unbuilt scope, tracked on the audit-log work, not issue #296.

<a id="migrations-seeds"></a>
### Seeds

`pnpm seed minimal|realistic|hostile` runs **after** migrations, through the application's
own repositories — never raw SQL — so seeded data obeys the same invariants as real data.
Seeds are idempotent per dataset name.

<a id="migrations-testing"></a>
### Testing

- Required: migrations applied from empty against **Testcontainers Postgres 18** — the whole
  journal, inherited files included; schema drift test (`drizzle-kit check`) fails if
  `schema.ts` and the migrations disagree. Note that kaneo's own CI validated these 45
  migrations on **Postgres 16**, so the first run on 18 is new information: any difference it
  surfaces is inherited, not caused by us, and belongs in the fork's verification record.
- Release validation: the **upgrade matrix** — restore `snapshots/<N-1>.sql` and
  `snapshots/<N-2>.sql`, apply all migrations forward against synthetic data, run the
  integration suite. This is what proves [release-plan.md](retained-constraints.md#release-plan)'s
  "upgrades cleanly from the two preceding minors."
- The production-copy dry run is an **operator** step in the [runbook](operations-and-distribution.md#runbook)
  against a restored, anonymised backup — never a CI job, because CI holds no production
  data.

<a id="migrations-related"></a>
### Related

- [Data model](data-model.md) · [CI/CD](ci-gates.md) · [Release plan](retained-constraints.md#release-plan)
- [Backup and restore](operations-and-distribution.md#backup-and-restore)

<a id="licensing-and-attribution"></a>
## Licensing and attribution

The complete retained clauses are maintained in [Licensing and attribution](retained-constraints.md#licensing-and-attribution). Current application-source restrictions, license/provenance obligations and owner decisions remain binding. No archival legal compatibility or process statement creates a new permission.

<a id="risks"></a>
## Product risks and owner decisions

The complete retained clauses are maintained in [Product risks and owner decisions](retained-constraints.md#risks). Current application-source restrictions, license/provenance obligations and owner decisions remain binding. No archival legal compatibility or process statement creates a new permission.

<a id="README"></a>
## Decision index

Accepted/proposed below describes the original architectural decision, not implemented or verified product behavior. ADR 0015 remains proposed; implementation authorization is not approval.

<a id="README-index"></a>
### Index

| # | Title | Status |
| --- | --- | --- |
| [0001](#0001-kaneo-as-foundation) | kaneo as the foundation, taken once, not forked | Accepted |
| [0002](#0002-single-backend) | One backend, not three | Accepted |
| [0003](#0003-better-auth-primary) | better-auth primary, identity providers as runtime plugins | Accepted |
| [0004](#0004-two-portals-two-origins) | Two portals, two origins, one codebase | Accepted |
| [0005](#0005-agpl-licensing) | AGPL-3.0 | Accepted |
| [0006](#0006-plugin-registry) | Runtime plugin registry over build-time configuration | Accepted |
| [0007](#0007-in-process-jobs) | In-process scheduled jobs, no worker service | Accepted |
| [0008](#0008-single-design-system) | One design system package, no bespoke primitives | Accepted |
| [0009](#0009-lazy-sla-evaluation) | SLA computed on read, never stored | Accepted |
| [0010](#0010-route-policy-registry) | Every route declares its policy; CI enforces it | Accepted |
| [0011](#0011-ticket-lifecycle-engine) | One generic lifecycle engine for every work item, not per-category logic | Accepted |
| [0012](#0012-terminology-overlay) | Terminology overlay: renameable nouns, separate from renameable states | Accepted |
| [0013](#0013-marketplace-metering-plugin) | Marketplace listing and usage metering are an optional plugin, never a default | Accepted |
| [0014](#0014-limited-home-realm-disclosure) | Customer home-realm routing accepts limited domain-specific disclosure | Accepted |
| [0015](#0015-membership-grant-provenance) | Membership grant provenance and effective-role projection | Proposed — Thomas approval required, not granted |

<a id="owner-decisions-2026-10"></a>
### Dated owner decisions, 22–23 October 2026

Recorded in chat by Thomas, or taken by the coordinator under his standing instruction of 22 October to approve the recommended option (marked *standing*). Each row names the requirement it governs.

| Date | Decision | Governs | Basis |
| --- | --- | --- | --- |
| 22 Oct | The work-item composer is neutral (no warning-tinted card); Internal/Public is a toggle plus an explanatory sentence | `CA-5`, UI-04 | Thomas rejected the tinted composer |
| 22 Oct | "Git update" means commit and push the feature branch (never main, never force); the Technexus image is built by pushing, opening the PR and letting CI scan and build, after local SIT passes | process | Thomas |
| 23 Oct | Staged attachment cards instead of inline pasted images in the create dialog until P1 completes inline embedding | `AT-11`, `AT-13` | Thomas |
| 23 Oct | `PA-1a` exemptions (unlinks, own settings, session-only configuration rows, revocation under another authenticator) | `PA-1`, `PA-4` | Thomas |
| 23 Oct | Children keep `parent_id` through the 30-day restore window and are detached at purge; a project with live child projects cannot be deleted | `RH-11`, `PR-16`, `PR-20` | standing |
| 23 Oct | User-preference keys `listGroups.<projectId>` and `columns.<projectId>` | `VW-15`, `VW-19` | standing |
| 23 Oct | Inherited project membership is evaluated at read time, with authority from the nearest ancestor grant when the child has none | `PR-2`, `PR-3`, `PR-4` | standing |
| 27 Oct 2026 | Upgrade path for the newly enforced default-off flags: migration `0206` writes an enabled, unlocked **instance** row for `feature.sla`, `feature.customer_portal`, `feature.timeline` and `feature.calendar` only when the database already holds a workspace and no instance row exists, so an upgraded installation keeps what it used (workspaces created later inherit it too) while a fresh install keeps the documented default (off). Existing instance rows and workspace/project overrides are never changed; instance level (not per-workspace rows) so an administrator can still turn a flag off once for the whole instance. Migration `0209` completes it: 0096 had already seeded these rows as off (version 1, no author), so 0206 left them off; 0209 switches on only rows still exactly as seeded | `ST-1`, `ST-11` | Thomas |
| 27 Oct 2026 | Audit export is elevated (P2R1-11): `POST /api/instance/audit/export` needs `instance:read_audit`, a browser session and a one-use PA-15 `audit_export` proof bound to the exact format, filters and row cap; migration `0207` adds the operation to `step_up_operation_route` | `AU-13`, `PA-15` | contract (feature-contracts-p2.md) |
| 27 Oct 2026 | Imported events are history, not triggers. Events the import writer emits carry `payload.source = "import"`. Automations and outbound webhooks skip them (P6-R1-07). This decision extends that to notifications: `materializeNotificationFanout` creates no inbox row, email, digest or external-channel delivery for any import-sourced event (assigned, mentions, comments, state, delta updates). Outbox, audit and realtime records are kept. | `IM-1`..`IM-7`, P6-R1-07, P6-R2-01 | Thomas (recommended option, standing approval) |
| 27 Oct 2026 | A request type that has ever received a submission cannot be deleted, open or closed: every submission pins one of its form versions, so deletion would erase the customer record. `DELETE /api/request-types/{id}` is a click-level pending action, refused while the type is published (unpublish first) and while any submission exists, checked at request and again at approval; unpublishing is the way to retire a used type | `PA-1`, request-type edge cases (feature-contracts-p2.md), P2R1-18 | Thomas (recommended option, standing approval) |
| 27 Oct 2026 | Customer approvers get approval notifications: the addressed customer approver of a still-valid customer approval receives `approval.requested`, `approval.expiring` (AP-13 reminders) and `approval.withdrawn` in the portal inbox and, per preference, by email. They never receive `approval.decided` or `approval.expired`, which are staff-side outcomes and do not appear in the portal inbox | `AP-21`, `AP-13`, P2R1-04, P2R2-04 | Thomas (recommended option, standing approval) |
| 27 Oct 2026 | `NO-18` is read strictly: a customer is notified about a work item only when it is linked to a submission they themselves requested (their own linked request), never for other requests of their organisation or for items they merely reach; enforced at fan-out and again at send time. Implemented in commit `f5521fb67` | `NO-18`, `EV-5` | Thomas (recommended option, standing approval) |

<a id="decision-provenance"></a>
## Precedence and source conflicts

- ADR 0014 records accepted limited home-realm disclosure only; its archived standing delegation is not renewed. ADR 0015 remains proposed while implementation of the documented recommendation is authorized. Retained owner-approved per-row membership reconciliation is a data/authority precondition, not redundant review paperwork; do not weaken it. Its private schema, digest, source proof, current-admin verification, total parent lock/retry and atomic all-or-nothing cutover/repair clauses remain intact above.
- Query ownership specifies allowed repository/infra locations and executor boundaries. It does not prove tenant predicates, infer a universal scoped-query wrapper or permit a broad `database/**` exception. Any current-code discrepancy is work to resolve, not a contract rewrite.
- The migrations opening boot sketch's “application role” cannot override the later explicit migration-only owner credential process. Serving processes never receive migration-owner credentials and fail if they do. Startup ordering, advisory serialization, journal transactions, forward-only recovery and previous-image compatibility remain requirements. The general generated-migration rule permits the explicitly documented hand-written trigger/extension/grant SQL appended to a generated journaled migration; it does not permit an untracked runner.
- ADR0012's older singular/plural schema and accessible-name tooltip suggestion are superseded by the maintained CLDR `forms jsonb` and visible-label-equals-accessible-name contract: the default noun may be in `title`, not an overriding `aria-label`. Stable API keys/paths never change with display terminology. Later source-specific IP/portal rules govern identity; an older “immediate revocation” summary never collapses the distinct next-request session check and 30-second authority-cache bound.
- Job-lease SQL must follow the retained UTC timestamp encoding/comparison contract; an older “kept verbatim” lease example does not override it. Lease at-least-once/idempotence, renewal/abort and outbox SKIP LOCKED semantics remain unchanged.
- Full shipped-source G3 pair/surface proof supersedes stale three-primitive coverage language. Actual backdrop/translucency and computed light/dark CSS remain mandatory. G8 uses the settled Playwright in-repository baseline choice. Authored palette values are provisional until original-Kaneo comparison; numeric contrast alone is not visual acceptance. Current UI boundary has no approved Radix exception; an old ADR escape description adds none.
- The accepted auth architecture does not approve every future provider or imply factors are enabled. Entra remains core; SAML and other provider expansion follow the current roadmap rather than the older ADR 0003 “Stage 5” placement. Separate stored authority/cache/session rules override broad historical “immediate” summaries.
- Glossary code nouns do not override audience-facing copy: the interface may say Status and the portal says Request, while internal schema/state/capability identifiers remain stable.
- The original Kaneo shell/composition/controls/editor/DnD/animation remain binding. New business-aware picker examples are feature compositions where they require domain types/data; they cannot override `packages/ui`'s no-domain/no-I/O boundary. Shared controlled presentation can live there with caller-supplied values/labels. Existing Calendar/Gantt remains P1 continuity; older Timeline/P5 descriptions and illustrative wireframes do not redesign it. No automatic 150-line limit or per-change approval round survives current instructions.
- Application source comes only from Kaneo or TaskDesk v1. Historical licensing discussions of broader legal compatibility are not permission to copy other applications. Preserve AGPL product/source obligations, Kaneo MIT notices, compatible library licenses and actual source/image provenance; new dependencies still need Thomas's approval. Marketplace listing is deferred; BYOL/contract is preferred, and `license.none` never phones home.
- Preserved source descriptions of file presence, tests, triggers, engines or proposed implementation do not establish today's code or runtime. Current registered identifiers and retained owner choices control implementation; report unresolved mismatches honestly. This document does not accept ADR 0015 or claim any database migration, token gate, browser journey, restore or external review ran.

## Inactive historical references

Only obsolete workflow/delegation provenance may remain here; product clauses must live in maintained sections above or the linked runtime/operations/feature references. These original path strings are not active instructions or archive dependencies.
| 23 Oct | Custom-role capabilities live in the canonical `role` + `membership` tables, not `workspace_role` | `RL-1`, `RL-2`, `RL-4`, `RL-5` | Thomas |
| 23 Oct | PA-15 allowlist gains keys for impersonation start and secret rotation | `GM-7`..`GM-11`, `GM-13` | Thomas |
| 23 Oct | Holiday dataset (CAL-10/11) and list-virtualisation dependency approved; log in `THIRD-PARTY-NOTICES.md` | `CAL-10`, `CAL-11` | Thomas |
| 23 Oct | Customer invitations (CP-11/12/13) and typed-domain SSO (CP-17/18) deferred to P5 pending contracts | `CP-11`..`CP-13`, `CP-17`, `CP-18` | Thomas |
| 23 Oct | P5: rename old time table to `task_time_entry`; inline-SVG charts + Table equivalents; dnd-kit dashboard grid; indented-list service impact; estimates under project settings; CAB workflow opt-in for existing workspaces; NOT VALID FKs with scratch DB first; staff-only project Pages; customer-scoped invitations refusing staff roles | `TC-*`, `RP-*`, `ES-*`, `SVC-*`, `CH-*`, `CP-11` | Thomas (recommended options) |
| 23 Oct | Customer invitations use a new hashed single-use credential and a scope discriminator on `invitation`; Pages reuse `project:read`/`project:update`; typed-domain route claims non-enumeration for accounts only (ADR 0014); invitation lifetime and rate limits are instance configuration | `CP-20`..`CP-29`, `PG-1`..`PG-8` | standing |
| 27 Oct 2026 | The local-factor policy applies to staff only: customers are exempt in every mode (including `required_everyone`) and customer SSO sign-in never reaches the agent-only `/auth/two-factor` (a factor a customer enrolled voluntarily is still honoured on local sign-in); the God Mode label reads "Everyone (staff)" | `CP-19`, `P3-R1-04` | recommended option, Thomas standing rule |
