import { describe, expect, it } from "vitest";
import {
  canonicalScimAdminRequest,
  validateScimAdminRequest,
} from "./scim-admin.js";

describe("IP-6: SCIM administrator PATCH variants", () => {
  it("normalizes allowed resources and preserves omitted settings", () => {
    expect(
      validateScimAdminRequest({
        configVersion: 4,
        kind: "settings",
        allowedResources: ["groups", "users"],
      }),
    ).toEqual({
      ok: true,
      value: {
        configVersion: 4,
        kind: "settings",
        allowedResources: ["users", "groups"],
      },
    });
  });

  it.each([
    { configVersion: 0, kind: "settings", enabled: true },
    { configVersion: 1, kind: "settings", enabled: null },
    { configVersion: 1, kind: "settings", allowedResources: ["groups"] },
    { configVersion: 1, kind: "settings", enabled: true, private: true },
    { configVersion: 1, kind: "settings" },
    {
      configVersion: 1,
      kind: "mapping_create",
      externalGroupId: "group",
      roleId: "role",
      scope: "organisation",
      scopeId: "attacker-controlled",
    },
    {
      configVersion: 1,
      kind: "mapping_create",
      externalGroupId: "group\nother",
      roleId: "role",
      scope: "workspace",
      scopeId: "workspace",
    },
    {
      configVersion: 1,
      kind: "mapping_update",
      mappingId: "mapping",
      roleId: "role",
      enabled: true,
      scope: "organisation",
    },
  ])("rejects malformed or authority-bearing requests %#", (request) => {
    expect(validateScimAdminRequest(request).ok).toBe(false);
  });

  it("canonicalizes defaults, property order, route and connection", () => {
    const parsed = validateScimAdminRequest({
      enabled: true,
      scope: "workspace",
      roleId: "role-id",
      externalGroupId: "opaque-group",
      configVersion: 8,
      kind: "mapping_create",
      scopeId: "workspace-id",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(canonicalScimAdminRequest("connection-id", parsed.value)).toBe(
      JSON.stringify({
        routeKey: "PATCH /api/instance/identity-connections/{id}/scim",
        connectionId: "connection-id",
        request: {
          configVersion: 8,
          kind: "mapping_create",
          externalGroupId: "opaque-group",
          externalGroupNameSnapshot: null,
          roleId: "role-id",
          scope: "workspace",
          scopeId: "workspace-id",
          enabled: true,
        },
      }),
    );
  });

  it("binds explicit snapshot null differently from omitted snapshot", () => {
    const cleared = validateScimAdminRequest({
      configVersion: 3,
      kind: "mapping_update",
      mappingId: "mapping-id",
      externalGroupNameSnapshot: null,
    });
    const preserved = validateScimAdminRequest({
      configVersion: 3,
      kind: "mapping_update",
      mappingId: "mapping-id",
      enabled: false,
    });
    expect(cleared.ok && preserved.ok).toBe(true);
    if (cleared.ok && preserved.ok) {
      expect(
        canonicalScimAdminRequest("connection-id", cleared.value),
      ).not.toBe(canonicalScimAdminRequest("connection-id", preserved.value));
    }
  });
});
