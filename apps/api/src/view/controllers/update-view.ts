import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  savedViewTable,
  teamMemberTable,
  teamTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import type { z } from "../../openapi";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { assertCallerHasCapability } from "../../utils/require-workspace-capability";
import { assertCanEditView } from "../assert-can-edit-view";
import { assertCanShareView } from "../assert-can-share-view";
import {
  type SavedViewAuditActor,
  savedViewAuditState,
  writeSavedViewAudit,
} from "../audit";
import type { updateViewBody } from "../schema";

type UpdateViewInput = z.infer<typeof updateViewBody>;

async function updateView(
  id: string,
  input: UpdateViewInput,
  personId: string,
  userId: string,
  auditActor: SavedViewAuditActor,
) {
  const { updated, before } = await db.transaction(async (tx) => {
    const view = await tx.query.savedViewTable.findFirst({
      where: (savedView, { eq }) => eq(savedView.id, id),
    });

    if (!view) {
      throw new HTTPException(404, { message: "Saved view not found" });
    }

    await assertCanEditView(view, personId, userId);

    const nextVisibility = input.visibility ?? view.visibility;
    const nextSharedWithTeamId =
      input.sharedWithTeamId !== undefined
        ? input.sharedWithTeamId
        : view.sharedWithTeamId;

    if (nextVisibility === "team") {
      if (!nextSharedWithTeamId) {
        throw new HTTPException(400, {
          message: "sharedWithTeamId is required when visibility is 'team'",
        });
      }
      rejectNulByte(nextSharedWithTeamId, "sharedWithTeamId");
      const teamAudienceChanged =
        view.visibility !== "team" ||
        nextSharedWithTeamId !== view.sharedWithTeamId;
      if (teamAudienceChanged) {
        await assertCanShareView(view.workspaceId, userId);
      }
      // Same check as create-view.ts's `assertScopeBelongsToWorkspace`-adjacent team
      // membership check: membership in the team alone is not enough -- the team must
      // also belong to THIS view's own workspace, or a caller who is a member of some
      // unrelated team in a foreign workspace could re-share their own view into it.
      const [membership] = await tx
        .select({ id: teamMemberTable.id })
        .from(teamMemberTable)
        .innerJoin(teamTable, eq(teamMemberTable.teamId, teamTable.id))
        .where(
          and(
            eq(teamMemberTable.teamId, nextSharedWithTeamId),
            eq(teamMemberTable.userId, userId),
            eq(teamTable.workspaceId, view.workspaceId),
          ),
        )
        .limit(1);
      if (!membership) {
        throw new HTTPException(403, {
          message: "Not a member of the team this view would be shared with",
        });
      }
    } else if (nextSharedWithTeamId) {
      throw new HTTPException(400, {
        message: "sharedWithTeamId is only valid when visibility is 'team'",
      });
    }

    if (nextVisibility === "workspace" && view.visibility !== "workspace") {
      await assertCallerHasCapability(
        view.workspaceId,
        userId,
        "workspace:manage_settings",
      );
    }

    const [updated] = await tx
      .update(savedViewTable)
      .set({
        name: input.name ?? view.name,
        visibility: nextVisibility,
        sharedWithTeamId:
          nextVisibility === "team" ? nextSharedWithTeamId : null,
        layout: input.layout ?? view.layout,
        query: input.query ?? view.query,
      })
      .where(eq(savedViewTable.id, id))
      .returning();

    if (!updated) {
      throw new HTTPException(404, { message: "Saved view not found" });
    }

    return { updated, before: savedViewAuditState(view) };
  });

  await writeSavedViewAudit({
    actor: auditActor,
    action: "saved_view.updated",
    workspaceId: updated.workspaceId,
    projectId: updated.scope === "project" ? updated.scopeId : null,
    entityId: updated.id,
    before,
    after: savedViewAuditState(updated),
  });

  await publishEvent("saved_view.updated", {
    savedViewId: updated.id,
    workspaceId: updated.workspaceId,
    userId,
  });

  return updated;
}

export default updateView;
