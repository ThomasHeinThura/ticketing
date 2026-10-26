import { type Capability, reaches } from "@taskdesk/permissions";
import { eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import db, { schema } from "../database";
import { reachAncestorIds } from "../project/hierarchy";
import {
  loadProjectAncestorIdsFor,
  loadProjectOwnerTeamIdFor,
} from "../project/hierarchy.repository";
import {
  hasProjectReadCapability,
  ownerAuthorityView,
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

/** Immutable live workspace/project facts shared by list and search decisions in one request. */
export type CallerReachProjectFact = Readonly<{
  id: string;
  workspaceId: string;
  organisationId: string | null;
  deleted: boolean;
  archived: boolean;
  ancestorProjectIds: readonly string[];
  ownerTeamId: string | null;
}>;

export type CallerReachContext = Readonly<{
  identity: Awaited<ReturnType<typeof resolveCallerIdentity>>;
  projectFactsFor: (
    workspaceIds: readonly string[],
  ) => Promise<readonly CallerReachProjectFact[]>;
  reachableProjectIds: (
    workspaceIds: readonly string[],
    options?: { includeDeleted?: boolean },
  ) => Promise<string[]>;
  reaches: (row: ReachRow) => Promise<boolean>;
  can: (capability: Capability, row: ReachRow) => Promise<boolean>;
}>;

/**
 * The caller's project reach and project-level capability, for routes that touch MORE THAN
 * ONE row (bulk, both ends of a relation, a related-items list) and so cannot rely on a
 * single-row reach middleware. One decision source for all of them: the same identity,
 * `reaches()` and `can()` the single-item middleware evaluates. Fails closed: with no
 * resolvable identity nothing is reachable and nothing is permitted.
 */
export async function callerReach(
  c: Context,
  userId: string,
): Promise<CallerReachContext> {
  const identity = await resolveCallerIdentity(c, userId);
  const credentialIsKey = Boolean(c.get("apiKey"));
  const organisations = new Map<string, string | null>();
  const projectFactsByWorkspaceSet = new Map<
    string,
    Promise<readonly CallerReachProjectFact[]>
  >();

  /**
   * Load project reach facts once for this request. Global work-item search needs both the
   * broad reach set and the narrower work_item:read set; both decisions consume these same
   * persisted rows and still run their original permission evaluators.
   */
  function projectFactsFor(
    workspaceIds: readonly string[],
  ): Promise<readonly CallerReachProjectFact[]> {
    const ids = [...new Set(workspaceIds)].sort();
    if (!identity || ids.length === 0) return Promise.resolve([]);
    const key = ids.join("\0");
    const cached = projectFactsByWorkspaceSet.get(key);
    if (cached) return cached;

    const pending = (async () => {
      const rows = await db
        .select({
          id: schema.projectTable.id,
          workspaceId: schema.projectTable.workspaceId,
          organisationId: schema.projectTable.organisationId,
          deletedAt: schema.projectTable.deletedAt,
          archivedAt: schema.projectTable.archivedAt,
          parentId: schema.projectTable.parentId,
          ownerTeamId: schema.projectTable.ownerTeamId,
        })
        .from(schema.projectTable)
        .where(inArray(schema.projectTable.workspaceId, ids));
      const rowsByWorkspace = new Map<string, typeof rows>();
      for (const row of rows) {
        const bucket = rowsByWorkspace.get(row.workspaceId);
        if (bucket) bucket.push(row);
        else rowsByWorkspace.set(row.workspaceId, [row]);
      }
      const result: CallerReachProjectFact[] = [];
      for (const workspaceRows of rowsByWorkspace.values()) {
        const parents = new Map(
          workspaceRows.map((row) => [row.id, row.parentId] as const),
        );
        const deleted = new Set(
          workspaceRows
            .filter((row) => row.deletedAt !== null)
            .map((row) => row.id),
        );
        for (const row of workspaceRows) {
          result.push(
            Object.freeze({
              id: row.id,
              workspaceId: row.workspaceId,
              organisationId: row.organisationId,
              deleted: row.deletedAt !== null,
              archived: row.archivedAt !== null,
              ancestorProjectIds: Object.freeze(
                reachAncestorIds(parents, deleted, row.id),
              ),
              ownerTeamId: row.ownerTeamId,
            }),
          );
        }
      }
      return Object.freeze(result);
    })();
    projectFactsByWorkspaceSet.set(key, pending);
    pending.catch(() => projectFactsByWorkspaceSet.delete(key));
    return pending;
  }
  // PR-2: inherited project membership is read at call time; memoised per request.
  // Memoised on the request context, shared with the other layers of the request, and skipped
  // entirely when the caller holds no project-scope row on any other project (nothing to inherit).
  function ancestorsOf(workspaceId: string, projectId: string) {
    if (!identity) return Promise.resolve<string[]>([]);
    return loadProjectAncestorIdsFor(c, db, identity, workspaceId, projectId);
  }

  // TM-4 / reach step 5: skipped without a query when the caller is on no team.
  function ownerTeamOf(workspaceId: string, projectId: string) {
    return loadProjectOwnerTeamIdFor(db, identity, workspaceId, projectId);
  }

  async function facts(row: ReachRow) {
    if (row.organisationId !== undefined) {
      return {
        projectId: row.projectId,
        workspaceId: row.workspaceId,
        organisationId: row.organisationId,
        workItemId: row.id,
        ancestorProjectIds: await ancestorsOf(row.workspaceId, row.projectId),
        ownerTeamId: await ownerTeamOf(row.workspaceId, row.projectId),
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
      ancestorProjectIds: await ancestorsOf(row.workspaceId, row.projectId),
      ownerTeamId: await ownerTeamOf(row.workspaceId, row.projectId),
    };
  }

  return Object.freeze({
    /** The immutable, credential-bound identity resolved once for this request. */
    identity,
    /** Same-request project facts for a second reach/capability evaluator. */
    projectFactsFor,
    /**
     * The ids of the live projects, in the given workspaces, that the caller reaches. The one
     * decision source for workspace-level LIST and SEARCH routes (#740): they apply this set in
     * their own SQL, so a hidden project's rows are never selected, counted or paged. Fails
     * closed: with no resolvable identity the set is empty.
     */
    async reachableProjectIds(
      workspaceIds: readonly string[],
      options: { includeDeleted?: boolean } = {},
    ): Promise<string[]> {
      if (!identity || workspaceIds.length === 0) return [];
      const rows = await projectFactsFor(workspaceIds);
      return rows
        .filter(
          (row) =>
            (options.includeDeleted || !row.deleted) &&
            reaches(identity, {
              projectId: row.id,
              workspaceId: row.workspaceId,
              organisationId: row.organisationId,
              ancestorProjectIds: row.ancestorProjectIds,
              ownerTeamId: row.ownerTeamId,
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
     * Whether the caller holds `capability` on the row at project level. For an API key this is
     * the OWNER's authority in the row's project (workspace role overridden by the project
     * role, #724); the key's own scope stays with the caller's key-aware gate, which speaks
     * the stored legacy statements. A key therefore never does what its owner's session could
     * not do in the project.
     */
    async can(capability: Capability, row: ReachRow): Promise<boolean> {
      if (!identity) return false;
      return hasProjectReadCapability(
        credentialIsKey ? ownerAuthorityView(identity) : identity,
        capability,
        "work_item",
        await facts(row),
      );
    },
  });
}
