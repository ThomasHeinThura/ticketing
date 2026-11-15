import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import {
  deleteThroughApproval,
  ensureAgentSession,
} from "./helpers/pending-deletion";

function call(method: string, path: string, body?: unknown) {
  const { app } = createApp();
  return app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function world() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const addMember = async (role: "lead" | "member") => {
    const actor = await createWorkspaceMember({ role });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: actor.user.id,
      role,
      joinedAt: new Date(),
    });
    return actor;
  };
  const label = requireRow(
    await db
      .insert(schema.labelTable)
      .values({
        workspaceId: owner.workspace.id,
        projectId: project.id,
        name: "Existing",
        color: "blue",
      })
      .returning(),
    "project label",
  );
  return {
    project,
    label,
    url: `/api/label/project/${project.id}/catalogue`,
    narrowedLead: await addMember("lead"),
    liftedMember: await addMember("member"),
  };
}

describe("project label catalogue honours project roles", () => {
  beforeEach(resetTestDatabase);

  it("refuses a workspace lead narrowed to project-viewer and admits a member made project-lead", async () => {
    const w = await world();
    await ensureAgentSession(w.narrowedLead.user.id);
    await ensureAgentSession(w.liftedMember.user.id);
    await grantProjectRole(
      w.narrowedLead.user.id,
      w.project.id,
      BUILT_IN_ROLES.viewer.capabilities,
    );
    await grantProjectRole(
      w.liftedMember.user.id,
      w.project.id,
      BUILT_IN_ROLES.lead.capabilities,
    );
    const body = { name: "Fresh", color: "teal" };
    const renamed = { name: "Updated", color: "teal" };

    mockAuthenticatedSession(w.narrowedLead.user);
    expect((await call("GET", w.url)).status).toBe(200);
    expect(
      await (
        await call(
          "GET",
          `/api/capabilities?workspaceId=${w.project.workspaceId}&projectId=${w.project.id}`,
        )
      ).json(),
    ).toMatchObject({ manageLabels: false });
    expect((await call("POST", w.url, body)).status).toBe(403);
    expect(
      (await call("PATCH", `${w.url}/${w.label.id}`, renamed)).status,
    ).toBe(403);
    expect((await call("DELETE", `${w.url}/${w.label.id}`)).status).toBe(403);

    mockAuthenticatedSession(w.liftedMember.user);
    expect(
      await (
        await call(
          "GET",
          `/api/capabilities?workspaceId=${w.project.workspaceId}&projectId=${w.project.id}`,
        )
      ).json(),
    ).toMatchObject({ manageLabels: true });
    expect((await call("POST", w.url, body)).status).toBe(200);
    expect(
      (await call("PATCH", `${w.url}/${w.label.id}`, renamed)).status,
    ).toBe(200);
    expect(
      (
        await db
          .select()
          .from(schema.labelTable)
          .where(eq(schema.labelTable.id, w.label.id))
      )[0],
    ).toMatchObject({ name: "Updated" });
    await deleteThroughApproval(
      createApp().app,
      w.liftedMember.user,
      `${w.url}/${w.label.id}`,
    );
    expect(
      await db
        .select()
        .from(schema.labelTable)
        .where(eq(schema.labelTable.id, w.label.id)),
    ).toHaveLength(0);
  });
});
