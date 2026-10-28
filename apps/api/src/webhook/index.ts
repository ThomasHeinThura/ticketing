import { can } from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { clientIpForContext } from "../api-key/enforce";
import type { ExtInput } from "../auth/step-up-ext";
import { runWithStepUp } from "../auth/step-up-spend";
import db from "../database";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import {
  registeredDeletionRequestSchema,
  requestRegisteredDeletion,
} from "../pending-action/deletion-targets";
import { callerReach } from "../utils/caller-reach";
import { resolveCallerIdentity } from "../utils/has-project-reach";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { WEBHOOK_DELETION_ROUTE } from "./deletion-target";
import { deliverWebhookNow } from "./delivery";
import { ownerReceivesEverything, receivesEverything } from "./reach";
import {
  createWebhook,
  enqueueRedelivery,
  enqueueTestDelivery,
  findDeliveryWorkspace,
  findWebhookWorkspace,
  getDelivery,
  getWebhook,
  listDeliveries,
  listWebhooks,
  rotateWebhookSecret,
  updateWebhook,
  type WebhookActor,
  type WebhookDeliveryRow,
  type WebhookRow,
  WebhookVersionConflictError,
} from "./repository";
import {
  webhookDeliveryListSchema,
  webhookDeliverySchema,
  webhookListSchema,
  webhookSchema,
  webhookVersionConflictSchema,
} from "./response";
import { assertWebhookDestination, WebhookDestinationError } from "./safe-http";
import {
  createWebhookBody,
  deliveriesQuery,
  deliveryIdParam,
  rotateSecretBody,
  updateWebhookBody,
  webhookIdParam,
  workspaceHeader,
} from "./schema";
import { previousSecretStillValid } from "./signature";
import { workspaceFromHeader } from "./workspace-header";

function instanceUrl(): string {
  return (process.env.TASKDESK_AGENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
}

async function webhookRowReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing webhook id" });
  rejectNulByte(id, "Webhook id");
  const row = await findWebhookWorkspace(id);
  if (!row) throw new HTTPException(404, { message: "Webhook not found" });
  await maskedWorkspaceAccess(c, row.workspaceId, "Webhook not found");
  await next();
}

async function deliveryRowReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing delivery id" });
  rejectNulByte(id, "Delivery id");
  const row = await findDeliveryWorkspace(id);
  if (!row) throw new HTTPException(404, { message: "Delivery not found" });
  await maskedWorkspaceAccess(c, row.workspaceId, "Delivery not found");
  await next();
}

/** An out-of-reach row answers exactly like a missing one (reach is a 404, never a 403). */
async function maskedWorkspaceAccess(
  c: Context,
  workspaceId: string,
  notFound: string,
) {
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: notFound });
    throw error;
  }
  c.set("workspaceId", workspaceId);
  c.set("workspaceIdSource", "row");
}

async function callerIdentity(c: Context) {
  const identity = await resolveCallerIdentity(c, c.get("userId"));
  if (identity?.side !== "staff")
    throw new HTTPException(403, { message: "Insufficient permissions" });
  return identity;
}

async function callerActor(c: Context): Promise<WebhookActor> {
  const identity = await callerIdentity(c);
  const apiKey = c.get("apiKey");
  return {
    userId: c.get("userId"),
    personId: identity.personId,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
    actorIp: clientIpForContext(c),
    userAgent: c.req.header("user-agent") ?? null,
  };
}

const stepUpHeader = z.string().length(43).optional();

/**
 * WH-15: creating a webhook, changing its destination, and rotating its secret each spend a
 * one-use, operation-bound step-up proof (PA-15). The proof binds the server-resolved workspace
 * and webhook ids and the destination, so a token minted for anything else fails the hash
 * comparison. It is spent inside the write's own transaction (`runWithStepUp`), after every
 * other check, so a refusal, a stale version or a failed write never burns it.
 */
type WebhookStepUp = Extract<
  ExtInput,
  {
    operation:
      | "webhook_create"
      | "webhook_update_url"
      | "webhook_rotate_secret";
  }
>;

async function assertDestination(url: string) {
  try {
    await assertWebhookDestination(url);
  } catch (error) {
    if (error instanceof WebhookDestinationError)
      throw new HTTPException(400, { message: `url: ${error.message}` });
    throw error;
  }
}

function health(
  row: WebhookRow,
  last: { state: string } | null,
): z.infer<typeof webhookSchema>["health"] {
  if (!row.active) return row.disabledAt ? "paused" : "inactive";
  if (row.failingSince) return "failing";
  return last ? "healthy" : "untested";
}

function toWebhookResponse(
  row: WebhookRow,
  ownerName: string | null,
  last: {
    state: string;
    statusCode: number | null;
    attemptedAt: Date | null;
  } | null,
) {
  return webhookSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    url: row.url,
    events: row.events,
    active: row.active,
    disabledAt: row.disabledAt,
    disabledReason: row.disabledReason,
    failingSince: row.failingSince,
    lastError: row.lastError,
    secretRotatedAt: row.secretRotatedAt,
    previousSecretActive:
      row.secretPrevious !== null &&
      previousSecretStillValid(row.secretRotatedAt, new Date()),
    ownerPersonId: row.createdBy,
    ownerName,
    health: health(row, last),
    lastDeliveryState: last?.state ?? null,
    lastDeliveryStatusCode: last?.statusCode ?? null,
    lastDeliveryAt: last?.attemptedAt ?? null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

const baseMiddleware = [
  requireApiKeyPermissionScope({ webhook: ["manage"] }),
  requireWorkspaceCapability("webhook:manage"),
] as const;

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listWebhooks",
  tags: ["Webhooks"],
  summary: "List workspace webhooks",
  middleware: [workspaceFromHeader, ...baseMiddleware] as const,
  request: { headers: workspaceHeader },
  responses: {
    200: jsonResponse("Webhooks of the workspace", webhookListSchema),
    400: errorResponse("Missing X-Workspace-Id"),
    403: errorResponse("Missing webhook:manage permission"),
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/",
  operationId: "createWebhook",
  tags: ["Webhooks"],
  summary: "Create a webhook",
  description:
    "Session-only. The signing secret is write-only: supply it here, it is never returned.",
  middleware: [
    requireSessionOnly(),
    workspaceFromHeader,
    ...baseMiddleware,
  ] as const,
  request: {
    headers: workspaceHeader.extend({
      "x-taskdesk-step-up-token": stepUpHeader,
    }),
    body: {
      required: true,
      content: { "application/json": { schema: createWebhookBody } },
    },
  },
  responses: {
    201: jsonResponse("Created webhook", webhookSchema),
    400: errorResponse("Invalid webhook or destination"),
    403: errorResponse("Missing permission, or session required"),
    429: errorResponse("Webhook quota exceeded"),
  },
});

const updateRouteDef = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "updateWebhook",
  tags: ["Webhooks"],
  summary: "Update a webhook",
  middleware: [
    requireSessionOnly(),
    webhookRowReach,
    ...baseMiddleware,
  ] as const,
  request: {
    params: webhookIdParam,
    headers: z.object({ "x-taskdesk-step-up-token": stepUpHeader }),
    body: {
      required: true,
      content: { "application/json": { schema: updateWebhookBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated webhook", webhookSchema),
    400: errorResponse("Invalid webhook or destination"),
    403: errorResponse(
      "Missing permission, session required, a destination change by someone other than the owner, or a re-own of an active webhook by a non-administrator",
    ),
    404: errorResponse("Webhook not found"),
    409: jsonResponse(
      "Version conflict, or the owner changed concurrently",
      webhookVersionConflictSchema,
    ),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  operationId: "requestWebhookDeletion",
  tags: ["Webhooks"],
  summary: "Request deletion of a webhook",
  description:
    "Session-only. Opens a pending action (typed exact name + step-up, AK-11); nothing is deleted until the requester approves it in the browser.",
  middleware: [
    requireSessionOnly(),
    webhookRowReach,
    ...baseMiddleware,
  ] as const,
  request: { params: webhookIdParam },
  responses: {
    202: jsonResponse("Pending deletion", registeredDeletionRequestSchema),
    403: errorResponse("Missing permission, or session required"),
    404: errorResponse("Webhook not found"),
    409: errorResponse("A deletion of this webhook is already pending"),
  },
});

const testRoute = createRoute({
  method: "post",
  path: "/{id}/test",
  operationId: "sendWebhookTestEvent",
  tags: ["Webhooks"],
  summary: "Send a test event",
  middleware: [webhookRowReach, ...baseMiddleware] as const,
  request: { params: webhookIdParam },
  responses: {
    200: jsonResponse(
      "The test delivery and its outcome",
      webhookDeliverySchema,
    ),
    403: errorResponse("Missing webhook:manage permission"),
    404: errorResponse("Webhook not found"),
    409: errorResponse("Webhook is paused"),
  },
});

const rotateRoute = createRoute({
  method: "post",
  path: "/{id}/rotate-secret",
  operationId: "rotateWebhookSecret",
  tags: ["Webhooks"],
  summary: "Rotate the signing secret",
  description:
    "Session-only. The previous secret keeps signing for 24 hours (WH-13). Neither secret is returned.",
  middleware: [
    requireSessionOnly(),
    webhookRowReach,
    ...baseMiddleware,
  ] as const,
  request: {
    params: webhookIdParam,
    headers: z.object({ "x-taskdesk-step-up-token": stepUpHeader }),
    body: {
      required: true,
      content: { "application/json": { schema: rotateSecretBody } },
    },
  },
  responses: {
    200: jsonResponse("Webhook with its rotation time", webhookSchema),
    403: errorResponse("Missing permission, or session required"),
    404: errorResponse("Webhook not found"),
  },
});

const deliveriesRoute = createRoute({
  method: "get",
  path: "/{id}/deliveries",
  operationId: "listWebhookDeliveries",
  tags: ["Webhooks"],
  summary: "Delivery history",
  middleware: [webhookRowReach, ...baseMiddleware] as const,
  request: { params: webhookIdParam, query: deliveriesQuery },
  responses: {
    200: jsonResponse("Deliveries, newest first", webhookDeliveryListSchema),
    403: errorResponse("Missing webhook:manage permission"),
    404: errorResponse("Webhook not found"),
  },
});

const redeliverRoute = createRoute({
  method: "post",
  path: "/deliveries/{id}/redeliver",
  operationId: "redeliverWebhookDelivery",
  tags: ["Webhooks"],
  summary: "Redeliver a delivery",
  middleware: [deliveryRowReach, ...baseMiddleware] as const,
  request: { params: deliveryIdParam },
  responses: {
    200: jsonResponse(
      "The new delivery and its outcome",
      webhookDeliverySchema,
    ),
    403: errorResponse("Missing webhook:manage permission"),
    404: errorResponse("Delivery not found"),
    409: errorResponse(
      "Delivery has no recorded payload, webhook is paused, or the destination or owner changed after the delivery was created",
    ),
  },
});

/** WH-6: a body is shown only when its entity is in the reader's reach. */
async function toDeliveryResponses(
  c: Context,
  rows: WebhookDeliveryRow[],
  workspaceId: string,
) {
  const reach = await callerReach(c, c.get("userId"));
  const identity = await callerIdentity(c);
  const everything = receivesEverything(identity, workspaceId);
  const projectVisible = new Map<string, boolean>();
  const out = [];
  for (const row of rows) {
    let visible = true;
    if (row.source !== "test") {
      if (row.projectId) {
        let known = projectVisible.get(row.projectId);
        if (known === undefined) {
          known = await reach.reaches({
            projectId: row.projectId,
            workspaceId,
          });
          projectVisible.set(row.projectId, known);
        }
        visible = known;
      } else {
        visible = everything;
      }
    }
    out.push(
      webhookDeliverySchema.parse({
        id: row.id,
        webhookId: row.webhookId,
        eventId: row.eventId,
        eventKind: row.eventKind,
        source: row.source,
        redeliveryOf: row.redeliveryOf,
        attempt: row.attempt,
        state: row.state,
        nextAttemptAt: row.state === "pending" ? row.nextAttemptAt : null,
        statusCode: row.statusCode,
        durationMs: row.durationMs,
        error: row.error,
        attemptedAt: row.attemptedAt,
        createdAt: row.createdAt,
        requestBody: visible ? (row.requestBody ?? null) : null,
        responseBody: visible ? row.responseBody : null,
        bodyRedacted: !visible && row.requestBody !== null,
      }),
    );
  }
  return out;
}

const router = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) => {
    const rows = await listWebhooks(c.get("workspaceId"));
    return c.json(
      webhookListSchema.parse({
        data: rows.map(({ row, ownerName, last }) =>
          toWebhookResponse(row, ownerName, last),
        ),
        meta: { total: rows.length },
      }),
      200,
    );
  })
  .openapi(createRouteDef, async (c) => {
    const body = c.req.valid("json");
    await assertDestination(body.url);
    const actor = await callerActor(c);
    const identity = await callerIdentity(c);
    // WH-15: a webhook whose owner receives everything is a whole-workspace data channel.
    if (
      receivesEverything(identity, c.get("workspaceId")) &&
      !can(identity, "instance:admin", "instance", { instance: true })
    ) {
      throw new HTTPException(403, {
        message: "webhook_owner_requires_instance_admin",
      });
    }
    const stepUp: WebhookStepUp = {
      operation: "webhook_create",
      workspaceId: c.get("workspaceId"),
      name: body.name,
      url: body.url,
      events: body.events,
    };
    const row = await runWithStepUp(c, stepUp, (spend) =>
      createWebhook({
        workspaceId: c.get("workspaceId"),
        actor,
        name: body.name,
        url: body.url,
        secret: body.secret,
        events: body.events,
        spend,
      }),
    );
    return c.json(toWebhookResponse(row, null, null), 201);
  })
  .openapi(updateRouteDef, async (c) => {
    const id = c.req.valid("param").id;
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const existing = await getWebhook(id, workspaceId);
    if (!existing)
      throw new HTTPException(404, { message: "Webhook not found" });
    const urlChanging = body.url !== undefined && body.url !== existing.url;
    if (urlChanging) await assertDestination(body.url as string);
    const actor = await callerActor(c);
    const identity = await callerIdentity(c);
    const isAdmin = can(identity, "instance:admin", "instance", {
      instance: true,
    });
    const isOwner = identity.personId === existing.createdBy;
    if (body.reown) {
      // WH-14: a re-own is for a webhook paused because its owner left. Taking over an active
      // webhook someone else owns is an instance-admin action.
      if (existing.disabledReason !== "owner_left" && !isAdmin) {
        throw new HTTPException(403, {
          message: "webhook_reown_requires_owner_left",
        });
      }
      if (receivesEverything(identity, workspaceId) && !isAdmin) {
        throw new HTTPException(403, {
          message: "webhook_owner_requires_instance_admin",
        });
      }
    } else if (urlChanging) {
      // P4R1-H1: the destination of a webhook is the owner's to change (delivery is reach-checked
      // against the owner). Anyone else must re-own first (step-up, reach rules). The one
      // exception is an instance admin for a webhook whose owner receives everything, where the
      // reach is the same either way. An owner who receives everything needs instance:admin too
      // (WH-15).
      const allowed = isOwner
        ? !receivesEverything(identity, workspaceId) || isAdmin
        : isAdmin &&
          (await ownerReceivesEverything(db, existing.createdBy, workspaceId));
      if (!allowed) {
        throw new HTTPException(403, {
          message: isOwner
            ? "webhook_owner_requires_instance_admin"
            : "webhook_url_requires_owner",
        });
      }
    }
    const patch = {
      name: body.name,
      url: body.url,
      events: body.events,
      active: body.active,
      reown: body.reown,
      expectedOwner: existing.createdBy,
      expectedVersion: body.version,
    };
    let row: WebhookRow | undefined;
    try {
      // A re-own is elevated like a destination change (P4R1-L1): the proof binds the resulting
      // destination, so a re-own that keeps the url binds the current one.
      row =
        urlChanging || body.reown
          ? await runWithStepUp(
              c,
              {
                operation: "webhook_update_url",
                workspaceId,
                webhookId: id,
                url: body.url ?? existing.url,
              } satisfies WebhookStepUp,
              (spend) => updateWebhook(id, workspaceId, patch, actor, spend),
            )
          : await updateWebhook(id, workspaceId, patch, actor);
    } catch (error) {
      if (error instanceof WebhookVersionConflictError)
        return c.json(
          { message: error.message, currentVersion: error.currentVersion },
          409,
        );
      throw error;
    }
    if (!row) throw new HTTPException(404, { message: "Webhook not found" });
    return c.json(toWebhookResponse(row, null, null), 200);
  })
  .openapi(deleteRoute, async (c) => {
    const id = c.req.valid("param").id;
    const pending = await requestRegisteredDeletion(c, {
      routeKey: WEBHOOK_DELETION_ROUTE,
      targetType: "webhook",
      id,
      workspaceId: c.get("workspaceId"),
    });
    return c.json(pending, 202);
  })
  .openapi(testRoute, async (c) => {
    const id = c.req.valid("param").id;
    const workspaceId = c.get("workspaceId");
    const webhook = await getWebhook(id, workspaceId);
    if (!webhook)
      throw new HTTPException(404, { message: "Webhook not found" });
    if (!webhook.active)
      throw new HTTPException(409, { message: "webhook_paused" });
    const actor = await callerActor(c);
    const delivery = await enqueueTestDelivery({
      webhook,
      instance: instanceUrl(),
      actorName: c.get("user")?.name ?? "TaskDesk",
      actorPersonId: actor.personId,
    });
    await deliverWebhookNow(delivery.id);
    const finished = await getDelivery(delivery.id);
    const [response] = await toDeliveryResponses(
      c,
      [finished ?? delivery],
      workspaceId,
    );
    return c.json(response as z.infer<typeof webhookDeliverySchema>, 200);
  })
  .openapi(rotateRoute, async (c) => {
    const id = c.req.valid("param").id;
    const actor = await callerActor(c);
    const row = await runWithStepUp(
      c,
      {
        operation: "webhook_rotate_secret",
        workspaceId: c.get("workspaceId"),
        webhookId: id,
      } satisfies WebhookStepUp,
      (spend) =>
        rotateWebhookSecret(
          id,
          c.get("workspaceId"),
          c.req.valid("json").secret,
          actor,
          spend,
        ),
    );
    if (!row) throw new HTTPException(404, { message: "Webhook not found" });
    return c.json(toWebhookResponse(row, null, null), 200);
  })
  .openapi(deliveriesRoute, async (c) => {
    const id = c.req.valid("param").id;
    const query = c.req.valid("query");
    const rows = await listDeliveries(id, {
      limit: query.limit,
      before: query.before ? new Date(query.before) : undefined,
    });
    const page = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const data = await toDeliveryResponses(c, page, c.get("workspaceId"));
    return c.json(
      {
        data,
        page: {
          hasMore,
          nextBefore: hasMore
            ? (page[page.length - 1]?.createdAt.toISOString() ?? null)
            : null,
        },
      },
      200,
    );
  })
  .openapi(redeliverRoute, async (c) => {
    const original = await getDelivery(c.req.valid("param").id);
    if (!original || original.workspaceId !== c.get("workspaceId"))
      throw new HTTPException(404, { message: "Delivery not found" });
    const webhook = await getWebhook(original.webhookId, original.workspaceId);
    if (!webhook)
      throw new HTTPException(404, { message: "Delivery not found" });
    if (!webhook.active)
      throw new HTTPException(409, { message: "webhook_paused" });
    // P4R1-H1: a delivery created before the destination or owner changed was addressed to the
    // previous one; it is never replayed to the new destination.
    if (
      webhook.destinationChangedAt &&
      original.createdAt < webhook.destinationChangedAt
    )
      throw new HTTPException(409, { message: "webhook_destination_changed" });
    const queued = await enqueueRedelivery(original);
    await deliverWebhookNow(queued.id);
    const finished = await getDelivery(queued.id);
    const [response] = await toDeliveryResponses(
      c,
      [finished ?? queued],
      original.workspaceId,
    );
    return c.json(response as z.infer<typeof webhookDeliverySchema>, 200);
  });

export default router;
