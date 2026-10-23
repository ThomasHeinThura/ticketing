# Alignment with the original product

The original goal remains: **one place for every request, ticket, project and commitment, with an interface people enjoy using**. The three faces are the agent workspace, customer portal and God Mode, running from one self-hostable image with runtime customer configuration.

## What stays aligned

| Original intent | Current documentation and delivery |
| --- | --- |
| Replace Planner, Power Apps ticketing, Jira, Plane and Azure DevOps | [Whole-product catalogue](features.md) includes work, service desk, customer self-service, governance, insight and migration |
| Start from Kaneo rather than invent a frontend | Original shell, sidebar, settings, board/list/cards/task editor, type and spacing remain the design; extensions use those components |
| One real system, no fake portal | Agent and portal use persisted APIs with explicit tenancy, permissions, visibility and separate sessions/bundles |
| One image, customer-controlled behavior | Branding, identity, storage, notifications, flags, workflows and policies are configured through God Mode/settings |
| Honest reporting and history | Three reporting tiers, all 20 fixed reports, reach-aware exports and traceable idempotent imports are retained |
| Complete visible outcomes | Laptop implementation/test/repair loop, integrated browser journeys, one independent phase review and one consolidated owner report |
| Full product ambition | P0–P7 are now all planned. Original later candidates are catalogued in proposed P8/P9 groups rather than dropped |

## Sources searched

The original vision, product/design principles, P0–P7 phase definitions, all 31 feature specifications, import/operations plans, inherited-feature inventory and applicable owner decisions were searched for scope. Their ignored, read-only archive is historical provenance, not a fresh-checkout dependency. Maintained [requirements](requirements.md), [contracts](contracts.md) and the technical references carry active meaning; their migration is tracked in [status](status.md). This comparison is repository evidence, not external market research or upstream runtime acceptance.

The original phase definitions stop at P7. There are no defined original P8/P9 product phases. The new groupings organise the original later candidates; they do not invent accepted behavior or revive excluded products.

## Corrections and unresolved details

- **Earlier docs were too narrow.** P5–P7 are part of the full roadmap, not outside this plan. Whole-product planning does not mean simultaneously implementing every phase.
- **Phase ownership:** projects begin in P1, with service engagement coordination in P2; settings span P1/P4; services/changes/releases belong in P5, while workflow/CAB foundations belong in P2. Calendar/Gantt continuity is required during P1 unification; advanced planning follows in P5.
- **Pages:** original P5 feature has no completed behavior spec. Its purpose/placement is recorded; editing, sharing, history and permission details must be settled before build.
- **Reports:** preserve fixed reports, saved configurable table reports, and the small custom aggregation/chart builder. Do not reduce reporting to a dashboard mockup or add a new query language.
- **Rates/timers:** the owner’s recorded 20 October D4 decision preserves applied rates on time-entry creation/stop, splits timers server-side at the applicable midnight, and uses profile → workspace → UTC timezone fallback. Older conflicting prose does not reopen those settled questions. The retained D4 decision for issues 811/773 is recorded below.
- **Later candidates:** KB prose calls multilingual/AI articles a “Stage 6 candidate”, but the full roadmap puts them beyond P7. Use the explicit later-candidate grouping here; P6 remains import/cutover.
- **Identifiers and permissions:** archived prose can disagree internally. Use retained requirements and the latest applicable owner decision for intended behavior, and runtime/schema as evidence of current implementation; preserve permission strength and record any unresolved behavior explicitly. A mismatch may be an implementation defect; do not rewrite intended behavior to match existing code. The feature catalogue does not create new database names, capability strings or API contracts.
- **Historical exclusions remain visible:** full native CMDB, payroll/invoicing, automated managed-service deployment and public boards are not silently included as accepted features. Their related candidates/decisions are listed in [features](features.md).

## Design alignment for features Kaneo did not have

A new capability may require a new route, but it still uses Kaneo’s layout and composition: a list uses its header/filter/table; detail uses its content/property/section pattern; configuration uses its settings shell; rich text uses its editor; scheduling extends its Calendar/Gantt. Reports, knowledge, timesheets, imports and God Mode must feel like the same product. Existing UI libraries may support necessary controls within that system.

Every candidate's finish evidence must show real data and a user action retained after reload. Browser comparison against pinned upstream `42bb8011` checks shared composition; intentional feature additions are documented rather than hidden by arbitrary screenshot tolerances.

## Old and new agent guidance

A read-only comparison covered the archived root instructions/provider note/workflow and the active instructions, testing and alignment docs. The following dispositions preserve safeguards while keeping delivery focused on visible results.

| Area | Old versus new disposition |
| --- | --- |
| Kaneo design, real APIs, runtime configuration | Preserved; token use, route policy and registered URL/bootstrap state are explicit again |
| Security, deletion and licensing | Preserved with concrete identity/MCP/tenant restrictions, pending actions, source provenance and removed-router protection |
| Completion evidence | Preserved: source presence, local tests, actual browser journeys, independent review and Thomas acceptance remain distinct |
| Reviews and publishing | One fresh independent phase review with a neutral evidence packet; no review round per small edit. Protected publishing remains intact |
| Agent collaboration | Clarified: one coordinated worktree/team, bounded assignments, disjoint files, agreed shared contracts and a coordinator responsible for integration |
| Failure and ownership | Preserve dirty files, stop on unexpected edits to an owned file, diagnose repeated failures and preserve budgets; never falsify results |
| Original delivery scope | Expanded from the first reset's P0–P4 to the original full P0–P7; proposed P8/P9 retain future candidates without inventing acceptance |

## Remaining concerns and concrete next actions

| Concern | Current evidence / impact | Action |
| --- | --- | --- |
| Review enforcement | PR/phase/release callers validate one consolidated source-bound report only on explicit phase submission; ordinary integration requires no per-change reviewer | Preserve required remote contexts; test explicit phase/release submission against the source and maintained requirements |
| Archive independence | All 72 indexed contracts and 647 rules have maintained destinations; archive-absent reader tests and combined link checks pass, with historical prose semantically curated | Preserve every numbered rule plus unnumbered API, permission and edge clauses; do not change the ignored snapshot or weaken checks |
| Stale repository ownership paths | `.github/CODEOWNERS` still refers to removed workflow paths and older role terminology | Reconcile owners/path rules with current entrypoints during publishing-tool cleanup; do not assume remote protection changed |
| Implementation versus intent | Code/schema can disagree with owner decisions or retained feature rules | Record the mismatch and repair the defect or identify the exact unresolved behavior; source presence is not product authority |
| Source/version split and concurrent edits | Existing checkout, supplied PR screenshots and uncommitted work are different evidence sets | Coordinator records selected revision and writable owners before implementation; no overwriting or transferred acceptance claims |
| Shared-contract collisions | Disjoint UI files can still depend on incompatible API/schema/seed assumptions | Agree DTO/permission/migration contracts first; shared files have one explicit owner; serialize dependent work |
| Verification gaps | P5–P7 code discovery, all persisted browser journeys, real Entra, current SIT provenance/recovery and existing lint/visual-scope failures remain unresolved | Keep these in the phase report with actual evidence. The documentation comparison closes none of them |

The agent team is prepared by [agent-work.md](agent-work.md). Example work packages there are unassigned preparation, not active jobs. This comparison is a documentation/authority check, not a product security clearance or a completed phase review.

## 22 October: work-item interaction correction

Thomas's supplied examples reject the current TaskDesk task experience. Matching the shell or a static card is insufficient: use the actual Kaneo sheet and task-page presentation with canonical persisted APIs, including original opening/closing/expansion behavior and Activity composition. Roadmap tasks UI-01–UI-09 make this additional requirement explicit. The existing Sheet/Dialog motion primitives already match the pinned original; the canonical interaction path bypasses them. Fix the mounting/composition path before changing global animation tokens.

## Preserved owner decisions

These are behavior decisions, not current implementation or acceptance evidence. Earlier execution procedures and model assignments are inactive. Provenance: original decision log entries of 11, 16 and 19 October 2026; current integration instructions of 22 October take precedence.

| Decision | Required behavior |
| --- | --- |
| D1 · export | Stream CSV; maximum 10,000 rows, 30-second query timeout, five exports/minute/person. Above the cap return `422 export_limit_exceeded` with total so filters can be narrowed. |
| D2 · initial priority | `work_item:create` permits initial priority. Later priority edits require `work_item:set_priority`. |
| D3 · deleted projects | All one-hop children enforce live project/reach and return404 to regular callers while preserving the 30-day recovery period. |
| D4 · time valuation | Snapshot applied rates when a time entry is created/stopped; historical costs do not change with rate cards. Server-side midnight splitting uses profile timezone, then workspace timezone, then UTC. |
| D5 · request types/home | Archive a request type with submissions; preserve history. Portal home offers search/catalogue categories and the person’s recent open requests. |
| D6 · privacy | Requester and authorized staff may choose private/organisation visibility; staff cannot widen a private request without requester consent. |
| WF-9 | Validation/publishing requires reach to every project in the workspace, including empty/archived projects; refuse generically if any is unreachable. |
| WF-19 | Validate assignee ID shape at authoring, roster eligibility at execution; unknown IDs may be saved. Reject an ineligible transition atomically. `set_field` remains held/rejected at authoring and execution without partial effects. |
| Saved views | Retain native workspace-role admission for another person’s view. A projected manager grant does not widen native-member route admission. Denial creates no pending action or requested-event/audit receipt. |
| 22 October | Keep archive ignored; migrate active readers and retained contracts together before publishing. Local testing, original Kaneo UX and one consolidated independent phase review remain required. |

## Competitive inspiration

The retained comparison is an ideas inventory, not current vendor claims or permission to copy code. Application source comes only from original Kaneo or TaskDesk v1 under the current product rules. Other products inform domain behavior; they do not supply a replacement interface.

| Source | Retained behavior and boundary |
| --- | --- |
| Kaneo | Entire shell, typography, primitives, motion, editing and board/list/Calendar/Gantt/backlog interactions; editable roles, typed API and shared tooling. Remove billing/trials and dormant public/anonymous/integration routes. Runtime abuse controls remain explicit rather than permanently enabled cloud switches. |
| Plane | Three settings tiers plus user preferences, distinct instance administration, per-project flags, cycles/modules/estimates and intake. Collaboration stays a later candidate. Keep the current TypeScript/query stack and one backend; no separate admin application. |
| OpenProject | Type/role/state workflows, grouped custom fields, project-role inheritance, effective-dated time/cost, hierarchy separate from rich relations, immutable journals and granular notifications. Exclude BIM, forums/news and its dense presentation. |
| Service management | Request forms/catalogue, shared queues, calendar-aware SLA triggers/pauses, approvals, public/internal comments, CSAT and knowledge deflection. Preserve customer priority/reordering/assignment/self-approval constraints from the detailed contracts. No per-seat machinery or general-purpose automation platform. |
| TaskDesk v1 | Reach separate from authority, directory-owned identity, scoped404 reads, derived SLA/calendar behavior, versioned transitions/notes, engagement composition, prerequisites/milestones/escalation, dated projects versus managed services, safe webhooks and registered URLs. Do not reuse its frontend or multiple-backend architecture. Older email-based identity shorthand does not override connection/subject admission and current directory rules. |
| Other comparisons | Retain business-hour escalation, canned responses, hierarchical scope, runtime plugin health/forms, renameable lifecycle states, custom fields and shared selectable-column reports. Omnichannel intake and commercial distribution remain conditional candidates. Exclude round-robin assignment, native CMDB/asset inventory, arbitrary no-code app design, fixed statuses and conversation-first navigation. Uniform licensing and current source restrictions govern over old comparison examples. |

The full catalogue and feature contracts carry these behaviors; the comparison supplies no implementation or acceptance evidence. Historical vendor/version/licence descriptions need current verification before an external commercial decision. The retired completion-procedure file imposes no additional rules; current AGENTS and laptop testing govern the work.
