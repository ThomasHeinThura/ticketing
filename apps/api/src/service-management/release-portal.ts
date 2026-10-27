import {
  and,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { personTable, projectTable } from "../database/schema";
import {
  type PublishedReleaseSnapshot,
  releaseTable,
  serviceLinkTable,
  serviceTable,
} from "../database/schema-p5-service";
import {
  type CustomerPortalScope,
  customerPortalOnFor,
  customerPortalOnSql,
  customerPortalScope,
} from "../feature-flag/enforce";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { serviceCatalogueEnabled } from "./common";

type PortalReleaseVariables = BaseVariables & {
  portalPredicateSatisfied: boolean;
  policyOrganisationId: string;
  policyOrganisationIdSource: "row";
  portalRelease: {
    organisationId: string;
    workspaceIds: string[];
  };
};

const notFound = () => new HTTPException(404, { message: "Release not found" });

/** Only active customer people can read published releases for their organisation. */
async function resolvePortalReleaseScope(userId: string) {
  const [person] = await db
    .select({ organisationId: personTable.organisationId })
    .from(personTable)
    .where(
      and(
        eq(personTable.userId, userId),
        eq(personTable.side, "customer"),
        eq(personTable.active, true),
      ),
    )
    .limit(1);
  if (!person?.organisationId)
    throw new HTTPException(404, { message: "Portal account not found" });

  const reached = await db
    .selectDistinct({ workspaceId: projectTable.workspaceId })
    .from(serviceLinkTable)
    .innerJoin(
      projectTable,
      and(
        eq(projectTable.id, serviceLinkTable.projectId),
        eq(projectTable.workspaceId, serviceLinkTable.workspaceId),
      ),
    )
    .where(
      and(
        eq(serviceLinkTable.kind, "project"),
        eq(projectTable.organisationId, person.organisationId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    );
  // `feature.customer_portal` off for a workspace hides its releases from the portal.
  const portal = await customerPortalScope();
  const enabled = await Promise.all(
    reached.map(async ({ workspaceId }) =>
      customerPortalOnFor(portal, workspaceId) &&
      (await serviceCatalogueEnabled(workspaceId))
        ? workspaceId
        : null,
    ),
  );
  return {
    organisationId: person.organisationId,
    workspaceIds: enabled.filter((id): id is string => id !== null),
  };
}

async function portalScopeMiddleware(
  c: Context<{
    Variables: PortalReleaseVariables;
  }>,
  next: Next,
) {
  const scope = await resolvePortalReleaseScope(c.get("userId"));
  c.set("portalRelease", scope);
  c.set("portalPredicateSatisfied", true);
  c.set("policyOrganisationId", scope.organisationId);
  c.set("policyOrganisationIdSource", "row");
  await next();
}

export const portalReleaseSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  serviceName: z.string(),
  plannedDate: z.string().nullable(),
  notes: z.string().nullable(),
  publishedAt: z.string().datetime(),
});

export const portalReleaseListSchema = z.object({
  data: z.array(portalReleaseSummarySchema),
  nextCursor: z.string().nullable(),
});

export const portalReleaseDetailSchema = portalReleaseSummarySchema;
export type PortalReleaseSummary = z.infer<typeof portalReleaseSummarySchema>;

const releaseListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

type ReleaseCursor = {
  v: 1;
  organisationId: string;
  publishedAt: string;
  id: string;
};

function encodeCursor(cursor: ReleaseCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(
  value: string | undefined,
  organisationId: string,
): ReleaseCursor | null | false {
  if (value === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) return false;
    const candidate: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return false;
    const parsed = candidate as Record<string, unknown>;
    if (
      Object.keys(parsed).sort().join(",") !==
        "id,organisationId,publishedAt,v" ||
      parsed.v !== 1 ||
      parsed.organisationId !== organisationId ||
      typeof parsed.id !== "string" ||
      parsed.id.length < 1 ||
      parsed.id.length > 128 ||
      typeof parsed.publishedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(parsed.publishedAt)
    )
      return false;
    const timestamp = new Date(parsed.publishedAt);
    const cursor = parsed as ReleaseCursor;
    return !Number.isNaN(timestamp.getTime()) &&
      timestamp.toISOString() === cursor.publishedAt &&
      encodeCursor(cursor) === value
      ? cursor
      : false;
  } catch {
    return false;
  }
}

/**
 * A release reaches an organisation through a live project of theirs linked to its service; a
 * project whose `feature.customer_portal` resolves off (project override first) is no such path.
 */
function organisationReach(
  organisationId: string,
  portal: CustomerPortalScope | null,
) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(serviceLinkTable)
      .innerJoin(
        projectTable,
        and(
          eq(projectTable.id, serviceLinkTable.projectId),
          eq(projectTable.workspaceId, serviceLinkTable.workspaceId),
        ),
      )
      .where(
        and(
          eq(serviceLinkTable.workspaceId, releaseTable.workspaceId),
          eq(serviceLinkTable.serviceId, releaseTable.serviceId),
          eq(serviceLinkTable.kind, "project"),
          eq(projectTable.organisationId, organisationId),
          isNull(projectTable.deletedAt),
          isNull(projectTable.archivedAt),
          customerPortalOnSql(
            portal,
            projectTable.workspaceId,
            projectTable.id,
          ),
        ),
      ),
  );
}

const published = and(
  eq(releaseTable.status, "released"),
  eq(releaseTable.publishToPortal, true),
  isNotNull(releaseTable.publishedAt),
  isNotNull(releaseTable.portalSnapshot),
);

function fromSnapshot(id: string, snapshot: PublishedReleaseSnapshot) {
  return {
    id,
    name: snapshot.name,
    serviceName: snapshot.serviceName,
    plannedDate: snapshot.plannedDate,
    notes: snapshot.notes,
    publishedAt: snapshot.publishedAt,
  };
}

export async function listPortalReleases(
  scope: {
    organisationId: string;
    workspaceIds: readonly string[];
  },
  input: { limit: number; cursor?: string },
) {
  if (scope.workspaceIds.length === 0) return { data: [], nextCursor: null };
  const cursor = decodeCursor(input.cursor, scope.organisationId);
  if (cursor === false)
    throw new HTTPException(400, { message: "Invalid release cursor" });
  const rows = await db
    .select({
      id: releaseTable.id,
      portalSnapshot: releaseTable.portalSnapshot,
      publishedAt: releaseTable.publishedAt,
    })
    .from(releaseTable)
    .innerJoin(
      serviceTable,
      and(
        eq(serviceTable.id, releaseTable.serviceId),
        eq(serviceTable.workspaceId, releaseTable.workspaceId),
      ),
    )
    .where(
      and(
        published,
        inArray(releaseTable.workspaceId, [...scope.workspaceIds]),
        organisationReach(scope.organisationId, await customerPortalScope()),
        cursor
          ? or(
              lt(releaseTable.publishedAt, new Date(cursor.publishedAt)),
              and(
                eq(releaseTable.publishedAt, new Date(cursor.publishedAt)),
                lt(releaseTable.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(releaseTable.publishedAt), desc(releaseTable.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows.at(-1);
  return {
    data: pageRows.flatMap((row) =>
      row.portalSnapshot ? [fromSnapshot(row.id, row.portalSnapshot)] : [],
    ),
    nextCursor:
      hasMore && last?.publishedAt
        ? encodeCursor({
            v: 1,
            organisationId: scope.organisationId,
            publishedAt: last.publishedAt.toISOString(),
            id: last.id,
          })
        : null,
  };
}

export async function getPortalRelease(
  scope: {
    organisationId: string;
    workspaceIds: readonly string[];
  },
  id: string,
) {
  if (scope.workspaceIds.length === 0) throw notFound();
  const [row] = await db
    .select({
      id: releaseTable.id,
      portalSnapshot: releaseTable.portalSnapshot,
    })
    .from(releaseTable)
    .innerJoin(
      serviceTable,
      and(
        eq(serviceTable.id, releaseTable.serviceId),
        eq(serviceTable.workspaceId, releaseTable.workspaceId),
      ),
    )
    .where(
      and(
        eq(releaseTable.id, id),
        published,
        inArray(releaseTable.workspaceId, [...scope.workspaceIds]),
        organisationReach(scope.organisationId, await customerPortalScope()),
      ),
    )
    .limit(1);
  if (!row?.portalSnapshot) throw notFound();
  return fromSnapshot(row.id, row.portalSnapshot);
}

const portalReleaseId = z.object({ id: z.string().min(1).max(128) }).strict();

const listRoute = createRoute({
  method: "get",
  path: "/releases",
  operationId: "listPortalReleases",
  tags: ["Portal releases"],
  summary: "List published release notes visible to the customer organisation",
  middleware: [portalScopeMiddleware] as const,
  request: { query: releaseListQuery },
  responses: {
    200: jsonResponse("Published release notes", portalReleaseListSchema),
    400: errorResponse("Invalid release cursor or page size"),
    404: errorResponse("Portal account unavailable"),
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/releases/{id}",
  operationId: "getPortalRelease",
  tags: ["Portal releases"],
  summary: "Read a published release note",
  middleware: [portalScopeMiddleware] as const,
  request: { params: portalReleaseId },
  responses: {
    200: jsonResponse("Published release notes", portalReleaseDetailSchema),
    404: errorResponse("Release not found"),
  },
});

export const portalReleaseRouter = apiRouter<PortalReleaseVariables>()
  .openapi(listRoute, async (c) =>
    c.json(
      portalReleaseListSchema.parse(
        await listPortalReleases(c.get("portalRelease"), c.req.valid("query")),
      ),
      200,
    ),
  )
  .openapi(detailRoute, async (c) =>
    c.json(
      portalReleaseDetailSchema.parse(
        await getPortalRelease(c.get("portalRelease"), c.req.valid("param").id),
      ),
      200,
    ),
  );
