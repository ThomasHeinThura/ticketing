import { describe, expect, it } from "vitest";
import { oidcGroupMappingCreateRequestSchema } from "../../apps/api/src/identity/oidc-group-mapping-contract";

describe("OIDC group mapping group object id contract", () => {
  it("accepts UUID casing and stores the shared lowercase canonical form", () => {
    const parsed = oidcGroupMappingCreateRequestSchema.parse({
      configVersion: 1,
      externalGroupId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      roleId: "role-id",
      scope: "workspace",
      scopeId: "workspace-id",
    });

    expect(parsed.externalGroupId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("rejects non-UUID group identifiers", () => {
    expect(
      oidcGroupMappingCreateRequestSchema.safeParse({
        configVersion: 1,
        externalGroupId: "support-team",
        roleId: "role-id",
        scope: "workspace",
        scopeId: "workspace-id",
      }).success,
    ).toBe(false);
  });
});
