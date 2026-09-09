> ## ⚠ Read this first — this is a PLAN written against an OLDER `main`
>
> **Baseline:** `955f8d4d`, the tip of `main` on 2026-09-06. **`main` has moved since**, and
> as of 2026-09-09 it is `d4510a2` with nine more pull requests merged. Statements below of
> the form "X does not exist on `main`" or "PR #N is open and unmerged" were **true when
> written and are not true now.**
>
> **What changed under this plan** (see [`../lane-prep/README.md`](README.md) for the full
> reconciliation):
>
> - `packages/domain` **now exists** (PR #69) — service calendars, 59 tests.
> - `packages/ui` **now exists** (PR #63) — the first primitive slice.
> - **CI exists on `main`** (PR #19): the `check:*` gates, `test:all`, the OpenAPI baseline,
>   and eleven required status checks on the `protect-main` ruleset.
> - Retrofit **S0, S2 and S4 have merged** (PRs #65, #67). S1 was already merged (#57).
> - Issue **#7 is complete and closed.**
>
> **What has NOT changed, and is the reason this plan is still the right starting point:**
> **Throttle 1 is still shut.** Its condition 2 requires issue #6 through retrofit **S10**;
> S3 and S5–S11 have not started. Every "do not write code yet" instruction below still
> stands, unchanged.
>
> This file is committed **as the research artifact it is** — deliberately not rewritten,
> because rewriting a dated plan to look current is how a snapshot starts lying. Trust its
> reasoning, its spec citations and its dependency analysis; re-verify every claim about
> what is or is not on `main` against `main`.

---

# P4 governance-seams — implementation-readiness plan

Prepared by a Sonnet PREPARATION agent, working tree `/tmp/claude-1000/prep-p4` at
`955f8d4d` (= `origin/main` at prep time). **Nothing built, no deps installed, no tests
run.** This is a plan only.

Status: COMPLETE for this prep pass. See "NOT DONE" at the end for what was deliberately
left unread, and §9 for what genuinely needs Thomas.

**Contents:** §1 the seam contract · §2 P4's obligations on P1/P2 · §3 engine-boundary
decisions · §4 dependency order and what can start now · §5 acceptance criteria per issue ·
§6 identifier registrations owed · §7 security surface (the #40/#66 hazard, the #47
session-only-reach hazard, #42's highest-privilege surface) · §8 what P4 must not do · §9
open questions for Thomas · Appendix (2026-09-05 review cross-check) · NOT DONE.

---

## 1. The seam contract — "schema → admin API → God Mode", precisely

Stated once here; every per-lane obligation below just names which of these five a given
configurable thing owes.

A "configurable thing" is anything that varies **between deployments or between
workspaces/projects within one deployment** — a plugin-kind implementation, a feature
flag, or a domain module's tunable settings (SLA policy, workflow, terminology, custom
field definitions, notification channel settings, automation rules, API-key/webhook
policy, MCP ceilings).

For each such thing, the seam is:

1. **Database.** A real table/columns in `docs/01-architecture/data-model.md` — never a
   `process.env` read, never a compiled branch. `plugin-architecture.md` gives the general
   shape: `instance_plugin_config` (kind, `config jsonb`, `secrets bytea` AES-256-GCM,
   `scope: instance|workspace`) for plugins; `instance_feature_flag` /
   `workspace_feature_flag` / `project_feature_flag` for flags; a feature-specific table
   (e.g. `custom_field`, `automation_rule`, `notification_preference`) for domain-module
   config.
2. **Admin API.** A capability-guarded `/api/instance/*` (or `/api/workspaces/{id}/*` for
   workspace-scoped config) route set: list, create/update, delete-as-pending-action where
   destructive, and a `test()`/dry-run route wherever "wrong" would otherwise be silent
   (`GM-4`, engine-pattern point 5). Every route declares a policy per `rbac.md` (do-not 3)
   — capability, scope, `elevated`/`sessionOnly` where the action mints or removes
   authority.
3. **God Mode surface.** A screen (or a fold-in to an existing one of the 19) that reads
   and writes that admin API. **Verified mechanism, from `god-mode.md` `GM-5`:
   "Settings forms are generated from each plugin's Zod schema, so a new plugin arrives
   with its administration UI already built"** — and `plugin-architecture.md`'s engine
   pattern point 3 generalises this past plugins: *"Configuration generated from a schema,
   not a bespoke form... the same idea applies to a workflow's transition editor or a
   custom report's builder."* So: **plugin config renders from `Plugin.configSchema`
   (Zod); a domain module's settings screen (e.g. workflow editor, custom-field builder)
   is generated from that module's own config schema/shape, by the same principle, even
   though it has no literal `Plugin` object.** This is confirmed by god-mode.md itself, not
   invented by this plan.
4. **What generates from what.** Zod schema → form fields (type, validation, required);
   `secretFields` → masked inputs that read back `"••••••••"` and treat omission-on-write as
   "unchanged" (plugin-architecture.md, "Storage of configuration"); the flag enumeration
   in `plugin-architecture.md § Feature toggles` → the single generated list God Mode's
   Features screen renders (a CI test asserts the code enum equals that list — so a new
   flag *must* land in that document in the same change, or the test fails, which is the
   mechanical form of do-not 11 for this identifier class).
5. **Audit.** Every change writes an audit row (`GM-1`); secret **values** never recorded,
   only the fact that a secret changed.

**A configurable thing is not "done" until 1–5 all exist.** A lane that ships 1 (schema) and
2 (API) without 3 (God Mode) has built half a seam — that is precisely the "clean-up lane"
failure mode P4 exists to prevent, and per the working agreement the seam lands
**immediately** with the feature, not as a follow-up P4 ticket.

**Uncertain / to verify at implementation start:** `god-mode.md` states the Zod→form
mechanism as a fact ("Settings forms are generated…") but the actual generator
(`packages/ui` form-from-schema component, or a `packages/plugins-contracts` helper) does
not exist on `main` yet — `packages/plugins-contracts` is marked NOT YET in AGENTS.md's
layout table. **This is the first piece of shared-contract infrastructure #42 (God Mode)
must build or receive from #9 (UI extraction) before any other P4 screen can honestly claim
GM-5.** Confirm with whoever owns #9/#42 whether the generator lives in `packages/ui` (a
generic "Zod schema → form" primitive) or is God-Mode-specific.

## 2. Per-lane obligations P4 imposes on P1 (#23–#30) and P2 (#31–#37)

**Read first, because it changes the shape of this section:** `settings-hierarchy.md`'s own
header says *"Stage: P4 (individual screens land with their features, from P1)"*, and
`god-mode.md`'s header says *"Stage: P4 (authentication and organisations land in P3; the
audit log in P2)"*. **This is not this plan's inference — it is written into the specs
themselves.** So P4's obligation on P1/P2 is not "P4 will build these screens later" — it is
"the owning lane builds its own settings screen and admin API when it builds the feature,
against the structure `settings-hierarchy.md` already lays down, and #43 (settings hierarchy)
is the completion gate that confirms every one of those screens actually landed with its
feature rather than being deferred." A P1/P2 lane that ships a configurable feature with no
settings screen has not satisfied its own Definition of Done — this is a P1/P2 obligation
enforced by referencing `settings-hierarchy.md`'s table, not a P4 deliverable.

Cross-referencing `docs/03-features/README.md`'s table with `settings-hierarchy.md`'s
Workspace/Project screen tables and `plugin-architecture.md`'s feature-flag list:

### P1 (#23–#30)

| Issue | Configurable thing it introduces | Seam owed, and when |
| --- | --- | --- |
| **#23 work items** | `work_item_type` (name, icon, category, `is_epic`/`is_change`) | Workspace → **Work item types** screen + `custom_field_type_visibility`'s counterpart CRUD API, **landing with #23**, not deferred. `settings-hierarchy.md`'s Workspace table lists this row explicitly |
| **#25 projects and engagements** | Project `General` (name/key/icon/kind/dates/manager/owner team/defaults), `Members` (roster + per-project role overrides) | Project-level settings screens, **landing with #25** |
| **#26 relations and hierarchy** | none identified as instance/workspace-configurable beyond the relation type vocabulary, which is fixed in the data model (`work_item_relation.type` enum) — **not** a seam, because it is not swappable or admin-editable | — |
| **#27 comments and activity** | The internal/public comment-edit window (`withinMinutes` in rbac.md's `orOwner`) is cited from `comments-and-activity.md` — a workspace-level number. If it becomes admin-editable rather than fixed, it owes a settings field; **as currently specified it is a fixed constant cited by the registry, not yet a seam** — flag as **uncertain**, resolve when #27's spec is read in full (out of this prep's scope) |
| **#29 search and saved views** | `saved_view` sharing (`private`/`team`/`workspace`) — not instance-configurable, no seam owed | — |
| **#30 assignment** | The assignment *rule engine* is explicitly deferred to P2/`packages/domain` per the 2026-09-06 decision-log table ("Assignment: defaults and UI are P1; the rule engine ports with packages/domain in P2"). **This is itself an engine-boundary case**: one implementation (round-robin was explicitly rejected as out of scope, decision-log 2026-09-05), varying only by configuration → **domain module + flag, not a plugin.** No P4 action needed beyond confirming the flag is registered when P2 builds it |

None of #23–#30 is a `plugin`-kind feature (no swappable backend), so none needs a
`packages/plugins-contracts` interface; their obligation is schema + admin API + settings
screen only, per the seam contract in §1.

### P2 (#31–#37)

| Issue | Configurable thing it introduces | Seam owed, and when |
| --- | --- | --- |
| **#31 workflows** | `workflow` / `workflow_version` / `workflow_transition` — the ADR-0011 lifecycle engine: states, transitions, guards, effects, per-role transition legality | Workspace → **States** and **Workflows** screens (transition editor, publish-time validation panel — engine pattern point 5), **landing with #31**. This is the clearest instance of "a workflow's transition editor is generated from the shape of the thing being edited" (plugin-architecture.md engine pattern point 3) |
| **#32 SLA** | SLA policies (goals by type/priority, workspace default) | Workspace → **SLA policies** screen, **landing with #32**. Also feeds `settings-hierarchy.md` `ST-3`'s inheritance list (project overrides workspace SLA policy) |
| **#33 service calendars** | Cover windows and holidays | Workspace → **Service calendars** screen, **landing with #33** |
| **#34 request types and catalogue** | The customer-facing catalogue, per-organisation assignment | Workspace → **Request types** screen, **landing with #34**; also a God Mode Organisations field (`organisation_request_type`) that **must exist the moment #34 ships**, not wait for #42 |
| **#35 intake queue** | Triage queue configuration — check against #35's own spec for what is admin-configurable (not fully read in this pass — **uncertain**, flag for the implementing lane) | — |
| **#36 approvals and CAB** | Approval policies, CAB team flag (`team.is_cab`) | The CAB flag itself is **#41's** (teams) data, so #36 and #41 have a two-way dependency: #36 needs `team.is_cab` to exist (from #41 or from #36 adding the column itself, whichever lands first — **this ordering must be decided explicitly, it is not free**); approval policy screens land with #36 |
| **#37 audit trail** | Audit retention period, audit action catalogue | Retention period is a **God Mode General** field (`instance_setting.retention_periods`) — **owed at #37**, since God Mode's own header says "the audit log [lands] in P2." The **Audit** God Mode screen itself (list/filter/export) is explicitly assigned to #42 in `god-mode.md`'s screen list, stage P4 — so #37 owes the schema/retention setting immediately, and #42 owes the read/export UI. This is the one case in this table where the read surface and the write surface for the same table are legitimately split across two issues/lanes, and it is spelled out in the spec, not invented here |

**The mechanical check for whoever picks up P1/P2 work:** open `settings-hierarchy.md`'s
Workspace and Project tables (`docs/03-features/settings-hierarchy.md`), find the row for
the feature being built, and ship that row's screen and API in the same pull request as the
feature — per the working agreement's "lands immediately," and per do-not 11 the
table/column and, where relevant, the capability go into `data-model.md`/`rbac.md` in the
**same change**, not a follow-up.

**What #43 (settings hierarchy) actually is, given this:** not a screen-building issue in
its own right so much as (a) the **Profile** level screens, which belong to no P1–P3
feature and are P4's own to build, (b) the structural mechanisms shared by every level —
flag resolution (`ST-1`, `ST-2`), the inheritance-indicator convention (`ST-4`), the
dry-run blast-radius convention (`ST-7`), the danger-zone convention (`ST-8`) — which are
genuinely P4 infrastructure every other lane's screen depends on, and (c) the **completion
gate**: confirming every P1–P3 feature actually shipped its row. (a) and (b) can be built
early; (c) cannot close before P1–P3 ship.

## 3. Engine-boundary decisions — plugin, or domain module + flag?

Rule (decision log, 2026-09-06, `plugin-architecture.md`): *"could two different
implementations of this be installed side by side and swapped by an administrator? Yes →
plugin. No → domain module + feature flag."*

| Feature | Decision | Justification |
| --- | --- | --- |
| **Custom fields (#44)** | **Domain module + flag** (`always on`, per the spec header — so really just a domain module, no flag needed at all beyond the per-type visibility it already has). | There is exactly one custom-fields implementation; what varies is *configuration* (which fields, which sections, which types) — not swappable engines. `custom-fields.md` never proposes alternates. **No registry temptation here** — the spec correctly models it as tables (`custom_field_section`, `custom_field`, …) plus a settings screen, not a plugin kind. This is the easy case; flagging it only to confirm it is not being over-engineered |
| **Notifications (#45)** | **Split, and the spec already splits it correctly.** The *channel* axis is a plugin (`notify.email`, `notify.webhook`, future `notify.teams`/`slack`/…) — genuinely swappable, installed side by side (an instance can run SMTP and the generic webhook simultaneously), each with its own config schema and `test()`. The *preference/digest/quiet-hours* axis is a domain module — one preference-resolution algorithm, one digest batcher, configured per person/workspace/project, never swapped | `notifications.md` itself: "Every channel is a `notify.*` plugin... An administrator decides which exist on this instance." Confirmed already in `plugin-architecture.md`'s `notify` kind table. **The temptation to avoid:** do not build a "preference engine registry" — there is one preference-resolution algorithm (`NO-1`–`NO-3`), it is a domain module, not a plugin kind |
| **Automations (#46)** | **Domain module + flag** (`feature.automations`). | One rule engine (trigger/conditions/actions), not swappable implementations — an administrator cannot install "a different automation engine" side by side with this one. `automations.md`'s own design stance ("ours should cover ninety per cent... anything needing branching/loops is a webhook to a real automation tool") is explicit that this is deliberately *not* meant to be pluggable/extensible into a general engine — that door is the webhook action, not a second automation plugin kind. **This is exactly the registry temptation named in the task**: automations *could* be modelled as a registry of "trigger handlers" or "action handlers," each with one member per action type, which would be ceremony around a fixed, closed action vocabulary (`automations.md`: "the action vocabulary above contains no delete... any later capability needs its own feature specification" — a closed list, not an open registry) |
| **Webhooks and API keys (#47)** | **Domain module + flag** for the webhook/API-key *mechanism itself* (`always on`) — there is one webhook delivery engine and one API-key evaluator, not swappable ones. Note this is **distinct** from `notify.webhook`, which *is* a plugin (a notification channel) — #47's webhooks are a **generic outbound integration surface** (any event, any URL), architecturally adjacent but not the same registry member; the spec cross-references but does not merge them, and this plan does not either | `webhooks-and-api-keys.md` names no alternate implementation of webhook delivery or API-key evaluation; SSRF protection, HMAC signing and retry/backoff are one mechanism, God Mode-configured (URL, events, secret) per webhook row, not per-deployment swappable |
| **MCP server (#48)** | **Domain module + flag** (`feature.mcp`). | `mcp-server.md`'s central architectural claim is that the MCP server is "a thin client over the public API... there is one authorization surface, not two" — explicitly **not** a second pluggable backend, precisely to avoid the registry temptation of "many MCP servers, pick one." There is one MCP server package (`@taskdesk/mcp`), one flag to disable it entirely, and its behaviour is 100% inherited from whatever routes/policies exist — nothing about it is swappable |
| **Roles and permissions UI (#40)**, **Teams (#41)**, **God Mode (#42)**, **Settings hierarchy (#43)** | **Not plugin-kind questions at all** — these are the administration surface itself, not features that could have alternate implementations. God Mode *hosts* the plugin registry (Plugins screen) but is not itself a plugin. No engine-boundary decision needed; flagging their absence from the table above is deliberate, not an omission | `plugin-architecture.md`'s seven plugin kinds (`auth`, `storage`, `notify`, `devlink`, `import`, `search`, `ai`, `license`) do not include "administration," "roles," or "teams" — correctly, since none of these vary between deployments in the swappable-backend sense |

**Where the registry temptation is most concrete, restated:** automations (#46) is the one
issue whose action/trigger vocabulary could plausibly be redesigned as an open plugin
registry ("action plugins," "trigger plugins") by an implementer reaching for
"everything is an engine" without reading the 2026-09-06 boundary rule first. The spec's
own "no branching, no loops, no sub-flows... a webhook is the escape hatch" is the answer:
**closed vocabulary, domain module, flag** — and #46's acceptance criteria should be read
literally on this point before writing a single interface.

**Correction made during this prep pass:** `apps/api/src/plugins/{index,registry,types}.ts`
**does exist on `main`**, but reading it shows it is **kaneo's inherited `IntegrationPlugin`
system** — `registerPlugin`, `initializeEventSubscriptions`, `TaskCreatedEvent` et al. —
the mechanism behind the GitHub/Gitea/Slack/Discord/Telegram/webhook integration routers
that do-not 14 and `inherited-features.md` mark **deleted at fork**, and `rbac.md` cites
this same `registry.ts:29` only for its (surviving, generic) `subscribeToEvent` wiring, not
for its plugin concept. **This is not the TaskDesk `packages/plugins-contracts`
`Plugin<TConfig>` contract** described in `plugin-architecture.md` — that package does not
exist yet (AGENTS.md marks it NOT YET). So #45's `notify.email` / `notify.webhook` plugins,
and every other `auth`/`storage`/`notify` plugin, are **greenfield**: nothing in
`apps/api/src/plugins/` is reusable for them, and an implementer must not be tempted to
extend the inherited `IntegrationPlugin` map instead of building the real one — that map is
scheduled for deletion, not extension. Confirm at #45/#42 implementation start that #16's
removal of the inherited integration routers has actually deleted this directory (per
status.md, #16 is merged, but a stale mount of the *dispatcher* using this registry may
still be wired at `apps/api/src/index.ts` — check before building on top of it).

## 4. Dependency order across the nine, with concrete edges

**Precondition for all nine:** Throttle 1 (per CLAUDE.md: #5, #6-the-issue, #7, route-policy
coverage running in CI, and an unclassified route demonstrably failing CI). As of this prep
pass (`main` at `955f8d4d`), **Throttle 1 has not opened**: #6 the issue is not complete
(organization-plugin retrofit S2–S10 remain; only S1 is done), #19 (the CI job that runs the
coverage gate) is still an open PR. So nothing in P4 can merge before Throttle 1, by the
working agreement's own three-to-four-active-branches model — but planning, spec-closure and
interface design (see "what can start immediately" below) do not need code to merge.

**Edges among the nine:**

```
#41 teams ─────────────┬──────────────────────────────────► #36 (P2 approvals/CAB) needs team.is_cab
                        │                                      — cross-lane edge, not P4-internal
                        ▼
#40 roles and permissions UI ◄──── requires #66 CLOSED (hasWorkspacePermission fallback fix)
        │                           before its own acceptance criteria can be honestly met
        ▼
#43 settings hierarchy  ◄──── structurally depends on #40 (Roles screen embeds in workspace
        │                     settings nav) and #41 (Teams screen likewise) and is the
        │                     completion GATE for P1/P2/P3's own settings screens landing
        │                     with their features (§2 above) — so #43 cannot honestly close
        │                     before P1/P2/P3 finish shipping their rows, even though its
        │                     OWN infrastructure (flag resolution, inheritance indicator,
        │                     dry-run convention, Profile screens) can be built early
        ▼
#42 God Mode ◄──── hosts the plugin registry UI; depends on #9 (UI extraction, for the
        │          generated-form primitive per §1) and on whichever plugins exist to list;
        │          Authentication/Organisations sections depend on P3 identity work;
        │          Audit section depends on #37 (P2) for the underlying table+retention
        │          setting already existing
        ▼
#44 custom fields ──────── independent of the other eight once #40/#43's infra exists;
                            needs work_item_type (#23, P1) to exist for CF-2/CF-3 (per-type
                            visibility) to have something to key on
#45 notifications ──────── the in-app inbox is P1; P4's slice is channel plugins (notify.*)
                            + preference/digest/quiet-hours — needs #42's Plugins screen to
                            list/test channels through the generic route, and needs the
                            unified events.md catalogue (already on main as a planning doc,
                            not yet as packages/domain/src/events/ code)
#46 automations ────────── needs #31 (workflows, P2) for legal-transition checking, needs
                            #45's notification "send a notification" action, needs #47's
                            webhook action (WH-14, AM-12: delivers only what the webhook
                            owner may see) — so #46 is the most cross-dependent of the nine
                            and should sequence AFTER #45 and #47's core mechanism exists,
                            even though all three can be spec'd/reviewed in parallel
#47 webhooks and API keys ─ independent schema-wise; its capability vocabulary
                            (webhook:manage, api_key:manage) is ALREADY on main (§ found
                            below) — genuinely close to startable once Throttle 1 opens.
                            #47 also owes the resolution to R10/the session-only-reach
                            hazard (§7) before #40/#42 can safely expose role/membership
                            reads through a route an API key might reach
#48 MCP server ──────────── depends on #47 (API keys — is_mcp flag, capability clamping)
                            being built first; otherwise pure route-parity work over
                            whatever P1–P3 routes already exist
```

**What can genuinely start immediately (spec/interface work, no schema dependency, before
Throttle 1 even opens):**

1. **Close #66** (see §7 — this blocks #40's acceptance criteria honestly, and blocks S7 of
   the organization retrofit per the issue itself: "S7 is blocked until this is resolved").
   This is arguably the single highest-leverage immediate task for the whole P4 lane.
2. **Re-verify `docs/07-planning/reviews/2026-09-05/features-governance-design.md`'s
   sections 1–8** (roles, god-mode, settings-hierarchy, custom-fields, notifications,
   automations, webhooks-and-api-keys, mcp-server) against the *current* spec text — see
   §9/Appendix below. Cross-reading done in this prep pass found nearly every "high"
   finding already fixed in the spec since the review was written, but **the SDLC step-2
   exit criterion requires a reviewer, not the author, to check this box**, and no
   decision-log or in-file marker records that check having happened for these eight
   sections (unlike e.g. `21-policy-registry.md`'s `VERIFIED-CLOSED` annotations). This is
   real, low-risk, high-value work a reviewer (not this prep agent — do-not 7) can do before
   Throttle 1 opens, and it directly satisfies do-not 15.
3. **Design `packages/plugins-contracts`** (the `Plugin<TConfig>` interface, `secretFields`,
   `configSchema`, `validate`/`test`/`create`) as a small dedicated contract PR — it is
   listed shared-contract-adjacent (touches the plugin registry every `notify.*`/`auth.*`
   plugin depends on) and per CLAUDE.md §5 needs its own reviewed PR, not a feature-agent
   drive-by. This unblocks #42, #45 concretely.
4. **teams.md has no section in the 2026-09-05 governance review** (it did not exist yet —
   the review's own "what is missing entirely" list names it). #41 should get an equivalent
   review pass before build, not skip review because none exists — flagged as a genuine
   process gap, not a "nothing to do here."
5. Write `#40`'s and `#41`'s route-policy files (`policy.ts`) referencing the
   **already-registered** capabilities (see §6) — this is real, mergeable-once-Throttle-1-
   opens work with zero dependency on P1–P3 schema, because roles/teams are pure P4 tables.

**What must wait for P1–P3 surface:**

- #44 (custom fields) needs `work_item_type` (#23) and the work-item form to attach to.
- #46 (automations) needs #31 (workflows) for transition legality and #34 (request types)
  for `submission.received` semantics.
- #42's Authentication/Organisations sections need P3's identity_connection/scim_connection
  work landed (`identity-provisioning.md`), not merely spec'd.
- #43's completion cannot be claimed before P1/P2/P3 finish their own settings rows (§2).

## 5. Acceptance criteria per issue — from the issue and spec, not invented

Each GitHub issue is a **completion-gate issue**: "PRs are slices and the spec remains
authoritative." So the issue's own "Done when" line plus the spec's Testing section is the
acceptance criteria — quoted, not paraphrased.

**#40 roles and permissions UI** — issue: *"editable roles/capability matrix,
reach-vs-authority semantics, permissions UX, named tests and applicable
Definition-of-Done/security gates pass, and the feature index can mark Roles and
permissions UI shipped."* Spec tests: `role-privilege-escalation.spec.ts` (`RL-3`),
`role-rank-guard.spec.ts` (`RL-4`), `capability-implication.spec.ts` (`RL-5`),
`last-admin-role-protected.spec.ts` (`RL-7`). **Cannot honestly pass "reach-vs-authority
semantics" while #66 is open** — see §7.

**#41 teams** — issue: *"all team membership, reach/authority, permissions, screens, APIs,
named tests and applicable gates pass."* Spec tests:
`teams-reach-via-owner.spec.ts` (`TM-4`), `teams-cab-membership-gates-decision.spec.ts`
(`TM-5`, `TM-6`), `teams-lead-can-edit-roster.spec.ts` (`TM-3`),
`teams-delete-refused-while-owning.spec.ts` (`TM-7`).

**#42 God Mode** — issue: *"general/branding/storage/notifications/features/jobs/plugins/
users/audit/health surfaces, permissions, APIs, named tests and applicable gates pass."*
Spec tests: `godmode-requires-instance-admin.spec.ts`, `secrets-never-serialised.spec.ts`,
`impersonation-audited.spec.ts` (`GM-7`,`GM-8`), `impersonation-forbidden-actions.spec.ts`
(`GM-9`,`GM-10`), `impersonation-cap.spec.ts`, `rekey-resumable.spec.ts` (`GM-12`–`14`),
`terminology-a11y-name.spec.ts` (`GM-T5`).

**#43 settings hierarchy** — issue: *"instance/workspace/project settings hierarchy,
locking/inheritance, permissions, screens, APIs, named tests and applicable gates pass."*
Spec tests: `flag-resolution.spec.ts` (`ST-1`,`ST-2`),
`locked-flag-cannot-be-overridden.spec.ts` (`ST-2`), `inheritance-indicator.spec.ts`
(`ST-3`,`ST-4`), `settings-history.spec.ts` (`ST-6`), `dry-run-blast-radius.spec.ts`
(`ST-7`), `project-move-refuses-unmapped.spec.ts` (`ST-10`). **This issue cannot close
before every P1/P2/P3 settings row in §2's table exists** — its own "done when" line
implicitly depends on that even though the issue text does not say so explicitly; flag
this dependency loudly when the issue is worked, since it is easy to attempt #43 as an
isolated P4 slice and find it structurally incomplete.

**#44 custom fields** — issue: *"custom-field sections/type visibility, permissions,
screens, APIs, named tests and applicable gates pass."* Spec testing section is prose
(unit: per-type visibility resolution, conditional evaluation, required-field gating;
integration: values scoped by entity permission, option-removal-refused-while-in-use,
soft-delete/restore round-trip) — **no named test files**, unlike most other P4 specs; the
implementing lane should name them at spec-close (SDLC step 2) rather than at code review.

**#45 notifications** — issue: *"notification channels/preferences/digests/quiet-hours
behavior, permissions, screens, APIs, named tests and applicable gates pass."* Spec testing
is also prose only (per the same gap the 2026-09-05 review flagged, low severity, still
present in the current text) — name files at step 2: candidates
`customer-never-sees-internal.spec.ts` (`NO-19`,`NO-20`), `outbox-transactional.spec.ts`
(`NO-8`), `preference-resolution.spec.ts` (`NO-1`).

**#46 automations** — issue: *"automation triggers/actions, dry-run, permissions, screens,
APIs, named tests and applicable security/UX gates pass, **including alignment of the
inherited flag-gated workflow-rule engine**."* That last clause is load-bearing and easy to
miss: `apps/api/src/database/schema.ts` already defines `workflowRuleTable` — **kaneo's own
inherited automation-adjacent engine, distinct from the `automation` table
`data-model.md` §11 specifies for P4.** #46 is not greenfield; it must reconcile (or
explicitly retire) the inherited `workflowRuleTable` against the new `automation` /
`automation_run` schema before or alongside building the new engine — the issue text
anticipated exactly this, and `plugin-architecture.md`'s `feature.automations` flag entry
says "the engine is inherited from kaneo; flagged off until spec-aligned," confirming the
inherited table is currently **off**, not absent. **Uncertain / needs a read at
implementation start:** whether "alignment" means adapting the inherited table's rows into
the new schema, or deleting `workflowRuleTable` outright and building fresh — the spec
(`automations.md`) describes only the new shape and never mentions the inherited table by
name, so this decision is not yet written down anywhere and should go through the SDLC
step-2 spec-close gate, possibly needing a decision-log entry given it is "material
behaviour" per CLAUDE.md §6.

**#47 webhooks and API keys** — issue: *"signed/retried webhook delivery, delivery
history, SSRF protection, personal/workspace service keys, bounded authority, revocation,
permissions, named tests and applicable security gates pass."* Named tests:
`webhook-ssrf-guard.spec.ts` (`WH-9`–`WH-12`), `webhook-signature.spec.ts` (`WH-1`,`WH-2`),
`api-key-clamped-to-owner.spec.ts` (`AK-3`), `service-key-cannot-exceed-creator.spec.ts`
(`AK-7`), `webhook-delivery-reach.test.ts` (`WH-14`). **Must also resolve R10 (§7) —
the issue's "bounded authority" criterion is exactly what R10 leaves undecided for
workspace-CRUD-adjacent native routes.**

**#48 MCP server** — issue: *"MCP server uses the mature authority model, defaults keys
read-only, routes destructive tools through pending actions, exposes the pending-actions
UX, passes named tests and applicable security gates."* Spec: `tests/mcp/injection.test.ts`
(prompt-injection scenario, `MC-15`–`MC-18`); `pnpm test:mcp` tool-to-route parity test
(consumes the tool→route→policy table in `mcp-server.md`'s API section).

## 6. Identifier registrations owed, and to which authoritative document

Checked directly against `packages/permissions/src/capabilities.ts` on `main` at
`955f8d4d` (not assumed from the docs):

**Already registered in code (`packages/permissions/src/capabilities.ts`) — confirmed by
direct grep, not assumption:** `instance:admin`, `instance:read_audit`,
`instance:manage_plugins`, `instance:manage_jobs`, `instance:manage_terminology`,
`workspace:manage_roles`, `workspace:manage_settings`, `custom_field:manage`,
`api_key:manage`, `webhook:manage`, `automation:manage`. **This means the RBAC capability
vocabulary P4 needs is already on `main` from #21 — the P4 lanes do not need to invent or
register new capabilities for their core actions**, only reference the existing ones.
Checked specifically for a gap the God Mode Users section might imply
(`instance:manage_users`) — **none exists, and none is needed**: `god-mode.md`'s own
Permissions table gates every Users action with plain `instance:admin` (which
`capabilities.ts` confirms `implies: ["instance:*"]`, i.e. the whole Instance group), so
there is no missing capability here, just a capability that must not be invented.

**Not yet in code, owed at implementation, one per do-not 11:**

| Identifier class | Owed by | Lands in |
| --- | --- | --- |
| Tables: `instance_setting`, `instance_branding`, `instance_plugin_config`, `instance_feature_flag`, `workspace_feature_flag`, `project_feature_flag`, `terminology_override`, `role` (generic, replacing/extending `workspace_role`), `team.is_cab`/`capacity_days_per_week`, `custom_field*` (4 tables), `automation`/`automation_run`, `notification_preference` (extended), `webhook`/`webhook_delivery` (extended), `api_key` (extension table) | The issue building each (already fully specified in `data-model.md` §§1,2,5,11 — **the planning-doc registration already exists**; what's owed is the actual migration + `schema.ts` entry) | `docs/01-architecture/data-model.md` (already done) → migration + `apps/api/src/database/schema.ts` (not done) |
| Feature flags: `feature.automations`, `feature.mcp`, and any new one a P4 issue introduces | The introducing issue | `docs/01-architecture/plugin-architecture.md § Feature toggles` (already lists both — confirmed by direct read) — a CI test (not yet on `main`, arrives with #19) asserts the code enum matches this table |
| Plugin kinds: none new — `auth`/`storage`/`notify`/`import`/`search`/`ai`/`license` are the fixed seven; P4 adds **instances** of `notify` (`notify.email`, `notify.webhook`), not new kinds | #45 | `plugin-architecture.md § Plugin kinds` (already lists both) |
| Capabilities: any found missing at implementation start (see `instance:manage_users` uncertainty above) | The issue needing it | `docs/01-architecture/rbac.md` + `packages/permissions/src/capabilities.ts` in the **same change** |
| Event keys: `webhook.auto_disabled`, `api_key.auto_disabled`, `automation.run_failed` and the rest of `notifications.md`'s event table — **already registered as planning-doc entries** in `docs/01-architecture/events.md`'s catalogue (confirmed by direct read: the file states "a CI test asserts the enum in `packages/domain/src/events/` equals this table") | #45/#46/#47 | `docs/01-architecture/events.md` (already done) → `packages/domain/src/events/` (not done — `packages/domain` itself is marked NOT YET in AGENTS.md) |
| Background jobs: `outbox-drain`, `notification-digest`, `automation-schedule`, `pending-action-expire` and others relevant to P4 — **already registered** in `docs/01-architecture/background-jobs.md` (confirmed by direct read, with schedule/lease/description per job) | #45/#46/#47/#48 | `docs/01-architecture/background-jobs.md` (already done) → actual job code (not done) |
| Env vars: none new identified for P4 — every P4-relevant setting (MCP write ceiling, API-key burst threshold, encryption key rotation) is **God Mode/database configuration**, per the plugin-architecture rule, not an env var. If an implementer is tempted to add one (e.g. a default automation dry-run window), it must go through `docs/05-operations/configuration-reference.md` first and needs a reason it cannot be a database setting | Whichever issue proposes it | `docs/05-operations/configuration-reference.md` |
| Rule-id prefixes: `RL`, `GM`/`GM-T`, `ST`, `CF`, `NO`, `AM`, `WH`/`AK`, `MC` — **all nine already allocated**, confirmed against `docs/03-features/README.md`'s prefix table (no collisions found for the P4 set; the historical `AU`/`SV`/`RL` collisions the decision log records were already renumbered away from automations/roles before this prep pass) | — | `docs/03-features/README.md` (already done) |

**The mechanical takeaway:** for P4, the planning-document half of do-not 11 is
**already satisfied** for almost every identifier — data-model.md, rbac.md's capability
list, events.md, background-jobs.md and plugin-architecture.md's flag/kind tables all
predate this prep pass and were checked directly, not assumed. What remains is the
**code** half (migrations, `schema.ts`, `capabilities.ts` additions where genuinely
missing, `packages/domain/src/events/`), which do-not 11 requires to land **in the same
change** as whichever P4 issue first uses each identifier — not registered speculatively
ahead of the feature that needs it.

## 7. Security surface, enumerated — for the reviewer who reads this first

Three of the nine issues carry the mandatory Opus security review by name in the task
brief: **#47** (API keys, webhook signing/delivery), **#42** (God Mode, the highest-
privilege surface in the product), **#40** (permissions UI). This section is written for
that reviewer, not for the implementer.

### 7.1 — Hazard 1: #40 inherits issue #66 (`hasWorkspacePermission` fail-open fallback)

**The defect, quoted from #66:** `hasWorkspacePermission` in
`apps/api/src/utils/require-workspace-permission.ts` runs
`(await customRoleStatements(workspaceId, member.role)) ?? builtInRoleStatements(member.role)`
— it falls back to the **compiled-in static role definitions** whenever no `workspace_role`
DB row matches the caller's role name. Verified present on `main` at `955f8d4d`. Measured
divergence from the `organization()` plugin's own evaluator: **admin diverges on 16 of 16
capability checks**; member on 6 of 16; viewer on 0 of 16.

**Exactly where this bites #40, stated precisely:** `roles-and-permissions-ui.md`'s `RL-9`
says *"Changing a role takes effect immediately for every holder, because authority is
resolved from the database on every request."* The roles UI's entire value proposition —
an administrator narrows the `admin` role's capability set, sees "This will change
permissions for 14 people immediately," and trusts that it did — is **false** the moment
the underlying `workspace_role` row for that role is later deleted (accidentally, or via
`RL-8`'s pending-action delete flow) or was never seeded (R6: `afterCreateOrganization`
seeds roles in a `try/catch` that swallows failure, so a workspace can exist for hours with
no role rows). At that point `hasWorkspacePermission` **silently reinstates the full
compiled-in `admin` statement set** — every one of the 16 capabilities the administrator
thought they had removed — while the roles UI, reading whatever it reads (a `role`/
`workspace_role` row that is now absent, or shows the narrowed set from history/cache),
**displays authority the database does not actually grant at request time.** The UI and
the enforcement point disagree, and the disagreement is invisible until someone tests the
narrowed capability directly against the API. This is not a hypothetical: #66's own
"Done when" criterion 4 is *"native `/api/capabilities` and the canonical permission
evaluator agree for missing-role cases"* — i.e., the bug is explicitly framed as a
UI/evaluator disagreement problem, exactly as this hazard describes.

**The escalation path #66 names:** an admin narrows the `admin` role, then **deletes** that
role row — the narrowing is *undone* by the delete, because deletion returns the evaluator
to the fail-open fallback. A permission downgrade reversed by a delete is a privilege
escalation primitive, reachable today via direct DB access and **reachable through the
product the moment S7's native role-delete routes ship** — which is #40's own delete
route (`DELETE /api/roles/{id}`, `RL-8`).

**What must not be reachable:** no path by which deleting or losing a `workspace_role` row
restores broader-than-configured authority. No path by which the roles UI's displayed
capability set and the runtime-enforced capability set diverge for any role, missing-row
or not.

**Negative tests owed (from #66's "Done when," verbatim):**
- default role rows are created atomically with workspace creation, or creation aborts —
  test that a crashed/interrupted role-seed never leaves a workspace with holders and no
  role rows
- deleting/missing a narrowed admin/member role never restores broader compiled
  permissions — the direct regression #66 names, preserved from PR #65's
  `tests/api-integration/capabilities-equivalence.test.ts` ("FINDING: default-role fallback
  diverges from the plugin once the row is gone")
- S7 (role-delete, i.e. #40's `DELETE /api/roles/{id}`) preserves assigned-role /
  last-admin / system-role guardrails **in combination with** the missing-row case — a
  role that is both "last holding `workspace:manage_roles`" (`RL-7`) and subject to the
  fallback must not be deletable in a way that both empties the guard and re-grants full
  authority
- the admin/member/viewer/custom role matrix (`RL`'s own permission-matrix test) is
  extended to include missing/deleted-row cases, not only present-row cases
- a regression proves delete-after-narrow cannot escalate authority

**Sequencing implication, stated plainly:** #40's acceptance criterion "reach-vs-authority
semantics" (issue #40's own words) cannot be honestly claimed met while #66 is open, and
#66 itself says **"S7 is blocked until this is resolved"** — S7 is the organization-retrofit
step that includes native role-delete routes, which is the surface #40 ships. **#66 must
close before #40's delete-role path ships**, even if #40's read/create/edit paths can be
built and reviewed in parallel with #66's fix.

### 7.2 — Hazard 2: #47 and the "native organization routes preserve inherited session-only
reach" decision

**The adjacent decision, precisely located:** `docs/07-planning/retrofits/
organization-plugin-retrofit.md` R10, quoted in full because it is the load-bearing text:
*"`enableSessionForAPIKeys: false` ... means an API key never became a session, so
`/organization/*` was effectively session-only. Every route added in S2/S4–S7 mounts below
the global guard ... which authenticates API keys too. Workspace creation, member removal
and role editing would become API-key-reachable for the first time. `hasWorkspacePermission`
does intersect API-key permissions ... so this is contained rather than open — but the
policy decision ('which routes are `sessionOnly`') belongs to #7's route-policy registry
... Flag it; do not decide it here."*

**Current state, checked directly against `rbac.md` on `main`:** the **elevated + session-
only list** (`rbac.md § Elevated and audited actions`) already marks **deletion** of a
workspace, organisation, project, API key, webhook or identity connection as
`sessionOnly: true` — so those specific DELETEs are settled: refused `403 session_required`
from any non-session credential. **What R10 actually flags is broader and is NOT settled
by the elevated-deletion list**: ordinary **workspace creation, membership reads/writes,
and invitation management** — the routes S2/S4–S7 are about to add natively — were
*implicitly* session-only under the old plugin (`enableSessionForAPIKeys: false`) and have
**no equivalent stated rule** for the native replacements. Creating a workspace is not on
the elevated-deletion list; reading or editing membership is not either (only
`workspace:manage_members` granting `sees_all` is elevated, per the single list — the
membership *read* and ordinary *edit* paths are not). **This is a real, open gap between
what R10 asks for and what `rbac.md`'s current elevated/session-only tables actually
decide**, and it is precisely the hazard the task brief names: *"a personal API key must
not reach workspace/membership/invitation data through a native route"* is **not yet a
written rule** for the non-elevated portion of that surface — it is inherited behaviour
that a native retrofit route can silently drop simply by not being marked `sessionOnly`.

**What #47 must not do:** #47 defines the **general** personal-API-key capability model
(`AK-3`, `AK-9` — read-only default, clamped to current authority). That model is
necessary but **not sufficient** here: `AK-3`'s clamping means a key still *inherits*
whatever capability the owner holds, including `workspace:read`/`workspace:create` if the
owner has them. If #47 ships its capability-subset model without #6/S2–S7 (a different
lane, not P4) also explicitly deciding and marking `sessionOnly` on the *non-elevated*
workspace-create/membership-read/invitation routes, **the net effect of #47 landing first
is a widening**: a personal API key that previously could not reach `/organization/*` at
all (old plugin behaviour) now reaches its native replacement, gated only by capability —
which is exactly "casually widening what an API key can do" the task brief warns against.

**What #47's plan must say, concretely, to the organization-retrofit lane (#6/S2–S7, not
P4's own issue, but P4 is the seam that must catch this before it ships):**
1. Do not assume `AK-3`'s general clamping model is sufficient for the workspace/
   membership/invitation surface. That surface carries an *additional*, inherited
   session-only expectation that predates the capability model and is orthogonal to it.
2. Before S4–S7 (native workspace/member/invitation routes) ship, each such route's policy
   must explicitly decide `sessionOnly: true` or `false` and — if `false` — that decision
   needs the same weight as any other widening of API-key reach: a decision-log entry,
   not a default inherited silently from "well, `AK-3` clamps it."
3. #47's own acceptance criterion "bounded authority" (issue #47's words) should be read to
   include this: bounded not only by the owner's capability set, but by whether the *route*
   is reachable by a non-session credential at all — two independent gates, and #47 must
   not let the first one stand in for the second.

**Negative tests owed:** a personal API key with full owner authority (e.g. the owner is a
workspace admin) attempting `POST /api/workspaces` (or its native equivalent),
`GET/PATCH /api/workspaces/{id}/members`, and invitation create/accept/list, each asserted
against **whatever `sessionOnly` decision the retrofit lane ultimately records** — the test
should fail loudly (not silently pass) if that decision has not yet been made explicit in
`rbac.md`'s policy map, so an unmarked route cannot ship by omission.

**Who owns fixing this:** this is technically the organization-retrofit lane's (#6, S2–S7)
decision to make, since the routes in question are native replacements for the removed
plugin, not P4's own schema. **P4's obligation is to not build #47's capability/clamping
model as if it already covers this**, and to flag the gap loudly in #47's spec-close (SDLC
step 2) so it is not silently assumed closed. This plan does not decide `sessionOnly: true`
or `false` for those routes — that is exactly the kind of "material behaviour change" that
CLAUDE.md §6 says needs "spec and decision log first, then code," and it is Thomas's call
(§9 below), informed by whoever is running the organization retrofit.

### 7.3 — #42 God Mode: the highest-privilege surface

- **What must never be reachable:** any God Mode route without `instance:admin` (or the
  narrower `instance:manage_*` where the route uses one); any secret value in any API
  response (reads return `"••••••••"`); `auth.password` removal (lock-out prevention);
  granting `instance:admin` via any identity connection, OIDC claim, SCIM attribute or
  group mapping (explicit do-not 13); impersonating another instance administrator
  (`GM-10`); an impersonation session outliving 30 minutes (`GM-7`); an impersonator
  performing an elevated action, approving/requesting a deletion, or creating anything
  that outlives the session (`GM-9`).
- **What must never be logged or serialised:** plugin `secretFields` values — only the
  fact that a secret changed (`GM-1`); SCIM tokens beyond their one-time display; OIDC
  `client_secret`; the encryption key itself, ever, anywhere in logs.
- **Negative tests, already named in the spec:** `secrets-never-serialised.spec.ts`,
  `impersonation-forbidden-actions.spec.ts` (`GM-9`,`GM-10`), `impersonation-cap.spec.ts`.
- **This prep pass's addition to that list:** a test that the **Plugins** screen
  (`instance:manage_plugins`) cannot be reached with only `instance:read_audit` or any
  other narrower instance capability — i.e., the capability-boundary tests should be
  written per-screen, not only per the top-level `instance:admin` gate, since
  `instance:manage_jobs`/`instance:manage_terminology`/`instance:read_audit` are all
  narrower capabilities implied by, but distinct from, `instance:admin`, and a route
  policy that accidentally accepts the narrower one where it should require the broader
  one is a silent privilege widening in the other direction.

### 7.4 — `secretFields` and the plugin contract, generally

Every plugin (`notify.email`'s SMTP credentials, `notify.webhook`'s nothing-secret-here-
but-`auth.oidc`'s client secret, `identity_connection.client_secret`, `scim_connection.
token_hash`) must declare its `secretFields` per the `Plugin<TConfig>` contract
(`plugin-architecture.md`), and #42/#45's admin API must honour "omitting a secret field on
write means unchanged; there is no in-band sentinel string" literally — an implementer who
treats `"••••••••"` as a real value that gets round-tripped back into storage would
overwrite a real secret with the mask. Negative test: PATCH a plugin config without
touching its secret field; assert the stored secret is byte-identical to before.

## 8. What P4 must NOT do

- **No per-customer hardcoding.** No `if (customer === …)`, no `process.env` read for
  anything but the five required + optional operational bootstrap variables already listed
  in `configuration-reference.md`. Every P4 setting is a database row, God Mode-editable.
- **No registry built for a single implementation.** Concretely for this lane: do not give
  automations (#46) a "trigger plugin" / "action plugin" registry — its vocabulary is
  closed by design (§3). Do not give custom fields (#44) a "field-type plugin" registry —
  the format list is a fixed enum in `data-model.md`, not swappable backends. Do not give
  webhooks (#47) a "delivery-mechanism plugin" registry — there is one HMAC-signed HTTP
  delivery mechanism. Each of these is a **real temptation** because "everything is an
  engine" reads naturally that way until the 2026-09-06 boundary rule is applied
  deliberately, one feature at a time.
- **No seam deferred to "later."** A P1/P2 pull request that ships a configurable feature
  (a new work item type field, an SLA policy shape, a workflow transition) without its
  settings screen and admin API in the **same pull request** has not met its own
  Definition of Done — P4's job is to notice this in review, not to clean it up
  afterward in a dedicated P4 pull request. If a lane genuinely cannot land the seam
  immediately (e.g. genuinely blocked on `packages/plugins-contracts` or `packages/ui`'s
  form generator not existing yet), that is a **hard block, shared contract** per the
  blocking taxonomy — escalate to Thomas, do not ship the feature without its seam and
  call it "P4 follow-up."
- **No self-approval of the mandatory reviews.** #40, #42 and #47 all require the
  independent Opus security review (CLAUDE.md's three absolutes) — no Sonnet
  implementation agent may sign off its own remediation, and no orchestrator may either.
- **No deciding #47's `sessionOnly` question in this prep pass, or silently, in
  implementation.** §7.2 identifies a real gap; this plan states it precisely and hands it
  to Thomas (§9) rather than picking an answer, because it is exactly the "material
  behaviour change" CLAUDE.md §6 reserves for spec-and-decision-log-first.
- **No building #40's role-delete route ahead of #66's fix landing**, per §7.1's
  sequencing — the two are not independent even though they are nominally two different
  issues.

## 9. Open questions genuinely needing Thomas — checked against the decision log first

Both of the following were searched for directly in `docs/07-planning/decision-log.md`
(every dated entry title, plus targeted grep for "sessionOnly", "session_required",
"native organization route", "workspace_role", "hasWorkspacePermission") and **neither has
a recorded Thomas decision** — they are genuinely open, not merely undocumented:

1. **Should the native workspace-create / membership-read-and-write / invitation routes
   (organization-retrofit S2, S4–S7) be marked `sessionOnly` in the route-policy registry,
   preserving the inherited plugin's de-facto session-only reach — or is capability-based
   clamping (`AK-3`) considered sufficient on its own?** (§7.2). This is not P4's decision
   alone to make — it is the organization-retrofit lane's route policies that would carry
   the mark — but P4's #47 (webhooks and API keys) cannot honestly claim "bounded
   authority" without knowing the answer, and a wrong default (silently `sessionOnly:
   false`) is a real widening of what a personal API key can reach. **Recommend:**
   Thomas decides this alongside whoever owns the organization retrofit (#6), not as a P4
   decision in isolation, because the routes in question belong to that retrofit.
2. **#46's "alignment of the inherited flag-gated workflow-rule engine"** (issue #46's own
   acceptance-criterion wording) — does this mean adapting `workflowRuleTable`'s existing
   rows/shape into the new `automation`/`automation_run` schema, or retiring
   `workflowRuleTable` outright and building the new engine from nothing? No document
   states which, and `automations.md` never names the inherited table. **Recommend:**
   resolved at #46's SDLC step 2 (spec-close), with a decision-log entry given it is a
   material behaviour choice, not invented silently by whoever implements #46.

**Checked and found already decided (not reopened here, listed so the next agent does not
re-litigate them):** the engine-boundary rule itself (2026-09-06, settled); personal
API keys read-only by default (2026-09-06, Claude Code/Fable, reversible but not
contested); elevated targets never deletable from a non-session credential (2026-09-06,
same table); service API keys bounded by creator (2026-09-05, Thomas); `is_mcp`
self-declared, not a security boundary (2026-09-06, Claude Code, reversible).

## Appendix — cross-check of `docs/07-planning/reviews/2026-09-05/features-governance-
design.md` against the current spec text (for whoever runs SDLC step 2 on each issue)

This review (not the pre-p0-check-fable audit trail status.md cites) is a **separate**
document, dated the same day, whose eight sections (§1 roles, §2 god-mode, §3
settings-hierarchy, §4 custom-fields, §5 notifications, §6 automations, §7
webhooks-and-api-keys, §8 mcp-server) map 1:1 to eight of this lane's nine issues (teams has
no section — see below). **Per do-not 15 and the SDLC step-2 exit criterion ("the
feature's section in reviews/2026-09-05/ is empty... reviewers check this box, not the
author"), no P4 issue may enter step 3 (Build) while its section here is non-empty.**

Cross-reading the review's findings against the **current** spec files (this prep pass,
not assumed): the overwhelming majority of "high" and "medium" findings across all eight
sections **appear already fixed** in the spec text and in `data-model.md`/`rbac.md`/
`events.md`/`plugin-architecture.md` — concretely confirmed by direct reads in this pass:
`workspace_feature_flag` now exists (data-model.md §2); the canonical event catalogue now
exists (`events.md`) and all three consuming specs cite it instead of restating; the
`automation`/`automation_run` tables now exist (data-model.md §11); `webhook`/
`webhook_delivery` now carry `created_by`, `secret_previous`/`secret_rotated_at`
(`WH-13`), `attempt`/`request_body`/`response_body`; the `api_key` extension table now
exists with `capabilities`, `ip_allowlist`, service-key ownership-transfer rules (`AK-7`);
`custom_field` now carries `visibility_condition`, `customer_visible`, `help_text`; the
workspace-context convention (`X-Workspace-Id` header) is now stated once in `rbac.md`;
`MC-14`'s flag enforcement, `MC-4`'s `actor_type`/`api_key_id` on `audit_log`, and the
MCP tool→route→policy table all now exist in `mcp-server.md`.

**This is not the same as the review being marked closed.** No decision-log entry and no
in-file annotation (unlike `docs/07-planning/security-reviews/21-policy-registry.md`'s
`VERIFIED-CLOSED` markers) records that a reviewer re-checked these eight sections against
the current text and confirmed closure. **This prep pass is not that reviewer** — do-not 7
("approve your own design review") and the SDLC rule ("reviewers check this box, not the
author") both apply, and a prep agent recommending its own cross-check as sufficient would
be exactly the failure mode those rules exist to prevent. What this pass **can** responsibly
hand forward: the specific cross-references above, so the actual reviewer's job is
confirmation rather than a cold re-read.

**Two findings this pass did *not* confirm as closed, flagged for the reviewer's attention
specifically:**
- `RL-4`'s rank-comparison ambiguity ("ranked above your own" — is equal rank editable?)
  and `RL-5`'s full implication graph across all ~60 capabilities: `capabilities.ts` does
  carry an `implies` field per capability (confirmed for `instance:admin`), but this prep
  pass did not verify every capability has a complete, reviewed implication entry, nor
  did it find where `RL-4`'s exact comparison operator (`>` vs `>=`) is now stated.
- `mcp-server.md`'s `## Out of scope` section: this pass's read of the current file found
  `MC-3` reworded to state the device flow is "out of scope for P4 — moved to candidates"
  in-line, but did not confirm a literal `## Out of scope` header exists as the review's
  fix suggested — **cosmetic if the substance is there, but the SDLC template requires
  the section**, so worth a literal check.

**Teams (#41) has no section in this review** — `teams.md` did not exist when the review
was written (the review's own "what is missing entirely" list names it as a gap). It has
since been written (this prep pass read it in full and found it complete: 9 numbered
rules, permissions table, screens, API, named tests, "Open questions: None"). **No
equivalent independent review of `teams.md` is recorded anywhere this pass could find** —
flagged as a genuine process gap: #41 should get a review pass functionally equivalent to
what the other eight received, not skip one because none happened to exist at audit time.

## NOT DONE

- Did not read #24 (views and layouts), #28 (attachments), #35 (intake queue) specs in
  full — cited only from `docs/03-features/README.md`'s table and `settings-hierarchy.md`'s
  cross-references. Their per-lane obligations in §2 are marked accordingly where
  uncertain.
- Did not read #27 (comments-and-activity) or #36 (approvals) specs in full — the
  comment-edit-window and CAB-team-flag cross-dependencies in §2/§4 are inferred from
  `rbac.md` and `teams.md` citations, not from those specs' own text.
- Did not read the ADRs (0006 plugin registry, 0011 lifecycle engine, 0012 terminology
  overlay, 0013 marketplace metering) in full — cited only where `plugin-architecture.md`
  or `data-model.md` pointed at them directly.
- Did not read `docs/01-architecture/rbac.md` cover to cover — read the sections covering
  policy kinds, elevated/session-only routes, MCP, and the capability-registration
  mechanics; did not verify every one of the ~60 capabilities has a complete `group`,
  `description` and `implies` entry (flagged in the Appendix above for the reviewer).
- Did not read `docs/01-architecture/events.md`'s full catalogue table (read the envelope
  and section headers only) — did not enumerate every event key against every one of
  notifications.md/automations.md/webhooks-and-api-keys.md's tables to check for residual
  drift beyond what the review/decision-log already document as fixed.
- Did not read `docs/01-architecture/background-jobs.md` in full — read the job table only
  (schedule, lease, description columns), not its Behaviour/Health-threshold sections.
- Did not read `docs/03-features/{intake-queue,approvals,audit-trail,workflows,sla,
  service-calendars,request-types-and-catalogue}.md` (the P2 specs) in full — §2's P2 table
  is built from `README.md` + `settings-hierarchy.md` + `data-model.md` cross-references,
  not each spec's own Behaviour section. Confirm against each spec directly before treating
  §2's P2 row for that issue as complete.
- Did not read `docs/01-architecture/adr/0012-terminology-overlay.md` directly — the
  terminology material in §1/§7.3 is drawn from `god-mode.md`'s citations of it.
- Did not verify whether `apps/api/src/index.ts`'s route mount order still wires the
  inherited `apps/api/src/plugins/registry.ts` dispatcher live, or whether #16's removal
  already dead-coded it — flagged as a concrete check for whoever starts #45/#42, not
  resolved here (would require reading `index.ts` in full, not done in this pass).
- Did not attempt to determine whether `packages/plugins-contracts` should be a new
  top-level package or folded into an existing one — flagged as a question for whoever
  scopes the first small dedicated contract PR (§4, item 3), not decided here.
- No code was written, no dependency installed, no test run, no build attempted, per the
  hard boundaries of this task.
