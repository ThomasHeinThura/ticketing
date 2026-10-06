import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import { parseLocalFactorPolicy } from "../auth/local-factor-policy";
import db, { schema } from "../database";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "./observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "./observability/runtime";
import {
  getLocalFactorPolicy,
  lockLocalFactorPolicy,
  lockLocalFactorRole,
} from "./repository";
import { requireCurrentInstanceAdmin } from "./require-instance-admin";

const policySchema = z
  .object({
    mode: z.enum([
      "off",
      "optional",
      "required_staff",
      "required_role",
      "required_everyone",
    ]),
    requiredRoleId: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "required_role" && !value.requiredRoleId) {
      ctx.addIssue({
        code: "custom",
        message: "requiredRoleId is required",
        path: ["requiredRoleId"],
      });
    }
    if (value.mode !== "required_role" && value.requiredRoleId !== null) {
      ctx.addIssue({
        code: "custom",
        message: "requiredRoleId must be null",
        path: ["requiredRoleId"],
      });
    }
  });

const responseSchema = z.object({ policy: policySchema });

const getRoute = createRoute({
  method: "get",
  operationId: "getLocalFactorPolicy",
  path: "/local-factor-policy",
  tags: ["Instance"],
  summary: "Get instance local-factor policy",
  responses: {
    200: jsonResponse("Local-factor policy", responseSchema),
    403: jsonResponse("Forbidden", z.object({ message: z.string() })),
    503: jsonResponse("Policy unavailable", z.object({ message: z.string() })),
  },
});

const patchRoute = createRoute({
  method: "patch",
  operationId: "patchLocalFactorPolicy",
  path: "/local-factor-policy",
  tags: ["Instance"],
  summary: "Update instance local-factor policy",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: policySchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated local-factor policy", responseSchema),
    400: jsonResponse(
      "Invalid policy or unknown role",
      z.object({ message: z.string() }),
    ),
    403: jsonResponse("Forbidden", z.object({ message: z.string() })),
    503: jsonResponse("Policy unavailable", z.object({ message: z.string() })),
  },
});

const routes = apiRouter()
  .openapi(getRoute, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "GET",
      "/api/instance/local-factor-policy",
    );
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    const [row] = await getLocalFactorPolicy();
    if (!row) throw new HTTPException(503, { message: "Policy unavailable" });
    try {
      return c.json({ policy: parseLocalFactorPolicy(row.policy) }, 200);
    } catch {
      throw new HTTPException(503, { message: "Policy unavailable" });
    }
  })
  .openapi(patchRoute, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "PATCH",
      "/api/instance/local-factor-policy",
    );
    c.header("Cache-Control", "no-store");
    const requested = parseLocalFactorPolicy(c.req.valid("json"));
    const result = await db.transaction(async (tx) => {
      // Match PostgreSQL DELETE's unavoidable role-row → singleton ordering. The
      // database trigger remains the final invariant for every deletion path.
      if (requested.mode === "required_role") {
        const roleId = requested.requiredRoleId;
        if (!roleId) return { previous: null, updated: false };
        const [role] = await lockLocalFactorRole(tx, roleId);
        if (!role) return { previous: null, updated: false };
      }
      const [row] = await lockLocalFactorPolicy(tx);
      if (!row) throw new HTTPException(503, { message: "Policy unavailable" });
      const current = parseLocalFactorPolicy(row.policy);
      if (JSON.stringify(current) === JSON.stringify(requested))
        return { previous: current, updated: true };
      await tx
        .update(schema.instanceSettingTable)
        .set({ localFactorPolicy: requested })
        .where(eq(schema.instanceSettingTable.id, "singleton"));
      return { previous: current, updated: true };
    });
    if (!result.updated || !result.previous)
      return c.json({ message: "Unknown required role" }, 400);

    if (JSON.stringify(result.previous) !== JSON.stringify(requested)) {
      await appendAuditLog(db, {
        action: "instance.local_factor_policy_changed",
        actorId: c.get("userId"),
        actorType: "person",
        traceId: normaliseTraceId(c.req.header("x-request-id")),
        workspaceId: null,
        entityType: "instance",
        entityId: "singleton",
        before: {
          mode: result.previous.mode,
          requiredRoleId: result.previous.requiredRoleId,
        },
        after: {
          mode: requested.mode,
          requiredRoleId: requested.requiredRoleId,
        },
      }).catch(async () => {
        recordAuditWriteFailure("mutation");
        await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
      });
    }
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ policy: requested }, 200);
  });

export default routes;
