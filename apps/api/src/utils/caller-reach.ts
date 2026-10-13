import { type Capability, reaches } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
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
