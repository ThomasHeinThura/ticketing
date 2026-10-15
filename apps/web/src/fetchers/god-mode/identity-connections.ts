import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { ensureIdentityAdminOk } from "./identity-admin-error";

// The generated Hono client cannot address these routes: the identity routers are mounted as a
// union and the collection node loses its method types. These DTOs mirror the accepted API
// schemas in apps/api/src/identity/{connection-contract,connection-admin,scim-admin}.ts and are
// exercised against the same shapes by the mock-API e2e fixtures.

export type IdentityJitPolicy = {
  enabled: boolean;
  default_role_id: string | null;
  required_entra_app_role: string;
};

export type IdentityConnection = {
  id: string;
  providerType: "entra";
  portalScope: "agent" | "customer";
  organisationId: string | null;
  defaultWorkspaceId: string | null;
  displayName: string;
  issuer: string;
  tenantId: string | null;
  clientId: string;
  clientSecretConfigured: boolean;
  redirectUri: string;
  scopes: string[];
  claimMapping: { version: 1; displayName: "name" } | null;
  claimMappingState: "default" | "valid" | "invalid";
  domainBindings: string[];
  jitPolicy: IdentityJitPolicy;
  maxRoleRank: number | null;
  mfaUpstreamMode: "claim" | "static" | "off";
  enabled: boolean;
  configVersion: number;
  healthState: "unknown" | "healthy" | "degraded" | "invalid";
  healthCheckedAt: string | null;
};

export type IdentityConnectionCreateBody = {
  portalScope: "agent" | "customer";
  organisationId: string | null;
  defaultWorkspaceId: string | null;
  displayName: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  claimMapping?: { version: 1; displayName: "name" } | null;
  domainBindings: string[];
  jitPolicy: IdentityJitPolicy;
  maxRoleRank: number | null;
};

/** `{configVersion}` plus at least one of the optional fields; omitted fields keep their stored value. */
export type IdentityConnectionConfigureBody = {
  configVersion: number;
  displayName?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  claimMapping?: { version: 1; displayName: "name" } | null;
  domainBindings?: string[];
  defaultWorkspaceId?: string | null;
  jitPolicy?: IdentityJitPolicy;
  maxRoleRank?: number | null;
  enabled?: boolean;
};

export const IDENTITY_EVENT_KINDS = [
  "user.created",
  "user.updated",
  "user.deactivated",
  "user.reactivated",
  "group.directory_changed",
  "group.mapping_changed",
  "group.member_added",
  "group.member_removed",
  "request.denied",
  "auth.failed",
  "token.rotated",
  "token.revoked",
  "connection.changed",
  "sync.failed",
] as const;

export type IdentityConnectionEventPage = {
  data: {
    kind: (typeof IDENTITY_EVENT_KINDS)[number];
    outcome: string;
    actorType: "person" | "scim" | "oidc";
    createdAt: string;
  }[];
  page: { nextCursor: string | null; hasMore: boolean };
};

export const SCIM_MATCH_ATTRIBUTES = [
  "externalId",
  "userName",
  "displayName",
  "name.formatted",
  "title",
  "preferredLanguage",
] as const;
export type ScimMatchAttribute = (typeof SCIM_MATCH_ATTRIBUTES)[number];

export type ScimProfileMapping = {
  version: 1;
  name: "displayName" | "name.formatted";
  email: "emails.primary.value" | "userName";
  jobTitle: "title" | "unmapped";
  locale: "preferredLanguage" | "locale" | "unmapped";
};

export type ScimGroupMapping = {
  id: string;
  externalGroupId: string;
  externalGroupNameSnapshot: string | null;
  roleId: string;
  scope: "organisation" | "workspace";
  scopeId: string;
  enabled: boolean;
};

export type ScimAdminSettings = {
  data: {
    enabled: boolean;
    allowedResources: ("users" | "groups")[];
    lifecyclePolicy: "end_memberships" | "keep_memberships";
    matchAttributes: ScimMatchAttribute[];
    attributeMapping: ScimProfileMapping;
    mappings: ScimGroupMapping[];
  };
  configVersion: number;
};

/** The four closed PATCH variants of `PATCH /instance/identity-connections/{id}/scim`. */
export type ScimAdminRequest =
  | {
      configVersion: number;
      kind: "settings";
      enabled?: boolean;
      allowedResources?: ("users" | "groups")[];
      lifecyclePolicy?: "end_memberships" | "keep_memberships";
      matchAttributes?: ScimMatchAttribute[];
    }
  | {
      configVersion: number;
      kind: "mapping_create";
      externalGroupId: string;
      externalGroupNameSnapshot?: string | null;
      roleId: string;
      scope: "organisation" | "workspace";
      scopeId?: string;
      enabled?: boolean;
    }
  | {
      configVersion: number;
      kind: "mapping_update";
      mappingId: string;
      externalGroupNameSnapshot?: string | null;
      roleId?: string;
      scopeId?: string;
      enabled?: boolean;
    }
  | {
      configVersion: number;
      kind: "attribute_mapping";
      attributeMapping: ScimProfileMapping;
    };

type MappingTarget = { id: string; name: string };
type MappingRole = { id: string; name: string; rank: number };
export type ScimMappingOptions =
  | {
      kind: "agent_targets";
      data: MappingTarget[];
      nextCursor: string | null;
    }
  | {
      kind: "agent_roles";
      target: MappingTarget;
      data: MappingRole[];
      nextCursor: string | null;
    }
  | {
      kind: "customer";
      target: MappingTarget | null;
      role: MappingRole | null;
      nextCursor: null;
    };

const connectionsPath = "instance/identity-connections";
const itemPath = (id: string) => `${connectionsPath}/${encodeURIComponent(id)}`;

async function request<T>(
  path: string,
  failure: string,
  init?: { method: "POST" | "PATCH"; token: string; body: unknown },
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    credentials: "include",
    cache: "no-store",
    ...(init
      ? {
          method: init.method,
          headers: {
            "content-type": "application/json",
            "x-taskdesk-step-up-token": init.token,
          },
          body: JSON.stringify(init.body),
        }
      : {}),
  });
  await ensureIdentityAdminOk(response, failure);
  return (await response.json()) as T;
}

export async function getIdentityConnections(): Promise<IdentityConnection[]> {
  const body = await request<{ data: IdentityConnection[] }>(
    connectionsPath,
    "Unable to load identity connections",
  );
  return body.data;
}

export function getIdentityConnectionEvents(
  id: string,
  cursor: string | undefined,
): Promise<IdentityConnectionEventPage> {
  const query = new URLSearchParams({ limit: "25" });
  if (cursor) query.set("cursor", cursor);
  return request(
    `${itemPath(id)}/events?${query}`,
    "Unable to load provisioning history",
  );
}

export function getScimAdminSettings(id: string): Promise<ScimAdminSettings> {
  return request(`${itemPath(id)}/scim`, "Unable to load SCIM settings");
}

export function getScimMappingOptions(
  id: string,
  workspaceId?: string,
  cursor?: string,
): Promise<ScimMappingOptions> {
  const query = new URLSearchParams({ limit: "100" });
  if (workspaceId) query.set("workspaceId", workspaceId);
  if (cursor) query.set("cursor", cursor);
  return request(
    `${itemPath(id)}/scim/mapping-options?${query}`,
    "Unable to load mapping options",
  );
}

export async function createIdentityConnection(input: {
  body: IdentityConnectionCreateBody;
  token: string;
}): Promise<IdentityConnection> {
  const result = await request<{ data: IdentityConnection }>(
    connectionsPath,
    "Unable to create the connection",
    { method: "POST", token: input.token, body: input.body },
  );
  return result.data;
}

export async function configureIdentityConnection(input: {
  id: string;
  body: IdentityConnectionConfigureBody;
  token: string;
}): Promise<IdentityConnection> {
  const result = await request<{ data: IdentityConnection }>(
    itemPath(input.id),
    "Unable to save the connection",
    { method: "PATCH", token: input.token, body: input.body },
  );
  return result.data;
}

export function patchScimAdmin(input: {
  id: string;
  body: ScimAdminRequest;
  token: string;
}): Promise<ScimAdminSettings> {
  return request(`${itemPath(input.id)}/scim`, "Unable to save SCIM settings", {
    method: "PATCH",
    token: input.token,
    body: input.body,
  });
}

export function rotateScimBearer(input: {
  id: string;
  version: number;
  token: string;
}): Promise<{ configVersion: number; token: string; tokenRotatedAt: string }> {
  return request(
    `${itemPath(input.id)}/scim/rotate-token`,
    "Unable to rotate the SCIM token",
    { method: "POST", token: input.token, body: { version: input.version } },
  );
}

export function revokeScimBearer(input: {
  id: string;
  version: number;
  token: string;
}): Promise<{ configVersion: number; revoked: true }> {
  return request(
    `${itemPath(input.id)}/scim/revoke-token`,
    "Unable to revoke the SCIM token",
    { method: "POST", token: input.token, body: { version: input.version } },
  );
}
