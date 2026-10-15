import type {
  IdentityConnection,
  IdentityConnectionConfigureBody,
  IdentityConnectionCreateBody,
  ScimAdminRequest,
  ScimAdminSettings,
  ScimGroupMapping,
  ScimMatchAttribute,
  ScimProfileMapping,
} from "@/fetchers/god-mode/identity-connections";

/** Mirrors the closed claim map the API accepts; saving it repairs a malformed stored map. */
export const DEFAULT_CLAIM_MAPPING = {
  version: 1,
  displayName: "name",
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

export type ConnectionDraft = {
  displayName: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  domains: string;
  defaultWorkspaceId: string;
  jitEnabled: boolean;
  defaultRoleId: string;
  requiredAppRole: string;
  maxRoleRank: string;
  enabled: boolean;
  repairClaimMapping: boolean;
};

export type ConnectionFieldError =
  | "displayName"
  | "tenantId"
  | "clientId"
  | "clientSecret"
  | "domains"
  | "requiredAppRole"
  | "maxRoleRank"
  | "defaultWorkspaceId"
  | "defaultRoleId";

export function emptyConnectionDraft(): ConnectionDraft {
  return {
    displayName: "",
    tenantId: "",
    clientId: "",
    clientSecret: "",
    scopes: "openid, profile, email",
    domains: "",
    defaultWorkspaceId: "",
    jitEnabled: false,
    defaultRoleId: "",
    requiredAppRole: "",
    maxRoleRank: "",
    enabled: false,
    repairClaimMapping: false,
  };
}

export function draftFromConnection(
  connection: IdentityConnection,
): ConnectionDraft {
  return {
    displayName: connection.displayName,
    tenantId: connection.tenantId ?? "",
    clientId: connection.clientId,
    clientSecret: "",
    scopes: connection.scopes.join(", "),
    domains: connection.domainBindings.join("\n"),
    defaultWorkspaceId: connection.defaultWorkspaceId ?? "",
    jitEnabled: connection.jitPolicy.enabled,
    defaultRoleId: connection.jitPolicy.default_role_id ?? "",
    requiredAppRole: connection.jitPolicy.required_entra_app_role,
    maxRoleRank: connection.maxRoleRank?.toString() ?? "",
    enabled: connection.enabled,
    repairClaimMapping: false,
  };
}

export function parseList(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDomains(value: string): string[] {
  return [
    ...new Set(parseList(value).map((item) => item.toLowerCase())),
  ].sort();
}

function parseRank(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{1,5}$/u.test(trimmed)) return "invalid";
  const rank = Number(trimmed);
  return rank <= 10_000 ? rank : "invalid";
}

type Validation<T> =
  | { ok: true; body: T }
  | { ok: false; errors: ConnectionFieldError[] };

function validateCommon(draft: ConnectionDraft, agent: boolean) {
  const errors: ConnectionFieldError[] = [];
  if (!draft.displayName.trim() || draft.displayName.trim().length > 128)
    errors.push("displayName");
  if (!UUID_PATTERN.test(draft.clientId.trim())) errors.push("clientId");
  if (!draft.requiredAppRole.trim()) errors.push("requiredAppRole");
  const domains = parseDomains(draft.domains);
  if (domains.some((domain) => !DOMAIN_PATTERN.test(domain)))
    errors.push("domains");
  const rank = parseRank(draft.maxRoleRank);
  if (rank === "invalid" || (agent && rank === null))
    errors.push("maxRoleRank");
  if (draft.jitEnabled && agent && !draft.defaultWorkspaceId.trim())
    errors.push("defaultWorkspaceId");
  if (draft.jitEnabled && !draft.defaultRoleId.trim())
    errors.push("defaultRoleId");
  return { errors, domains, rank: rank === "invalid" ? null : rank };
}

/** Creation is staff-portal only here: customer connections are configured from the organisation Identity tab. */
export function buildCreateBody(
  draft: ConnectionDraft,
): Validation<IdentityConnectionCreateBody> {
  const common = validateCommon(draft, true);
  const errors = [...common.errors];
  if (!UUID_PATTERN.test(draft.tenantId.trim())) errors.push("tenantId");
  if (!draft.clientSecret) errors.push("clientSecret");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      portalScope: "agent",
      organisationId: null,
      defaultWorkspaceId: draft.defaultWorkspaceId.trim() || null,
      displayName: draft.displayName.trim(),
      tenantId: draft.tenantId.trim(),
      clientId: draft.clientId.trim(),
      clientSecret: draft.clientSecret,
      scopes: parseList(draft.scopes),
      domainBindings: common.domains,
      jitPolicy: {
        enabled: draft.jitEnabled,
        default_role_id: draft.defaultRoleId.trim() || null,
        required_entra_app_role: draft.requiredAppRole.trim(),
      },
      maxRoleRank: common.rank,
    },
  };
}

/**
 * Sends only the fields that changed (omitted fields keep their stored value) with the version the
 * draft was based on. Returns `unchanged` when there is nothing to save, so no proof is spent.
 */
export function buildConfigureBody(
  connection: IdentityConnection,
  draft: ConnectionDraft,
): Validation<IdentityConnectionConfigureBody> | { ok: "unchanged" } {
  const agent = connection.portalScope === "agent";
  const common = validateCommon(draft, agent);
  if (common.errors.length) return { ok: false, errors: common.errors };
  const body: IdentityConnectionConfigureBody = {
    configVersion: connection.configVersion,
  };
  if (draft.displayName.trim() !== connection.displayName)
    body.displayName = draft.displayName.trim();
  if (draft.clientId.trim() !== connection.clientId)
    body.clientId = draft.clientId.trim();
  if (draft.clientSecret) body.clientSecret = draft.clientSecret;
  const scopes = parseList(draft.scopes);
  if (scopes.join("\n") !== connection.scopes.join("\n")) body.scopes = scopes;
  if (
    common.domains.join("\n") !==
    [...connection.domainBindings].sort().join("\n")
  )
    body.domainBindings = common.domains;
  if (agent) {
    const workspace = draft.defaultWorkspaceId.trim() || null;
    if (workspace !== connection.defaultWorkspaceId)
      body.defaultWorkspaceId = workspace;
    if (common.rank !== connection.maxRoleRank) body.maxRoleRank = common.rank;
  }
  const jit = {
    enabled: draft.jitEnabled,
    default_role_id: draft.defaultRoleId.trim() || null,
    required_entra_app_role: draft.requiredAppRole.trim(),
  };
  if (JSON.stringify(jit) !== JSON.stringify(connection.jitPolicy))
    body.jitPolicy = jit;
  if (draft.enabled !== connection.enabled) body.enabled = draft.enabled;
  if (draft.repairClaimMapping && connection.claimMappingState === "invalid")
    body.claimMapping = DEFAULT_CLAIM_MAPPING;
  return Object.keys(body).length === 1
    ? { ok: "unchanged" }
    : { ok: true, body };
}

export function isConnectionDraftDirty(
  connection: IdentityConnection,
  draft: ConnectionDraft,
): boolean {
  return (
    JSON.stringify(draft) !== JSON.stringify(draftFromConnection(connection))
  );
}

// ---------------------------------------------------------------------------------------------
// SCIM

export const REQUIRED_MATCH_ATTRIBUTES = ["externalId", "userName"] as const;
export const OPTIONAL_MATCH_ATTRIBUTES = [
  "displayName",
  "name.formatted",
  "title",
  "preferredLanguage",
] as const;

export type ScimSettingsDraft = {
  groups: boolean;
  lifecyclePolicy: ScimAdminSettings["data"]["lifecyclePolicy"];
  matchAttributes: ScimMatchAttribute[];
  profile: ScimProfileMapping;
};

export function draftFromScim(settings: ScimAdminSettings): ScimSettingsDraft {
  return {
    groups: settings.data.allowedResources.includes("groups"),
    lifecyclePolicy: settings.data.lifecyclePolicy,
    matchAttributes: [...settings.data.matchAttributes],
    profile: { ...settings.data.attributeMapping },
  };
}

/** Canonical order the API stores and returns: required names first, then optional names in fixed order. */
export function canonicalMatchAttributes(
  optional: readonly ScimMatchAttribute[],
): ScimMatchAttribute[] {
  return [
    ...REQUIRED_MATCH_ATTRIBUTES,
    ...OPTIONAL_MATCH_ATTRIBUTES.filter((name) => optional.includes(name)),
  ];
}

/** One settings PATCH carrying only changed settings, or null when none changed. */
export function buildScimSettingsRequest(
  settings: ScimAdminSettings,
  draft: ScimSettingsDraft,
): ScimAdminRequest | null {
  const request: Extract<ScimAdminRequest, { kind: "settings" }> = {
    configVersion: settings.configVersion,
    kind: "settings",
  };
  if (settings.data.allowedResources.includes("groups") !== draft.groups)
    request.allowedResources = draft.groups ? ["users", "groups"] : ["users"];
  if (settings.data.lifecyclePolicy !== draft.lifecyclePolicy)
    request.lifecyclePolicy = draft.lifecyclePolicy;
  if (
    settings.data.matchAttributes.join("|") !== draft.matchAttributes.join("|")
  )
    request.matchAttributes = draft.matchAttributes;
  return Object.keys(request).length === 2 ? null : request;
}

export function buildScimEnabledRequest(
  settings: ScimAdminSettings,
  enabled: boolean,
): ScimAdminRequest {
  return { configVersion: settings.configVersion, kind: "settings", enabled };
}

export function buildScimProfileRequest(
  settings: ScimAdminSettings,
  draft: ScimSettingsDraft,
): ScimAdminRequest | null {
  return JSON.stringify(settings.data.attributeMapping) ===
    JSON.stringify(draft.profile)
    ? null
    : {
        configVersion: settings.configVersion,
        kind: "attribute_mapping",
        attributeMapping: draft.profile,
      };
}

export type MappingDraft = {
  externalGroupId: string;
  displayName: string;
  scopeId: string;
  roleId: string;
  enabled: boolean;
};

export function emptyMappingDraft(): MappingDraft {
  return {
    externalGroupId: "",
    displayName: "",
    scopeId: "",
    roleId: "",
    enabled: true,
  };
}

export function draftFromMapping(mapping: ScimGroupMapping): MappingDraft {
  return {
    externalGroupId: mapping.externalGroupId,
    displayName: mapping.externalGroupNameSnapshot ?? "",
    scopeId: mapping.scopeId,
    roleId: mapping.roleId,
    enabled: mapping.enabled,
  };
}

const textEncoder = new TextEncoder();
// biome-ignore lint/suspicious/noControlCharactersInRegex: the API rejects control characters.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
export function isValidExternalGroupId(value: string): boolean {
  const bytes = textEncoder.encode(value).length;
  return value.length > 0 && bytes <= 255 && !CONTROL_CHARACTERS.test(value);
}

export function isValidDisplaySnapshot(value: string): boolean {
  return (
    value === "" ||
    (textEncoder.encode(value).length <= 255 && !CONTROL_CHARACTERS.test(value))
  );
}

/**
 * Create sends the full definition. Customer mappings omit `scopeId` (resolved from the persisted
 * connection). Update sends only changed mutable properties; null when nothing changed, which the
 * API would reject as a 422 no-op without advancing the version.
 */
export function buildMappingRequest(input: {
  version: number;
  existing: ScimGroupMapping | null;
  draft: MappingDraft;
  customer: boolean;
}): ScimAdminRequest | null {
  const { version, existing, draft, customer } = input;
  const snapshot = draft.displayName.trim() || null;
  if (!existing) {
    return {
      configVersion: version,
      kind: "mapping_create",
      externalGroupId: draft.externalGroupId,
      externalGroupNameSnapshot: snapshot,
      roleId: draft.roleId,
      scope: customer ? "organisation" : "workspace",
      ...(customer ? {} : { scopeId: draft.scopeId }),
      enabled: draft.enabled,
    };
  }
  const request: Extract<ScimAdminRequest, { kind: "mapping_update" }> = {
    configVersion: version,
    kind: "mapping_update",
    mappingId: existing.id,
  };
  if (snapshot !== existing.externalGroupNameSnapshot)
    request.externalGroupNameSnapshot = snapshot;
  if (draft.roleId !== existing.roleId) request.roleId = draft.roleId;
  if (!customer && draft.scopeId !== existing.scopeId)
    request.scopeId = draft.scopeId;
  if (draft.enabled !== existing.enabled) request.enabled = draft.enabled;
  return Object.keys(request).length === 3 ? null : request;
}
