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
    await db.insert(schema.stateTable).values([
      { projectId: project.id, stateTemplateId: backlog.id, isDefault: true },
      { projectId: project.id, stateTemplateId: done.id, isDefault: false },
    ]);

    // An "adopting project": a work item of a type whose `workflow_id` is this
    // workflow -- the query `validateWorkflowVersion` uses to find every project it
    // must check (`WF-9`'s "every project whose work item types use this workflow").
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
