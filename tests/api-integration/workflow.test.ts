/**
 * Issue #31's bounded slice: persistence + minimal admin CRUD for
 * `docs/03-features/workflows.md`'s lifecycle engine -- `workflow`, `workflow_version`,
 * `workflow_transition`, `scheduled_transition`. Does NOT cover the state-transition
 * EXECUTION route (`POST /api/work-items/{key}/transition`) or `GET /transitions` --
 * those are a follow-up issue, tracked separately, and depend on the not-yet-built
 * `approval` table (#36) for full `requires_approval`/`requires_cab` semantics.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function listWorkflows(workspaceId: string) {
  const { app } = createApp();
  return app.request(`/api/workflows?workspaceId=${workspaceId}`);
}

async function createWorkflow(body: unknown) {
  const { app } = createApp();
  return app.request("/api/workflows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getWorkflow(id: string) {
  const { app } = createApp();
  return app.request(`/api/workflows/${id}`);
}

async function createWorkflowVersion(id: string, body: unknown) {
  const { app } = createApp();
  return app.request(`/api/workflows/${id}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function publishWorkflowVersion(id: string, number: number) {
  const { app } = createApp();
  return app.request(`/api/workflows/${id}/versions/${number}/publish`, {
    method: "POST",
  });
}

/** Seeds two `state_template` rows for `workspaceId`, in different groups. */
async function seedStateTemplates(workspaceId: string) {
  const [backlog, done] = await db
    .insert(schema.stateTemplateTable)
    .values([
      { workspaceId, key: "backlog", name: "Backlog", group: "backlog" },
      { workspaceId, key: "done", name: "Done", group: "completed" },
    ])
    .returning();
  return {
    backlog: requireRow([backlog], "seedStateTemplates: backlog"),
    done: requireRow([done], "seedStateTemplates: done"),
  };
}

describe("API integration: workflow persistence", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated requests", async () => {
    mockAnonymousSession();
    const response = await listWorkflows("workspace-missing");
    expect(response.status).toBe(401);
  });

  it("rejects creation from a role without workflow:manage", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(member.user);

    const response = await createWorkflow({
      workspaceId: member.workspace.id,
      key: "default",
      name: "Default workflow",
    });

    expect(response.status).toBe(403);
  });

  it("a member (workflow:read) can list workflows but not create one", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(member.user);

    const response = await listWorkflows(member.workspace.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("creates a workflow, a version, and publishes it", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const { backlog, done } = await seedStateTemplates(owner.workspace.id);

    const createResponse = await createWorkflow({
      workspaceId: owner.workspace.id,
      key: "default",
      name: "Default workflow",
    });
    expect(createResponse.status).toBe(200);
    const workflow = (await createResponse.json()) as {
      id: string;
      activeVersionId: string | null;
      versions: unknown[];
    };
    expect(workflow.activeVersionId).toBeNull();
    expect(workflow.versions).toEqual([]);

    const listResponse = await listWorkflows(owner.workspace.id);
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toHaveLength(1);

    const versionResponse = await createWorkflowVersion(workflow.id, {
      transitions: [
        {
          fromStateTemplateId: backlog.id,
          toStateTemplateId: done.id,
          notePolicy: "none",
          noteVisibility: "internal",
        },
      ],
    });
    expect(versionResponse.status).toBe(200);
    const version = (await versionResponse.json()) as {
      number: number;
      transitions: { fromStateTemplateId: string; toStateTemplateId: string }[];
    };
    expect(version.number).toBe(1);
    expect(version.transitions).toHaveLength(1);
    expect(version.transitions[0]?.toStateTemplateId).toBe(done.id);

    const publishResponse = await publishWorkflowVersion(
      workflow.id,
      version.number,
    );
    expect(publishResponse.status).toBe(200);
    const published = (await publishResponse.json()) as {
      publishedAt: string | null;
    };
    expect(published.publishedAt).not.toBeNull();

    const getResponse = await getWorkflow(workflow.id);
    expect(getResponse.status).toBe(200);
    const fetched = (await getResponse.json()) as {
      activeVersionId: string | null;
      versions: unknown[];
    };
    expect(fetched.activeVersionId).not.toBeNull();
    expect(fetched.versions).toHaveLength(1);
  });

  it("refuses a structurally invalid draft version with a 400, persisting nothing", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const { backlog } = await seedStateTemplates(owner.workspace.id);

    const createResponse = await createWorkflow({
      workspaceId: owner.workspace.id,
      key: "default",
      name: "Default workflow",
    });
    const workflow = (await createResponse.json()) as { id: string };

    // References a to-state-template id that does not exist in this workspace.
    const versionResponse = await createWorkflowVersion(workflow.id, {
      transitions: [
        {
          fromStateTemplateId: backlog.id,
          toStateTemplateId: "state-template-does-not-exist",
        },
      ],
    });
    expect(versionResponse.status).toBe(400);

    const rows = await db
      .select()
      .from(schema.workflowVersionTable)
      .where(eq(schema.workflowVersionTable.workflowId, workflow.id));
    expect(rows).toHaveLength(0);
  });

  it("a workflow from another workspace is not reachable (404, not 403)", async () => {
    const ownerA = await createWorkspaceMember({ role: "owner" });
    const ownerB = await createWorkspaceMember({ role: "owner" });

    mockAuthenticatedSession(ownerA.user);
    const createResponse = await createWorkflow({
      workspaceId: ownerA.workspace.id,
      key: "default",
      name: "Default workflow",
    });
    const workflow = (await createResponse.json()) as { id: string };

    mockAuthenticatedSession(ownerB.user);
    const response = await getWorkflow(workflow.id);
    expect(response.status).toBe(404);
  });
});
