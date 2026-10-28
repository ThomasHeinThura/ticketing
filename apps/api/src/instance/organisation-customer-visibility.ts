import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireCurrentInstanceAdmin } from "./require-instance-admin";

const T = schema.organisationTable;
const visibilitySchema = z.enum(["private", "organisation"]);
const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const responseSchema = z.object({
  data: z.object({
    organisationId: z.string(),
    defaultCustomerVisibility: visibilitySchema,
    updatedAt: z.string().datetime(),
  }),
});
const errorSchema = z.object({ message: z.string() });
const conflictSchema = z.object({
  message: z.literal("version_conflict"),
  updatedAt: z.string().datetime(),
});

type Visibility = z.infer<typeof visibilitySchema>;

function liveCustomerOrganisation(id: string) {
  return and(
    eq(T.id, id),
    eq(T.isInternal, false),
    eq(T.active, true),
    isNull(T.deletedAt),
  );
}

const getRoute = createRoute({
  method: "get",
  path: "/organisations/{id}/customer-visibility",
  operationId: "getOrganisationCustomerVisibility",
  tags: ["Organisations"],
  summary: "Read an organisation's default customer request visibility",
  middleware: [requireSessionOnly()] as const,
  request: { params: paramsSchema },
  responses: {
    200: jsonResponse("Organisation customer visibility", responseSchema),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Organisation not found", errorSchema),
    503: jsonResponse("Organisation visibility unavailable", errorSchema),
  },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/organisations/{id}/customer-visibility",
  operationId: "patchOrganisationCustomerVisibility",
  tags: ["Organisations"],
  summary: "Update an organisation's default customer request visibility",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: paramsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              expectedUpdatedAt: z.string().datetime(),
              defaultCustomerVisibility: visibilitySchema,
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated organisation customer visibility",
      responseSchema,
    ),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Organisation not found", errorSchema),
    409: jsonResponse("Changed by another administrator", conflictSchema),
    503: jsonResponse("Organisation visibility unavailable", errorSchema),
  },
});

const routes = apiRouter()
  .openapi(getRoute, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "GET",
      "/api/instance/organisations/{id}/customer-visibility",
    );
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    const { id } = c.req.valid("param");
    const [row] = await db
      .select({
        organisationId: T.id,
        defaultCustomerVisibility: T.defaultCustomerVisibility,
        updatedAt: T.updatedAt,
      })
      .from(T)
      .where(liveCustomerOrganisation(id))
      .limit(1);
    if (!row)
      throw new HTTPException(404, { message: "Organisation not found" });
    const visibility = visibilitySchema.safeParse(
      row.defaultCustomerVisibility,
    );
    if (!visibility.success)
      throw new HTTPException(503, {
        message: "Organisation visibility setting unavailable",
      });
    return c.json(
      {
        data: {
          organisationId: row.organisationId,
          defaultCustomerVisibility: visibility.data,
          updatedAt: row.updatedAt.toISOString(),
        },
      },
      200,
    );
  })
  .openapi(patchRoute, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "PATCH",
      "/api/instance/organisations/{id}/customer-visibility",
    );
    c.header("Cache-Control", "no-store");
    const { id } = c.req.valid("param");
    const { expectedUpdatedAt, defaultCustomerVisibility } =
      c.req.valid("json");
    const userId = c.get("userId");
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          organisationId: T.id,
          defaultCustomerVisibility: T.defaultCustomerVisibility,
          updatedAt: T.updatedAt,
        })
        .from(T)
        .where(liveCustomerOrganisation(id))
        .for("update")
        .limit(1);
      if (!row) return { kind: "not_found" as const };

      const currentVisibility = visibilitySchema.safeParse(
        row.defaultCustomerVisibility,
      );
      if (!currentVisibility.success)
        throw new HTTPException(503, {
          message: "Organisation visibility setting unavailable",
        });

      if (row.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
        return { kind: "conflict" as const, updatedAt: row.updatedAt };
      }

      if (currentVisibility.data === defaultCustomerVisibility) {
        return { kind: "updated" as const, row };
      }

      const [updated] = await tx
        .update(T)
        .set({
          defaultCustomerVisibility,
          // The version is millisecond precision in the API. Advance it monotonically so two
          // writes in one millisecond cannot make a stale administrator's version look current.
          updatedAt: new Date(
            Math.max(Date.now(), row.updatedAt.getTime() + 1),
          ),
        })
        .where(liveCustomerOrganisation(id))
        .returning({
          organisationId: T.id,
          defaultCustomerVisibility: T.defaultCustomerVisibility,
          updatedAt: T.updatedAt,
        });
      if (!updated) return { kind: "not_found" as const };

      await appendAuditLog(tx, {
        action: "instance.settings_changed",
        actorId: userId,
        actorType: "person",
        traceId: normaliseTraceId(c.req.header("x-request-id")),
        workspaceId: null,
        organisationId: id,
        entityType: "organisation",
        entityId: id,
        before: null,
        after: { changedKeys: ["defaultCustomerVisibility"] },
      });
      return { kind: "updated" as const, row: updated };
    });

    if (result.kind === "not_found")
      throw new HTTPException(404, { message: "Organisation not found" });
    if (result.kind === "conflict")
      return c.json(
        {
          message: "version_conflict" as const,
          updatedAt: result.updatedAt.toISOString(),
        },
        409,
      );

    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        data: {
          organisationId: result.row.organisationId,
          defaultCustomerVisibility: result.row
            .defaultCustomerVisibility as Visibility,
          updatedAt: result.row.updatedAt.toISOString(),
        },
      },
      200,
    );
  });

export default routes;
