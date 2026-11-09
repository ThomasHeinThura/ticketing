/**
 * A8-2 (D2): project archive authority and board/automation settings authority.
 *
 * The contract (feature-contracts-p1 "Projects and engagements — Permissions", permissions.md)
 * puts archive and restore under `project:archive` and project settings (states, automations)
 * under `project:manage_settings`. These routes used to declare and enforce the broader
 * `project:update`, so a lead could archive a project or reshape its board. The declaration is
 * what `workspaceAccess.*({ requireProjectReach: true })` enforces at runtime, so pinning it
 * here pins the runtime gate as well; `evaluatePolicy` proves the declaration alone refuses a
 * lead and admits a manager.
 */
import {
  BUILT_IN_ROLE_KEYS,
  BUILT_IN_ROLES,
  type BuiltInRoleKey,
  type Capability,
  evaluatePolicy,
  expandCapabilities,
  isCapabilityPolicy,
  projectScopeFromRow,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { loadPolicyRegistry } from "./api-app";
import {
  identityFor,
  MATRIX_TARGET,
  PROJECT_ID,
  WORKSPACE_ID,
} from "./matrix-fixture";

const EXPECTED: Readonly<Record<string, Capability>> = {
  "PUT /api/project/{id}/archive": "project:archive",
  "PUT /api/project/{id}/unarchive": "project:archive",
  "PUT /api/project/{id}/restore": "project:archive",
  "POST /api/column/{projectId}": "project:manage_settings",
  "PUT /api/column/{id}": "project:manage_settings",
  "DELETE /api/column/{id}": "project:manage_settings",
  "PUT /api/column/reorder/{projectId}": "project:manage_settings",
  "PUT /api/workflow-rule/{projectId}": "project:manage_settings",
  "DELETE /api/workflow-rule/{id}": "project:manage_settings",
};

describe("A8-2: archive, column and workflow-rule routes declare the contract capability", () => {
  for (const [routeKey, capability] of Object.entries(EXPECTED)) {
    it(`${routeKey} declares ${capability}; lead refused, manager allowed`, async () => {
      const registry = await loadPolicyRegistry();
      const entry = registry.entries.find((e) => e.routeKey === routeKey);
      if (!entry) throw new Error(`${routeKey} is missing from the registry`);
      if (!isCapabilityPolicy(entry.policy)) {
        throw new Error(`${routeKey} is no longer a capability-kind policy`);
      }
      expect(entry.policy.capability).toBe(capability);
      expect(entry.policy.scope).toBe("project");
      expect(entry.policy.reach).toBe("required");

      const scope = projectScopeFromRow({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      });
      for (const key of BUILT_IN_ROLE_KEYS) {
        const decision = evaluatePolicy(entry.policy, {
          identity: identityFor(key as BuiltInRoleKey, { inReach: true }),
          target: MATRIX_TARGET,
          scope,
          inReach: true,
          portalPredicateSatisfied: true,
        });
        const holds = expandCapabilities(
          BUILT_IN_ROLES[key as BuiltInRoleKey].capabilities,
        ).has(capability);
        expect(decision.allowed, `${routeKey} · ${key}`).toBe(holds);
      }
      const lead = evaluatePolicy(entry.policy, {
        identity: identityFor("lead", { inReach: true }),
        target: MATRIX_TARGET,
        scope,
        inReach: true,
        portalPredicateSatisfied: true,
      });
      const manager = evaluatePolicy(entry.policy, {
        identity: identityFor("manager", { inReach: true }),
        target: MATRIX_TARGET,
        scope,
        inReach: true,
        portalPredicateSatisfied: true,
      });
      expect(lead.allowed, `${routeKey} · lead`).toBe(false);
      expect(manager.allowed, `${routeKey} · manager`).toBe(true);
    });
  }
});
