import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { personTable, teamMemberTable, teamTable } from "../../database/schema";
import { invalidateNativeAuthorization } from "../../ws";
import {
  checkReparent,
  MAX_PROJECT_DEPTH,
  type ReparentRefusal,
} from "../hierarchy";
import {
  findLiveProject,
  loadWorkspaceParentMap,
  lockProjectHierarchy,
  setProjectOwnerTeam,
  setProjectParent,
} from "../hierarchy.repository";

const REFUSAL_MESSAGES: Record<ReparentRefusal, string> = {
  parent_not_found: "project_parent_not_found",
  parent_is_self: "project_parent_is_self: a project cannot be its own parent",
  parent_is_descendant:
    "project_parent_is_descendant: a project cannot be moved under its own descendant",
  depth_exceeded: `PR-1: the hierarchy is capped at ${MAX_PROJECT_DEPTH} levels; this move would exceed it`,
};

/**
 * `PATCH /api/projects/{projectId}/ownership` (PR-1): set or clear the parent project.
 *
 * Runs under the workspace hierarchy lock and re-reads every project's parent inside the
 * transaction, so the depth cap (new parent's level + the moved subtree's height <= 4), the
 * cycle check and the archived-parent refusal are decided on current data, not on what the
 * caller saw. The caller (route handler) has already established `project:manage_members` on
 * BOTH the child and the prospective parent; this function re-validates only existence and
 * same-workspace, which the composite FK `project_workspace_parent_fk` also backstops.
 *
 * The change is a reach change (rbac.md "Reach": parent/owner-team fields are reach-affecting),
 * so it is audited as `project.reach_changed` in the same transaction.
 */
async function updateProjectOwnership(input: {
  projectId: string;
  workspaceId: string;
  /** `undefined` leaves the parent unchanged. */
  parentId?: string | null;
  /** `undefined` leaves the owning team unchanged (TM-4). */
  ownerTeamId?: string | null;
  actorId: string;
  actorType: "person" | "api_key";
}) {
  const { projectId, workspaceId, parentId, ownerTeamId } = input;
  const result = await db.transaction(async (tx) => {
    await lockProjectHierarchy(tx, workspaceId);

    const project = await findLiveProject(tx, workspaceId, projectId);
    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }
    const parentChanged =
      parentId !== undefined && project.parentId !== parentId;
    const teamChanged =
      ownerTeamId !== undefined && project.ownerTeamId !== ownerTeamId;
    if (!parentChanged && !teamChanged) return { project, changed: false };

    if (parentChanged && parentId !== null) {
      const parent = await findLiveProject(tx, workspaceId, parentId);
      if (!parent) {
        throw new HTTPException(422, {
          message: REFUSAL_MESSAGES.parent_not_found,
        });
      }
      // An archived parent may not gain children: archiving a parent requires its children
      // to be archived first, so attaching a live child would break that invariant.
      if (parent.archivedAt !== null) {
        throw new HTTPException(422, {
          message:
            "project_parent_archived: an archived project cannot take children",
        });
      }
      const parents = await loadWorkspaceParentMap(tx, workspaceId);
      const refusal = checkReparent(parents, projectId, parentId);
      if (refusal) {
        throw new HTTPException(422, { message: REFUSAL_MESSAGES[refusal] });
      }
    }

    // TM-4: the owning team must be a team of this workspace (the composite FK
    // `project_workspace_owner_team_fk` backstops it); its CURRENT active members are named in
    // the audit row so the reach grant is reviewable.
    let ownerTeamMemberPersonIds: string[] | undefined;
    if (teamChanged && ownerTeamId !== null && ownerTeamId !== undefined) {
      const [team] = await tx
        .select({ id: teamTable.id })
        .from(teamTable)
        .where(
          and(
            eq(teamTable.id, ownerTeamId),
            eq(teamTable.workspaceId, workspaceId),
          ),
        )
        .for("share")
        .limit(1);
      if (!team) {
        throw new HTTPException(422, {
          message: "project_owner_team_not_found",
        });
      }
      ownerTeamMemberPersonIds = await activeTeamMemberPersonIds(
        tx,
        ownerTeamId,
      );
    }

    let updated = project;
    if (parentChanged) {
      updated = (await setProjectParent(tx, projectId, parentId)) ?? updated;
    }
    if (teamChanged) {
      updated =
        (await setProjectOwnerTeam(tx, projectId, ownerTeamId ?? null)) ??
        updated;
    }
    await appendAuditLog(tx, {
      actorId: input.actorId,
      actorType: input.actorType,
      workspaceId,
      projectId,
      action: "project.reach_changed",
      entityType: "project",
      entityId: projectId,
      before: {
        parentId: project.parentId,
        ...(teamChanged ? { ownerTeamId: project.ownerTeamId } : {}),
      },
      after: {
        parentId: parentChanged ? parentId : project.parentId,
        ...(teamChanged
          ? {
              ownerTeamId,
              ownerTeamMemberPersonIds: ownerTeamMemberPersonIds ?? [],
            }
          : {}),
      },
    });
    return { project: updated, changed: true };
  });

  if (result.changed) await invalidateNativeAuthorization({ projectId });
  return result.project;
}

async function activeTeamMemberPersonIds(
  executor: Pick<typeof db, "select">,
  teamId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ personId: personTable.id })
    .from(teamMemberTable)
    .innerJoin(personTable, eq(personTable.userId, teamMemberTable.userId))
    .where(
      and(eq(teamMemberTable.teamId, teamId), eq(personTable.active, true)),
    );
  return rows.map((row) => row.personId).sort();
}

export default updateProjectOwnership;
