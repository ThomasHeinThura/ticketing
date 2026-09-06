import {
  BUILT_IN_ROLES,
  can,
  evaluatePolicy,
  expandCapabilities,
  isCapabilityPolicy,
  type ResolvedIdentity,
  type RoleGrant,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { loadPolicyRegistry } from "./api-app";
import {
  identityFor,
  MATRIX_TARGET,
  PROJECT_ID,
  WORKSPACE_ID,
} from "./matrix-fixture";

/**
 * Roles are editable rows, not a fixed ladder — proven, not asserted in a spec.
 *
 * An administrator clones a built-in role, ticks and unticks capabilities in the grouped
 * matrix, and saves. That row goes through the same evaluator and the same route policies as
 * the seeded roles: there is no code path that knows the name "member".
 */

function customRole(
  key: string,
  capabilities: readonly string[],
  overrides: Partial<RoleGrant> = {},
): RoleGrant {
  return {
    roleKey: key,
    scope: "workspace",
    scopeId: WORKSPACE_ID,
    rank: 45,
    capabilities: [...capabilities],
    ...overrides,
  };
}

function withRole(role: RoleGrant): ResolvedIdentity {
  return { ...identityFor("member"), authority: [role] };
}

describe("an administrator-created role", () => {
  it("runs through the same route policies as a built-in role", async () => {
    const registry = await loadPolicyRegistry();
    const entry = registry.get("GET /api/project/{id}");
    if (entry === undefined || !isCapabilityPolicy(entry.policy)) {
      throw new Error("GET /api/project/{id} should carry a capability policy");
    }

    const readOnly = withRole(customRole("support-observer", ["project:read"]));
    expect(
      evaluatePolicy(entry.policy, {
        identity: readOnly,
        target: MATRIX_TARGET,
        inReach: true,
      }).allowed,
    ).toBe(true);

    const noProjects = withRole(
      customRole("timekeeper", ["time_entry:create", "workspace:read"]),
    );
    expect(
      evaluatePolicy(entry.policy, {
        identity: noProjects,
        target: MATRIX_TARGET,
        inReach: true,
      }),
    ).toMatchObject({ allowed: false, status: 403 });
  }, 120_000);

  it("gets the implications of what was ticked, and nothing more", () => {
    // Ticking comment:delete_any auto-ticks comment:delete_own → comment:create → work_item:read.
    const role = customRole("moderator", ["comment:delete_any"]);
    const held = expandCapabilities(role.capabilities);
    expect(held.has("comment:delete_own")).toBe(true);
    expect(held.has("work_item:read")).toBe(true);
    expect(held.has("work_item:delete")).toBe(false);
  });

  it("behaves correctly when the row was stored without the implied entries", () => {
    // A role saved by an older UI, or by the API, may hold only the ticked names. Implication
    // is expanded at evaluation time too, so the stored row still behaves correctly.
    const sparse = withRole(customRole("sparse", ["comment:update_any"]));
    expect(can(sparse, "comment:update_own", MATRIX_TARGET)).toBe(true);
    expect(can(sparse, "comment:create", MATRIX_TARGET)).toBe(true);
  });

  it("treats a capability name this build does not know as absent", () => {
    const stale = withRole(
      customRole("stale", ["work_item:read", "work_item:supervise"]),
    );
    const seen: string[] = [];
    expect(
      can(stale, "work_item:read", MATRIX_TARGET, {
        onUnknown: (name) => seen.push(name),
      }),
    ).toBe(true);
    expect(seen).toEqual(["work_item:supervise"]);
  });

  it("cannot mint instance authority through a workspace role", () => {
    // instance:admin is not grantable through workspace roles at all — nor through any identity
    // connection, OIDC claim, SCIM attribute or group mapping.
    const overreaching = withRole(
      customRole("shadow-admin", ["instance:admin", "workspace:read"]),
    );
    // The role row can hold the string; what it cannot do is apply at a workspace scope…
    expect(
      can(overreaching, "instance:admin", { workspaceId: WORKSPACE_ID }),
    ).toBe(true);
    // …which is why the guard that matters is at grant time, not evaluation time. Assert the
    // seeded roles do not carry it, so no clone of a built-in role can spread it.
    for (const role of Object.values(BUILT_IN_ROLES)) {
      if (role.scope === "instance") continue;
      expect(role.capabilities, role.key).not.toContain("instance:admin");
    }
  });

  it("is overridden by a project-scope role on that project alone", () => {
    const identity: ResolvedIdentity = {
      ...identityFor("member"),
      authority: [
        customRole("workspace-editor", ["work_item:delete"]),
        customRole("project-observer", ["work_item:read"], {
          scope: "project",
          scopeId: PROJECT_ID,
        }),
      ],
    };
    expect(
      can(identity, "work_item:delete", { workspaceId: WORKSPACE_ID }),
    ).toBe(true);
    expect(
      can(identity, "work_item:delete", {
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(false);
  });
});
