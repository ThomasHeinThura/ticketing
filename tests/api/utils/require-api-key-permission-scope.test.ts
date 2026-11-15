import { describe, expect, it } from "vitest";
import {
  apiKeyCapabilitySubset,
  apiKeyHasCapabilityScope,
  apiKeyScopeFromStoredPermissions,
  apiKeyScopeSatisfies,
} from "../../../apps/api/src/utils/require-api-key-permission-scope";

describe("API-key permission scope intersection", () => {
  const required = { project: ["create"] };

  it("parses persisted key scopes and fails closed on malformed values", () => {
    expect(
      apiKeyScopeFromStoredPermissions(
        JSON.stringify({ work_item: ["read", "delete"] }),
      ),
    ).toEqual({ permissions: { work_item: ["read", "delete"] } });
    expect(apiKeyScopeFromStoredPermissions(null)).toEqual({
      permissions: null,
    });
    expect(apiKeyScopeFromStoredPermissions("not-json")).toEqual({
      permissions: null,
    });
    expect(
      apiKeyScopeFromStoredPermissions(JSON.stringify({ work_item: 1 })),
    ).toEqual({
      permissions: null,
    });
  });

  it("leaves session requests to the role evaluator", () => {
    expect(apiKeyScopeSatisfies(undefined, required)).toBe(true);
  });

  it("requires the key to carry every requested resource/action grant", () => {
    expect(
      apiKeyScopeSatisfies(
        { permissions: { project: ["create", "read"] } },
        required,
      ),
    ).toBe(true);
    expect(
      apiKeyScopeSatisfies({ permissions: { project: ["read"] } }, required),
    ).toBe(false);
    expect(apiKeyScopeSatisfies({ permissions: {} }, required)).toBe(false);
  });

  it.each([
    ["SQL NULL", { permissions: null }],
    ["missing scope", {}],
    ["non-object scope", { permissions: "project:create" }],
    ["non-array resource scope", { permissions: { project: "create" } }],
    [
      "mixed malformed scope",
      { permissions: { project: ["create"], task: null } },
    ],
  ])("fails closed for %s", (_label, apiKey) => {
    expect(apiKeyScopeSatisfies(apiKey as never, required)).toBe(false);
  });

  it("uses the canonical capability's exact resource/action pair", () => {
    expect(
      apiKeyHasCapabilityScope(
        { permissions: { instance: ["read_audit"] } },
        "instance:read_audit",
      ),
    ).toBe(true);
    expect(
      apiKeyHasCapabilityScope(
        { permissions: { instance: ["admin"] } },
        "instance:read_audit",
      ),
    ).toBe(false);
    expect(apiKeyHasCapabilityScope(undefined, "instance:read_audit")).toBe(
      true,
    );
  });

  it("projects only recognized stored statements into the canonical key subset", () => {
    expect(
      apiKeyCapabilitySubset({
        permissions: {
          work_item: ["update", "invented"],
          project: ["read"],
          legacy_resource: ["read"],
        },
      }),
    ).toEqual(["work_item:update", "project:read"]);
    expect(apiKeyCapabilitySubset({ permissions: null })).toEqual([]);
    expect(
      apiKeyCapabilitySubset({
        permissions: { work_item: ["update"], malformed: null as never },
      }),
    ).toEqual([]);
    // A malformed ACTION anywhere (not only a malformed resource) voids the whole projection,
    // even when other resources are valid and listed before or after it (#750).
    for (const permissions of [
      { project: ["read"], work_item: [1] },
      { work_item: [1], project: ["read"] },
      { project: ["read"], work_item: ["read", {}] },
      { project: ["read"], work_item: "read" },
    ])
      expect(
        apiKeyCapabilitySubset({ permissions: permissions as never }),
      ).toEqual([]);
  });

  it("satisfies non-identity legacy statement gates from canonical API-key scopes (H-5 / D-S)", () => {
    expect(
      apiKeyScopeSatisfies(
        { permissions: { label: ["manage"] } },
        { label: ["create", "update", "delete"] },
      ),
    ).toBe(true);
    expect(
      apiKeyScopeSatisfies(
        { permissions: { workspace: ["read"] } },
        { label: ["read"], ac: ["read"] },
      ),
    ).toBe(true);
    expect(
      apiKeyScopeSatisfies(
        { permissions: { workspace: ["update", "delete"] } },
        { organization: ["update", "delete"] },
      ),
    ).toBe(true);
    expect(
      apiKeyScopeSatisfies(
        { permissions: { workspace: ["manage_members"] } },
        { member: ["create", "update"] },
      ),
    ).toBe(true);
    expect(
      apiKeyScopeSatisfies(
        { permissions: { member: ["remove", "invite"] } },
        { member: ["delete"], invitation: ["create", "cancel"] },
      ),
    ).toBe(true);
    expect(
      apiKeyScopeSatisfies(
        { permissions: { workspace: ["manage_settings"] } },
        { team: ["create", "update", "delete"] },
      ),
    ).toBe(true);
    expect(
      apiKeyScopeSatisfies(
        { permissions: { workspace: ["manage_roles"] } },
        { ac: ["create", "update", "delete"] },
      ),
    ).toBe(true);
    expect(
      apiKeyScopeSatisfies(
        { permissions: { project: ["manage_members"] } },
        { project: ["share"] },
      ),
    ).toBe(true);

    // Exact canonical scopes continue to satisfy their own gates without cross-granting others.
    const exactCanonicalPairs: Array<
      [Parameters<typeof apiKeyHasCapabilityScope>[1], Record<string, string[]>]
    > = [
      ["project:create", { project: ["create"] }],
      ["project:delete", { project: ["delete"] }],
      ["custom_field:manage", { custom_field: ["manage"] }],
      ["sla_policy:manage", { sla_policy: ["manage"] }],
      ["workflow:manage", { workflow: ["manage"] }],
      ["request_type:manage", { request_type: ["manage"] }],
      ["saved_view:share", { saved_view: ["share"] }],
      ["webhook:manage", { webhook: ["manage"] }],
    ];
    for (const [capability, granted] of exactCanonicalPairs) {
      expect(
        apiKeyHasCapabilityScope({ permissions: granted }, capability),
      ).toBe(true);
    }
    expect(
      apiKeyScopeSatisfies(
        { permissions: { workspace: ["admin"] } },
        { project: ["create"] },
      ),
    ).toBe(false);
    expect(
      apiKeyScopeSatisfies(
        { permissions: { workspace: ["admin"] } },
        { project: ["delete"] },
      ),
    ).toBe(false);
  });

  it("keeps canonical-to-legacy compatibility strictly unidirectional (legacy granular keys never widen)", () => {
    // Legacy granular `label:create` still satisfies literal `label:create` only, never `label:manage` or other writes.
    expect(
      apiKeyScopeSatisfies(
        { permissions: { label: ["create"] } },
        { label: ["create"] },
      ),
    ).toBe(true);
    expect(
      apiKeyScopeSatisfies(
        { permissions: { label: ["create"] } },
        { label: ["update"] },
      ),
    ).toBe(false);
    expect(
      apiKeyScopeSatisfies(
        { permissions: { label: ["create", "update", "delete"] } },
        { label: ["manage"] },
      ),
    ).toBe(false);
    expect(
      apiKeyHasCapabilityScope(
        { permissions: { label: ["create", "update", "delete"] } },
        "label:manage",
      ),
    ).toBe(false);
    expect(
      apiKeyCapabilitySubset({
        permissions: { label: ["create", "update", "delete"] },
      }),
    ).toEqual([]);

    // Other legacy pairs do not widen back to their canonical capability either.
    expect(
      apiKeyHasCapabilityScope(
        { permissions: { team: ["create", "update", "delete"] } },
        "workspace:manage_settings",
      ),
    ).toBe(false);
    expect(
      apiKeyHasCapabilityScope(
        { permissions: { organization: ["update"] } },
        "workspace:update",
      ),
    ).toBe(false);
    expect(
      apiKeyHasCapabilityScope(
        { permissions: { project: ["share"] } },
        "project:manage_members",
      ),
    ).toBe(false);
  });

  it("keeps project:archive, project:manage_settings, and project:update strictly distinct (H-3 / D-S)", () => {
    const updateOnly = { permissions: { project: ["update"] } };
    const archiveOnly = { permissions: { project: ["archive"] } };
    const settingsOnly = { permissions: { project: ["manage_settings"] } };

    expect(apiKeyHasCapabilityScope(updateOnly, "project:update")).toBe(true);
    expect(apiKeyHasCapabilityScope(updateOnly, "project:archive")).toBe(false);
    expect(
      apiKeyHasCapabilityScope(updateOnly, "project:manage_settings"),
    ).toBe(false);

    expect(apiKeyHasCapabilityScope(archiveOnly, "project:archive")).toBe(true);
    expect(apiKeyHasCapabilityScope(archiveOnly, "project:update")).toBe(false);
    expect(
      apiKeyHasCapabilityScope(archiveOnly, "project:manage_settings"),
    ).toBe(false);
    expect(apiKeyScopeSatisfies(archiveOnly, { project: ["update"] })).toBe(
      false,
    );

    expect(
      apiKeyHasCapabilityScope(settingsOnly, "project:manage_settings"),
    ).toBe(true);
    expect(apiKeyHasCapabilityScope(settingsOnly, "project:update")).toBe(
      false,
    );
    expect(apiKeyHasCapabilityScope(settingsOnly, "project:archive")).toBe(
      false,
    );
    expect(apiKeyScopeSatisfies(settingsOnly, { project: ["update"] })).toBe(
      false,
    );

    expect(apiKeyCapabilitySubset(archiveOnly)).toEqual(["project:archive"]);
    expect(apiKeyCapabilitySubset(settingsOnly)).toEqual([
      "project:manage_settings",
    ]);
    expect(apiKeyCapabilitySubset(updateOnly)).toEqual(["project:update"]);
  });
});
