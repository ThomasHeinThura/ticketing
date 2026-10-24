import { sql } from "drizzle-orm";
import db from "../../database";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { getSecretsRekeyProgress } from "../../secrets/rekey";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";
import {
  classifyDatabase,
  classifyDeliveries,
  classifySecrets,
  type HealthCheck,
} from "./classify";

const stateSchema = z.enum(["ok", "degraded", "failing", "unknown"]);
const healthSchema = z.object({
  checkedAt: z.string().datetime(),
  state: stateSchema,
  checks: z.array(
    z.object({
      key: z.string(),
      state: stateSchema,
      detail: z.record(
        z.string(),
        z.union([z.number(), z.boolean(), z.null()]),
      ),
    }),
  ),
});

const getRoute = createRoute({
  method: "get",
  operationId: "getInstanceHealth",
  path: "/health",
  tags: ["Instance"],
  summary: "Instance health",
  description:
    "What is working and what is not (God Mode landing page). Each check reports ok, degraded, failing or unknown with counts only. Checks whose data source does not exist yet are not listed rather than reported as ok.",
  responses: {
    200: jsonResponse("Health checks", healthSchema),
    403: jsonResponse("Forbidden", z.object({ message: z.string() })),
  },
});

const WORST: Record<HealthCheck["state"], number> = {
  ok: 0,
  unknown: 1,
  degraded: 2,
  failing: 3,
};

async function databaseCheck(): Promise<HealthCheck> {
  const started = performance.now();
  try {
    await db.execute(sql`SELECT 1`);
    return classifyDatabase(Math.round(performance.now() - started));
  } catch {
    return classifyDatabase(null);
  }
}

async function deliveryCheck(): Promise<HealthCheck> {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM outbox WHERE state = 'dead')::int AS "outboxDead",
      (SELECT count(*) FROM outbox WHERE state = 'pending')::int AS "outboxPending",
      (SELECT count(*) FROM notification_delivery WHERE state = 'dead')::int AS "deliveriesDead",
      (SELECT count(*) FROM notification_delivery WHERE state = 'pending')::int AS "deliveriesPending"
  `);
  const row = result.rows[0] as Record<string, number | string>;
  return classifyDeliveries({
    outboxDead: Number(row.outboxDead),
    outboxPending: Number(row.outboxPending),
    deliveriesDead: Number(row.deliveriesDead),
    deliveriesPending: Number(row.deliveriesPending),
  });
}

async function guarded(
  key: string,
  check: () => Promise<HealthCheck>,
): Promise<HealthCheck> {
  try {
    return await check();
  } catch {
    return { key, state: "unknown", detail: {} };
  }
}

const routes = apiRouter().openapi(getRoute, async (c) => {
  await requireCurrentInstanceAdmin(c, "GET", "/api/instance/health");
  setShadowLegacyAuthorization(c, "allowed");
  c.header("Cache-Control", "no-store");
  const checks = await Promise.all([
    databaseCheck(),
    guarded("secrets_encryption", async () =>
      classifySecrets(await getSecretsRekeyProgress()),
    ),
    guarded("outbox", deliveryCheck),
  ]);
  const state = checks.reduce<HealthCheck["state"]>(
    (worst, check) => (WORST[check.state] > WORST[worst] ? check.state : worst),
    "ok",
  );
  return c.json({ checkedAt: new Date().toISOString(), state, checks }, 200);
});

export default routes;
