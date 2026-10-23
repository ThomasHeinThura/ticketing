# Whole-product requirements

The full scope is described in [features.md](features.md); delivery order and visible outcomes are in [roadmap.md](roadmap.md). [Alignment](alignment.md) explains the original sources, settled decisions and genuine gaps. P0–P7 are all included. P8/P9 organise original later candidates and remain unscheduled proposed groups.

## Exact source traceability

[requirements-index.json](requirements-index.json) indexes every source contract listed below, plus extracted numbered rule definitions with original IDs, full multiline text, source lines and evidence slots. Unnumbered API/permission/edge-case and operational requirements remain in those contracts and the feature catalogue; a numbered-rule count is not a claim to capture every paragraph. Every requirement starts **unverified** unless actual evidence is attached.

New instructions replace historical delivery procedure. Existing product/security behavior is retained, subject to the latest applicable owner decision. Do not copy stale identifiers or reopen settled decisions merely because old prose differs.

| Primary phase | Detailed feature contract | Numbered rules |
| --- | --- | --- |
| P1 | [work-items](technical/feature-contracts-p1.md#work-items) | 31 |
| P1 | [views](technical/feature-contracts-p1.md#views) | 34 |
| P1 | [projects-and-engagements](technical/feature-contracts-p1.md#projects-and-engagements) | 19 |
| P1 | [assignment](technical/feature-contracts-p1.md#assignment) | 19 |
| P1 | [comments-and-activity](technical/feature-contracts-p1.md#comments-and-activity) | 22 |
| P1 | [attachments](technical/feature-contracts-p1.md#attachments) | 14 |
| P1 | [relations-and-hierarchy](technical/feature-contracts-p1.md#relations-and-hierarchy) | 19 |
| P1 | [search-and-saved-views](technical/feature-contracts-p1.md#search-and-saved-views) | 23 |
| P2 | [workflows](technical/feature-contracts-p2.md#workflows) | 22 |
| P2 | [sla](technical/feature-contracts-p2.md#sla) | 22 |
| P2 | [service-calendars](technical/feature-contracts-p2.md#service-calendars) | 17 |
| P2 | [request-types-and-catalogue](technical/feature-contracts-p2.md#request-types-and-catalogue) | 17 |
| P2 | [intake-queue](technical/feature-contracts-p2.md#intake-queue) | 23 |
| P2 | [approvals](technical/feature-contracts-p2.md#approvals) | 21 |
| P2 | [audit-trail](technical/feature-contracts-p2.md#audit-trail) | 15 |
| P3 | [customer-portal](technical/feature-contracts-p3.md#customer-portal) | 19 |
| P3 | [identity-provisioning](technical/feature-contracts-p3.md#identity-provisioning) | 34 |
| P4 | [roles-and-permissions-ui](technical/feature-contracts-p4.md#roles-and-permissions-ui) | 15 |
| P4 | [teams](technical/feature-contracts-p4.md#teams) | 9 |
| P4 | [custom-fields](technical/feature-contracts-p4.md#custom-fields) | 11 |
| P4 | [god-mode](technical/feature-contracts-p4.md#god-mode) | 15 |
| P4 | [settings-hierarchy](technical/feature-contracts-p4.md#settings-hierarchy) | 17 |
| P4 | [notifications](technical/feature-contracts-p4.md#notifications) | 22 |
| P4 | [automations](technical/feature-contracts-p4.md#automations) | 13 |
| P4 | [webhooks-and-api-keys](technical/feature-contracts-p4.md#webhooks-and-api-keys) | 27 |
| P4 | [mcp-server](technical/feature-contracts-p4.md#mcp-server) | 23 |
| P5 | [agile](technical/feature-contracts-p5.md#agile) | 18 |
| P5 | [time-and-cost](technical/feature-contracts-p5.md#time-and-cost) | 22 |
| P5 | [reports-and-dashboards](technical/feature-contracts-p5.md#reports-and-dashboards) | 18 |
| P5 | [knowledge-base](technical/feature-contracts-p5.md#knowledge-base) | 17 |
| P5 | [service-management](technical/feature-contracts-p5.md#service-management) | 16 |

## Foundation, operation and migration contracts

| Area | Preserved sources / phase ownership |
| --- | --- |
| Architecture and safety | [Architecture](technical/architecture-and-experience.md#overview), data model, RBAC, identity, tenancy, pending actions, events/jobs, realtime, storage, observability, localisation and plugin contracts — P0 foundations used throughout |
| Data protection | [Export, anonymisation, retention, erasure, legal holds and subprocessors](technical/operations-and-distribution.md#data-protection) — P4 administration and P7 operating proof |
| Installation and operation | [Deployment](technical/operations-and-distribution.md#deployment), container/source/signing, configuration, domains/environments, storage, Compose/Helm, backup/recovery, upgrade/runbook/scaling and installer — P0/P7 |
| Import | [Strategy](technical/import-and-cutover.md#import-strategy), [Azure DevOps](technical/import-and-cutover.md#azure-devops), [Plane](technical/import-and-cutover.md#plane), [field mapping](technical/import-and-cutover.md#field-mapping); Jira/JSM, Planner, Power Apps and CSV paths — P6 |
| User/admin/API documentation | [Documentation-site plan](technical/architecture-and-experience.md#plan) and content guidance — P7, describing verified shipped behavior |
| Later extensions | [Original later candidates](features.md#p8--integrations-and-enterprise-extensions-proposed-grouping) and [marketplace](technical/operations-and-distribution.md#aws-marketplace) — proposed P8/P9 groups, with conditional/excluded decisions visible |

The machine index lists individual source paths for all these areas. The ignored archive is historical provenance, not an active reader dependency. Remaining operational and architecture references are being migrated before publication. No stage is accepted because its documentation exists.

## Decisions to retain

Projects and basic settings begin in P1; service engagement coordination follows in P2 and full administration in P4. Service catalogue/change/release management belongs to P5; P2 supplies workflow/CAB foundations. Existing Calendar/Gantt views must work with P1 data. Pages still needs a behavior definition. Rate/timer behavior follows the recorded 20 October owner decision. See [alignment](alignment.md) for source details.

Full native CMDB, public boards, invoicing/payroll and automated managed-service deployment are not silently added. Every original later candidate is recorded in the feature catalogue, including those that need an explicit changed product decision.
