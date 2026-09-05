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

### 2026-09-05 · Confirmed decisions A–N, and Microsoft Entra SCIM/OIDC as core delivery

**Decision:** Thomas's confirmed decision document of 2026-09-05 is **product policy**.
Each section is recorded in the document it governs; this entry is the index.

| § | Decision | Recorded in |
| --- | --- | --- |
| A | The four-week plan is a **flexible target**; the whole program may take **three to four months**; a phase or task may finish in **one to three days** where kaneo already provides it. Finish when exit criteria are met; never remove security/quality/test/review gates to hit a date; narrow scope, move work later or move the date, and record it. **An operating rule, not a decision to reopen** | [phases.md](phases.md) (top), [accelerated-delivery-plan.md](accelerated-delivery-plan.md), [status.md](status.md) |
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
[reviews/2026-09-05/](reviews/2026-09-05/) and are closed at SDLC stage 2 of each feature,
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
  (`alpha` → `beta` → `rc`) are flipped on `main` at phase closes; no second long-lived
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
was "Phase 5"; [roadmap.md](roadmap.md) and [phases.md](phases.md) list it as a candidate,
not scheduled. Two documents against one — intake-queue.md is corrected. `IQ-1` still
names email as a possible source so the data model does not preclude it.

**Why:** found by the 2026-09-05 cross-document review. Recorded because a phase
assignment stated in one spec and denied in the roadmap is exactly how scope creeps in
unnoticed.

**Decided by:** Thomas

---

### 2026-09-05 · CHANGELOG.md added; release notes formalised alongside the auto-generated log

**Decision:** a `CHANGELOG.md` exists at the repo root from today, in Keep a Changelog
format, with an honest "no code released yet" `[Unreleased]` entry rather than fabricated
history. [CI/CD](../04-engineering/ci-cd.md) gains a **Release notes** section requiring a
short human-written summary at every phase close, alongside the entries
`semantic-release` generates automatically, and ties that moment to updating the
[screen inventory](../02-design/screen-inventory.md) and
[feature index](../03-features/README.md) status columns together, so "what shipped"
answers consistently from all three places.

**Why:** an explicit requirement for changelogs, feature-completion tracking and release
documentation. A generated commit log alone doesn't answer "what can I do now that I
couldn't before"; a separate, disconnected release-notes process drifts from what the
screen inventory and feature index say. Tying the three together at one moment (the phase
close, [SDLC](../04-engineering/sdlc.md) stage 8) is cheaper than reconciling them later.

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
every pull request and every phase gate, distinct from the general architecture/QA review
even when the same model performs both. Recorded in
[agent-workflow.md](../04-engineering/agent-workflow.md#model-tiers-within-claude-code) and
referenced from [SDLC](../04-engineering/sdlc.md) stages 5 and the phase gate.

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

**Decision:** the roadmap sequences phases but gives no dates.

**Why:** throughput for one human plus three agents is unknown. Dates now would be fiction,
and fiction that gets planned against is worse than no plan. After P0 and P1 there is
evidence.

**Decided by:** Thomas

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

*(None yet.)*

```markdown
### YYYY-MM-DD · Waived <gate> in PR #n
**Gate:** G-n
**Reason:**
**Follow-up:** issue #n
**Approved by:** Thomas
```

## Related

- [ADR index](../01-architecture/adr/README.md) · [Risks](risks.md) · [Status](status.md)
