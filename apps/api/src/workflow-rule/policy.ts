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
 * declared below is in `AUTHORITY_GRANTING`. `sessionOnly` on DELETE only (P0 deletion audit): the
 * delete is immediate and a workflow rule has no pending-action target, so API and MCP keys are
 * refused (`requireSessionOnly`); GET and PUT stay open to keys as kaneo had them.
 *
 * **Capability: `project:manage_settings` on both mutations (A8-2, Thomas 8 Nov).** rbac.md's
 * `project:manage_settings` is "Project states, features, labels, SLA and calendar assignment,
 * **automations**", and `data-model.md`'s `automation` table is the documented native successor
 * to this router's `workflow_rule` table. The project reach middleware
 * (`workspaceAccess.fromProject`/`fromWorkflowRule` with `requireProjectReach`) enforces this
 * declaration against the caller's project authority, and an API key must also carry it in its
 * scope (no `deferApiKeyCapability`). The legacy `requireWorkspacePermission({ project:
 * ["update"] })` gate stays as the baseline. A lead (`project:update` only) is refused.
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
  // Every workflow rule for a project. Runtime checks row-derived reach and then requires
  // `project:read` from the caller's workspace role.
  "GET /api/workflow-rule/{projectId}": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Create a rule, or update the target column of the existing rule for the same integration
  // and event.
  "PUT /api/workflow-rule/{projectId}": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Delete a workflow rule. `workspaceAccess.fromWorkflowRule("id")` resolves the rule's own
  // project.
  "DELETE /api/workflow-rule/{id}": {
    capability: "project:manage_settings",
    sessionOnly: true,
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
