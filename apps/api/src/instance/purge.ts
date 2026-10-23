import { HTTPException } from "hono/http-exception";
import db from "../database";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { createPendingAction } from "../pending-action/service";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { requireSessionOnly } from "../utils/require-session-only";
import { isCurrentInstanceAdmin } from "./observability/audit-failure-notifier";
import {
  HARD_PURGE_TARGET_TYPES,
  inspectHardPurgeTarget,
} from "./purge-target";
import { getActiveStaffPerson } from "./users/repository";

/**
 * `POST /api/instance/purge` (`PA-13`; `safety-and-runtime.md` pending-actions API:
 * `instance:admin  E`). Requests an exceptional hard purge of one soft-deleted work item or
 * project. The legal-hold and retention checks run **before** the request is accepted; the
 * request then becomes a pending action of kind `purge`, whose server-selected confirmation is
 * `typed_name_step_up` (`pending-action/payload.ts`). Nothing is deleted here: the purge itself
 * runs only when the requester approves in a browser session with a fresh step-up, through
 * `executeHardPurge` (`./purge-target.ts`), which re-checks the hold under a fence.
 *
 * Not mounted yet. Mounting and approval need coordinator-owned wiring: the policy entry, the
 * route registration in `index.ts`, and the pending-action request-scope, approval-contract and
 * executor branches for `action = 'purge'` (see the P0 implementer report).
 */

export const HARD_PURGE_ROUTE_KEY = "POST /api/instance/purge" as const;

const errorSchema = z.object({ message: z.string() });
const requestSchema = z
  .object({
    targetType: z.enum(HARD_PURGE_TARGET_TYPES),
    targetId: z.string().trim().min(1).max(128),
  })
  .strict();

const purgeRoute = createRoute({
  method: "post",
  operationId: "requestInstanceHardPurge",
  path: "/purge",
  tags: ["Instance"],
  summary: "Request a hard purge of soft-deleted data",
  description:
    "Instance administrators only, browser session only. Checks legal hold and retention first, then creates a pending action that requires typed exact name and step-up to approve.",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: requestSchema } },
    },
  },
  responses: {
    202: jsonResponse(
      "Hard purge pending action",
      z.object({
        pendingActionId: z.string(),
        action: z.literal("purge"),
        confirmation: z.literal("typed_name_step_up"),
        summary: z.record(z.string(), z.unknown()),
        expiresAt: z.string().datetime(),
        approveUrl: z.string(),
      }),
    ),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Target not found", errorSchema),
    409: jsonResponse(
      "Refused: legal hold, not soft-deleted, blocked by dependants, or duplicate pending action",
      errorSchema,
    ),
  },
});

type SessionContext = {
  id: string;
  portal?: string;
  impersonatedBy?: string | null;
} | null;

const hardPurge = apiRouter().openapi(purgeRoute, async (c) => {
  c.header("Cache-Control", "no-store");
  const session = c.get("session") as SessionContext;
  if (
    session?.portal !== "agent" ||
    session.impersonatedBy ||
    !(await isCurrentInstanceAdmin(c.get("userId")))
  ) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Forbidden" });
  }
  const [actor] = await getActiveStaffPerson(c.get("userId"));
  if (!actor) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const target = c.req.valid("json");
  const check = await inspectHardPurgeTarget(db, target);
  if (check.status === "not_found")
    throw new HTTPException(404, { message: "Target not found" });
  if (check.status !== "eligible") {
    throw new HTTPException(409, {
      message: `hard_purge_${check.status}: ${check.reason}`,
    });
  }

  const requested = await createPendingAction({
    requesterPersonId: actor.id,
    credentialType: "session",
    credentialId: session.id,
    origin: "web",
    action: "purge",
    routeKey: HARD_PURGE_ROUTE_KEY,
    targetType: target.targetType,
    targetIds: [target.targetId],
    actorId: c.get("userId"),
    actorType: "person",
    actorIp: c.req.header("x-forwarded-for") ?? null,
    userAgent: c.req.header("user-agent") ?? null,
  });
  setShadowLegacyAuthorization(c, "allowed");
  return c.json(
    {
      ...requested,
      action: "purge" as const,
      confirmation: "typed_name_step_up" as const,
    },
    202,
  );
});

export default hardPurge;
