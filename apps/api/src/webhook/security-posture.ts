import { can } from "@taskdesk/permissions";
import { eq, gt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../auth";
import db, { schema } from "../database";
import { webhookTable } from "../database/schema";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { requireSessionOnly } from "../utils/require-session-only";
import { receivesEverything } from "./reach";

export { webhookSecurityPosturePolicies } from "./security-posture-policy";

const errorSchema = z.object({ message: z.string() });

const securityPostureQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(128).optional(),
});

const securityPostureEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  ownerPersonId: z.string(),
  ownerName: z.string().nullable(),
  receivesEverythingBecause: z.enum(["instance_admin", "sees_all"]),
  events: z.array(z.string()),
  active: z.boolean(),
  disabledAt: z.string().datetime().nullable(),
  disabledReason: z.string().nullable(),
  secretRotatedAt: z.string().datetime().nullable(),
});

const securityPostureResponseSchema = z.object({
  data: z.array(securityPostureEntrySchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
});

const getRoute = createRoute({
  method: "get",
  operationId: "listWebhookSecurityPosture",
  path: "/instance/webhooks/security-posture",
  tags: ["Instance"],
  summary: "List webhooks owned by identities with full workspace reach",
  description:
    "Current instance administrators can inspect bounded, secret-free metadata for webhooks whose live owners receive everything through instance administration or workspace sees_all. URLs, signing secrets, and delivery bodies are never returned.",
  middleware: [requireSessionOnly()] as const,
  request: { query: securityPostureQuery },
  responses: {
    200: jsonResponse(
      "Current webhook security posture",
      securityPostureResponseSchema,
    ),
    403: jsonResponse("Forbidden", errorSchema),
  },
});

export async function readWebhookSecurityPosture(input: {
  limit: number;
  cursor?: string | undefined;
}) {
  const rows = await db
    .select({
      id: webhookTable.id,
      name: webhookTable.name,
      workspaceId: webhookTable.workspaceId,
      workspaceName: schema.workspaceTable.name,
      ownerPersonId: webhookTable.createdBy,
      ownerUserId: schema.personTable.userId,
      ownerName: schema.personTable.displayName,
      events: webhookTable.events,
      active: webhookTable.active,
      disabledAt: webhookTable.disabledAt,
      disabledReason: webhookTable.disabledReason,
      secretRotatedAt: webhookTable.secretRotatedAt,
    })
    .from(webhookTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, webhookTable.workspaceId),
    )
    .leftJoin(
      schema.personTable,
      eq(schema.personTable.id, webhookTable.createdBy),
    )
    .where(input.cursor ? gt(webhookTable.id, input.cursor) : undefined)
    .orderBy(webhookTable.id)
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const ownerIds = [
    ...new Set(
      pageRows.flatMap((row) => (row.ownerUserId ? [row.ownerUserId] : [])),
    ),
  ];
  const identities = new Map<
    string,
    Awaited<ReturnType<typeof resolveIdentity>>
  >();
  // Keep the read bounded while avoiding an unbounded burst of identity-resolution queries.
  for (let start = 0; start < ownerIds.length; start += 8) {
    const chunk = ownerIds.slice(start, start + 8);
    const resolved = await Promise.all(
      chunk.map(
        async (userId) =>
          [
            userId,
            await resolveIdentity({ userId, credential: "session" }),
          ] as const,
      ),
    );
    for (const [userId, identity] of resolved) identities.set(userId, identity);
  }

  const data = pageRows.flatMap((row) => {
    if (!row.ownerPersonId || !row.ownerUserId) return [];
    const identity = identities.get(row.ownerUserId);
    if (
      !identity ||
      identity.personId !== row.ownerPersonId ||
      identity.side !== "staff" ||
      !receivesEverything(identity, row.workspaceId)
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        name: row.name,
        workspaceId: row.workspaceId,
        workspaceName: row.workspaceName,
        ownerPersonId: row.ownerPersonId,
        ownerName: row.ownerName,
        receivesEverythingBecause:
          identity.reach.kind === "all" ||
          can(identity, "instance:admin", "instance", { instance: true })
            ? ("instance_admin" as const)
            : ("sees_all" as const),
        events: row.events,
        active: row.active,
        disabledAt: row.disabledAt?.toISOString() ?? null,
        disabledReason: row.disabledReason,
        secretRotatedAt: row.secretRotatedAt?.toISOString() ?? null,
      },
    ];
  });

  return securityPostureResponseSchema.parse({
    data,
    page: {
      nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
      hasMore,
    },
  });
}

const router = apiRouter().openapi(getRoute, async (c) => {
  if (portalForHost(c.req.header("host")) !== "agent")
    throw new HTTPException(403, { message: "Forbidden" });
  await requireCurrentInstanceAdmin(
    c,
    "GET",
    "/api/instance/webhooks/security-posture",
  );
  c.header("Cache-Control", "no-store");
  setShadowLegacyAuthorization(c, "allowed");
  return c.json(await readWebhookSecurityPosture(c.req.valid("query")), 200);
});

export default router;
