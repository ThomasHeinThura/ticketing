# Inherited-features register

Every kaneo feature and notable dependency that arrives with the fork, with a verdict. **A
P0 step 1 deliverable** ([phases.md](../07-planning/phases.md), [repository-bootstrap.md](../04-engineering/repository-bootstrap.md)):
this page is filled in against the actual snapshot, and the kaneo commit SHA is recorded
here and in `THIRD-PARTY-NOTICES.md`. Until a "keep — write a spec" row has its spec, the
feature ships **feature-flagged off**.

**kaneo commit taken:** *(fill at fork)*
**Primitive libraries found in `components/ui`:** *(Radix n / Base UI m — fill at
extraction; see [ui-extraction-plan.md](../02-design/ui-extraction-plan.md))*

| kaneo feature / dependency | Where | Verdict | v2 spec / flag |
| --- | --- | --- | --- |
| `github-integration`, `gitea-integration` (`octokit`, `@octokit/webhooks`) | `apps/api/src` | **Keep — write a spec** | Developer-tool linking via `external_link`; flag `feature.dev_links` (off) |
| `slack-integration`, `discord-integration`, `generic-webhook-integration` | `apps/api/src` | Keep | Fold into `notify.*` plugins — [plugin-architecture.md](plugin-architecture.md) |
| `telegram-integration` | `apps/api/src` | **Decide** | Keep as `notify.telegram` or remove; default off |
| `workflow-rule` | `apps/api/src` | Keep | [automations.md](../03-features/automations.md); `feature.automations` off until aligned |
| `time-entry` | `apps/api/src` | Keep | [time-and-cost.md](../03-features/time-and-cost.md); `feature.time_tracking` |
| `public-project` (anonymous public boards) | api + web | **Remove at fork** (decided 2026-09-05 — a flag is a runtime toggle, not a deletion; an unauthenticated read surface does not ship dormant) | Router and screens deleted in P0 step 1. The flag name `feature.public_boards` stays **reserved** for a future spec'd re-implementation with its own security review |
| `gantt`, `calendar` views | `apps/web` | Keep | [views.md](../03-features/views.md); `feature.timeline`, `feature.calendar` until P5 UX gates pass |
| `backlog-list-view`, `kanban-board`, `list-view`, `bulk-selection`, `command-palette`, `keyboard-shortcuts-help`, `search`, `onboarding`, `profile-setup`, `team` | `apps/web` | Keep | Covered by P1 specs |
| `scheduler` (`croner`), `mcp`, `oauth`, `invitation`, `notification-preferences`, `external-link`, `task-relation`, `column`, `activity`, `storage`, `plugins`, `instance` | `apps/api/src` | Keep | The mechanisms v2 assumes; `job_lease` is ours to write |
| `billing`, `trial-card`, `demo-alert`, `creem`, Turnstile / disposable-email checks | api + web | **Remove** (abuse checks → optional plugins) | [competitive-inspiration.md](../00-overview/competitive-inspiration.md) |
| `packages/planka-import` | packages | **Remove** | Park as `import.planka` only if trivially cheap |
| `valibot` alongside Zod; `nanostores` alongside Zustand | deps | **Remove — consolidate** | [tech-stack.md](tech-stack.md) |
| `react-markdown`, `turndown`, `mermaid`, `shiki` (Markdown import/export, diagrams, code highlighting) | `apps/web` | Keep | Add to [comments-and-activity.md](../03-features/comments-and-activity.md)'s rich-text rules |
| `@base-ui/react` + `@radix-ui/*` | `apps/web` | **Converge on one** | [ui-extraction-plan.md](../02-design/ui-extraction-plan.md) |
| `i18n/` — 18 locales | root | Keep | [i18n.md](i18n.md) |
| `skills/` — `improve-animations`, `find-animation-opportunities` | root | Keep | [agent-workflow.md](../04-engineering/agent-workflow.md); the other five skills there are ours to write |

## Related

- [Review 2026-09-05](../07-planning/review-2026-09-05.md) · [ADR 0001](adr/0001-kaneo-as-foundation.md) · [Licensing](../00-overview/licensing-and-attribution.md)
