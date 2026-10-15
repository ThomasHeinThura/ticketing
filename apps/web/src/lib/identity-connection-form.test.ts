import { describe, expect, it } from "vitest";
import type {
  IdentityConnection,
  ScimAdminSettings,
  ScimGroupMapping,
} from "@/fetchers/god-mode/identity-connections";
import {
  buildConfigureBody,
  buildCreateBody,
  buildMappingRequest,
  buildScimEnabledRequest,
  buildScimProfileRequest,
  buildScimSettingsRequest,
  canonicalMatchAttributes,
  draftFromConnection,
  draftFromScim,
  emptyConnectionDraft,
  emptyMappingDraft,
  isValidDisplaySnapshot,
  isValidExternalGroupId,
} from "./identity-connection-form";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

const connection: IdentityConnection = {
  id: "conn-1",
  providerType: "entra",
  portalScope: "agent",
  organisationId: null,
  defaultWorkspaceId: "ws-1",
  displayName: "Staff Entra",
  issuer: "https://login.example.test/tenant/v2.0",
  tenantId: TENANT,
  clientId: CLIENT,
  clientSecretConfigured: true,
  redirectUri: "https://desk.example.test/api/auth/callback/conn-1",
  scopes: ["openid", "profile", "email"],
  claimMapping: { version: 1, displayName: "name" },
  claimMappingState: "valid",
  domainBindings: ["example.test"],
  jitPolicy: {
    enabled: false,
    default_role_id: null,
    required_entra_app_role: "TaskDesk.User",
  },
  maxRoleRank: 10,
  mfaUpstreamMode: "off",
  enabled: false,
  configVersion: 7,
  healthState: "healthy",
  healthCheckedAt: null,
};

describe("identity connection create body", () => {
  it("builds a strict staff-portal body and never a customer one", () => {
    const draft = {
      ...emptyConnectionDraft(),
      displayName: " Staff ",
      tenantId: TENANT,
      clientId: CLIENT,
      clientSecret: "not-a-real-secret",
      domains: "B.example.test\na.example.test\nb.example.test",
      requiredAppRole: "TaskDesk.User",
      maxRoleRank: "10",
    };
    const built = buildCreateBody(draft);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body).toMatchObject({
      portalScope: "agent",
      organisationId: null,
      defaultWorkspaceId: null,
      displayName: "Staff",
      domainBindings: ["a.example.test", "b.example.test"],
      maxRoleRank: 10,
      jitPolicy: {
        enabled: false,
        default_role_id: null,
        required_entra_app_role: "TaskDesk.User",
      },
    });
    expect(Object.keys(built.body).sort()).toEqual(
      [
        "clientId",
        "clientSecret",
        "defaultWorkspaceId",
        "displayName",
        "domainBindings",
        "jitPolicy",
        "maxRoleRank",
        "organisationId",
        "portalScope",
        "scopes",
        "tenantId",
      ].sort(),
    );
  });

  it("reports every invalid field instead of sending a doomed request", () => {
    const built = buildCreateBody({
      ...emptyConnectionDraft(),
      tenantId: "nope",
      clientId: "nope",
      domains: "not a domain",
      jitEnabled: true,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors).toEqual(
      expect.arrayContaining([
        "displayName",
        "tenantId",
        "clientId",
        "clientSecret",
        "domains",
        "requiredAppRole",
        "maxRoleRank",
        "defaultWorkspaceId",
        "defaultRoleId",
      ]),
    );
  });
});

describe("identity connection configure body", () => {
  it("reports unchanged without spending a proof when nothing differs", () => {
    expect(
      buildConfigureBody(connection, draftFromConnection(connection)),
    ).toEqual({ ok: "unchanged" });
  });

  it("sends only changed fields with the version the draft was based on", () => {
    const draft = {
      ...draftFromConnection(connection),
      displayName: "Renamed",
      enabled: true,
    };
    expect(buildConfigureBody(connection, draft)).toEqual({
      ok: true,
      body: { configVersion: 7, displayName: "Renamed", enabled: true },
    });
  });

  it("sends the whole JIT policy when any JIT field changes and a replacement secret only when typed", () => {
    const draft = {
      ...draftFromConnection(connection),
      jitEnabled: true,
      defaultRoleId: "role-1",
      clientSecret: "replacement-placeholder",
    };
    expect(buildConfigureBody(connection, draft)).toEqual({
      ok: true,
      body: {
        configVersion: 7,
        clientSecret: "replacement-placeholder",
        jitPolicy: {
          enabled: true,
          default_role_id: "role-1",
          required_entra_app_role: "TaskDesk.User",
        },
      },
    });
  });

  it("clears the default workspace explicitly with null and never sends immutable fields", () => {
    const draft = {
      ...draftFromConnection(connection),
      defaultWorkspaceId: "",
    };
    const built = buildConfigureBody(connection, draft);
    expect(built).toEqual({
      ok: true,
      body: { configVersion: 7, defaultWorkspaceId: null },
    });
    const body = (built as { body: Record<string, unknown> }).body;
    for (const immutable of [
      "tenantId",
      "portalScope",
      "organisationId",
      "issuer",
    ])
      expect(body).not.toHaveProperty(immutable);
  });

  it("repairs only a malformed claim mapping and only when asked", () => {
    const broken = {
      ...connection,
      claimMapping: null,
      claimMappingState: "invalid" as const,
    };
    expect(buildConfigureBody(broken, draftFromConnection(broken))).toEqual({
      ok: "unchanged",
    });
    expect(
      buildConfigureBody(broken, {
        ...draftFromConnection(broken),
        repairClaimMapping: true,
      }),
    ).toEqual({
      ok: true,
      body: {
        configVersion: 7,
        claimMapping: { version: 1, displayName: "name" },
      },
    });
    expect(
      buildConfigureBody(connection, {
        ...draftFromConnection(connection),
        repairClaimMapping: true,
      }),
    ).toEqual({ ok: "unchanged" });
  });

  it("rejects a rank outside the accepted range", () => {
    const built = buildConfigureBody(connection, {
      ...draftFromConnection(connection),
      maxRoleRank: "10001",
    });
    expect(built).toEqual({ ok: false, errors: ["maxRoleRank"] });
  });
});

const settings: ScimAdminSettings = {
  configVersion: 4,
  data: {
    enabled: false,
    allowedResources: ["users"],
    lifecyclePolicy: "end_memberships",
    matchAttributes: ["externalId", "userName"],
    attributeMapping: {
      version: 1,
      name: "displayName",
      email: "emails.primary.value",
      jobTitle: "title",
      locale: "preferredLanguage",
    },
    mappings: [],
  },
};

describe("SCIM administration requests", () => {
  it("puts required match attributes first, then optional ones in the fixed order", () => {
    expect(
      canonicalMatchAttributes(["preferredLanguage", "displayName"]),
    ).toEqual(["externalId", "userName", "displayName", "preferredLanguage"]);
  });

  it("builds one settings request with only changed settings, or none", () => {
    const draft = draftFromScim(settings);
    expect(buildScimSettingsRequest(settings, draft)).toBeNull();
    expect(
      buildScimSettingsRequest(settings, {
        ...draft,
        groups: true,
        lifecyclePolicy: "keep_memberships",
        matchAttributes: canonicalMatchAttributes(["title"]),
      }),
    ).toEqual({
      configVersion: 4,
      kind: "settings",
      allowedResources: ["users", "groups"],
      lifecyclePolicy: "keep_memberships",
      matchAttributes: ["externalId", "userName", "title"],
    });
  });

  it("builds a separate enabled request and a separate attribute-mapping request", () => {
    expect(buildScimEnabledRequest(settings, true)).toEqual({
      configVersion: 4,
      kind: "settings",
      enabled: true,
    });
    const draft = draftFromScim(settings);
    expect(buildScimProfileRequest(settings, draft)).toBeNull();
    expect(
      buildScimProfileRequest(settings, {
        ...draft,
        profile: { ...draft.profile, jobTitle: "unmapped" },
      }),
    ).toEqual({
      configVersion: 4,
      kind: "attribute_mapping",
      attributeMapping: { ...draft.profile, jobTitle: "unmapped" },
    });
  });
});

describe("SCIM group mapping requests", () => {
  const existing: ScimGroupMapping = {
    id: "map-1",
    externalGroupId: "group-1",
    externalGroupNameSnapshot: "Support",
    roleId: "role-1",
    scope: "workspace",
    scopeId: "ws-1",
    enabled: true,
  };

  it("creates an agent mapping with an explicit workspace and a customer mapping without a scope id", () => {
    const draft = {
      ...emptyMappingDraft(),
      externalGroupId: "group-9",
      roleId: "role-2",
      scopeId: "ws-2",
    };
    expect(
      buildMappingRequest({
        version: 4,
        existing: null,
        draft,
        customer: false,
      }),
    ).toEqual({
      configVersion: 4,
      kind: "mapping_create",
      externalGroupId: "group-9",
      externalGroupNameSnapshot: null,
      roleId: "role-2",
      scope: "workspace",
      scopeId: "ws-2",
      enabled: true,
    });
    const customer = buildMappingRequest({
      version: 4,
      existing: null,
      draft,
      customer: true,
    });
    expect(customer).toMatchObject({ scope: "organisation" });
    expect(customer).not.toHaveProperty("scopeId");
  });

  it("updates only changed mutable properties and returns null for a no-op", () => {
    const draft = {
      externalGroupId: existing.externalGroupId,
      displayName: "Support",
      scopeId: "ws-1",
      roleId: "role-1",
      enabled: true,
    };
    expect(
      buildMappingRequest({ version: 4, existing, draft, customer: false }),
    ).toBeNull();
    expect(
      buildMappingRequest({
        version: 4,
        existing,
        draft: { ...draft, enabled: false, displayName: "" },
        customer: false,
      }),
    ).toEqual({
      configVersion: 4,
      kind: "mapping_update",
      mappingId: "map-1",
      externalGroupNameSnapshot: null,
      enabled: false,
    });
  });

  it("validates provider ids and snapshots like the API (bytes, control characters)", () => {
    expect(isValidExternalGroupId("a".repeat(255))).toBe(true);
    expect(isValidExternalGroupId("a".repeat(256))).toBe(false);
    expect(isValidExternalGroupId("é".repeat(128))).toBe(false);
    expect(isValidExternalGroupId("bad\nid")).toBe(false);
    expect(isValidExternalGroupId("")).toBe(false);
    expect(isValidDisplaySnapshot("")).toBe(true);
    expect(isValidDisplaySnapshot("tab\there")).toBe(false);
  });
});
