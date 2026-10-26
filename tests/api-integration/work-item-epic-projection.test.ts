import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveWorkItemEpicProjections } from "../../apps/api/src/work-item/epic-projection";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
} from "./helpers/fixtures";
import { ensureCreationWorkflow } from "./helpers/workflow";

async function createType(workspaceId: string, input: { epic?: boolean } = {}) {
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: input.epic ? "Configured Epic" : "Configured Task",
      category: "delivery",
      isEpic: input.epic ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("createType: insert returned no row");
  return type;
}

async function createState(workspaceId: string, projectId: string) {
  const now = new Date();
  const [template] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId,
      key: `state-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!template) throw new Error("createState: template missing");
  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: template.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("createState: state missing");
  return state;
}

async function createItem(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  typeId: string,
  title: string,
) {
  const response = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId, title }),
  });
  if (response.status !== 200) {
    throw new Error(
      `Work item creation failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.json()) as { id: string; key: string };
}

async function setParent(
  app: ReturnType<typeof createApp>["app"],
  childKey: string,
  parentKey: string,
) {
  const [child] = await db
    .select({ version: schema.workItemTable.version })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.key, childKey));
  const response = await app.request(`/api/v2/work-items/${childKey}/parent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "if-match": `"${child?.version ?? 1}"`,
    },
    body: JSON.stringify({ parentKey }),
  });
  expect(response.status).toBe(200);
}

async function setup() {
  const creator = await createWorkspaceMember({ role: "member" });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  await grantWorkItemProjectAccess(creator.user.id, project.id);
  const epicType = await createType(creator.workspace.id, { epic: true });
  const taskType = await createType(creator.workspace.id);
  await createState(creator.workspace.id, project.id);
  await Promise.all(
    [epicType, taskType].map((type) =>
      ensureCreationWorkflow({
        workspaceId: creator.workspace.id,
        projectId: project.id,
        typeId: type.id,
      }),
    ),
  );
  mockAuthenticatedSession(creator.user);
  return { creator, project, epicType, taskType, app: createApp().app };
}

describe("API integration: timeline epic projection (VW-27)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns the configured epic itself and nearest epic for descendants across list pages", async () => {
    const { project, epicType, taskType, app } = await setup();
    const epic = await createItem(app, project.id, epicType.id, "Epic title");
    const child = await createItem(app, project.id, taskType.id, "Child title");
    const grandchild = await createItem(
      app,
      project.id,
      taskType.id,
      "Grandchild title",
    );
    const noEpic = await createItem(app, project.id, taskType.id, "No epic");
    await setParent(app, child.key, epic.key);
    await setParent(app, grandchild.key, child.key);

    const firstPage = await app.request(
      `/api/projects/${project.id}/work-items?limit=1&sort=key&dir=asc`,
    );
    expect(firstPage.status).toBe(200);
    const first = (await firstPage.json()) as {
      data: Array<{ key: string; epic: unknown; epicAvailable: boolean }>;
      page: { nextCursor: string | null };
    };
    expect(first.data[0]).toMatchObject({
      key: epic.key,
      epic: { id: epic.id, key: epic.key, title: "Epic title" },
      epicAvailable: true,
    });
    expect(first.page.nextCursor).toBeTruthy();

    // The child page has no epic row in its own result; the server projection still resolves
    // the complete same-project ancestor chain for it.
    const childPage = await app.request(
      `/api/projects/${project.id}/work-items?limit=1&sort=key&dir=asc&cursor=${encodeURIComponent(first.page.nextCursor ?? "")}`,
    );
    expect(childPage.status).toBe(200);
    const childBody = (await childPage.json()) as {
      data: Array<{ key: string; epic: unknown; epicAvailable: boolean }>;
    };
    expect(childBody.data[0]).toMatchObject({
      key: child.key,
      epic: { id: epic.id, key: epic.key, title: "Epic title" },
      epicAvailable: true,
    });

    const grandchildPage = await app.request(
      `/api/projects/${project.id}/work-items?sort=key&dir=asc`,
    );
    const grandchildBody = (await grandchildPage.json()) as {
      data: Array<{ key: string; epic: unknown; epicAvailable: boolean }>;
    };
    expect(
      grandchildBody.data.find((row) => row.key === grandchild.key),
    ).toMatchObject({
      epic: { id: epic.id, key: epic.key, title: "Epic title" },
      epicAvailable: true,
    });
    expect(
      grandchildBody.data.find((row) => row.key === noEpic.key),
    ).toMatchObject({
      epic: null,
      epicAvailable: true,
    });
  });

  it("marks hidden ancestry unavailable without returning its identity or title", async () => {
    const { project, epicType, taskType, app } = await setup();
    const epic = await createItem(
      app,
      project.id,
      epicType.id,
      "Private deleted title",
    );
    const child = await createItem(
      app,
      project.id,
      taskType.id,
      "Visible child",
    );
    const archivedEpic = await createItem(
      app,
      project.id,
      epicType.id,
      "Private archived title",
    );
    const archivedChild = await createItem(
      app,
      project.id,
      taskType.id,
      "Visible archived child",
    );
    await setParent(app, child.key, epic.key);
    await setParent(app, archivedChild.key, archivedEpic.key);
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, epic.id));
    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workItemTable.id, archivedEpic.id));

    const response = await app.request(
      `/api/projects/${project.id}/work-items?sort=key`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ key: string; epic: unknown; epicAvailable: boolean }>;
    };
    const projected = body.data.find((row) => row.key === child.key);
    expect(projected).toMatchObject({ epic: null, epicAvailable: false });
    expect(JSON.stringify(projected)).not.toContain("Private deleted title");
    expect(JSON.stringify(projected?.epic)).not.toContain(epic.id);
    const archivedProjection = body.data.find(
      (row) => row.key === archivedChild.key,
    );
    expect(archivedProjection).toMatchObject({
      epic: null,
      epicAvailable: false,
    });
    expect(JSON.stringify(archivedProjection)).not.toContain(
      "Private archived title",
    );
    expect(JSON.stringify(archivedProjection?.epic)).not.toContain(
      archivedEpic.id,
    );
  });

  it("does not resolve a row outside the requested project scope", async () => {
    const { creator, project, app } = await setup();
    const otherProject = await createProjectFixture({
      workspaceId: creator.workspace.id,
    });
    const deniedResponse = await app.request(
      `/api/projects/${otherProject.project.id}/work-items`,
    );
    expect(deniedResponse.status).toBe(404);
    await grantWorkItemProjectAccess(creator.user.id, otherProject.project.id);
    const foreignEpicType = await createType(creator.workspace.id, {
      epic: true,
    });
    await createState(creator.workspace.id, otherProject.project.id);
    await ensureCreationWorkflow({
      workspaceId: creator.workspace.id,
      projectId: otherProject.project.id,
      typeId: foreignEpicType.id,
    });
    const foreign = await createItem(
      app,
      otherProject.project.id,
      foreignEpicType.id,
      "Foreign epic",
    );
    const result = await resolveWorkItemEpicProjections(
      project.id,
      creator.workspace.id,
      [foreign.id],
    );
    expect(result.get(foreign.id)).toEqual({
      epic: null,
      epicAvailable: false,
    });
  });
});
