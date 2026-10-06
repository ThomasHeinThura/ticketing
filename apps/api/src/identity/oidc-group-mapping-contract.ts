import { z } from "../openapi";

export const oidcGroupMappingCreateRequestSchema = z
  .object({
    configVersion: z.number().int().positive().safe(),
    externalGroupId: z
      .string()
      .regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u),
    externalGroupNameSnapshot: z.string().max(255).nullable().default(null),
    roleId: z.string().min(1).max(128),
    scope: z.enum(["organisation", "workspace"]),
    scopeId: z.string().min(1).max(128).optional(),
    enabled: z.boolean().default(true),
  })
  .strict();

export const oidcGroupMappingUpdateRequestSchema = z
  .object({
    configVersion: z.number().int().positive().safe(),
    externalGroupNameSnapshot: z.string().max(255).nullable().optional(),
    roleId: z.string().min(1).max(128).optional(),
    scopeId: z.string().min(1).max(128).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.externalGroupNameSnapshot !== undefined ||
      request.roleId !== undefined ||
      request.scopeId !== undefined ||
      request.enabled !== undefined,
    "At least one mutable property is required",
  );

export type OidcGroupMappingCreateRequest = z.infer<
  typeof oidcGroupMappingCreateRequestSchema
>;
export type OidcGroupMappingUpdateRequest = z.infer<
  typeof oidcGroupMappingUpdateRequestSchema
>;

export const OIDC_GROUP_MAPPING_CREATE_OPERATION =
  "oidc_group_mapping_create" as const;
export const OIDC_GROUP_MAPPING_UPDATE_OPERATION =
  "oidc_group_mapping_update" as const;
export const OIDC_GROUP_MAPPING_CREATE_ROUTE =
  "POST /api/instance/identity-connections/{id}/oidc-group-mappings" as const;
export const OIDC_GROUP_MAPPING_UPDATE_ROUTE =
  "PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}" as const;

export function canonicalOidcGroupMappingBody(input: {
  operation:
    | typeof OIDC_GROUP_MAPPING_CREATE_OPERATION
    | typeof OIDC_GROUP_MAPPING_UPDATE_OPERATION;
  connectionId: string;
  mappingId?: string;
  request: OidcGroupMappingCreateRequest | OidcGroupMappingUpdateRequest;
}): Buffer {
  const routeKey =
    input.operation === OIDC_GROUP_MAPPING_CREATE_OPERATION
      ? OIDC_GROUP_MAPPING_CREATE_ROUTE
      : OIDC_GROUP_MAPPING_UPDATE_ROUTE;
  return Buffer.from(
    JSON.stringify({
      routeKey,
      connectionId: input.connectionId,
      ...(input.operation === OIDC_GROUP_MAPPING_UPDATE_OPERATION
        ? { mappingId: input.mappingId }
        : {}),
      request: input.request,
    }),
    "utf8",
  );
}
