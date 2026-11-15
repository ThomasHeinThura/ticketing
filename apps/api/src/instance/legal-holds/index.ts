import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { clientIpForContext } from "../../api-key/enforce";
import { appendAuditLog } from "../../audit/audit-writer";
import { portalForHost } from "../../auth";
import db, { schema } from "../../database";
import type { Executor } from "../../database/executor";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { normaliseTraceId } from "../../permissions/shadow-middleware";
import { requireSessionOnly } from "../../utils/require-session-only";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";

const errorSchema = z.object({ message: z.string() });
const scopeSchema = z.enum(["organisation", "person"]);
const statusFilterSchema = z.enum(["active", "lifted", "all"]);

const actorSummarySchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  })
  .strict();

const legalHoldSchema = z
  .object({
    id: z.string(),
    scope: scopeSchema,
    scopeId: z.string(),
    status: z.enum(["active", "lifted"]),
    targetLabel: z.string(),
    targetSecondaryLabel: z.string().nullable(),
    reason: z.string(),
    placedAt: z.string().datetime(),
    placedBy: actorSummarySchema,
    liftedAt: z.string().datetime().nullable(),
    liftedBy: actorSummarySchema.nullable(),
  })
  .strict();

const listQuerySchema = z.object({
  status: statusFilterSchema.optional().default("all"),
  scope: scopeSchema.optional(),
  scopeId: z.string().trim().min(1).max(128).optional(),
});

const listResponseSchema = z
  .object({
    checkedAt: z.string().datetime(),
    activeCount: z.number().int().nonnegative(),
    holds: z.array(legalHoldSchema),
  })
  .strict();

const placeBodySchema = z
  .object({
    scope: scopeSchema,
    scopeId: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

const liftParamsSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

const liftBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

type RawLegalHoldRow = {
  id: string;
  scope: "organisation" | "person";
  scopeId: string;
  reason: string;
  placedBy: string;
  placedAt: Date | string;
  liftedBy: string | null;
  liftedAt: Date | string | null;
  organisationName: string | null;
  organisationKey: string | null;
  personDisplayName: string | null;
  targetUserName: string | null;
  targetUserEmail: string | null;
  placedByName: string | null;
  placedByEmail: string | null;
  liftedByName: string | null;
  liftedByEmail: string | null;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function mapHoldRow(row: RawLegalHoldRow): z.infer<typeof legalHoldSchema> {
  const targetLabel =
    row.scope === "organisation"
      ? (row.organisationName ?? row.scopeId)
      : (row.targetUserName ??
        row.personDisplayName ??
        row.targetUserEmail ??
        row.scopeId);
  const targetSecondaryLabel =
    row.scope === "organisation"
      ? (row.organisationKey ?? null)
      : (row.targetUserEmail ?? null);
  const liftedAtIso = row.liftedAt ? toIsoString(row.liftedAt) : null;

  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    status: liftedAtIso === null ? "active" : "lifted",
    targetLabel,
    targetSecondaryLabel,
    reason: row.reason,
    placedAt: toIsoString(row.placedAt),
    placedBy: {
      id: row.placedBy,
      name: row.placedByName ?? null,
      email: row.placedByEmail ?? null,
    },
    liftedAt: liftedAtIso,
    liftedBy:
      row.liftedBy !== null
        ? {
            id: row.liftedBy,
            name: row.liftedByName ?? null,
            email: row.liftedByEmail ?? null,
          }
        : null,
  };
}

export async function countActiveLegalHolds(
  executor: Executor = db,
): Promise<number> {
  const result = await executor.execute<{ activeCount: number | string }>(sql`
    SELECT count(*)::int AS "activeCount"
    FROM "legal_hold"
    WHERE "lifted_at" IS NULL
  `);
  return Number(result.rows[0]?.activeCount ?? 0);
}

async function queryEnrichedLegalHolds(
  executor: Executor,
  filters: {
    id?: string;
    status?: "active" | "lifted" | "all";
    scope?: "organisation" | "person";
    scopeId?: string;
  },
): Promise<Array<z.infer<typeof legalHoldSchema>>> {
  const clauses = [sql`TRUE`];
  if (filters.id) {
    clauses.push(sql`lh."id" = ${filters.id}`);
  }
  if (filters.status === "active") {
    clauses.push(sql`lh."lifted_at" IS NULL`);
  } else if (filters.status === "lifted") {
    clauses.push(sql`lh."lifted_at" IS NOT NULL`);
  }
  if (filters.scope) {
    clauses.push(sql`lh."scope" = ${filters.scope}`);
  }
  if (filters.scopeId) {
    clauses.push(sql`(
      lh."scope_id" = ${filters.scopeId}
      OR (
        lh."scope" = 'person'
        AND EXISTS (
          SELECT 1 FROM "person" pf
          WHERE pf."id" = lh."scope_id" AND pf."user_id" = ${filters.scopeId}
        )
      )
    )`);
  }

  const whereSql = sql.join(clauses, sql` AND `);
  const result = await executor.execute<RawLegalHoldRow>(sql`
    SELECT
      lh."id" AS "id",
      lh."scope" AS "scope",
      lh."scope_id" AS "scopeId",
      lh."reason" AS "reason",
      lh."placed_by" AS "placedBy",
      lh."placed_at" AS "placedAt",
      lh."lifted_by" AS "liftedBy",
      lh."lifted_at" AS "liftedAt",
      org."name" AS "organisationName",
      org."key" AS "organisationKey",
      tp."display_name" AS "personDisplayName",
      tu."name" AS "targetUserName",
      tu."email" AS "targetUserEmail",
      COALESCE(pu."name", ppu."name", pp."display_name") AS "placedByName",
      COALESCE(pu."email", ppu."email") AS "placedByEmail",
      COALESCE(lu."name", lpu."name", lp."display_name") AS "liftedByName",
      COALESCE(lu."email", lpu."email") AS "liftedByEmail"
    FROM "legal_hold" lh
    LEFT JOIN "organisation" org
      ON lh."scope" = 'organisation' AND org."id" = lh."scope_id"
    LEFT JOIN "person" tp
      ON lh."scope" = 'person' AND tp."id" = lh."scope_id"
    LEFT JOIN "user" tu
      ON lh."scope" = 'person' AND tu."id" = COALESCE(tp."user_id", lh."scope_id")
    LEFT JOIN "user" pu
      ON pu."id" = lh."placed_by"
    LEFT JOIN "person" pp
      ON pp."id" = lh."placed_by"
    LEFT JOIN "user" ppu
      ON ppu."id" = pp."user_id"
    LEFT JOIN "user" lu
      ON lu."id" = lh."lifted_by"
    LEFT JOIN "person" lp
      ON lp."id" = lh."lifted_by"
    LEFT JOIN "user" lpu
      ON lpu."id" = lp."user_id"
    WHERE ${whereSql}
    ORDER BY (lh."lifted_at" IS NULL) DESC, lh."placed_at" DESC, lh."id" DESC
  `);

  return result.rows.map(mapHoldRow);
}

async function resolveCanonicalHoldTarget(
  executor: Executor,
  scope: "organisation" | "person",
  rawScopeId: string,
): Promise<{ canonicalScopeId: string; organisationId: string | null }> {
  if (scope === "organisation") {
    const [organisation] = await executor
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.id, rawScopeId))
      .limit(1);
    if (!organisation) {
      throw new HTTPException(404, { message: "Organisation not found" });
    }
    return {
      canonicalScopeId: organisation.id,
      organisationId: organisation.id,
    };
  }

  // Purge, retention, and erasure checks match `scope = 'person'` against `person.id`.
  // Accept person.id or person.userId, but persist only the canonical person.id.
  const [personById] = await executor
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, rawScopeId))
    .limit(1);
  if (personById) {
    return { canonicalScopeId: personById.id, organisationId: null };
  }

  const [personByUser] = await executor
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, rawScopeId))
    .limit(1);
  if (personByUser) {
    return { canonicalScopeId: personByUser.id, organisationId: null };
  }

  throw new HTTPException(404, { message: "Person not found" });
}

const listRoute = createRoute({
  method: "get",
  path: "/legal-holds",
  operationId: "listInstanceLegalHolds",
  tags: ["Instance"],
  summary: "List legal holds",
  description:
    "Lists active and lifted legal holds ordered by active holds first and most recently placed first, along with the total active hold count.",
  middleware: [requireSessionOnly()] as const,
  request: {
    query: listQuerySchema,
  },
  responses: {
    200: jsonResponse("Legal holds and active hold count", listResponseSchema),
    400: jsonResponse("Invalid filter parameters", errorSchema),
    403: jsonResponse("Forbidden", errorSchema),
  },
});

const placeRoute = createRoute({
  method: "post",
  path: "/legal-holds",
  operationId: "placeInstanceLegalHold",
  tags: ["Instance"],
  summary: "Place a legal hold",
  description:
    "Places an organisation-scoped or person-scoped legal hold under SHARE ROW EXCLUSIVE table lock, blocking retention purges, erasures, and hard purges for the held scope.",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: placeBodySchema } },
    },
  },
  responses: {
    201: jsonResponse("Placed legal hold", legalHoldSchema),
    400: jsonResponse("Invalid legal hold request", errorSchema),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Hold target not found", errorSchema),
    409: jsonResponse(
      "An active legal hold already exists for this target",
      errorSchema,
    ),
  },
});

const liftRoute = createRoute({
  method: "post",
  path: "/legal-holds/{id}/lift",
  operationId: "liftInstanceLegalHold",
  tags: ["Instance"],
  summary: "Lift an active legal hold",
  description:
    "Marks an active legal hold as lifted under SHARE ROW EXCLUSIVE table lock and appends a hash-chained audit entry.",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: liftParamsSchema,
    body: {
      required: false,
      content: { "application/json": { schema: liftBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Lifted legal hold", legalHoldSchema),
    400: jsonResponse("Invalid lift request", errorSchema),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Legal hold not found", errorSchema),
    409: jsonResponse("Legal hold is already lifted", errorSchema),
  },
});

const router = apiRouter()
  .openapi(listRoute, async (c) => {
    if (portalForHost(c.req.header("host")) !== "agent") {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    await requireCurrentInstanceAdmin(c, "GET", "/api/instance/legal-holds");
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");

    const query = c.req.valid("query");
    const [activeCount, holds] = await Promise.all([
      countActiveLegalHolds(db),
      queryEnrichedLegalHolds(db, {
        status: query.status,
        scope: query.scope,
        scopeId: query.scopeId,
      }),
    ]);

    return c.json(
      {
        checkedAt: new Date().toISOString(),
        activeCount,
        holds,
      },
      200,
    );
  })
  .openapi(placeRoute, async (c) => {
    if (portalForHost(c.req.header("host")) !== "agent") {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    await requireCurrentInstanceAdmin(c, "POST", "/api/instance/legal-holds");
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");

    const actorUserId = c.get("userId") as string;
    const actorIp = clientIpForContext(c);
    const userAgent = c.req.header("user-agent") ?? null;
    const traceId = normaliseTraceId(c.req.header("x-request-id"));
    const body = c.req.valid("json");

    const placed = await db.transaction(async (tx) => {
      // Always fence legal_hold before acquiring the audit-chain lock via appendAuditLog.
      await tx.execute(sql`LOCK TABLE legal_hold IN SHARE ROW EXCLUSIVE MODE`);

      const { canonicalScopeId, organisationId } =
        await resolveCanonicalHoldTarget(tx, body.scope, body.scopeId);

      const existing = await tx.execute<{ id: string }>(sql`
        SELECT "id"
        FROM "legal_hold"
        WHERE "lifted_at" IS NULL
          AND "scope" = ${body.scope}
          AND ("scope_id" = ${canonicalScopeId} OR "scope_id" = ${body.scopeId})
        LIMIT 1
      `);
      if (existing.rows.length > 0) {
        throw new HTTPException(409, {
          message: "Active legal hold already exists for this target",
        });
      }

      const [created] = await tx
        .insert(schema.legalHoldTable)
        .values({
          scope: body.scope,
          scopeId: canonicalScopeId,
          placedBy: actorUserId,
          reason: body.reason,
        })
        .returning();
      if (!created) {
        throw new HTTPException(500, { message: "Legal hold creation failed" });
      }

      await appendAuditLog(tx, {
        organisationId,
        actorId: actorUserId,
        actorType: "person",
        actorIp,
        userAgent,
        traceId,
        action: "legal_hold.placed",
        entityType: "legal_hold",
        entityId: created.id,
        before: null,
        after: {
          scope: body.scope,
          scopeId: canonicalScopeId,
          reason: body.reason,
        },
      });

      const [enriched] = await queryEnrichedLegalHolds(tx, { id: created.id });
      if (!enriched) {
        throw new HTTPException(500, { message: "Legal hold creation failed" });
      }
      return enriched;
    });

    return c.json(placed, 201);
  })
  .openapi(liftRoute, async (c) => {
    if (portalForHost(c.req.header("host")) !== "agent") {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    await requireCurrentInstanceAdmin(
      c,
      "POST",
      "/api/instance/legal-holds/{id}/lift",
    );
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");

    const actorUserId = c.get("userId") as string;
    const actorIp = clientIpForContext(c);
    const userAgent = c.req.header("user-agent") ?? null;
    const traceId = normaliseTraceId(c.req.header("x-request-id"));
    const { id } = c.req.valid("param");
    const body = c.req.valid("json") ?? {};

    const lifted = await db.transaction(async (tx) => {
      // Always fence legal_hold before acquiring the audit-chain lock via appendAuditLog.
      await tx.execute(sql`LOCK TABLE legal_hold IN SHARE ROW EXCLUSIVE MODE`);

      const [hold] = await tx
        .select()
        .from(schema.legalHoldTable)
        .where(eq(schema.legalHoldTable.id, id))
        .limit(1);
      if (!hold) {
        throw new HTTPException(404, { message: "Legal hold not found" });
      }
      if (hold.liftedAt !== null) {
        throw new HTTPException(409, {
          message: "Legal hold is already lifted",
        });
      }

      const liftedAt = new Date();
      const [updated] = await tx
        .update(schema.legalHoldTable)
        .set({
          liftedBy: actorUserId,
          liftedAt,
        })
        .where(eq(schema.legalHoldTable.id, hold.id))
        .returning();
      if (!updated?.liftedAt) {
        throw new HTTPException(500, { message: "Legal hold lift failed" });
      }

      const organisationId =
        hold.scope === "organisation"
          ? ((
              await tx
                .select({ id: schema.organisationTable.id })
                .from(schema.organisationTable)
                .where(eq(schema.organisationTable.id, hold.scopeId))
                .limit(1)
            )[0]?.id ?? null)
          : null;

      await appendAuditLog(tx, {
        organisationId,
        actorId: actorUserId,
        actorType: "person",
        actorIp,
        userAgent,
        traceId,
        action: "legal_hold.lifted",
        entityType: "legal_hold",
        entityId: hold.id,
        before: { liftedAt: null },
        after: {
          scope: hold.scope,
          scopeId: hold.scopeId,
          liftedBy: actorUserId,
          liftedAt: updated.liftedAt.toISOString(),
          reason: body.reason ?? null,
        },
      });

      const [enriched] = await queryEnrichedLegalHolds(tx, { id: hold.id });
      if (!enriched) {
        throw new HTTPException(500, { message: "Legal hold lift failed" });
      }
      return enriched;
    });

    return c.json(lifted, 200);
  });

export default router;
