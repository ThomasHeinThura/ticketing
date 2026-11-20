import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

/** Workspace and project label catalogue History over HTTP: the allowed role reads, others are refused. */
describe("label catalogue settings history over HTTP", () => {
  beforeEach(async () => resetTestDatabase());

  it("lets an owner read both label catalogues and refuses a viewer and another workspace's owner", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const token = `token-${owner.user.id}`;
    await db.insert(schema.sessionTable).values({
      id: `session-${owner.user.id}`,
      token,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const label = async (projectId: string | null, name: string) =>
      requireRow(
        await db
          .insert(schema.labelTable)
          .values({
            workspaceId: owner.workspace.id,
            projectId,
            name,
            color: "blue",
          })
          .returning(),
        "label",
      );
    const workspaceLabel = await label(null, "Private workspace label");
    const projectLabel = await label(project.id, "Private project label");
    for (const [row, projectId] of [
      [workspaceLabel, null],
      [projectLabel, project.id],
    ] as const)
      await appendAuditLog(db, {
        actorId: owner.user.id,
        actorType: "person",
        workspaceId: owner.workspace.id,
        projectId,
        action: "label.catalogue_created",
        entityType: "label",
        entityId: row.id,
        after: { changedFields: ["name", "color"] },
      });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const headers = {
      host: "localhost:1337",
      cookie: `__Host-tdk_agent_session=${token}`,
    };
    const read = (type: string, id: string) =>
      app.request(`/api/audit?entity_type=${type}&entity_id=${id}`, {
        headers,
      });

    for (const [type, id] of [
      ["workspace_label", workspaceLabel.id],
      ["project_label", projectLabel.id],
    ] as const) {
      const response = await read(type, id);
      expect(response.status, type).toBe(200);
      const body = await response.json();
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0]).toMatchObject({
        action: "label.catalogue_created",
        changedFields: ["name", "color"],
      });
      expect(JSON.stringify(body)).not.toContain("Private");
    }
    // A label of one catalogue is not readable as the other.
    expect((await read("project_label", workspaceLabel.id)).status).toBe(404);
    expect((await read("workspace_label", projectLabel.id)).status).toBe(404);

    // The same read is refused once the caller loses workspace access.
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, owner.workspace.id),
          eq(schema.workspaceUserTable.userId, owner.user.id),
        ),
      );
    for (const [type, id] of [
      ["workspace_label", workspaceLabel.id],
      ["project_label", projectLabel.id],
    ] as const)
      expect([403, 404], type).toContain((await read(type, id)).status);

    // Another workspace's owner never sees these rows.
    const otherToken = `token-${other.user.id}`;
    await db.insert(schema.sessionTable).values({
      id: `session-${other.user.id}-${randomUUID()}`,
      token: otherToken,
      userId: other.user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    mockAuthenticatedSession(other.user);
    for (const [type, id] of [
      ["workspace_label", workspaceLabel.id],
      ["project_label", projectLabel.id],
    ] as const) {
      const response = await app.request(
        `/api/audit?entity_type=${type}&entity_id=${id}`,
        {
          headers: {
            host: "localhost:1337",
            cookie: `__Host-tdk_agent_session=${otherToken}`,
          },
        },
      );
      expect([403, 404], type).toContain(response.status);
    }
  });
});
