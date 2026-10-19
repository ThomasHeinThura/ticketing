import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { teamMemberInWorkspace } from "../../apps/api/src/view/repository";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

describe("saved-view repository (#580)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("teamMemberInWorkspace requires the team to belong to the named workspace, on the pool and on a transaction", async () => {
    const a = await createWorkspaceMember({ role: "owner" });
    const b = await createWorkspaceMember({ role: "owner" });
    const teamId = `team-${randomUUID()}`;
    await db.insert(schema.teamTable).values({
      id: teamId,
      name: "Service team",
      workspaceId: a.workspace.id,
      createdAt: new Date(),
    });
    await db.insert(schema.teamMemberTable).values({
      id: `team-member-${randomUUID()}`,
      teamId,
      userId: a.user.id,
      createdAt: new Date(),
    });

    expect(await teamMemberInWorkspace(teamId, a.user.id, a.workspace.id)).toBe(
      true,
    );
    // membership alone is not enough: the team must belong to the workspace being checked
    expect(await teamMemberInWorkspace(teamId, a.user.id, b.workspace.id)).toBe(
      false,
    );
    // another user is not a member
    expect(await teamMemberInWorkspace(teamId, b.user.id, a.workspace.id)).toBe(
      false,
    );
    await db.transaction(async (tx) => {
      expect(
        await teamMemberInWorkspace(teamId, a.user.id, a.workspace.id, tx),
      ).toBe(true);
      expect(
        await teamMemberInWorkspace(teamId, a.user.id, b.workspace.id, tx),
      ).toBe(false);
    });
  });
});
