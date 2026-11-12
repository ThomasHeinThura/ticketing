import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { makeTeam } from "./helpers/p4-closeout";
import {
  addMember,
  json,
  makeApiKey,
  setAmbientHeaders,
} from "./helpers/reach-world";

describe("team self-add refusal", () => {
  beforeEach(async () => resetTestDatabase());
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  for (const role of [
    "owner",
    "admin",
    "manager",
    "lead",
    "member",
    "viewer",
    "customer",
  ]) {
    it(`${role} cannot add themselves`, async () => {
      const workspace = await createWorkspaceMember({ role: "owner" });
      const actor = await addMember(workspace.workspace.id, role);
      const team = await makeTeam(workspace.workspace.id, []);
      const { app } = createApp();
      mockAuthenticatedSession(actor.user);
      const response = await json(
        app,
        "POST",
        `/api/teams/${team.id}/members`,
        { personId: actor.personId },
      );
      expect(response.status).toBe(403);
      expect(await response.text()).toContain("team_self_add_forbidden");
      const rows = await db
        .select()
        .from(schema.teamMemberTable)
        .where(
          and(
            eq(schema.teamMemberTable.teamId, team.id),
            eq(schema.teamMemberTable.userId, actor.user.id),
          ),
        );
      expect(rows).toHaveLength(0);
    });
  }

  it("refuses self-add by an existing team lead and a personal API key", async () => {
    const workspace = await createWorkspaceMember({ role: "owner" });
    const actor = await addMember(workspace.workspace.id, "admin");
    const team = await makeTeam(workspace.workspace.id, [actor.user.id], {
      leadUserId: actor.user.id,
    });
    const { app } = createApp();
    mockAuthenticatedSession(actor.user);
    const response = await json(app, "POST", `/api/teams/${team.id}/members`, {
      personId: actor.personId,
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("team_self_add_forbidden");
    const key = await makeApiKey(actor.user.id, {
      workspace: ["manage_settings"],
    });
    mockAnonymousSession();
    setAmbientHeaders({ "x-api-key": key });
    const keyed = await json(app, "POST", `/api/teams/${team.id}/members`, {
      personId: actor.personId,
    });
    expect(keyed.status).toBe(403);
    expect(await keyed.text()).toContain("team_self_add_forbidden");
  });

  it("allows an owner to add someone else and remove themselves", async () => {
    const workspace = await createWorkspaceMember({ role: "owner" });
    const target = await addMember(workspace.workspace.id, "member");
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, workspace.user.id));
    if (!person) throw new Error("owner person missing");
    const team = await makeTeam(workspace.workspace.id, [workspace.user.id]);
    const { app } = createApp();
    mockAuthenticatedSession(workspace.user);
    const added = await json(app, "POST", `/api/teams/${team.id}/members`, {
      personId: target.personId,
    });
    expect(added.status, await added.clone().text()).toBe(200);
    const removed = await json(
      app,
      "DELETE",
      `/api/teams/${team.id}/members/${person.id}`,
    );
    expect(removed.status, await removed.clone().text()).toBe(200);
    const members = await db
      .select()
      .from(schema.teamMemberTable)
      .where(eq(schema.teamMemberTable.teamId, team.id));
    expect(members.map((member) => member.userId)).toEqual([target.user.id]);
  });

  it("allows a team lead to remove themselves", async () => {
    const workspace = await createWorkspaceMember({ role: "owner" });
    const actor = await addMember(workspace.workspace.id, "member");
    const team = await makeTeam(workspace.workspace.id, [actor.user.id], {
      leadUserId: actor.user.id,
    });
    const { app } = createApp();
    mockAuthenticatedSession(actor.user);
    const response = await json(
      app,
      "DELETE",
      `/api/teams/${team.id}/members/${actor.personId}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await db
        .select()
        .from(schema.teamMemberTable)
        .where(eq(schema.teamMemberTable.teamId, team.id)),
    ).toHaveLength(0);
  });
});
