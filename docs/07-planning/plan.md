# Plan: finish P0–P4 on Kaneo, then deliver SIT

**Approved:** Thomas, direct chat 2026-10-21; [decision](decision-log.md).
The lean [workflow](../04-engineering/workflow.md) applies. Status belongs in
[status.md](status.md), not an archived queue.

## Goal

Complete every P0–P4 requirement on current main using the original Kaneo interface,
implement missing backend and UI behavior, pass tests and independent reviews, reduce CI
turnaround, deploy a source-identified artifact to local SIT with working accounts, and
prepare Thomas's integrated walkthrough. Continue routine work automatically. Record
external blockers truthfully. Close stages only after Thomas signs off.

## Order and completion checklist

1. **Baseline and CI:** reconcile current main, specs, screens and findings; repair the
   existing approvals/task-page stack. Measure the 35-minute critical path and implement
   isolated integration sharding without dropping tests or bypassing required checks.
2. **P0/P1:** finish canonical full-page and side-pane work items, labels, parent/subtasks,
   relations, inline editing, uploads, activity, board/list/table, filters, bulk, backlog,
   saved views, search, inbox and settings. Redirect duplicate legacy work entry points.
   Track host configuration; run fatal, repeatable seeds inside the container, including
   realistic submissions. Preserve pending actions, concurrency and tenant isolation.
3. **P2 and prerequisites:** teams/CAB and custom fields first where needed. Add eligible
   approval-candidate lookup and complete request/decide/withdraw/expiry/workflow gating.
   Finish workflows, assignment, triage, versioned forms, SLA bindings, policies, calendars,
   escalation, canned responses, audit, milestones, prerequisites and stakeholders.
4. **P3:** one host-root portal shell with home, catalogue/forms, requests, details,
   approvals, projects and account; public replies/uploads, visibility, escalation,
   ranking, satisfaction and reopen. Specify and implement the accepted admission proposal,
   typed-domain discovery and provider write/test contracts before enabling them. Complete
   organisation identity administration, MFA/session/SCIM UI and all 25 real-Entra tests.
5. **P4:** finish roles, teams, fields, inheritance and feature locks; signed webhooks with
   SSRF protection, retries/history; complete notification producers, recipient reach,
   adapters, destinations, preferences, digests, quiet hours and scheduler. Resolve the
   approved evaluator-failure policy in authoritative docs before wiring. Finish automation
   dry-run/actions/loop protection, God Mode configuration/operations/impersonation,
   API keys and P4 MCP parity/idempotency/pending actions. Complete #580 repository ownership
   and enable the structural query gate after conversion.
6. **Integrated review and repair:** compare every numbered P0–P4 requirement and screen
   with actual behavior, tests and independently dispositioned historical findings. Review
   security, integration seams and Kaneo consistency. Fix defects and rerun affected checks.
7. **SIT:** build/boot the reviewed artifact, record source SHA and image digest, deploy
   agent `https://ticketing.localhost:8443` and portal `https://portal.localhost:8443`.
   Verify clean install/upgrade, realistic data, all journeys, nonempty attachment backup
   and usable isolated restore. Provide seeded admin/lead/agent/customer credentials
   privately and a concise walkthrough. Thomas reviews last; record actual stage outcomes.

## Hosted SIT addition — 2026-10-21

Thomas requested assessment of SSH alias `proxy` and `technexus.info` to reduce laptop
power use. Live read-only inspection confirmed x86-64 Ubuntu, 2 vCPUs, 7.7 GiB RAM
(4.5 GiB available), 166 GiB free disk, Docker 29.8.1 and Compose 5.5.1. Low sampled load
supports light functional SIT; this shared 2-vCPU host is not reference load/performance
acceptance evidence. No remote services were changed.

Recommended agent/portal origins: `https://sit.technexus.info` and
`https://portal-sit.technexus.info`. Both need DNS records; the checked authoritative
Cloudflare zone had no address records at those names. Reuse existing Traefik on ports
80/443, its `web` network and `le` ACME resolver. The stock overlay assumes network
`proxy`, resolver `letsencrypt` and file-provider middleware absent on this host, so it
cannot be deployed unchanged. Prepare and review a dedicated SIT overlay, isolated
Compose project/database/volumes and bounded runtime memory. Keep PostgreSQL/Valkey and
application ports unpublished. Build immutable images on hosted CI, then pull on the VM;
do not run builds or CI workers alongside its existing services.

Before hosted handoff: establish DNS/certificate access, validate the new overlay, deploy
the reviewed SHA/digest with seeded accounts, verify both origins/security/journeys and
backup/restore, then move persistent SIT use off OrbStack. Retain local data until the
VM's recovery path works. The VM reports pending kernel maintenance/reboot; coordinate
that separately because unrelated applications share the host. Existing Watchtower is
label/scope restricted; do not opt TaskDesk into unattended image replacement.

## Rules and evidence

- Preserve Kaneo components, layout and tokens; extend before creating. Every reachable
  feature uses real persisted APIs. Hidden unfinished work does not count as completed.
- Each numbered spec rule and P0–P4 screen maps to implementation, meaningful tests and
  remaining gaps. Keep the checklist current while implementing the relevant feature.
- Every endpoint declares a policy; every screen has URL state. Authoritative docs own
  identifiers, configuration, events and jobs; Hono/OpenAPI types remain the API contract.
- Run unit/integration/permissions/contracts and required CI; open every changed screen,
  capture Kaneo comparisons, test keyboard/a11y/mobile/dark/reduced motion/visual/performance.
- Explicitly verify cross-tenant and private-request isolation, internal-content exclusion,
  API-key ceilings, deprovisioning, concurrent edits and approvals, jobs/retries and recovery.
- One independent PR review, with security coverage where required. Full integrated review
  follows feature completion. No skipped tests, manual green statuses or gate bypasses.
- No P5–P7 features, production changes or bulk branch/worktree deletion. No stage sign-off
  inferred from routine automatic approval. Real Entra verification waits for credentials
  when unavailable; continue all independent work.
