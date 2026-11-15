import { createRoute, jsonResponse, z } from "../openapi";
import { requireSessionOnly } from "../utils/require-session-only";

const mappingOptionsLimit = z.coerce.number().int().min(1).max(100).default(50);
const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
});
const mappingOptionsQuery = z
  .object({
    workspaceId: z.string().min(1).max(128).optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: mappingOptionsLimit,
  })
  .strict();
export const scimMappingOptionsRoute = createRoute({
  method: "get",
  operationId: "getScimMappingOptions",
  path: "/identity-connections/{id}/scim/mapping-options",
  tags: ["Instance"],
  summary: "List eligible SCIM group mapping targets and roles",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: z.object({ id: z.string().min(1) }),
    query: mappingOptionsQuery,
  },
  responses: {
    200: jsonResponse(
      "Eligible targets or roles for a SCIM group mapping",
      z.union([
        z.object({
          kind: z.literal("agent_targets"),
          data: z.array(z.object({ id: z.string(), name: z.string() })),
          nextCursor: z.string().nullable(),
        }),
        z.object({
          kind: z.literal("agent_roles"),
          target: z.object({ id: z.string(), name: z.string() }),
          data: z.array(
            z.object({ id: z.string(), name: z.string(), rank: z.number() }),
          ),
          nextCursor: z.string().nullable(),
        }),
        z.object({
          kind: z.literal("customer"),
          target: z.object({ id: z.string(), name: z.string() }).nullable(),
          role: z
            .object({ id: z.string(), name: z.string(), rank: z.number() })
            .nullable(),
          nextCursor: z.null(),
        }),
      ]),
    ),
    400: jsonResponse("Invalid selector query or cursor", problemSchema),
    403: jsonResponse("Forbidden", problemSchema),
    404: jsonResponse("Connection unavailable", problemSchema),
  },
});

export const oidcMappingOptionsRoute = createRoute({
  ...scimMappingOptionsRoute,
  operationId: "getOidcGroupMappingOptions",
  path: "/identity-connections/{id}/oidc-group-mappings/mapping-options",
  summary: "List eligible OIDC group mapping targets and roles",
});
