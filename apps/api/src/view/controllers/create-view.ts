import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  savedViewTable,
  teamMemberTable,
  teamTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import type { z } from "../../openapi";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { assertCallerHasCapability } from "../../utils/require-workspace-capability";
import type { createViewBody } from "../schema";

type CreateViewInput = z.infer<typeof createViewBody>;

// SV-15/SV-18: `scope`/`scope_id` (what the query targets) is a separate axis from
// `visibility` (who can see the view). This validates the FORMER -- that `scopeId`
// genuinely names a workspace-or-project the view's own `workspaceId` contains -- so a
// view can never be created pointing at another tenant's project.
async function assertScopeBelongsToWorkspace(
  workspaceId: string,
  scope: "workspace" | "project",
  scopeId: string,
) {
  if (scope === "workspace") {
    if (scopeId !== workspaceId) {
      throw new HTTPException(400, {
        message: "scopeId must equal workspaceId when scope is 'workspace'",
      });
    }
    return;
  }

  rejectNulByte(scopeId, "scopeId");
  const [project] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, scopeId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!project) {
    throw new HTTPException(400, {
      message: "scopeId must be a project in this workspace",
    });
  }
}

async function createView(
  input: CreateViewInput,
  personId: string,
  userId: string,
) {
  const { workspaceId, scope, scopeId, visibility, sharedWithTeamId } = input;

  await assertScopeBelongsToWorkspace(workspaceId, scope, scopeId);

  // SV-15: this is a separate axis from `scope`/`scopeId` above.
  if (visibility === "team") {
    if (!sharedWithTeamId) {
      throw new HTTPException(400, {
        message: "sharedWithTeamId is required when visibility is 'team'",
      });
    }
    rejectNulByte(sharedWithTeamId, "sharedWithTeamId");
    // "Create a team view: Team membership" (search-and-saved-views.md § Permissions) --
    // membership in THIS team, not merely the workspace.
    const [membership] = await db
      .select({ id: teamMemberTable.id })
      .from(teamMemberTable)
      .innerJoin(teamTable, eq(teamMemberTable.teamId, teamTable.id))
      .where(
        and(
          eq(teamMemberTable.teamId, sharedWithTeamId),
          eq(teamMemberTable.userId, userId),
          eq(teamTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!membership) {
      throw new HTTPException(403, {
        message: "Not a member of the team this view would be shared with",
      });
    }
  } else if (sharedWithTeamId) {
    throw new HTTPException(400, {
      message: "sharedWithTeamId is only valid when visibility is 'team'",
    });
  }

  // SV-18: "A workspace view requires `workspace:manage_settings` to create."
  if (visibility === "workspace") {
    await assertCallerHasCapability(
      workspaceId,
      userId,
      "workspace:manage_settings",
    );
  }

  const [inserted] = await db
    .insert(savedViewTable)
    .values({
      workspaceId,
      createdBy: personId,
      name: input.name,
      scope,
      scopeId,
      visibility,
      sharedWithTeamId: visibility === "team" ? sharedWithTeamId : null,
      layout: input.layout,
      query: input.query,
    })
    .returning();

  if (!inserted) {
    throw new Error("Failed to create saved view");
  }

  await publishEvent("saved_view.created", {
    savedViewId: inserted.id,
    workspaceId,
    visibility,
    userId,
  });

  return inserted;
}

export default createView;
