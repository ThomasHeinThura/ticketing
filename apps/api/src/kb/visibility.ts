import { resolveFeatureFlag } from "@taskdesk/permissions";
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  instanceFeatureFlagTable,
  organisationRequestTypeTable,
  personTable,
  projectTable,
  requestTypeTable,
  workspaceFeatureFlagTable,
} from "../database/schema";
import { kbArticleTable } from "../database/schema-p5-kb";
import {
  customerPortalOnSql,
  customerPortalScope,
} from "../feature-flag/enforce";

export const KB_FEATURE = "feature.knowledge_base" as const;

/**
 * The subset of `workspaceIds` where `feature.knowledge_base` resolves on (instance, then
 * workspace override). The one flag resolution every agent and portal KB route uses.
 */
export async function kbEnabledWorkspaceIds(
  workspaceIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(workspaceIds)];
  if (ids.length === 0) return [];
  const [[instance], workspaceFlags] = await Promise.all([
    db
      .select({
        enabled: instanceFeatureFlagTable.enabled,
        locked: instanceFeatureFlagTable.locked,
      })
      .from(instanceFeatureFlagTable)
      .where(eq(instanceFeatureFlagTable.featureKey, KB_FEATURE))
      .limit(1),
    db
      .select({
        workspaceId: workspaceFeatureFlagTable.workspaceId,
        enabled: workspaceFeatureFlagTable.enabled,
      })
      .from(workspaceFeatureFlagTable)
      .where(
        and(
          inArray(workspaceFeatureFlagTable.workspaceId, ids),
          eq(workspaceFeatureFlagTable.featureKey, KB_FEATURE),
        ),
      ),
  ]);
  return ids.filter(
    (workspaceId) =>
      resolveFeatureFlag({
        feature: KB_FEATURE,
        instance: instance ?? null,
        workspace:
          workspaceFlags.find((flag) => flag.workspaceId === workspaceId)
            ?.enabled ?? null,
      }).enabled,
  );
}

/** An agent route on a workspace with the feature off answers 404, like a missing resource. */
export async function requireKbEnabled(workspaceId: string): Promise<void> {
  const enabled = await kbEnabledWorkspaceIds([workspaceId]);
  if (enabled.length === 0)
    throw new HTTPException(404, { message: "Not found" });
}

/**
 * The portal caller: an active customer person and the workspaces their organisation reaches
 * with the knowledge base switched on. A workspace is reached when the organisation is bound
 * to a live project in it or holds a published, customer-visible request type from it.
 */
export async function portalKbScope(userId: string) {
  const [person] = await db
    .select({
      personId: personTable.id,
      organisationId: personTable.organisationId,
    })
    .from(personTable)
    .where(
      and(
        eq(personTable.userId, userId),
        eq(personTable.side, "customer"),
        eq(personTable.active, true),
      ),
    )
    .limit(1);
  if (!person)
    throw new HTTPException(404, { message: "Portal account not found" });
  const [fromProjects, fromRequestTypes] = await Promise.all([
    db
      .selectDistinct({ workspaceId: projectTable.workspaceId })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.organisationId, person.organisationId),
          isNull(projectTable.deletedAt),
          isNull(projectTable.archivedAt),
        ),
      ),
    db
      .selectDistinct({ workspaceId: requestTypeTable.workspaceId })
      .from(organisationRequestTypeTable)
      .innerJoin(
        requestTypeTable,
        eq(requestTypeTable.id, organisationRequestTypeTable.requestTypeId),
      )
      .where(
        and(
          eq(
            organisationRequestTypeTable.organisationId,
            person.organisationId,
          ),
          eq(requestTypeTable.published, true),
          eq(requestTypeTable.customerVisible, true),
        ),
      ),
  ]);
  const workspaceIds = await kbEnabledWorkspaceIds([
    ...fromProjects.map((row) => row.workspaceId),
    ...fromRequestTypes.map((row) => row.workspaceId),
  ]);
  // `feature.customer_portal` off for the article's workspace or project hides it from the
  // portal (workspace override, else project override, else instance), like every portal read.
  const portalOn = customerPortalOnSql(
    await customerPortalScope(),
    kbArticleTable.workspaceId,
    kbArticleTable.projectId,
  );
  return {
    personId: person.personId,
    organisationId: person.organisationId,
    workspaceIds,
    /**
     * KB-2: the one condition every portal read uses. Published AND customer visible, in a
     * workspace the organisation reaches with the feature on, and a project-scoped article only
     * when the organisation is bound to that live project.
     */
    visible: and(
      eq(kbArticleTable.state, "published"),
      eq(kbArticleTable.customerVisible, true),
      isNotNull(kbArticleTable.publishedVersion),
      portalOn,
      workspaceIds.length > 0
        ? inArray(kbArticleTable.workspaceId, workspaceIds)
        : sql`false`,
      or(
        isNull(kbArticleTable.projectId),
        exists(
          db
            .select({ one: sql`1` })
            .from(projectTable)
            .where(
              and(
                eq(projectTable.id, kbArticleTable.projectId),
                eq(projectTable.workspaceId, kbArticleTable.workspaceId),
                eq(projectTable.organisationId, person.organisationId),
                isNull(projectTable.deletedAt),
                isNull(projectTable.archivedAt),
              ),
            ),
        ),
      ),
    ),
  };
}

export type PortalKbScope = Awaited<ReturnType<typeof portalKbScope>>;
