# External readiness review — supplied by Thomas, 2026-09-05

> Written by a separate AI agent reviewing the `docs/v2-planning-corpus` branch as it
> stood after the first push (124 changed files, ~22,600 lines, no application code).
> Reproduced here verbatim as an additional review input, then answered in the
> [response](#taskdesk-response) at the end. The scores are the reviewer's, not ours.

---

## Readiness decision

**Decision: Conditional GO to development planning — do not start P0 code yet.**

First, run one **documentation-closure PR**. Then begin P0 implementation.

The repository currently has a complete planning branch, but it is still documentation-only. It contains 124 changed files and more than 22,600 lines of documentation on `docs/v2-planning-corpus`, with no application code merged yet. GitGuardian passed; there is no build/test evidence for the future application yet.

The current planning set is strong enough to guide development, but it is **not ready to hand directly to implementation agents** because your newly approved scope decisions—especially SCIM/Entra, universal delete approval, and deferred integrations—are not yet fully represented in the repository documents.

## Executive score

| Area | Score | Readiness |
|---|---:|---|
| Product direction and scope | 8.4/10 | Strong |
| Architecture | 8.7/10 | Strong, with identity update required |
| Security design | 8.8/10 | Strong, but several high-risk mechanisms remain paper controls |
| Multi-tenancy and authorization | 9.0/10 | Excellent direction |
| Data model | 8.4/10 | Strong, but SCIM/deletion records are missing |
| Workflow and SLA design | 8.5/10 | Strong after correction |
| UI/UX planning | 8.0/10 | Strong structure; values/components still need P0 work |
| Engineering process | 8.3/10 | Strong SDLC; execution capacity is a risk |
| QA and test strategy | 8.6/10 | Strong; needs SCIM/delete/MCP test additions |
| DevOps and operations | 8.1/10 | Good; external deployment controls need proof |
| Documentation completeness | 8.5/10 | Complete enough for planning, not implementation-ready |
| Delivery readiness | 7.4/10 | Conditional GO |
| Overall planning quality | **8.5/10** | **Above average, not yet implementation-complete** |

## What is good

### 1. The product direction is clear

TaskDesk v2 is not "another task board." It is a self-hosted, multi-organisation service desk and work-management platform with:

- Internal staff portal.
- Customer portal.
- RBAC and reach isolation.
- Work items, workflows, SLA, approvals, intake, knowledge base, reports.
- God Mode runtime configuration.
- Plugin architecture.
- MCP support.
- Self-hosted deployment and optional marketplace path.

That is a coherent product shape. It is ambitious but not directionless.

### 2. The authorization model is one of the strongest parts

The plan correctly separates:

- **Reach** — which projects, workspaces, organisations, and records a user can see.
- **Authority** — which actions the user can perform.

This is the right model for a multi-organisation ticketing system.

Good decisions include:

- Out-of-reach returns constant-shape 404.
- In-reach but unauthorized returns 403.
- Every route must declare one of five policy kinds.
- Public routes require a written reason.
- Delegated routes such as `/auth/*`, WebSocket, and metrics are not invisible.
- Route coverage is tested against the router, not only an OpenAPI document.
- Customer restrictions are behavioral and enforced server-side.
- Identity is checked from TaskDesk's local database, not blindly from a token claim.

This is a mature model and directly addresses common service-desk failures.

### 3. The workflow and SLA model is strong

The corrected model now makes sense:

- States are workspace-level.
- Projects select/order/default states through `project_state`.
- Workflows are workspace-level and reference workspace states.
- Transition guards and effects have a closed vocabulary.
- "Open" and "closed" are based on state groups, not hardcoded state names.
- SLA pause/resume is a workflow effect.
- Completed states write/close SLA pause records.
- Reopen resumes the SLA clock instead of resetting it.

That is a buildable model. The previous project-vs-workspace contradiction would have broken the lifecycle engine; the correction fixes it.

### 4. Security thinking is above average

The plan includes:

- Threat model.
- OIDC PKCE/state/nonce requirements.
- Portal isolation by origin and session scope.
- Strict cookie controls.
- Step-up authentication for elevated actions.
- Central egress/SSRF protection.
- WebSocket origin and reauthorization checks.
- MCP prompt-injection protections.
- Service-key creator bounds.
- Hash-chained/append-only audit direction.
- Secret rotation.
- Backup and restore discipline.
- Internal red-team before go-live.
- External penetration test before external sale.

That is far stronger than a typical "we will secure it later" design.

### 5. Engineering discipline is realistic

The repository contains:

- SDLC.
- Definition of Done.
- CI/CD strategy.
- Testing strategy.
- Migration convention.
- Repository bootstrap.
- Error-fix loop.
- Agent workflow and model-tier policy.
- UX quality gates.
- Screen inventory.
- Review reports.

This gives implementation agents enough structure to avoid inventing rules on the fly.

## Critical gaps before development

These are not optional polish. Address them in the planning-closure PR.

### 1. SCIM/Entra scope is approved but not modeled

Your latest decision moved Microsoft Entra OIDC and SCIM into core delivery. The current repository's identity model is strong on OIDC, sessions, MFA, and role handling, but it does not yet contain the authoritative SCIM provisioning model.

The repo needs explicit documents/tables for:

| Required model | Purpose |
|---|---|
| `identity_connection` | One external OIDC/Entra connection for agent or customer portal |
| `scim_connection` | One SCIM provisioning connection and its credential/scope |
| `external_identity` | Immutable provider identity linked to a local user/person |
| `scim_group_mapping` | Controlled Entra group → TaskDesk role mapping |
| Provisioning event/audit shape | Trace every create/update/disable/re-enable and denied action |

Required rule:

> SCIM requests must never carry trusted organisation, portal, role, or capability data. TaskDesk must resolve all of those from the SCIM connection/credential on the server.

Without that, the coding agent will invent a tenancy model during implementation. That is too late.

### 2. Universal delete approval needs a data model and route family

Your rule is now:

> Every user-initiated deletion requires server-enforced TaskDesk UI approval.

The current repository supports the MCP pending-action concept, but the universal deletion workflow needs a first-class shared model.

Add an authoritative model such as:

```text
pending_action
```

With at least:

- ID.
- Requesting user.
- Requesting credential/API key.
- Action type.
- Target type.
- Target IDs.
- Target version.
- Payload hash.
- Requested state.
- Approval state.
- Approved/denied by.
- Approval timestamp.
- Expiry.
- Execution result.
- Audit trace.
- Source: UI / API / MCP / automation.

Then define routes such as:

```text
GET  /api/me/pending-actions
GET  /api/me/pending-actions/{id}
POST /api/me/pending-actions/{id}/approve
POST /api/me/pending-actions/{id}/deny
```

Important: approval routes must accept browser session authentication only, not normal bearer API keys or MCP credentials.

### 3. The current repo does not yet reflect the final deferred-scope decisions

You have now decided:

- Public boards: **fully remove in P0**.
- Antivirus: **not built or installed now**.
- RLS: **defer until compliance-sensitive customer**.
- SCIM/Entra: **core delivery**.
- AWS Marketplace: **defer; prefer BYOL/contract later**.
- Notification integrations: **future only; Email first, Teams second**.
- Developer integrations: **future only; GitHub/GitLab/Gitea/Bitbucket/Azure DevOps**.

The repository's inherited-feature register already anticipates Kaneo cleanup and flags unsupported inherited integrations, but the new scope must be explicitly recorded so the coding agent does not "helpfully" keep Telegram/GitHub/Gitea automation enabled.

### 4. The repository contains a large number of medium/low findings

The repo's own review correctly leaves roughly 300 medium/low per-spec findings to close at each feature's SDLC stage 2. That is acceptable **only if enforced**.

The coding agent must not treat:

> "Documentation exists"

as:

> "Spec is complete."

Use this rule:

> A feature may not enter implementation until its spec's section in `docs/07-planning/reviews/2026-09-05/` is empty.

This is already the repo's intended model. Enforce it through PR review and definition-of-done checks.

### 5. Security must become an implementation evidence chain

Right now the plan is written. P0 must turn it into evidence.

For example:

| Planned control | Required evidence |
|---|---|
| Every route has a policy | Route coverage test green |
| No cross-tenant reads | IDOR/cross-tenant tests green |
| No forged proxy IP | Negative proxy-header test green |
| MCP cannot approve delete | MCP approval-bypass test green |
| Customer session cannot access agent route | Portal-boundary test green |
| WebSocket drops revoked access | Revocation test green |
| Service key cannot exceed creator | Service-key clamp test green |
| Entra SCIM is tenant-bound | SCIM organisation-isolation test green |
| OIDC is safe | PKCE/state/nonce/signature tests green |

Until these tests run, the controls are intentions, not security.

## Product recommendations

### 1. Do not widen integrations in the current scope

Your final choice is correct:

- Email first.
- Microsoft Teams second.
- Slack, Telegram, Viber later.
- GitHub, GitLab, Gitea, Bitbucket, Azure DevOps later.

Keep these as future plugin/integration work. Do not enable inherited Kaneo Telegram/GitHub/Gitea integrations by default.

Reason: every integration adds credentials, webhooks, outbound requests, tenant-visibility risk, tests, and operational support. They are not needed for P0/P1 core.

### 2. Keep public boards removed

Do not compromise here.

Anonymous public boards are a separate product surface, not a simple checkbox. They need publishing rules, redaction rules, public indexing policy, rate limiting, abuse controls, expiry/revocation, and attachment/comment protection.

Delete Kaneo's inherited implementation at P0. Recreate it later only as a dedicated TaskDesk feature.

### 3. Do not implement antivirus now

Your conclusion is correct.

Antivirus scanning can be an optional future plugin. For the current internal-controlled scope, document the accepted risk and continue with:

- MIME/extension allowlist.
- Magic-byte validation.
- Separate files origin.
- Safe download headers.
- Size limits.
- Generated object keys.
- Visibility checks.

Do not install ClamAV or a scanner now.

### 4. Keep RLS deferred

Keep application-layer scoped repositories and policy enforcement as the primary control.

RLS can later become defence-in-depth for high-value tenant tables such as work items, comments, and attachments. Do not add it now; it adds database-role, migration, debugging, and policy-maintenance complexity.

## Security recommendations

### 1. Keep SCIM tightly bound to organisation and portal

A SCIM token must identify:

- Which external identity connection is calling.
- Which organisation is allowed.
- Which portal is allowed.
- Which resource types are allowed.
- Which role mappings are allowed.

A request body must not be able to override those.

### 2. Make de-provisioning immediate and visible

When Entra sends `active=false`:

- Disable the TaskDesk account.
- Revoke sessions.
- Revoke personal API keys.
- Revoke personal MCP keys.
- Remove active workspace/project access according to policy.
- Preserve history.
- Audit the event.

Microsoft Entra SCIM uses `active: false` as a soft-disable/de-provisioning operation.

### 3. Keep customer identity admin-controlled initially

For the first release, only TaskDesk instance administrators should configure customer OIDC/SCIM connections.

Do not give external customers self-service IdP setup in the initial version.

### 4. Treat MCP as a user-controlled automation client

MCP is fine if it remains:

- Same RBAC as the owning user.
- Read-only by default.
- Stricter write/bulk rate limits.
- No broad `mcp:*` capability set.
- No MCP hard-purge tool.
- No model-supplied delete approval.
- UI approval for every user-initiated delete.

That is a safe direction.

## QA/QC recommendations

The current test strategy is strong. Add four explicit test families before development:

### SCIM/Entra tests

- Organisation isolation.
- Customer-to-staff escalation prevention.
- User create/update/disable/re-enable.
- Group-to-role mapping.
- Token rotation.
- OIDC PKCE/state/nonce/signature validation.
- Portal-session isolation.

### Universal delete tests

- Delete request creates pending action.
- Pending action does not mutate the target.
- MCP/API cannot self-approve.
- Approval is target-bound.
- Approval is payload-bound.
- Approval is single-use.
- Approval expires.
- Authorization is re-checked at execution.
- Sensitive delete requires step-up.

### Multi-tenant negative tests

- Customer A cannot infer Customer B's records.
- Private request is 404 to another colleague.
- Project owner team change cannot silently grant reach.
- Parent-project change cannot cross organisation.
- Search/filter/count cannot expose hidden records.

### UI/UX quality tests

- All P0 screens pass accessibility gates.
- Route inventory matches implementation.
- Base UI exception list is enforced.
- Design tokens have concrete values.
- Error/empty/loading states are part of each screen.

## Architecture recommendations

### 1. Put one identity document in charge

Currently identity concerns are split across auth, security model, RBAC, customer portal, God Mode, and now your SCIM decision.

That is acceptable only if one document owns the final identity model.

Recommendation: `docs/01-architecture/auth-and-identity.md` should become the authoritative identity and external-IdP owner, with agent portal identity, customer portal identity, OIDC, SCIM, external identity link, user lifecycle, session/key revocation, group mapping, identity UI ownership. Other documents must link to it, not duplicate competing rules.

### 2. Keep the data model authoritative

The current plan correctly says `data-model.md` is authoritative for every table and column. Extend that to SCIM and delete approval now. If a table does not exist there, implementation does not start.

### 3. Keep feature flags as runtime configuration

Do not reintroduce configuration variables for integrations, log levels, feature switches, branding, or provider credentials. Your five required env-var rule is good. Keep integration configuration inside God Mode and encrypted plugin/config storage.

## Delivery recommendation

**Step 0 — documentation closure, 1–2 days.** One PR updating `decision-log.md`, `status.md`, `phases.md`, `release-plan.md`, `auth-and-identity.md`, `security-model.md`, `data-model.md`, `rbac.md`, `customer-portal.md`, `god-mode.md`, `mcp-server.md`, `testing-strategy.md`, `inherited-features.md`, `accelerated-delivery-plan.md` — adding the flexible-timeline clarification, SCIM/Entra as core P3 identity, the SCIM data model, the universal delete-approval model, the deferred integration list, the full public-board removal rule, and the SCIM/OIDC/MCP/delete test cases.

**Step 1 — P0 foundation.** Kaneo SHA-pinned snapshot; inherited-features register; public-board deletion; package extraction; policy-registry foundation; router retrofit; UI extraction; Base UI convergence; CI/test scaffolding; deployment/installer foundation.

**Step 2 — P1/P2 internal product.** Only what internal work management and internal service-desk use need. No Telegram, Slack, Teams, Viber, GitHub, GitLab, Gitea, Bitbucket, Azure DevOps, Marketplace, antivirus, RLS.

**Step 3 — P3 identity/portal.** Customer portal; agent/customer session separation; Entra OIDC for both portals; organisation-bound SCIM; identity configuration UI; provisioning/de-provisioning lifecycle; full negative security tests.

**Step 4 — P4 governance.** God Mode maturity; editable roles; feature flags; MCP; delete-approval workflows; runtime configuration; audit/governance controls.

## Final decision

```text
Status: Conditional GO.

Condition: Do not start P0 implementation until one documentation-closure PR records the
latest approved decisions and adds the missing authoritative models for: Microsoft Entra
OIDC; Microsoft Entra SCIM; organisation/portal-bound identity connections; external
identity links; SCIM group-to-role mapping; universal delete pending actions; deferred
integration scope; required SCIM/MCP/delete acceptance tests.

After that PR: start P0. Do not start broad feature development before: Kaneo SHA is
recorded; public boards are deleted; inherited features are registered; every inherited
route is assigned a policy; route-policy coverage runs against the inherited surface; the
P0 security review signs off.
```

Overall: **8.5/10 planning quality; conditional go after documentation closure.**

---

## TaskDesk response

*Written the same day by the Claude Code session that applied the decision document.*

**Agreement.** Every critical gap is real and every one is closed in the same closure PR as
this file:

| Gap named | Where it is now closed |
| --- | --- |
| SCIM/Entra approved but not modelled | `identity_connection`, `scim_connection`, `external_identity`, `scim_group_mapping`, `scim_group_member`, `provisioning_event` in [data-model.md](../../../01-architecture/data-model.md) §2; the feature spec [identity-provisioning.md](../../../03-features/identity-provisioning.md) (`IP-1`…`IP-25`, 17 named acceptance tests); [auth-and-identity.md](../../../01-architecture/auth-and-identity.md) as the identity owner |
| "SCIM requests must never carry trusted organisation/portal/role/capability data" | `IP-4` — refused `400 forbidden_attribute`, not ignored; [security-model.md § SCIM](../../../01-architecture/security-model.md#scim--an-inbound-privileged-management-api) |
| Universal delete approval without a model or routes | [pending-actions.md](../../../01-architecture/pending-actions.md) (`PA-1`…`PA-14`), `pending_action` in data-model §11, the `/api/me/pending-actions/*` route family, session-only approval, `202` in [api-design.md](../../../01-architecture/api-design.md#errors) |
| Deferred-scope decisions not recorded | [decision-log.md](../../decision-log.md) entry "Confirmed decisions A–N and core identity", [roadmap.md](../../roadmap.md) deferred list with priorities, [inherited-features.md](../../../01-architecture/inherited-features.md) integration rows set to *remove at fork* |
| ~300 medium/low findings must be enforced, not assumed | Rule added to [definition-of-done.md](../../../04-engineering/definition-of-done.md) and [sdlc.md](../../../04-engineering/sdlc.md) stage 2: a feature may not enter implementation until its section in `reviews/2026-09-05/` is empty |
| Security must become an evidence chain | The control → test table in [security-model.md § Testing security](../../../01-architecture/security-model.md#testing-security) is now the P0/P3 exit evidence list |
| One identity document in charge | `auth-and-identity.md` owns the identity model; `identity-provisioning.md` owns the numbered behavioural rules and tests, as every other architecture/feature pair in this corpus does; the others link |

**Two places we went further than the review asked:**

- Service API keys **cannot be MCP keys** — `CHECK (NOT is_mcp OR person_id IS NOT NULL)`
  in the schema, not only a rule — because "a personal MCP key must be owned by a named
  human user" is only true if the database refuses the alternative.
- SCIM token rotation has **no grace window** (the review's own acceptance test 14 says
  the old token must be invalid), so the God Mode flow tells the administrator to update
  Entra before re-enabling rather than pretending both tokens can coexist.

**One place we disagree, mildly:** the review scores "UI/UX planning" lowest and says
"values/components still need P0 work". True, but that is the plan — `packages/ui` is
extracted from kaneo *at* P0 step 1 ([ui-extraction-plan.md](../../../02-design/ui-extraction-plan.md)),
and the token values are already concrete in [design-system.md](../../../02-design/design-system.md)
after the first audit. The Base UI decision is now recorded as made, with the Radix
exception register (`KNOWN-RADIX.md`) enforced by `check:ui`.

**The condition is met by this PR.** P0 step 1 may start once it merges.
