import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAGS,
  isFeatureFlag,
  LOCKED_FEATURE_DEFAULTS,
} from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireCurrentInstanceAdmin } from "./require-instance-admin";

const featureParam = z.object({ featureKey: z.string().min(1).max(80) });
const updateBody = z
  .object({
    version: z.number().int().positive(),
    enabled: z.boolean(),
    locked: z.boolean(),
  })
  .strict();
const featureRow = z.object({
  key: z.string(),
  enabled: z.boolean(),
  locked: z.boolean(),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime().nullable(),
});
const featureList = z.object({ items: z.array(featureRow) });

const getRoute = createRoute({
  method: "get",
  path: "/features",
  operationId: "getInstanceFeatures",
  tags: ["Instance"],
  summary: "List instance feature flags",
  responses: {
    200: jsonResponse("Instance feature flags", featureList),
    403: errorResponse("Forbidden"),
  },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/features/{featureKey}",
  operationId: "updateInstanceFeature",
  tags: ["Instance"],
  summary: "Update an instance feature flag",
  request: {
    params: featureParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated feature flag", featureRow),
    400: errorResponse("Unknown feature flag"),
    403: errorResponse("Forbidden"),
    409: errorResponse("Feature flag version conflict"),
    503: errorResponse("Feature flag unavailable"),
  },
});

const routes = apiRouter()
  .openapi(getRoute, async (c) => {
    await requireCurrentInstanceAdmin(c, "GET", "/api/instance/features");
    const rows = await db.select().from(schema.instanceFeatureFlagTable);
    const byKey = new Map(rows.map((row) => [row.featureKey, row]));
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        items: FEATURE_FLAGS.map((key) => {
          const row = byKey.get(key);
          return {
            key,
            enabled: row?.enabled ?? FEATURE_FLAG_DEFAULTS[key],
            locked: row?.locked ?? LOCKED_FEATURE_DEFAULTS.has(key),
            version: row?.version ?? 1,
            updatedAt: row?.updatedAt?.toISOString() ?? null,
          };
        }),
      },
      200,
    );
  })
  .openapi(patchRoute, async (c) => {
    const { featureKey } = c.req.valid("param");
    const requested = c.req.valid("json");
    if (!isFeatureFlag(featureKey))
      throw new HTTPException(400, { message: "Unknown feature flag" });
    await requireCurrentInstanceAdmin(
      c,
      "PATCH",
      `/api/instance/features/${featureKey}`,
    );
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.instanceFeatureFlagTable)
        .where(eq(schema.instanceFeatureFlagTable.featureKey, featureKey))
        .for("update")
        .limit(1);
      if (!current)
        throw new HTTPException(503, { message: "Feature flag unavailable" });
      if (current.version !== requested.version) {
        throw new HTTPException(409, {
          message: "Feature flag version conflict",
        });
      }
      if (
        current.enabled === requested.enabled &&
        current.locked === requested.locked
      ) {
        return { ...current, changed: false };
      }
      const [actor] = await tx
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(
          and(
            eq(schema.personTable.userId, c.get("userId")),
            eq(schema.personTable.side, "staff"),
            eq(schema.personTable.active, true),
          ),
        )
        .limit(1);
      if (!actor) throw new HTTPException(403, { message: "Forbidden" });
      const [updated] = await tx
        .update(schema.instanceFeatureFlagTable)
        .set({
          enabled: requested.enabled,
          locked: requested.locked,
          version: current.version + 1,
          updatedBy: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.instanceFeatureFlagTable.featureKey, featureKey))
        .returning();
      if (!updated)
        throw new HTTPException(503, { message: "Feature flag unavailable" });
      await appendAuditLog(tx, {
        action: "feature_flag.changed",
        actorId: c.get("userId"),
        actorType: "person",
        traceId: normaliseTraceId(c.req.header("x-request-id")),
        entityType: "instance_feature_flag",
        entityId: featureKey,
        before: { enabled: current.enabled, locked: current.locked },
        after: { enabled: updated.enabled, locked: updated.locked },
      });
      return { ...updated, changed: true };
    });
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        key: result.featureKey,
        enabled: result.enabled,
        locked: result.locked,
        version: result.version,
        updatedAt: result.updatedAt.toISOString(),
      },
      200,
    );
  });

export default routes;
