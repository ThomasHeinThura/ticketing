import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { savedViewTable, teamMemberTable } from "../../database/schema";
import { publishEvent } from "../../events";
import type { z } from "../../openapi";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { assertCallerHasCapability } from "../../utils/require-workspace-capability";
import { assertCanEditView } from "../assert-can-edit-view";
import type { updateViewBody } from "../schema";

type UpdateViewInput = z.infer<typeof updateViewBody>;

async function updateView(
  id: string,
  input: UpdateViewInput,
  personId: string,
  userId: string,
) {
  return db.transaction(async (tx) => {
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
      const [membership] = await tx
        .select({ id: teamMemberTable.id })
        .from(teamMemberTable)
        .where(
          and(
            eq(teamMemberTable.teamId, nextSharedWithTeamId),
            eq(teamMemberTable.userId, userId),
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

    await publishEvent("saved_view.updated", {
      savedViewId: id,
      workspaceId: view.workspaceId,
      userId,
    });

    return updated;
  });
}

export default updateView;
