# Plan: P0–P4 to a usable product

The one living plan. Rewrite it as things land; don't append history. Status lives in
[status.md](status.md). The process is [workflow.md](../04-engineering/workflow.md), and the
design rule is [Integrate, don't add](../02-design/design-principles.md#integrate-dont-add-2026-10-20).

**Updated:** 2026-10-20

## Goal

> In SIT, TaskDesk looks and feels like kaneo everywhere. There is one agent app at `/agent`,
> with kaneo's sidebar and layout on every page, and one portal. Every reachable screen reads
> and writes the real API; none uses mock data. A customer signs in on the portal and submits a
> request. An agent triages it, works it with SLA and approvals visible, replies and resolves
> it. Settings and God Mode configure the instance without touching files. The docs are short
> and true, and Thomas has walked through each stage.

## Where things stand (audit 2026-10-20)

- **Backend:** every P1–P3 feature has a mounted, tested API. In P4, roles, notifications,
  API keys, identity and God Mode users/observability have APIs. Teams, custom fields,
  automations, webhooks and the God Mode configuration pages have **no API**.
- **Two data models.** Kaneo's `/dashboard` pages run on the old `task` API, and `/agent`
  runs on v2 `work_item`. v2 is canonical (decision log 2026-09-23). Kaneo's richer task UI
  (relations, subtasks, labels, inline editing) is the design to bring onto `work_item`.
- **Mock UI** is down to `components/agent/p1-core-and-settings.tsx`, behind 15 `/agent/*`
  routes. Nine of those duplicate real kaneo `/dashboard/*` pages.
- **Real but unlinked:** triage, request types, SLA policies, calendars, pending actions, God
  Mode authentication and SCIM.
- **SIT config:** the redirect, fatal seeding and request-type seed are fixed by batch 3.
  Still open:
  - SIT depends on an untracked Traefik file for `ticketing.localhost`.
  - Seeds run on the host, not in the container.
  - There are no seeded submissions.

## Batches (one PR each, in order)

| # | Batch | Done when |
| --- | --- | --- |
| 1 | **Lean reset + revert #863** (#864) | `main` green, docs true |
| 2 | **Kaneo shell on `/agent`, entry points, portal sign-in** (#865) | Every `/agent` page has the sidebar; `/portal/sign-in` works |
| 3 | **SIT config and seed** (#866) | `scripts/deploy.sh local` gives working agent *and* portal logins and published request types on `:8443`, the redirect keeps the port, and seeding fails loudly. Follow-ups: seeds in the container, seeded submissions, `TASKDESK_AGENT_HOST` instead of the untracked Traefik file. |
| 4 | **Settings: one kaneo settings shell** | Every `/agent/settings/*` item mounts the real kaneo component inside kaneo's settings layout (account info, preferences, security, notifications, API keys, workspace general, labels, members, roles, project general). The sidebar links triage, request types, SLA, calendars and pending actions. The mock screens and `/dashboard/settings/*` redirect to `/agent/settings/*`. The p1 mock module is deleted. |
| 5 | **Work item completeness** on `work_item` | The detail page and side pane get an SLA panel (`/work-items/{key}/sla`), approvals (request, decide, withdraw), attachments, a relations/parent editor and inline field editing, all with kaneo's task components. My work gets an approvals lens (`/me/approvals`). Inbox uses the notification API. The legacy `/dashboard/.../task` and board routes redirect to `/agent`. |
| 6 | **Portal** | A kaneo-style portal shell (top bar, logo, nav, theme, sign-out) with home, new request (catalogue), my requests (`GET /portal/submissions`), request detail, approvals (`/portal/approvals`), and account. |
| 7 | **Real gaps that already have an API** | Canned responses, the audit log (instance and workspace), God Mode organisations and their identity, workflows list and editor, and project plan (milestones/prerequisites) and stakeholders. Each goes into its kaneo settings or project-settings surface. |
| 8 | **P4 features with no API** | One PR each, backend and UI together, in this order: webhooks, custom fields, teams, automations, God Mode configuration (general, branding, storage, notification channels, deliveries, features, jobs), MCP usage. Until a feature lands it stays hidden and ⬜. |
| 9 | **Docs and CI cleanup** | `docs/README.md` index, the remaining process remnants (`runbook.md`, `ux-quality-gates.md`, CODEOWNERS), `ci-cd.md` (`test:mcp` planned), and unused scripts wired in or removed. |
| 10 | **Stage walkthroughs** | Thomas walks through P0–P4 on SIT. Each stage gets ✅ only on his sign-off. |

## Needs Thomas (not done autonomously)

- **Repo hygiene.** Deleting 320 merged remote branches and 175 merged worktrees can't be
  undone. Thomas confirms first.
- **Real Entra tenant.** The P3 exit criterion needs his tenant credentials.
- **Stage sign-off walkthroughs** (batch 10).
- **Open owner questions** #811 and #773, and query ownership #580 (2.3k checker problems).

## Rules for every batch

- Reuse kaneo components; never add a parallel screen.
- No mock data; a screen without an API isn't in navigation.
- CI green on GitHub, never `[skip ci]`; one independent review per PR.
