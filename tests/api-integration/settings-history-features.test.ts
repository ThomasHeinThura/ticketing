import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  patchProjectFeatures,
  patchWorkspaceFeatures,
} from "../../apps/api/src/feature-flag/repository";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  type SeededMemberContext,
} from "./helpers/fixtures";

const ESTIMATES = "feature.estimates";
const TIME = "feature.time_tracking";

async function actorFor(user: SeededMemberContext["user"]) {
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id))
    .limit(1);
  if (!person) throw new Error("Missing person");
  return { userId: user.id, personId: person.id };
}

describe("workspace and project features history on stored audit rows", () => {
  beforeEach(async () => resetTestDatabase());

  it("returns only the target switch rows with actor names and denies callers without manage_settings", async () => {
    const owner = await createWorkspaceMember({
      role: "owner",
      userName: "Features Owner",
    });
    const viewer = await createWorkspaceMember({ role: "viewer" });
    const foreign = await createWorkspaceMember({
      role: "owner",
      userName: "Foreign Owner",
    });
    const workspaceId = owner.workspace.id;
    const { project } = await createProjectFixture({ workspaceId });
    const { project: sibling } = await createProjectFixture({ workspaceId });
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    await grantProjectRole(owner.user.id, project.id, [
      "project:read",
      "project:manage_settings",
    ]);
    await grantProjectRole(viewer.user.id, project.id, ["project:read"]);
    await db.insert(schema.sessionTable).values(
      [owner, viewer].map(({ user }) => ({
        id: `session-${user.id}`,
        token: `token-${user.id}`,
        userId: user.id,
        portal: "agent" as const,
        expiresAt: new Date(Date.now() + 3_600_000),
      })),
    );

    const ownerActor = await actorFor(owner.user);
    const foreignActor = await actorFor(foreign.user);
    // Real writer path: each change audits one feature_flag.changed row.
    await patchWorkspaceFeatures(
      workspaceId,
      [{ key: ESTIMATES, enabled: true }],
      ownerActor,
    );
    await patchWorkspaceFeatures(
      workspaceId,
      [{ key: TIME, enabled: true }],
      ownerActor,
    );
    await patchProjectFeatures(
      project.id,
      workspaceId,
      [{ key: ESTIMATES, enabled: true }],
      ownerActor,
    );
    await patchProjectFeatures(
      project.id,
      workspaceId,
      [{ key: ESTIMATES, enabled: false }],
      ownerActor,
    );
    await patchProjectFeatures(
      sibling.id,
      workspaceId,
      [{ key: TIME, enabled: true }],
      ownerActor,
    );
    await patchWorkspaceFeatures(
      foreign.workspace.id,
      [{ key: TIME, enabled: true }],
      foreignActor,
    );
    await patchProjectFeatures(
      foreignProject.id,
      foreign.workspace.id,
      [{ key: TIME, enabled: true }],
      foreignActor,
    );

    const { app } = createApp();
    const read = async (
      user: SeededMemberContext["user"],
      entityType: string,
      entityId: string,
    ) => {
      mockAuthenticatedSession(user);
      return app.request(
        `/api/audit?entity_type=${entityType}&entity_id=${encodeURIComponent(entityId)}`,
        { headers: { cookie: `__Host-tdk_agent_session=token-${user.id}` } },
      );
    };
    const summarize = async (response: Response) => {
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        rows: Array<{
          actorName?: string | null;
          actor?: { name?: string | null } | null;
          changedFields?: string[];
        }>;
      };
      return body.rows.map((row) => ({
        actor: row.actorName ?? row.actor?.name,
        fields: row.changedFields,
      }));
    };

    const workspaceRows = await summarize(
      await read(owner.user, "workspace_features", workspaceId),
    );
    expect(workspaceRows).toHaveLength(2);
    expect(workspaceRows.map((row) => row.fields).sort()).toEqual([
      [`featureFlag:${ESTIMATES}`],
      [`featureFlag:${TIME}`],
    ]);
    expect(workspaceRows.every((row) => row.actor === "Features Owner")).toBe(
      true,
    );

    // Project history is its own scope: not the workspace rows, sibling or foreign rows.
    const projectRows = await summarize(
      await read(owner.user, "project_features", project.id),
    );
    expect(projectRows).toEqual([
      { actor: "Features Owner", fields: [`featureFlag:${ESTIMATES}`] },
      { actor: "Features Owner", fields: [`featureFlag:${ESTIMATES}`] },
    ]);

    // The sibling project keeps its own single row.
    expect(
      await summarize(await read(owner.user, "project_features", sibling.id)),
    ).toEqual([{ actor: "Features Owner", fields: [`featureFlag:${TIME}`] }]);

    // Denied: no manage_settings on the workspace or the project, and cross-tenant targets.
    for (const [user, type, id] of [
      [viewer.user, "workspace_features", workspaceId],
      [viewer.user, "project_features", project.id],
      [owner.user, "workspace_features", foreign.workspace.id],
      [owner.user, "project_features", foreignProject.id],
    ] as const) {
      const denied = await read(user, type, id);
      expect([403, 404]).toContain(denied.status);
      expect(await denied.text()).not.toContain('"rows"');
    }
  });
});
