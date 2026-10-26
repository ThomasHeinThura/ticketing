import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  organisationProfileResponseSchema,
  readOrganisationDirectory,
  readOrganisationProjectDefaultOptions,
} from "./organisation-lifecycle";
import { requireCurrentInstanceAdmin } from "./require-instance-admin";

const O = schema.organisationTable;
const M = schema.organisationRequestTypeTable;
const R = schema.requestTypeTable;
const V = schema.requestTypeVersionTable;
const P = schema.projectTable;
const errorSchema = z.object({ message: z.string() });
const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const catalogueItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  group: z.string(),
  autoAccept: z.boolean(),
});
const catalogueStateSchema = z.object({
  organisationId: z.string(),
  requestTypeIds: z.array(z.string()),
  etag: z.string(),
});
const responseSchema = z.object({
  data: z.array(
    organisationProfileResponseSchema.extend({
      deletedAt: z.string().datetime().nullable(),
      purgeAfter: z.string().datetime().nullable(),
      deletionGeneration: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      deletionOperationId: z.string().nullable(),
      catalogue: catalogueStateSchema,
      assignedRequestTypes: z.array(catalogueItemSchema),
    }),
  ),
  options: z.array(catalogueItemSchema),
  projectDefaultOptions: z.array(
    z.object({
      workspaceId: z.string(),
      workspaceName: z.string(),
      serviceCalendars: z.array(z.object({ id: z.string(), name: z.string() })),
      slaPolicies: z.array(
        z.object({ id: z.string(), name: z.string(), published: z.boolean() }),
      ),
    }),
  ),
});
const replaceBodySchema = z
  .object({
    requestTypeIds: z.array(z.string().min(1).max(128)).max(500),
    expectedCatalogueEtag: z.string().min(1).max(128),
  })
  .strict();
const replaceResponseSchema = z.object({
  data: z.object({
    catalogue: catalogueStateSchema,
    assignedRequestTypes: z.array(catalogueItemSchema),
  }),
});
const conflictSchema = z.object({
  message: z.literal("catalogue_conflict"),
  etag: z.string(),
});

function liveCustomerOrganisation(id?: string) {
  return and(
    id ? eq(O.id, id) : undefined,
    eq(O.isInternal, false),
    eq(O.active, true),
    isNull(O.deletedAt),
  );
}

export function buildOrganisationCatalogueEtag(
  organisationId: string,
  ids: string[],
) {
  const stableIds = [...ids].sort();
  const digest = createHash("sha256")
    .update(JSON.stringify([organisationId, stableIds]))
    .digest("base64url");
  return `"${digest}"`;
}

function sortedUniqueIds(ids: string[]) {
  return [...new Set(ids)].sort();
}

async function readCatalogueOptions() {
  const types = await db
    .select({
      id: R.id,
      workspaceId: R.workspaceId,
      key: R.key,
      name: R.name,
      description: R.description,
      icon: R.icon,
      group: R.group,
    })
    .from(R)
    .where(and(eq(R.published, true), eq(R.customerVisible, true)))
    .orderBy(asc(R.group), asc(R.position), asc(R.name), asc(R.id));
  if (types.length === 0) return [];

  const versions = await db
    .select({
      requestTypeId: V.requestTypeId,
      number: V.number,
      autoAccept: V.autoAccept,
      defaultProjectId: V.defaultProjectId,
      workspaceId: V.workspaceId,
    })
    .from(V)
    .where(
      inArray(
        V.requestTypeId,
        types.map((type) => type.id),
      ),
    )
    .orderBy(asc(V.requestTypeId), asc(V.number));
  const latestVersion = new Map<string, (typeof versions)[number]>();
  for (const version of versions)
    latestVersion.set(version.requestTypeId, version);

  return types.flatMap((type) => {
    const version = latestVersion.get(type.id);
    if (!version) return [];
    return [
      {
        id: type.id,
        key: type.key,
        name: type.name,
        description: type.description,
        icon: type.icon,
        group: type.group,
        autoAccept: version.autoAccept,
        workspaceId: type.workspaceId,
        defaultProjectId: version.defaultProjectId,
      },
    ];
  });
}

async function readAssignedItems(organisationId: string) {
  const assigned = await db
    .select({
      id: R.id,
      workspaceId: R.workspaceId,
      key: R.key,
      name: R.name,
      description: R.description,
      icon: R.icon,
      group: R.group,
    })
    .from(M)
    .innerJoin(R, eq(R.id, M.requestTypeId))
    .where(eq(M.organisationId, organisationId))
    .orderBy(asc(R.group), asc(R.position), asc(R.name), asc(R.id));
  if (assigned.length === 0) return [];
  const versions = await db
    .select({
      requestTypeId: V.requestTypeId,
      number: V.number,
      autoAccept: V.autoAccept,
    })
    .from(V)
    .where(
      inArray(
        V.requestTypeId,
        assigned.map((item) => item.id),
      ),
    )
    .orderBy(asc(V.requestTypeId), asc(V.number));
  const latestVersion = new Map<string, (typeof versions)[number]>();
  for (const version of versions)
    latestVersion.set(version.requestTypeId, version);
  return assigned.map((item) => ({
    ...item,
    autoAccept: latestVersion.get(item.id)?.autoAccept ?? false,
  }));
}

const getRoute = createRoute({
  method: "get",
  path: "/organisations",
  operationId: "getInstanceOrganisations",
  tags: ["Organisations"],
  summary: "List customer organisations and catalogue options",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse(
      "Customer organisations and request catalogue options",
      responseSchema,
    ),
    403: jsonResponse("Forbidden", errorSchema),
    503: jsonResponse("Organisation catalogue unavailable", errorSchema),
  },
});

const putRoute = createRoute({
  method: "put",
  path: "/organisations/{id}/catalogue",
  operationId: "replaceOrganisationCatalogue",
  tags: ["Organisations"],
  summary: "Replace an organisation's request catalogue",
  description:
    "Replaces the assigned request types atomically. `expectedCatalogueEtag` must match the current organisation-bound catalogue or the request receives 409.",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: paramsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: replaceBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated organisation catalogue", replaceResponseSchema),
    400: jsonResponse("Invalid request", errorSchema),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Organisation not found", errorSchema),
    409: jsonResponse(
      "Catalogue changed by another administrator",
      conflictSchema,
    ),
    422: jsonResponse(
      "One or more request types cannot be assigned",
      errorSchema,
    ),
    503: jsonResponse("Organisation catalogue unavailable", errorSchema),
  },
});

const routes = apiRouter()
  .openapi(getRoute, async (c) => {
    await requireCurrentInstanceAdmin(c, "GET", "/api/instance/organisations");
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    const organisations = await readOrganisationDirectory();
    const options = await readCatalogueOptions();
    const projectDefaultOptions = await readOrganisationProjectDefaultOptions();
    const data = await Promise.all(
      organisations.map(async (organisation) => {
        const requestTypeIds = (
          await db
            .select({ requestTypeId: M.requestTypeId })
            .from(M)
            .where(eq(M.organisationId, organisation.id))
        ).map((row) => row.requestTypeId);
        const assignedRequestTypes = await readAssignedItems(organisation.id);
        return {
          ...organisation,
          catalogue: {
            organisationId: organisation.id,
            requestTypeIds: sortedUniqueIds(requestTypeIds),
            etag: buildOrganisationCatalogueEtag(
              organisation.id,
              requestTypeIds,
            ),
          },
          assignedRequestTypes,
        };
      }),
    );
    return c.json(
      {
        data,
        options: options.map(({ defaultProjectId: _, ...item }) => item),
        projectDefaultOptions,
      },
      200,
    );
  })
  .openapi(putRoute, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "PUT",
      "/api/instance/organisations/{id}/catalogue",
    );
    c.header("Cache-Control", "no-store");
    const { id } = c.req.valid("param");
    const { requestTypeIds, expectedCatalogueEtag } = c.req.valid("json");
    if (new Set(requestTypeIds).size !== requestTypeIds.length)
      throw new HTTPException(400, { message: "Duplicate request type IDs" });

    const actorId = c.get("userId");
    const result = await db.transaction(async (tx) => {
      const initialIds = (
        await tx
          .select({ requestTypeId: M.requestTypeId })
          .from(M)
          .where(eq(M.organisationId, id))
      ).map((row) => row.requestTypeId);
      const lockIds = sortedUniqueIds([...initialIds, ...requestTypeIds]);
      const lockedTypes = lockIds.length
        ? await tx
            .select({
              id: R.id,
              key: R.key,
              name: R.name,
              description: R.description,
              icon: R.icon,
              group: R.group,
              workspaceId: R.workspaceId,
              published: R.published,
              customerVisible: R.customerVisible,
            })
            .from(R)
            .where(inArray(R.id, lockIds))
            .orderBy(asc(R.id))
            .for("share")
        : [];

      const [organisation] = await tx
        .select({ id: O.id })
        .from(O)
        .where(liveCustomerOrganisation(id))
        .for("update")
        .limit(1);
      if (!organisation) return { kind: "not_found" as const };

      const currentIds = (
        await tx
          .select({ requestTypeId: M.requestTypeId })
          .from(M)
          .where(eq(M.organisationId, id))
      ).map((row) => row.requestTypeId);
      const currentEtag = buildOrganisationCatalogueEtag(id, currentIds);
      if (
        currentEtag !== expectedCatalogueEtag ||
        JSON.stringify(sortedUniqueIds(initialIds)) !==
          JSON.stringify(sortedUniqueIds(currentIds))
      )
        return { kind: "conflict" as const, etag: currentEtag };

      const newlyRequestedIds = requestTypeIds.filter(
        (requestTypeId) => !initialIds.includes(requestTypeId),
      );
      const targetTypes = lockedTypes.filter((type) =>
        newlyRequestedIds.includes(type.id),
      );
      if (
        targetTypes.length !== newlyRequestedIds.length ||
        targetTypes.some((type) => !type.published || !type.customerVisible)
      )
        throw new HTTPException(422, {
          message: "One or more request types cannot be assigned",
        });

      const versions = requestTypeIds.length
        ? await tx
            .select({
              requestTypeId: V.requestTypeId,
              workspaceId: V.workspaceId,
              autoAccept: V.autoAccept,
              defaultProjectId: V.defaultProjectId,
              number: V.number,
            })
            .from(V)
            .where(inArray(V.requestTypeId, requestTypeIds))
            .orderBy(asc(V.requestTypeId), asc(V.number))
        : [];
      const latestVersions = new Map<string, (typeof versions)[number]>();
      for (const version of versions)
        latestVersions.set(version.requestTypeId, version);
      if (targetTypes.some((type) => !latestVersions.has(type.id)))
        throw new HTTPException(422, {
          message: "One or more request types cannot be assigned",
        });

      const autoAcceptTypes = targetTypes.filter(
        (type) => latestVersions.get(type.id)?.autoAccept,
      );
      if (autoAcceptTypes.length) {
        const projectIds = sortedUniqueIds(
          autoAcceptTypes
            .map((type) => latestVersions.get(type.id)?.defaultProjectId)
            .filter(
              (projectId): projectId is string =>
                projectId !== null && projectId !== undefined,
            ),
        );
        const projects = projectIds.length
          ? await tx
              .select({
                id: P.id,
                workspaceId: P.workspaceId,
                organisationId: P.organisationId,
                archivedAt: P.archivedAt,
                deletedAt: P.deletedAt,
              })
              .from(P)
              .where(inArray(P.id, projectIds))
              .orderBy(asc(P.id))
              .for("share")
          : [];
        const byProjectId = new Map(
          projects.map((project) => [project.id, project]),
        );
        if (
          autoAcceptTypes.some((type) => {
            const version = latestVersions.get(type.id);
            const project = version?.defaultProjectId
              ? byProjectId.get(version.defaultProjectId)
              : undefined;
            return (
              !version?.defaultProjectId ||
              !project ||
              project.workspaceId !== type.workspaceId ||
              project.organisationId !== id ||
              project.archivedAt !== null ||
              project.deletedAt !== null
            );
          })
        )
          throw new HTTPException(422, {
            message: "One or more request types cannot be assigned",
          });
      }

      const nextIds = sortedUniqueIds(requestTypeIds);
      const currentSorted = sortedUniqueIds(currentIds);
      if (JSON.stringify(nextIds) !== JSON.stringify(currentSorted)) {
        await tx.delete(M).where(eq(M.organisationId, id));
        if (nextIds.length)
          await tx.insert(M).values(
            nextIds.map((requestTypeId) => ({
              organisationId: id,
              requestTypeId,
            })),
          );
        await appendAuditLog(tx, {
          action: "instance.settings_changed",
          actorId,
          actorType: "person",
          traceId: normaliseTraceId(c.req.header("x-request-id")),
          workspaceId: null,
          organisationId: id,
          entityType: "organisation",
          entityId: id,
          before: { requestTypeIds: currentSorted },
          after: { changedKeys: ["requestCatalogue"], requestTypeIds: nextIds },
        });
      }
      return {
        kind: "updated" as const,
        requestTypeIds: nextIds,
        assignedRequestTypes: lockedTypes.flatMap((type) => {
          if (!requestTypeIds.includes(type.id)) return [];
          const version = latestVersions.get(type.id);
          return [
            {
              id: type.id,
              workspaceId: type.workspaceId,
              key: type.key,
              name: type.name,
              description: type.description,
              icon: type.icon,
              group: type.group,
              autoAccept: version?.autoAccept ?? false,
            },
          ];
        }),
      };
    });

    if (result.kind === "not_found")
      throw new HTTPException(404, { message: "Organisation not found" });
    if (result.kind === "conflict")
      return c.json(
        { message: "catalogue_conflict" as const, etag: result.etag },
        409,
      );
    setShadowLegacyAuthorization(c, "allowed");
    const etag = buildOrganisationCatalogueEtag(id, result.requestTypeIds);
    return c.json(
      {
        data: {
          catalogue: {
            organisationId: id,
            requestTypeIds: result.requestTypeIds,
            etag,
          },
          assignedRequestTypes: result.assignedRequestTypes,
        },
      },
      200,
    );
  });

export default routes;
