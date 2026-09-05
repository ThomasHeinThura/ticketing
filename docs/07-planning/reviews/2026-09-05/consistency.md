# TaskDesk v2 — cross-document consistency audit

- **Repository:** `/Users/heinthura/Documents/Workfolder/Development/Ticketing.v2`
- **Date:** 2026-09-05
- **Scope:** cross-document contradictions and stale values only. Per-document quality,
  prose, and structure are out of scope. No repository file was modified.
- **Pinned reference stack:** Node 24 · TypeScript 7 · pnpm 10 · Turborepo 2 · Biome 2 ·
  Hono 4 · @hono/zod-openapi → OpenAPI 3.2 · Zod 4 · Drizzle 0.45 · PostgreSQL 18 ·
  better-auth 1.6 · Valkey 9 · SeaweedFS (default object storage; MinIO dropped) ·
  React 19 · Vite 8 · TanStack Router + Query 5 · Tailwind v4 · Radix UI (Base UI via
  kaneo) · Tiptap 3 · Traefik v3 · Keycloak 26.
  Screens = 109 · Features = 29 · ADRs = 0001–0013 · versioning starts `2.0.0-alpha.1` ·
  `latest` = stable only · images cosign-signed.

---

## Contradictions

| Files | Issue | Fix |
| --- | --- | --- |
| `docs/07-planning/phases.md:48` vs `docs/01-architecture/adr/README.md:40-52`, `docs/07-planning/status.md:57-63`, `docs/07-planning/decision-log.md:276-298` | P0's exit list still requires only **"ADRs 0001–0010 committed"**. ADRs 0011, 0012 and 0013 were written in the 2026-09-05 session and are Accepted in the ADR index; P0 cannot close without them committed either. | `- ADRs 0001–0013 committed` |
| `docs/07-planning/accelerated-delivery-plan.md:42` vs `docs/01-architecture/adr/README.md:40-52` | *"the RBAC model and **ten ADRs** are written"* — thirteen ADRs are written and Accepted. | "thirteen ADRs" |
| `docs/07-planning/accelerated-delivery-plan.md:41` vs `docs/03-features/README.md` (29 rows), `docs/07-planning/status.md:31`, `docs/07-planning/review-2026-09-05.md:59` | *"All **30 feature specs** … are written"*. The feature index has 29 rows and `docs/03-features/` holds exactly 29 spec files. `review-2026-09-05.md:59` records this exact "30 → 29" correction as **already applied** — it was applied to `status.md` but not to this document. | "All 29 feature specs" |
| `docs/07-planning/roadmap.md:90` vs `docs/02-design/screen-inventory.md:178`, `docs/07-planning/status.md:30`, `docs/07-planning/accelerated-delivery-plan.md:34` | *"screen-inventory.md — **107 screens** with status"*. Every other document says 109. | "109 screens with status" |
| `CHANGELOG.md:27` vs `docs/07-planning/release-plan.md:16`, `docs/07-planning/decision-log.md:98` | The changelog's own worked example is `## [0.1.0] - YYYY-MM-DD`. `release-plan.md:16` explicitly says the first version is `2.0.0-alpha.1`, **"Not `0.1.0`"**, and the decision log records `0.x` versioning as *rejected*. The changelog template therefore models the exact scheme the release plan forbids. | `## [2.0.0-alpha.1] - YYYY-MM-DD` |
| `docs/07-planning/release-plan.md:42-44` vs `docs/04-engineering/ci-cd.md:63-65` | Release plan says, in the present tense, that this *"changes one line in ci-cd.md's main pipeline, **which currently tags every merge `latest`**"*. `ci-cd.md:64` has already been changed — it now reads "**Not `latest`**". The release plan describes a fix that is already applied, so a reader is told ci-cd.md is wrong when it is right. (`decision-log.md:105` gets the tense right: "previously tagged".) | Change to past tense: "…which previously tagged every merge `latest`". |
| `AGENTS.md:49` and `docs/05-operations/configuration-reference.md:9` vs `docs/05-operations/configuration-reference.md:21-39` | Both assert **"eight"** bootstrap environment variables. The authoritative table immediately below lists **11** `TASKDESK_*` variables (5 required + 6 optional) plus `NODE_ENV` — 12. AGENTS.md builds a rule on the number ("if you are about to add a ninth, stop"), so the rule currently reads as already violated. | Recount and state one number in both places (12, or restate as "five required, seven optional"). |
| `docs/01-architecture/plugin-architecture.md:223`, `docs/07-planning/status.md:66`, `docs/07-planning/decision-log.md:164,167` | All say **"the six current plugin kinds"**, but the list given is seven — `auth`, `storage`, `notify`, `import`, `search`, `ai`, **plus `license`** (added by ADR 0013 in the same session). plugin-architecture.md:223 states "six … plus `license`" in one sentence, which is self-contradictory as written. | "the seven plugin kinds" throughout, or drop the count. |
| `docs/07-planning/review-2026-09-05.md:10` vs repository (106 `.md` files) | *"every relative link and heading anchor in **104 markdown files**"*. The corpus is 106 files, and the review session itself added `release-plan.md` and `review-2026-09-05.md` — i.e. the count predates the session it documents. | Restate as "104 files at the time of the pass" or update to 106. |
| `docs/07-planning/status.md:48,209` vs repository (106 `.md` files) | *"roughly 65 documents"* / "roughly 65 documents across nine sections" describes a corpus that is now 106 files. Stated twice. | Update, or qualify as "at that point". |

---

## Stale values

| File:line | Value | Should be |
| --- | --- | --- |
| `docs/07-planning/roadmap.md:90` | `107 screens with status` | `109` |
| `docs/07-planning/accelerated-delivery-plan.md:41` | `All 30 feature specs` | `All 29 feature specs` |
| `docs/07-planning/accelerated-delivery-plan.md:42` | `ten ADRs are written` | `thirteen ADRs are written` |
| `docs/07-planning/phases.md:48` | `ADRs 0001–0010 committed` | `ADRs 0001–0013 committed` |
| `CHANGELOG.md:27` | `## [0.1.0] - YYYY-MM-DD` | `## [2.0.0-alpha.1] - YYYY-MM-DD` |
| `docs/01-architecture/tech-stack.md:72` | `Component catalogue \| **Storybook 8**` | **Stale.** Storybook 9 shipped mid-2025 and Storybook 10 late 2025; 8 is two majors behind. It is the one pin in the table the 2026-09-05 "reviewed against current upstream status" sweep (tech-stack.md:145-155) did not check — that paragraph names Node, Traefik, Keycloak, Valkey and PostgreSQL only. |
| `docs/02-design/design-system.md:17` | `Catalogue \| Storybook 8` | Same as above — must move with tech-stack.md, which is the authority. |
| `AGENTS.md:49` | `There are eight of them` | 12 (see Contradictions) |
| `docs/05-operations/configuration-reference.md:9` | `Amount \| Eight variables` | 12 (see Contradictions) |
| `docs/07-planning/review-2026-09-05.md:10` | `104 markdown files` | 106 |
| `docs/07-planning/status.md:48` | `roughly 65 documents` | ~106 |
| `docs/07-planning/status.md:209` | `roughly 65 documents across nine sections` | ~106 |
| `docs/05-operations/deployment.md:14` | `keycloak \| \`keycloak:26\`` | Version is correct, image reference is not — the published image is `quay.io/keycloak/keycloak:26`. There is no Docker Hub `keycloak` image, so a compose file copied from this table will not pull. |
| `docs/05-operations/deployment.md:13,15` | `chrislusf/seaweedfs`, `axllent/mailpit` — untagged | Untagged means implicit `:latest`. Given `release-plan.md:42` makes "never take an untested `latest`" a stated principle, third-party images in the shipped compose stack should carry explicit tags too. |

### Stale-value greps that came back clean

Checked across `docs/` + `README.md` + `AGENTS.md` + `CHANGELOG.md`; every hit below is
**explanatory text about the correction**, which the audit brief permits:

- `PostgreSQL 16` / `postgres:16` / `Postgres 16` — only `decision-log.md:25`
  ("PostgreSQL 16 → 18"), `status.md:79`, and `tech-stack.md:26,150-155`.
  Live pins are `PostgreSQL 18` everywhere (`README.md:41,72`, `overview.md:21,141`,
  `data-model.md:3`, `deployment.md:11`, `accelerated-delivery-plan.md:105`).
- `Valkey 8` / `valkey:8` — only `decision-log.md:28`, `status.md:79`. Live pins are
  Valkey 9 (`README.md:42`, `tech-stack.md:30`, `deployment.md:12`, `accelerated-delivery-plan.md:105`).
- `OpenAPI 3.1` — only `decision-log.md:41,54-60`, `status.md:79`. Live target is 3.2
  (`tech-stack.md:23`, `api-design.md:3`, `testing-strategy.md:116`, `README.md:72`).
- `Vite 5` — only `review-2026-09-05.md:58` and the parenthetical in `tech-stack.md:42`
  ("was listed as 5 in error"). Live pin is Vite 8.
- `Node 20` / `Node 22` — `adr/0002-single-backend.md:14` describes **v1's** bff
  (legitimate history); `tech-stack.md:147` is the rationale for staying on 24. No stale
  pin.
- `Keycloak 25` — no occurrences. Keycloak 26 everywhere.
- `107` / `108` as screen totals — one occurrence (`roadmap.md:90`), listed above.
- `MinIO` — 14 occurrences, **all explanatory or negative** ("Not MinIO", "why MinIO is
  not the default", the decision-log entry). No document proposes MinIO as a backend.
- `latest` as an image tag — every usage matches the new rule. `ci-cd.md:64` tags merges
  `edge` + `sha-<gitsha>` and says "Not `latest`"; `ci-cd.md:86` and
  `release-plan.md:122` move `latest` only at promotion; `release-plan.md:40` scopes
  `latest` to the stable channel; `one-line-install.md:53,109` resolves "latest stable".
  The only defect is the stale tense in `release-plan.md:43` (see Contradictions).
- cosign signing + provenance attestation is stated consistently in `ci-cd.md:66-69`,
  `security-model.md:175-177`, `release-plan.md:115-119`, `decision-log.md:110-114`.
- Version pins otherwise agree with the pinned stack across `tech-stack.md`, `README.md`,
  `AGENTS.md`, `overview.md`, `data-model.md`, `api-design.md`, `deployment.md`,
  `product-principles.md`, `competitive-inspiration.md`, `adr/0001`, `adr/0008`.
- i18n locale counts agree: 22 inherited (`tech-stack.md:58`), "the other 21"
  (`accelerated-delivery-plan.md:195`).
- UX gates: 13 defined (`ux-quality-gates.md` G1–G13) matches "thirteen automated UX
  gates" (`status.md:217`).

---

## Glossary violations

Authority: `docs/00-overview/glossary.md:84-93` — *"Terms we do not use"*: Status → **State**;
Tenant → **Organisation**; Issue/task/card/ticket (as a table name) → **Work item**;
Client → **Customer**.

Excluded from this table, per the audit brief: intake-queue submission statuses
(`intake-queue.md:27,75`; `customer-portal.md:99`; `data-model.md:157`), HTTP status codes
(`api-design.md:165`), health/status pages, ADR/spec front-matter `**Status:**` fields,
inventory "Status" columns, and `status.md` itself.

### `status` where the glossary mandates `state`

| File:line | Text | Severity / fix |
| --- | --- | --- |
| `docs/02-design/information-architecture.md:175` | `/portal/requests?status=open` | **Highest — a direct self-contradiction.** Twelve lines earlier, `:163` in the same code block writes `/agent/projects/{key}/work?layout=board&state=started`. `views.md:17` and `api-design.md:75` also use `state=`. The portal URL is the only `status=` filter param in the corpus. → `?state=open` |
| `docs/01-architecture/data-model.md:77` | `invitation` … `status` | Column name. data-model.md is the normative schema every feature spec mirrors, so each `status` column here propagates the violation. → `state` |
| `docs/01-architecture/data-model.md:164` | `approval` … `status` | → `state` |
| `docs/01-architecture/data-model.md:177` | `cycle` … `status` | → `state` |
| `docs/01-architecture/data-model.md:178` | `module` … `status` | → `state` |
| `docs/01-architecture/data-model.md:201` | `kb_article` … `status` | → `state` |
| `docs/01-architecture/data-model.md:207` | `release` … `status` | → `state` |
| `docs/01-architecture/data-model.md:215,244` | `outbox` … `status`; `create index on outbox (status, next_attempt_at) where status = 'pending'` | → `state` |
| `docs/01-architecture/data-model.md:221` | `import_run` … `status` | → `state` |
| `docs/03-features/approvals.md:30` | `\| **Status** \| pending · approved · rejected · expired · withdrawn \|` | Approval lifecycle position. The glossary already models the analogue as **SLA state**. → "State" |
| `docs/03-features/approvals.md:35` | `approval` — … `status`, … | Mirrors data-model.md:164. → `state` |
| `docs/03-features/approvals.md:67` | "`AP-12` `reminder-scan` expires approvals past `expires_at`, setting status `expired`." | Numbered, citable behaviour rule. → "setting state `expired`" |
| `docs/03-features/agile.md:25` | "`CY-3` Status is derived from dates: `upcoming`, `active`, `completed`." | Numbered behaviour rule. → "State is derived…" |
| `docs/03-features/agile.md:45` | module "…a status." | → "a state" |
| `docs/03-features/knowledge-base.md:21` | `\| **Status** \| draft · in_review · published · archived \|` | Article lifecycle. → "State" |
| `docs/03-features/knowledge-base.md:77` | "article list with status, owner and review date" | → "state" |
| `docs/03-features/service-management.md:28-29` | "`SV-4` A service has a status — operational, degraded, outage… Computed status from open incidents is appealing and always wrong." | Numbered behaviour rule, twice. → "state" |
| `docs/03-features/service-management.md:63` | "`RL-1` A release has a name, a target service, a planned date, a status and notes." | → "a state" |
| `docs/03-features/service-management.md:79` | `\| Set service status \| service:manage \|` | Permission-table action name. → "Set service state" |
| `docs/03-features/customer-portal.md:42` | "**My requests** \| Everything they have raised, filterable by status" | This is the work item's state, not the submission status — and it is the prose behind the `?status=open` URL above. → "filterable by state" |
| `docs/03-features/customer-portal.md:43` | "**Request detail** \| Conversation, status, SLA due time, attachments, actions" | → "state" |
| `docs/03-features/webhooks-and-api-keys.md:136` | "The key follows the owner's status" | → "the owner's state" (or "active/deactivated") |
| `docs/01-architecture/storage-and-attachments.md:52,60` | "creates attachment row (status = pending)" … "status = ready" | Attachment lifecycle in a sequence diagram. → `state` |
| `docs/02-design/design-system.md:74` | `\| approval-card \| Approver, status, expiry, decision affordance \|` | → "state" |
| `docs/02-design/design-tokens.md:46,78` | "### Status colours" … "Status must never be conveyed by colour alone." | Borderline — these token names encode SLA/work-item state. Given the glossary defines **SLA state**, "State colours" is the consistent name. |
| `docs/03-features/projects-and-engagements.md:76` | "health (RAG…), status note with a timestamp" | Borderline — "status note" reads as a status *report*, not a lifecycle position. Flagged only because it sits beside `health`, which is the RAG field; if it means a narrative update, rename to "progress note" to remove the ambiguity. |

**Not violations** (external-system vocabulary, correctly used to describe someone else's
model): `docs/06-data-import/*` Jira/Plane "statuses" (`import-strategy.md:20,77,110,123`,
`field-mapping.md:140,195`); `workflows.md:19`, `data-model.md:145`,
`competitive-inspiration.md:75,191,247`, `licensing-and-attribution.md:71`,
`adr/0011:13,50-51,70,107` describing OpenProject's "type × role × status" model and v1's
fixed status enum; `problem-statement.md:26-27` ("asks for status") is ordinary English
about communication, not an entity field.

### `tenant` where the glossary mandates `organisation`

| File:line | Text | Severity / fix |
| --- | --- | --- |
| `docs/03-features/god-mode.md:74` | "### Organisations — **Tenants.** Create, edit, suspend, delete." | **Highest.** The one-word definition of the Organisations section is the banned word, in a normative feature spec. → "Customer organisations." |
| `docs/02-design/information-architecture.md:142` | `Organisations    tenants, quotas, portal access` | Same pattern in the God Mode IA map. → "organisations, quotas, portal access" |
| `docs/07-planning/phases.md:119` | "**God Mode → Organisations**: tenants, catalogues, quotas, portal access" | Same pattern in P3's scope list. → "organisations, catalogues, …" |
| `docs/00-overview/product-principles.md:111` | "Not horizontal scale beyond a few thousand users per tenant" | → "per organisation" |
| `docs/README.md:28` | "Every tenant-specific behaviour" | Adjectival; lower severity, but this is the docs hub's one-paragraph summary, the first prose most readers see. → "organisation-specific" |

**Not violations:** "multi-tenant"/"multi-tenancy"/"tenant isolation"/"cross-tenant"/
"tenant boundary" are architecture-discipline terms, not the entity name, and the glossary
itself uses "A tenant boundary" to *define* Organisation (`glossary.md:11`). That covers
`multi-tenancy.md`, `security-model.md:70,192`, `rbac.md:187`, `testing-strategy.md:17,70,96,194,270`,
`error-fix-loop.md:85`, `decision-log.md:440,445`, `accelerated-delivery-plan.md:62,124,145`,
`adr/0001:75`, `adr/0010:62`, `competitive-inspiration.md:134`,
`customer-portal.md:178`. `auth-and-identity.md:81`, `plugin-architecture.md:119`
("tenant id field") are Microsoft Entra's own field name. `tech-stack.md:105`
("single-tenant installs") is deployment topology.

### `issue` / `card` as an entity name

**No violations found.** Every `issue` hit is either (a) source-system vocabulary in the
import mapping tables — `06-data-import/plane.md:28-142`, `field-mapping.md:64,107-152`,
`import-strategy.md:76` — which is exactly what those tables exist to map *away from*, or
(b) a tracker issue (`risks.md:28`, `ux-quality-gates.md:201,204`, `decision-log.md:477`,
`error-fix-loop.md:55`), or (c) a deliberate contrast with another product
(`problem-statement.md:32`, `adr/0011:61`, `adr/0012:10,12`).

`card` is used only for the board rendering of a work item (`views.md:52-53,55,61,118,133`,
`work-items.md:166`, `accessibility.md:52`, `motion.md:23,57,96-104`) or for the shadcn
`card` primitive (`design-system.md:52`, `design-tokens.md:34,96,126,137`,
`coding-standards.md:147-148`). The glossary's prohibition is scoped "*(as a table name)*",
which none of these are. No table, column or API resource is named `card` or `issue`.

### `client` where the glossary mandates `customer`

**No violations found.** All 60+ hits are HTTP/typed/OAuth "client", `client-side`, or
`Client state` — legitimate technical usage. No document uses "client" for a paying
customer or a customer organisation.

### One further violation of the glossary's own list, outside the brief's four categories

| File:line | Text | Note |
| --- | --- | --- |
| `docs/00-overview/glossary.md:93` vs the corpus | Glossary: *"Agent (as a person) → **Staff**. 'Agent' means the agent portal, or an AI agent."* This is honoured consistently — `README.md:36` "agent workspace", `screen-inventory.md` "Agent — core/project/…", `phases.md`, `rbac.md` all use it portal-wise or AI-wise. No violation found; recorded here only so the reader knows it was checked. |

---

## Phase/count mismatches

### 4a · Feature index vs feature header vs phases.md

**All 29 feature specs' `- **Phase:**` headers match the phase column in
`docs/03-features/README.md`, and all match `phases.md`'s phase scope lists.** No
mismatch found. Verified spec-by-spec.

The only drift is that four specs carry a **parenthetical caveat the index drops**, and in
each case the screen inventory follows the caveat rather than the index:

| Files | Issue | Fix |
| --- | --- | --- |
| `docs/03-features/god-mode.md:3` ("P4 (authentication and organisations land in P3)") vs `docs/03-features/README.md:44` ("P4") vs `docs/02-design/screen-inventory.md:132-135` (P3) | The index says God Mode is P4 flat. Four of its fifteen screens — Authentication providers, Provider editor, Organisations, Organisation detail — are P3 in the inventory, and `phases.md:116-120` puts them in P3. A reader who trusts the index alone under-scopes P3. | Add "(P3 for authentication and organisations)" to the index row. |
| `docs/03-features/notifications.md:3` ("P4 (in-app inbox in P1)") vs `README.md:47` ("P4") vs `screen-inventory.md:21` (Inbox = P1) | Same shape. | Same. |
| `docs/03-features/projects-and-engagements.md:3` ("P1 (delivery structure in P2)") vs `README.md:14` ("P1") vs `screen-inventory.md:45-46` (Milestones & prerequisites, Stakeholders = P2) | Same shape. | Same. |
| `docs/03-features/settings-hierarchy.md:3` ("P4 (individual screens land with their features)") vs `README.md:45` ("P4") | Same shape; the settings screens in the inventory span P1–P6. | Same. |

### 4b · Screen phase vs owning feature phase

| Files | Issue | Fix |
| --- | --- | --- |
| `docs/03-features/audit-trail.md:3` (P2) and its Screens section ("**God Mode → Audit**") vs `docs/02-design/screen-inventory.md:141` ("Audit log \| `…/audit` \| **P4**") | **Real mismatch.** The audit trail is a P2 feature — `phases.md:99` lists "Audit trail" under P2 — and its own spec names God Mode → Audit as one of its screens. The inventory schedules that screen two phases later, in P4. Either the audit log is unreachable for two phases while audit rows accumulate, or the screen is P2. | Move `screen-inventory.md:141` to P2, or add the caveat to `audit-trail.md:3` the way god-mode.md does. |
| `docs/03-features/approvals.md:3` (P2) vs `screen-inventory.md:156` (Portal Approvals = P3); `docs/03-features/request-types-and-catalogue.md:3` (P2) vs `screen-inventory.md:154-155` (Catalogue, Request form = P3) | Both P2 specs name portal screens the inventory places in P3. This is defensible — the portal origin does not exist until P3 (`phases.md:108-113`) — but it is undocumented, unlike the god-mode.md pattern. | Add "(portal screens in P3)" to both headers, so the rule is stated rather than inferred. |
| `docs/03-features/views.md:24-30` vs `screen-inventory.md:37-38` | **Correct, recorded as verified.** views.md is P1 but carries a per-layout phase table putting Calendar and Timeline at P5, exactly matching the inventory. This is the pattern the four specs above should follow. | — |

### 4c · Screens with no owning feature spec

The feature index is presented as the complete product surface ("0 of 29 shipped",
`status.md:31`), and `docs/03-features/README.md:113` says *"A feature is not built until
its spec exists and has been read."* These inventory rows have no spec to read:

| Files | Issue | Fix |
| --- | --- | --- |
| `docs/02-design/screen-inventory.md:44` (Pages, P5) + `docs/07-planning/phases.md:163` ("Pages") vs `docs/03-features/` | **No feature spec mentions Pages at all** — a grep for `pages` across all 29 specs returns nothing. A P5 screen and a P5 scope line exist for a feature with no specification. | Write the spec, or drop the screen and the phases.md line. |
| `docs/02-design/screen-inventory.md:102` (Workspace — teams, P4) + `phases.md:135` ("Teams") + `glossary.md:13` (Team is a defined term) vs `docs/03-features/` | No spec owns Teams. Only `reports-and-dashboards.md` mentions the word. | Same. |
| `docs/02-design/screen-inventory.md:100` (Workspace — terminology, P4) + `phases.md` vs `docs/03-features/` | The terminology overlay has an ADR (`adr/0012`) and a screen, but no feature spec. `notifications.md`, `god-mode.md`, `settings-hierarchy.md` and `customer-portal.md` reference terminology without owning it. | Same, or name god-mode.md/settings-hierarchy.md as the owner explicitly. |
| `docs/02-design/screen-inventory.md:19,150` (Accept invitation, agent + portal, P3) + `phases.md:121` ("Invitations and onboarding") | Owned only in passing by `god-mode.md` and `customer-portal.md`. | Same. |
| `docs/03-features/mcp-server.md` Screens section ("In God Mode: **MCP usage** — which keys, how many calls, which tools, error rates") vs `screen-inventory.md:129-143` | The MCP usage screen is **absent from the inventory**, which violates `screen-inventory.md:186` ("A screen is not on this list until it is in `lib/routes.ts`") in the other direction: a spec requires a screen the inventory does not carry. This also collides with `god-mode.md`'s "Fifteen screens" — the God Mode section has exactly 15 rows, so adding MCP usage makes that sentence wrong too. | Add the row and update `god-mode.md` to sixteen, or move MCP usage under profile settings where the rest of that spec's surface lives. |
| `docs/03-features/intake-queue.md` Screens ("**Portal** — submission confirmation; durable submission page with the thread; reply box") vs `screen-inventory.md:145-163` | The portal has "Request detail" (`:153`) but no submission confirmation or durable submission page, though `intake-queue.md` and `decision-log.md:302-321` (`IQ-16a`, the withdrawal flow) both depend on a durable submission page existing. | Add the rows, or state in intake-queue.md that they are `/portal/requests/{ref}` in a pre-acceptance mode. |

### 4d · Counts in `status.md` vs `screen-inventory.md` vs the feature index

| Files | Issue | Fix |
| --- | --- | --- |
| `docs/02-design/screen-inventory.md:171-178` vs the tables at `screen-inventory.md:13-163` | **The Counts table does not match the document it summarises.** Counting the phase column of every row gives **114 screens**, not 109, and five of the seven per-phase figures are wrong. Actual vs stated: **P0 6 vs 4** · **P1 28 vs 27** · **P2 16 vs 15** · **P3 19 vs 20** · **P4 20 vs 18** · P5 23 vs 23 ✓ · P6 2 vs 2 ✓. Section subtotals for verification: core 13, project 14, work item 10, service desk 10, insight 7, settings 30, God Mode 15, portal 15 = 114. | Recount and restate. Whichever total is chosen must then propagate to `status.md:30`, `accelerated-delivery-plan.md:34` and `roadmap.md:90`. |
| `docs/07-planning/status.md:30` ("0 of 109") | Consistent with `screen-inventory.md:178`'s stated total, and therefore inherits its error. Not independently wrong. | Follows the fix above. |
| `docs/07-planning/status.md:31` ("0 of 29 shipped") vs `docs/03-features/README.md` | **Correct.** 29 index rows; 29 spec files in `docs/03-features/` excluding README. Verified by file count. | — |
| `docs/07-planning/accelerated-delivery-plan.md:34` ("109 screens") | Agrees with the stated total; inherits the same error. | Follows the fix above. |
| `docs/07-planning/roadmap.md:90` ("107 screens") | Agrees with nothing. See Contradictions. | `109` (or the corrected figure). |
| `docs/03-features/god-mode.md` Screens ("Fifteen screens") vs `screen-inventory.md:129-143` | **Correct today** — exactly 15 God Mode rows. Will break if the MCP usage screen from 4c is added. | Note the coupling. |
| The feature index has no row for **import** (`docs/06-data-import/`), yet `phases.md:171-187` makes P6 an entire phase and the inventory carries two P6 screens (`:117`, `:142`) | "0 of 29 features" therefore excludes a whole phase of product surface. Not an error, but the index is used as the completeness measure at every phase close (`ci-cd.md:175-180`), and P6 cannot be tracked through it. | Either add an "Import" row pointing at `docs/06-data-import/import-strategy.md`, or state in the index that import is tracked separately. |

---

## Unknown capabilities / tables

### 5 · Capabilities used in feature specs vs `docs/01-architecture/rbac.md`

Canonical list: `docs/01-architecture/rbac.md:26-48` — **59 capabilities**, plus the
wildcard `instance:*` (`rbac.md:103`). Method: every `` `resource:action` `` token in
`docs/03-features/*.md` (124 occurrences; 103 of them inside `## Permissions` sections)
matched against that list.

**Result: zero unknown capabilities.** Every capability named in every feature spec's
permission table exists in `rbac.md`. This is the cleanest area of the corpus.

Three near-misses confirmed as non-capabilities, listed so they are not re-raised:

| File:line | Token | Verdict |
| --- | --- | --- |
| `docs/01-architecture/monorepo-layout.md:157`, `docs/04-engineering/coding-standards.md:30` | `resource:action` | The naming-rule placeholder from `rbac.md:23`, not a capability. |
| `docs/01-architecture/realtime.md:25` | `project:xyz` | A WebSocket channel name (`realtime.md:32` defines the channel scheme), not a capability. |
| `docs/03-features/roles-and-permissions-ui.md:50` | `instance_admin` | The instance-scope **role** key from `rbac.md:103`, not a capability. |

The reverse check found **7 capabilities defined in `rbac.md` that no feature spec ever
uses** — not errors, but each is a capability nothing in the product surface currently
guards, so nothing would fail if it were dropped or misspelled in code:

| File:line | Capability | Note |
| --- | --- | --- |
| `docs/01-architecture/rbac.md:26` | `instance:manage_plugins` | God Mode → Plugins is a screen (`screen-inventory.md:140`), but `god-mode.md` has **no `## Permissions` section** (see below), so nothing declares this. |
| `docs/01-architecture/rbac.md:27` | `workspace:update`, `workspace:delete` | Settings — general / danger zone screens exist; `settings-hierarchy.md` has no `## Permissions` section either. |
| `docs/01-architecture/rbac.md:36` | `label:create`, `label:update`, `label:delete` | Workspace — labels is a P1 screen (`screen-inventory.md:114`); `work-items.md` names the `label` tables but no spec guards label mutation. |
| `docs/01-architecture/rbac.md:47` | `member:remove` | `member:invite` is used; its counterpart is not. |

### 6 · Tables referenced in feature specs' `## Data` sections vs `docs/01-architecture/data-model.md`

Canonical list: **76 table names** in `data-model.md` (rows matching `` | `name` `` across
lines 50–273).

| Files | Unknown table | Detail / fix |
| --- | --- | --- |
| `docs/03-features/sla.md:56` (Data section) and `:93`; also `docs/01-architecture/background-jobs.md:72`, `docs/01-architecture/adr/0009-lazy-sla-evaluation.md:41,72,105` | **`work_item_sla_cache`** | **Does not exist in `data-model.md`.** This is the more serious of the two: it is named in a `## Data` section, in the background-jobs spec, and three times in **ADR 0009**, where `:41` calls it *"the only persisted SLA artefact"*. An accepted ADR's single persisted artefact is absent from the canonical schema. → Add the table to `data-model.md` (§ service desk, beside `sla_pause`). |
| `docs/03-features/reports-and-dashboards.md:137` (`RP-9`); also `docs/01-architecture/background-jobs.md:44,106`, `docs/01-architecture/adr/0009-lazy-sla-evaluation.md:87`, `docs/05-operations/scaling.md:71` | **`metric_snapshot`** | **Does not exist in `data-model.md`.** Cited by a numbered, citable behaviour rule (*"`RP-9` Closed periods read from `metric_snapshot`, computed hourly"*) and by a scheduled job. `reports-and-dashboards.md` has no `## Data` section, so nothing else declares it. → Add the table to `data-model.md`. |

Every other table named in a `## Data` section resolves cleanly: `approval`
(`approvals.md`); `custom_field_section`, `custom_field`, `custom_field_type_visibility`,
`custom_field_value` (`custom-fields.md`); `submission`, `submission_message`
(`intake-queue.md`); `request_type`, `request_type_version`
(`request-types-and-catalogue.md`); `role` (`roles-and-permissions-ui.md`);
`service_calendar` (`service-calendars.md`); `sla_policy`, `sla_policy_version`,
`sla_goal`, `sla_pause` (`sla.md`); `work_item`, `work_item_type`, `work_item_relation`,
`watcher`, `label`, `work_item_label` (`work-items.md`); `workflow`, `workflow_version`,
`workflow_transition` (`workflows.md`).

Confirmed **not** unknown tables: `at_risk`, `in_review` (enum values);
`blocked_by`, `duplicated_by`, `required_by` (`relations-and-hierarchy.md:26-29` — inverse
*labels*, explicitly rendered not stored per `RH-1`, matching the five stored types at
`data-model.md:106` and `glossary.md:29`); `create_work_item` (`mcp-server.md:80`, an MCP
tool name); `workspace_role` (`rbac.md:57`, kaneo's design being cited); `portal_scope`,
`jit_provisioning` (plugin config keys); `outbox_pending`, `job_last_success`,
`db_pool_waiting`, `taskdesk_*` (Prometheus metric names); `pg_stat_statements`,
`max_connections` (Postgres internals).

### 6b · The feature-spec template is not followed, which is why the two tables above went unnoticed

`docs/03-features/README.md:69-109` defines the mandatory spec shape and `:113-117` makes
it binding (*"A feature is not built until its spec exists and has been read"*). Section
presence across the 29 specs:

| Files | Issue | Fix |
| --- | --- | --- |
| `docs/03-features/README.md:83-84` vs 20 of 29 specs | **`## Data` is present in only 10 specs.** Missing from: `agile`, `assignment`, `attachments`, `audit-trail`, `automations`, `comments-and-activity`, `customer-portal`, `god-mode`, `knowledge-base`, `mcp-server`, `notifications`, `projects-and-engagements`, `relations-and-hierarchy`, `reports-and-dashboards`, `search-and-saved-views`, `service-management`, `settings-hierarchy`, `time-and-cost`, `views`, `webhooks-and-api-keys` — several of which plainly own tables in `data-model.md` (`audit_log`; `time_entry`/`hourly_rate`/`cost_entry`/`budget`; `service`/`change_detail`/`change_freeze`/`release`; `kb_article`/`kb_category`; `notification`/`notification_preference`; `webhook`/`webhook_delivery`; `saved_view`). Step 6 can only be audited for a third of the product. | Add `## Data` to the 20, even if the entry is one line linking the data model. |
| `docs/03-features/README.md:89-90` vs 4 specs | **`## Permissions` missing** from `audit-trail.md`, `god-mode.md`, `mcp-server.md`, `settings-hierarchy.md`. This directly weakens the project's headline rule — `AGENTS.md:52-56` and `README.md:83`, *"Every route declares its permission… a route without a policy entry fails the build"* — because God Mode is the highest-privilege surface in the product and its spec declares no capabilities at all. It is also why `instance:manage_plugins` and `workspace:update`/`delete` are unused above. | Add the tables; God Mode's is the urgent one. |
| `docs/03-features/README.md:92-93` vs 3 specs | `## Screens` missing from `attachments.md`, `search-and-saved-views.md`, `views.md` — though all three own inventory rows. | Add. |
| `docs/03-features/README.md:95-96` vs `mcp-server.md` | `## API` missing. | Add, or state that the MCP server exposes no HTTP API of its own (`mcp-server.md:32` says it is "a thin client over the public API", which would be the answer). |
| `docs/03-features/README.md:86-87,114` vs 8 specs | `## Behaviour` missing from `agile`, `comments-and-activity`, `notifications`, `relations-and-hierarchy`, `search-and-saved-views`, `service-management`, `time-and-cost`, `webhooks-and-api-keys`. Their numbered rules (`CY-3`, `RH-1`, `SV-4`, `RL-1` …) do exist, just under other headings, so the citation contract at `README.md:114` still holds — heading drift only. | Normalise the heading. |
| `docs/03-features/README.md:80-81` vs 20 specs | `## Concepts` missing from 20 of 29. The template ties it to the glossary (*"The nouns this feature introduces, matching the glossary"*) — the absent section is plausibly why the `status`/`state` drift in step 3 accumulated unchecked. | Add, or drop it from the template. |

---

## Summary

**Scope covered:** 106 markdown files. 17 documents read in full; the rest swept by
targeted grep for version pins, counts, glossary terms, phase assignments, capability
tokens and table names.

**Overall:** the corpus is unusually consistent for its size. The pinned stack holds
almost everywhere — every live version pin except one matches, no MinIO proposal survives,
every `latest` usage matches the stable-only rule, cosign signing is stated identically in
four places, and **every capability in every feature spec permission table exists in
rbac.md**. The defects cluster in two places: (1) documents written *before* the
2026-09-05 correction session that were not swept afterwards, and (2) the feature-spec
template not being applied, which removes the mechanism that would have caught the rest.

### The eight findings worth fixing first

| # | Finding | Where |
| --- | --- | --- |
| 1 | **The screen inventory's own Counts table is wrong.** Rows total **114**, table says 109; five of seven per-phase figures are off (P0 6≠4, P1 28≠27, P2 16≠15, P3 19≠20, P4 20≠18). Every other document's screen count is downstream of this. | `screen-inventory.md:171-178` |
| 2 | **Two tables are referenced but do not exist in the data model.** `work_item_sla_cache` — called *"the only persisted SLA artefact"* by accepted **ADR 0009** — and `metric_snapshot`, cited by behaviour rule `RP-9` and by two scheduled jobs. | `data-model.md` vs `sla.md:56,93`, `adr/0009:41,72,105`, `background-jobs.md:44,72,106`, `reports-and-dashboards.md:137` |
| 3 | **Four documents still carry pre-correction counts.** "ADRs 0001–**0010** committed" gates P0 on ten of thirteen ADRs; "**30** feature specs"; "**ten** ADRs"; "**107** screens". `review-2026-09-05.md:59` records the 30→29 fix as already applied — it reached status.md but not the accelerated plan. | `phases.md:48`, `accelerated-delivery-plan.md:41,42`, `roadmap.md:90` |
| 4 | **`god-mode.md` has no `## Permissions` section**, so the product's highest-privilege surface declares no capabilities — against `AGENTS.md:52-56`'s central rule. `instance:manage_plugins` is consequently defined and unguarded. Same gap in `audit-trail.md`, `mcp-server.md`, `settings-hierarchy.md`. | `docs/03-features/` vs `README.md:89-90` |
| 5 | **`status` used where the glossary mandates `state`** in ~25 normative places, including 8 columns in the canonical `data-model.md` and the numbered rules `AP-12`, `CY-3`, `SV-4`, `RL-1`. Sharpest instance: `information-architecture.md:175` writes `?status=open` twelve lines below `:163`'s `?state=started`, while `views.md:17` and `api-design.md:75` both use `state=`. | `data-model.md`, `approvals.md`, `agile.md`, `knowledge-base.md`, `service-management.md`, `information-architecture.md:175` |
| 6 | **CHANGELOG's worked example uses `[0.1.0]`** — the exact scheme `release-plan.md:16` names and rejects (*"Not `0.1.0`"*) and the decision log records as rejected. The one file a release author copies from models the forbidden version. | `CHANGELOG.md:27` |
| 7 | **Screens with no owning spec, and a spec whose screen is missing.** Pages, Teams, Terminology and Accept-invitation have inventory rows and phases.md scope lines but no feature spec; `mcp-server.md`'s "MCP usage" God Mode screen is absent from the inventory (and would break `god-mode.md`'s "Fifteen screens"); `intake-queue.md`'s durable portal submission page is absent too, though the `IQ-16a` withdrawal flow depends on it. | `screen-inventory.md:19,44,100,102,129-143,150`, `phases.md:135,163`, `mcp-server.md`, `intake-queue.md` |
| 8 | **`Storybook 8` is the one stale pin.** Two majors behind. It sits outside the paragraph at `tech-stack.md:145-155` that lists what the 2026-09-05 sweep re-checked (Node, Traefik, Keycloak, Valkey, PostgreSQL only), which is exactly why it survived. Also **"eight environment variables"** is asserted twice above a table listing twelve. | `tech-stack.md:72`, `design-system.md:17`; `AGENTS.md:49`, `configuration-reference.md:9` |

### What was checked and found clean

- **Phase assignments:** all 29 feature headers match the index and `phases.md` exactly.
  One real screen/feature phase mismatch only (audit trail P2 vs its God Mode screen P4).
- **Capabilities:** zero unknown tokens across 124 occurrences.
- **Feature count:** 29 index rows = 29 spec files = `status.md:31`.
- **Stale-version greps:** `PostgreSQL 16`, `Valkey 8`, `OpenAPI 3.1`, `Vite 5`,
  `Node 20/22`, `Keycloak 25` appear **only** in text explaining the correction, or
  describing v1's architecture. No live stale pin except Storybook.
- **MinIO:** 14 occurrences, all explanatory or negative. Rule respected.
- **`latest`:** every image-tag usage matches stable-only. One stale *tense* only
  (`release-plan.md:43` says ci-cd.md "currently" does what it no longer does).
- **Glossary — `client`, `issue`, `card`:** no violations. All hits are technical
  ("HTTP client"), source-system vocabulary in import mapping tables, or the shadcn `card`
  primitive / board-card UI, none of which the glossary's *"(as a table name)"* scoping
  prohibits.
- **`tenant`:** 5 real violations; every "tenant isolation"/"multi-tenant" usage is
  correct architecture vocabulary, as the glossary's own definition at `:11` establishes.
- **Cross-cutting numbers:** 13 UX gates (G1–G13) = "thirteen"; 22 locales inherited =
  "the other 21"; 15 God Mode screens = `god-mode.md`'s "Fifteen"; 14 reports consistent
  across five documents.

### Pattern worth naming

Every finding in group 3, plus the `release-plan.md` tense and the Storybook pin, is the
same failure: **the 2026-09-05 session corrected the hub documents and the tech stack, but
did not re-sweep the documents that quote them.** `decision-log.md:128-139` already records
this exact class of bug (inbound email said "Phase 5" in one spec and "candidate" in the
roadmap) with the note *"a phase assignment stated in one spec and denied in the roadmap is
exactly how scope creeps in unnoticed"*. The counts in group 3 are the same bug in a
different field. A link-and-anchor checker already runs (`review-2026-09-05.md:10`); a
companion check that asserts the corpus's handful of canonical numbers — screen total,
feature count, ADR range, first version — appear identically wherever they appear would
close the whole class before P0 rather than after.
