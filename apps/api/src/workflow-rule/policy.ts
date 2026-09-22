import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Workflow-rule route policies (issue #8).
 *
 * A workflow rule moves a task to a column when an integration event fires — kaneo's
 * automations primitive. `docs/01-architecture/inherited-features.md` classifies the router
 * `Keep`, pointing at `docs/03-features/automations.md` ("`feature.automations` off until
 * aligned"): this is inherited machinery kept for the native automations feature, not deleted
 * kaneo scaffolding. All three routes are capability-kind (kind 1); none is
 * `self`/`portal`/`public`/`delegated`, and none is `elevated` — no Projects-group capability
 * declared below is in `AUTHORITY_GRANTING`. No `sessionOnly`, same reasoning as every other
 * file in this batch: kaneo never restricted `/api/workflow-rule/*` to a browser session.
 *
 * **Legacy resource key: `"project"`, same as `column/policy.ts`, not a `"workflowRule"`
 * resource of its own.** Both mutation routes run `requireWorkspacePermission({ project:
 * ["update"] })` — the legacy `statement` object never had a distinct action for automations,
 * so `project:update` is the exact runtime check.
 *
 * **Granularity gap, the clearest instance of the pattern in this whole batch.** rbac.md's
 * `project:manage_settings` capability description is "Project states, features, labels, SLA
 * and calendar assignment, **automations**" — automations are named explicitly, and
 * `docs/01-architecture/data-model.md`'s `automation` table (`trigger` an event key from
 * `events.md`, `conditions`, `actions`, `effective_role_id`) is the documented native successor
 * to this router's `workflow_rule` table. The target capability for "who may create, edit or
 * delete a project's workflow rules" is therefore `project:manage_settings`, not the bare
 * `project:update` these routes enforce. Same reasoning as `column/policy.ts`'s note: declaring
 * `project:manage_settings` here would claim a stricter requirement than the runtime actually
 * imposes (`project:manage_settings` implies `project:update`, not the reverse), so
 * `project:update` is declared below, matching enforcement, and this is recorded as a gap for
 * #7 alongside column's.
 *
 * **Scope and scopeSource: `scope: 'project'`, `scopeSource: 'row'` throughout.** All three
 * routes address one identifiable project (the two `{projectId}` routes directly; the delete
 * route via the rule's own row). `workspaceAccess.fromProject("projectId")` issues a real
 * `SELECT workspaceId FROM project WHERE id = :id`; `workspaceAccess.fromWorkflowRule("id")`
 * issues a real `SELECT ... FROM workflow_rule JOIN project WHERE workflow_rule.id = :id` —
 * both genuinely read a row to derive the scope's containment chain.
 *
 * **`reach: "required"` throughout**, same reasoning as every other file in this batch: each
 * route addresses an existing project, directly or via the rule that belongs to it.
 */
export const workflowRulePolicies = {
  // Every workflow rule for a project. `getWorkflowRulesRoute`'s only middleware is
  // `workspaceAccess.fromProject("projectId")` -- no `requireWorkspacePermission` call, same
  // "reach alone" shape as the other list routes in this batch: every seeded role holds
  // `project: ["read"]` unconditionally.
  "GET /api/workflow-rule/{projectId}": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Create a rule, or update the target column of the existing rule for the same integration
  // and event. `requireWorkspacePermission({ project: ["update"] })` runs after
  // `workspaceAccess.fromProject("projectId")`.
  "PUT /api/workflow-rule/{projectId}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Delete a workflow rule. `workspaceAccess.fromWorkflowRule("id")` resolves the rule's own
  // project, then `requireWorkspacePermission({ project: ["update"] })` runs.
  "DELETE /api/workflow-rule/{id}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
