import { eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { clientIpForContext } from "../api-key/enforce";
import { portalForHost } from "../auth";
import { WEBHOOK_ROTATE_ALL_OPERATION } from "../auth/step-up-ext";
import { runWithStepUp, stepUpTokenHeader } from "../auth/step-up-spend";
import db, { schema } from "../database";
import { webhookTable } from "../database/schema";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { resolveCallerIdentity } from "../utils/has-project-reach";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  rotateAllWebhookSecrets,
  type WebhookActor,
  WebhookRotationSetConflictError,
} from "./repository";
import {
  rotateAllWebhookSecretsBody,
  webhookSecretRotationSetDigest,
} from "./rotate-all";

export { webhookRotateAllPolicies } from "./rotate-all-policy";

const securityPostureQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(128).optional(),
});

const targetSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  version: z.number().int().min(1),
});

const targetPageSchema = z.object({
  data: z.array(targetSchema),
  page: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
});

const rotationResultSchema = z.object({
  rotatedAt: z.string().datetime(),
  rotatedCount: z.number().int().min(1),
});

const queryRoute = createRoute({
  method: "get",
  operationId: "listWebhookRotationTargets",
  path: "/instance/webhooks/rotation-targets",
  tags: ["Instance"],
  summary: "List all current webhook rotation targets",
  description:
    "Current instance administrators can list bounded, secret-free metadata for every current webhook before incident rotation.",
  middleware: [requireSessionOnly()] as const,
  request: { query: securityPostureQuery },
  responses: {
    200: jsonResponse("Current webhook rotation targets", targetPageSchema),
    403: errorResponse("Forbidden"),
  },
});

const rotateRoute = createRoute({
  method: "post",
  operationId: "rotateAllWebhookSecrets",
  path: "/instance/webhooks/rotate-secrets",
  tags: ["Instance"],
  summary: "Rotate all current webhook signing secrets",
  description:
    "Session-only incident action. Requires a distinct operator-supplied replacement for every current webhook, a current-set/version match, and fresh step-up. Neither old nor new secrets are returned or audited.",
  middleware: [requireSessionOnly()] as const,
  request: {
    headers: stepUpTokenHeader,
    body: {
      required: true,
      content: { "application/json": { schema: rotateAllWebhookSecretsBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "All current webhook secrets rotated",
      rotationResultSchema,
    ),
    403: errorResponse("Forbidden or step-up unavailable"),
    409: errorResponse("The webhook set changed; reload targets and try again"),
  },
});

export async function listWebhookRotationTargets(input: {
  limit: number;
  cursor?: string | undefined;
}) {
  const rows = await db
    .select({
      id: webhookTable.id,
      name: webhookTable.name,
      workspaceId: webhookTable.workspaceId,
      workspaceName: schema.workspaceTable.name,
      version: webhookTable.version,
    })
    .from(webhookTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, webhookTable.workspaceId),
    )
    .where(input.cursor ? gt(webhookTable.id, input.cursor) : undefined)
    .orderBy(webhookTable.id)
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const data = hasMore ? rows.slice(0, input.limit) : rows;
  return targetPageSchema.parse({
    data,
    page: {
      nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null,
      hasMore,
    },
  });
}

async function currentWebhookActor(c: Context): Promise<WebhookActor> {
  const userId = c.get("userId");
  const identity = await resolveCallerIdentity(c, userId);
  if (!identity || identity.side !== "staff")
    throw new HTTPException(403, { message: "Forbidden" });
  const apiKey = c.get("apiKey");
  return {
    userId,
    personId: identity.personId,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
    actorIp: clientIpForContext(c),
    userAgent: c.req.header("user-agent") ?? null,
  };
}

const webhookRotateAllApi = apiRouter()
  .openapi(queryRoute, async (c) => {
    if (portalForHost(c.req.header("host")) !== "agent")
      throw new HTTPException(403, { message: "Forbidden" });
    await requireCurrentInstanceAdmin(
      c,
      "GET",
      "/api/instance/webhooks/rotation-targets",
    );
    c.header("Cache-Control", "no-store");
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(await listWebhookRotationTargets(c.req.valid("query")), 200);
  })
  .openapi(rotateRoute, async (c) => {
    if (portalForHost(c.req.header("host")) !== "agent")
      throw new HTTPException(403, { message: "Forbidden" });
    await requireCurrentInstanceAdmin(
      c,
      "POST",
      "/api/instance/webhooks/rotate-secrets",
    );
    setShadowLegacyAuthorization(c, "allowed");
    const replacements = c.req.valid("json");
    const replacementSetDigest = webhookSecretRotationSetDigest(replacements);
    const actor = await currentWebhookActor(c);
    try {
      const rotated = await runWithStepUp(
        c,
        { operation: WEBHOOK_ROTATE_ALL_OPERATION, replacementSetDigest },
        (spend) =>
          rotateAllWebhookSecrets({
            replacements,
            actor,
            spend,
          }),
      );
      return c.json(
        {
          rotatedAt: rotated.rotatedAt.toISOString(),
          rotatedCount: rotated.rotatedCount,
        },
        200,
      );
    } catch (error) {
      if (error instanceof WebhookRotationSetConflictError)
        throw new HTTPException(409, {
          message: "webhook_rotation_set_changed",
        });
      throw error;
    }
  });

export default webhookRotateAllApi;
