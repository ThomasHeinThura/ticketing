import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Automations (`feature-contracts-p4.md` "Automations", `AM-1`..`AM-13`).
 *
 * The contract names a union capability for the by-id routes ("`automation:manage` |
 * `workspace:manage_settings`"), which one route policy cannot express: a rule is either a
 * project rule or a workspace rule, decided by the row. The declaration below is the **stricter**
 * workspace authority, and the handlers apply the rule's real scope (`./access.ts`): a project
 * manager who holds `automation:manage` on the rule's project may change a project rule,
 * a workspace rule needs `workspace:manage_settings`. Declared policy and runtime therefore
 * agree for workspace rules and the runtime is the wider one for project rules; if
 * `TASKDESK_POLICY_ENFORCE` ever enforces this source, project managers would need the policy
 * split by rule scope (a decision for the coordinator, recorded in the handback).
 *
 * `DELETE /api/automations/{id}` only requests a deletion: a click-level pending action whose
 * registered target is `automationDeletionTarget` (`./deletion-target.ts`). The registry
 * re-evaluates this declared workspace policy at approval for a workspace rule, and the
 * project-scoped manage policy (`POST /api/projects/{key}/automations`) for a project rule, so
 * the request handler requires the same authority the approval will.
 *
 * None of these capabilities is in `AUTHORITY_GRANTING`, so no `elevated` field is declared. A
 * rule's *effective role* is bounded to the author's own rank at save time (`AM-3`).
 */
export const automationPolicies = {
  "GET /api/workspaces/{id}/automations": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/workspaces/{id}/automations": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/projects/{key}/automations": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/projects/{key}/automations": {
    capability: "automation:manage",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/automations/{id}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/automations/{id}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/automations/{id}/dry-run": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/automations/{id}/enable": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/automations/{id}/disable": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/automations/{id}/runs": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
