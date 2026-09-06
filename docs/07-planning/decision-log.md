# Decision log

Decisions too small for an [ADR](../01-architecture/adr/README.md) but worth recording:
dependency choices, convention changes, scope calls, gate waivers.

Newest first.

## Format

```markdown
### YYYY-MM-DD · Short title
**Decision:** what we are doing
**Why:** the reasoning
**Alternatives:** what was rejected, briefly
**Decided by:** who
```

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
