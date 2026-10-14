import { type Capability, reaches } from "@taskdesk/permissions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Context } from "hono";
import db, { schema } from "../database";
import {
  hasProjectReadCapability,
  resolveCallerIdentity,
} from "./has-project-reach";

/** The persisted facts reach is decided from for one work item / legacy task. */
export type ReachRow = {
  readonly id?: string;
  readonly projectId: string;
  readonly workspaceId: string;
  /**
   * The project's own customer organisation (`project.organisation_id`), when the caller has
   * it. Reach step 6 compares a customer's organisation with THIS, not the workspace's.
   */
  readonly organisationId?: string | null;
};

/**
 * The caller's project reach and project-level capability, for routes that touch MORE THAN
 * ONE row (bulk, both ends of a relation, a related-items list) and so cannot rely on a
 * single-row reach middleware. One decision source for all of them: the same identity,
 * `reaches()` and `can()` the single-item middleware evaluates. Fails closed: with no
 * resolvable identity nothing is reachable and nothing is permitted.
 */
export async function callerReach(c: Context, userId: string) {
  const identity = await resolveCallerIdentity(c, userId);
  const credentialIsKey = Boolean(c.get("apiKey"));
  const organisations = new Map<string, string | null>();

  async function facts(row: ReachRow) {
    if (row.organisationId !== undefined) {
      return {
        projectId: row.projectId,
        workspaceId: row.workspaceId,
        organisationId: row.organisationId,
        workItemId: row.id,
        ancestorProjectIds: [] as string[],
        ownerTeamId: null,
      };
    }
    let organisationId = organisations.get(row.workspaceId);
    if (organisationId === undefined) {
      const [workspace] = await db
        .select({ organisationId: schema.workspaceTable.organisationId })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, row.workspaceId))
        .limit(1);
      organisationId = workspace?.organisationId ?? null;
      organisations.set(row.workspaceId, organisationId);
    }
    return {
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      organisationId,
      workItemId: row.id,
      ancestorProjectIds: [] as string[],
      ownerTeamId: null,
    };
  }

  return {
    /**
     * The ids of the live projects, in the given workspaces, that the caller reaches. The one
     * decision source for workspace-level LIST and SEARCH routes (#740): they apply this set in
     * their own SQL, so a hidden project's rows are never selected, counted or paged. Fails
     * closed: with no resolvable identity the set is empty.
     */
    async reachableProjectIds(
      workspaceIds: readonly string[],
    ): Promise<string[]> {
      if (!identity || workspaceIds.length === 0) return [];
      const rows = await db
        .select({
          id: schema.projectTable.id,
          workspaceId: schema.projectTable.workspaceId,
          organisationId: schema.projectTable.organisationId,
        })
        .from(schema.projectTable)
        .where(
          and(
            inArray(schema.projectTable.workspaceId, [...workspaceIds]),
            isNull(schema.projectTable.deletedAt),
          ),
        );
      return rows
        .filter((row) =>
          reaches(identity, {
            projectId: row.id,
            workspaceId: row.workspaceId,
            organisationId: row.organisationId,
            ancestorProjectIds: [],
            ownerTeamId: null,
          }),
        )
        .map((row) => row.id);
    },
    /** Whether the row's project is within the caller's reach. */
    async reaches(row: ReachRow): Promise<boolean> {
      if (!identity) return false;
      return reaches(identity, await facts(row));
    },
    /**
     * Whether the caller holds `capability` on the row at project level. An API-key
     * credential carries no canonical capability subset, so for keys this returns `true`
     * and the caller's own key-aware gate decides (the same split `deferApiKeyCapability`
     * makes on the single-item routes).
     */
    async can(capability: Capability, row: ReachRow): Promise<boolean> {
      if (!identity) return false;
      if (credentialIsKey) return true;
      return hasProjectReadCapability(
        identity,
        capability,
        "work_item",
        await facts(row),
      );
    },
  };
}
