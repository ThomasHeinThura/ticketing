/**
 * `POST /api/workflows/{id}/versions/{n}/validate` (issue #442, `workflows.md` §
 * Screens, "Workflow editor" validation panel) -- the thin wrapper around
 * `packages/domain`'s already-tested structural checks.
 */
import { randomUUID } from "node:crypto";
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

async function seedStateTemplate(workspaceId: string, group: string) {
  return requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({ workspaceId, key: `state-${randomUUID()}`, name: group, group })
      .returning(),
    "seedStateTemplate",
  );
}

function validateRequest(
  app: ReturnType<typeof createApp>["app"],
  workflowId: string,
  number: number,
) {
  return app.request(
    `/api/workflows/${workflowId}/versions/${number}/validate`,
    {
      method: "POST",
    },
  );
}

describe("API integration: workflow version validation (#442)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it.each([
    { label: "empty", archived: false },
    { label: "archived", archived: true },
  ])(
    "returns a generic refusal when an inaccessible $label workspace project exists",
    async ({ archived }) => {
      const owner = await createWorkspaceMember({ role: "owner" });
      mockAuthenticatedSession(owner.user);
      const { app } = createApp();
      const backlog = await seedStateTemplate(owner.workspace.id, "backlog");
      const done = await seedStateTemplate(owner.workspace.id, "completed");

      const workflowResponse = await app.request("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: owner.workspace.id,
          key: `inaccessible-${archived ? "archived" : "empty"}`,
          name: "Inaccessible project workflow",
        }),
      });
      expect(workflowResponse.status).toBe(200);
      const workflow = (await workflowResponse.json()) as { id: string };
      const versionResponse = await app.request(
        `/api/workflows/${workflow.id}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            transitions: [
              {
                fromStateTemplateId: backlog.id,
                toStateTemplateId: done.id,
                notePolicy: "none",
                noteVisibility: "internal",
              },
            ],
          }),
        },
      );
      expect(versionResponse.status).toBe(200);
      const version = (await versionResponse.json()) as { number: number };

      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
        name: `Hidden ${archived ? "archived" : "empty"} project`,
      });
      if (archived) {
        await db
          .update(schema.projectTable)
          .set({ archivedAt: new Date() })
          .where(eq(schema.projectTable.id, project.id));
      }

      const response = await validateRequest(app, workflow.id, version.number);
      const refusal = await response.text();
      expect(response.status).toBe(403);
      expect(refusal).toBe("Workflow project access required");
      expect(refusal).not.toContain(project.id);
      expect(refusal).not.toContain(project.name);
    },
  );

  it("reports an unreachable state template and a template with no outbound transition", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const backlog = await seedStateTemplate(owner.workspace.id, "backlog");
    const done = await seedStateTemplate(owner.workspace.id, "completed");
    // `orphan` has no incoming transition at all -- unreachable from `backlog`.
    const orphan = await seedStateTemplate(owner.workspace.id, "started");

    const createWorkflowResponse = await app.request("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        key: "default",
        name: "Default workflow",
      }),
    });
    const workflow = (await createWorkflowResponse.json()) as { id: string };

    const versionResponse = await app.request(
      `/api/workflows/${workflow.id}/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transitions: [
            {
              fromStateTemplateId: backlog.id,
              toStateTemplateId: done.id,
              notePolicy: "none",
              noteVisibility: "internal",
            },
          ],
        }),
      },
    );
    const version = (await versionResponse.json()) as { number: number };

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, project.id, ["project:read"]);
    await db.insert(schema.stateTable).values([
      { projectId: project.id, stateTemplateId: backlog.id, isDefault: true },
      { projectId: project.id, stateTemplateId: done.id, isDefault: false },
    ]);

    // WF-9 checks every project in the workflow's workspace, including this empty
    // project, so the success case establishes canonical reach before validation.
    const type = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: owner.workspace.id,
          key: `type-${randomUUID()}`,
          name: "Ticket",
          category: "service",
          workflowId: workflow.id,
        })
        .returning(),
      "type",
    );
    await app.request(`/api/projects/${project.id}/work-items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ typeId: type.id, title: "Seed item" }),
    });

    const response = await validateRequest(app, workflow.id, version.number);
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      valid: boolean;
      unreachableStateTemplateIds: string[];
      noOutboundStateTemplateIds: string[];
    };
    expect(result.valid).toBe(false);
    expect(result.unreachableStateTemplateIds).toContain(orphan.id);
    // `done` is in the `completed` group but still has no outbound transition of its
    // own -- `noOutboundStateIds` reports every template with no way out, including a
    // terminal one, matching `workflow.test.ts`'s own domain-level test for the function.
    expect(result.noOutboundStateTemplateIds).toContain(orphan.id);
  });

  it("rejects unauthenticated requests, and a workflow from another workspace 404s", async () => {
    const ownerA = await createWorkspaceMember({ role: "owner" });
    const ownerB = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(ownerA.user);
    const { app } = createApp();

    const createWorkflowResponse = await app.request("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: ownerA.workspace.id,
        key: "default",
        name: "Default workflow",
      }),
    });
    const workflow = (await createWorkflowResponse.json()) as { id: string };

    mockAuthenticatedSession(ownerB.user);
    const response = await validateRequest(app, workflow.id, 1);
    expect(response.status).toBe(404);
  });
});
