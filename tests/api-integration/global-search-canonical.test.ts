/**
 * SV-1..SV-9: canonical global search over `work_item`, people and saved views.
 *
 * NOTE: written by the P1 search implementer WITHOUT a database; the coordinator runs it.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { mockAuthenticatedSession } from "./helpers/auth";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";
import { addMember } from "./helpers/reach-world";
import { ensureCreationWorkflow } from "./helpers/workflow";

type Result = {
  id: string;
  type: string;
  title: string;
  key?: string;
  relevanceScore: number;
};

async function seedWorld() {
  const member = await createWorkspaceMember({ role: "member" });
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantProjectRole(member.user.id, project.id, [
    "work_item:read",
    "work_item:create",
    "project:read",
    "workspace:read",
  ]);
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId: member.workspace.id,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [template] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId: member.workspace.id,
      key: `state-${randomUUID()}`,
      name: "Started",
      group: "started",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type || !template) throw new Error("fixture failed");
  await db.insert(schema.stateTable).values({
    projectId: project.id,
    stateTemplateId: template.id,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
  await ensureCreationWorkflow({
    workspaceId: member.workspace.id,
    projectId: project.id,
    typeId: type.id,
  });
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  const create = async (title: string) => {
    const response = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typeId: type.id, title }),
      },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { id: string; key: string };
  };
  const search = async (q: string, extra = "") => {
    const response = await app.request(
      `/api/search?q=${encodeURIComponent(q)}&workspaceId=${member.workspace.id}${extra}`,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { results: Result[] }).results;
  };
  return { member, project, type, template, app, create, search };
}

/**
 * A project with a default state and creation workflow, so work items can be created in it.
 * A type keeps ONE workflow, so a second project that shares the type must default to a state
 * template that workflow can leave: pass the first project's `sharedStateTemplateId`.
 */
async function provisionProject(
  workspaceId: string,
  projectId: string,
  typeId: string,
  sharedStateTemplateId?: string,
) {
  const now = new Date();
  const [template] = sharedStateTemplateId
    ? [{ id: sharedStateTemplateId }]
    : await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId,
          key: `state-${randomUUID()}`,
          name: "Started",
          group: "started",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
  if (!template) throw new Error("state template fixture failed");
  await db.insert(schema.stateTable).values({
    projectId,
    stateTemplateId: template.id,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
  await ensureCreationWorkflow({ workspaceId, projectId, typeId });
}

async function createItemAs(
  app: ReturnType<typeof createApp>["app"],
  user: Parameters<typeof mockAuthenticatedSession>[0],
  projectId: string,
  typeId: string,
  title: string,
) {
  mockAuthenticatedSession(user);
  const response = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId, title }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { id: string; key: string };
}

describe("API integration: canonical global search", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("finds work items by key first, weights title above description, and drops deleted items", async () => {
    const { project, create, search } = await seedWorld();
    const target = await create("Quokka onboarding checklist");
    const other = await create("Unrelated");
    await db
      .update(schema.workItemTable)
      .set({
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "mentions quokka once" }],
            },
          ],
        },
      })
      .where(eq(schema.workItemTable.id, other.id));

    const byTitle = (await search("quokka")).filter(
      (r) => r.type === "work_item",
    );
    expect(byTitle.map((r) => r.id)).toEqual([target.id, other.id]);
    expect(byTitle[0]?.relevanceScore).toBeGreaterThan(
      byTitle[1]?.relevanceScore ?? 0,
    );

    const byKey = await search(target.key.toLowerCase());
    expect(byKey[0]).toMatchObject({
      type: "work_item",
      id: target.id,
      key: target.key,
    });

    // Structural jsonb keys such as "paragraph" must not match.
    const structural = await search("paragraph");
    expect(structural.some((r) => r.id === other.id)).toBe(false);

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, target.id));
    const afterDelete = await search("quokka");
    expect(afterDelete.map((r) => r.id)).not.toContain(target.id);
    expect(project.id).toBeTruthy();
  });

  it("falls back to trigram similarity for a typo", async () => {
    const { create, search } = await seedWorld();
    const item = await create("Quarterly planning review");
    const fuzzy = await search("Quarterly planing reveiw");
    expect(fuzzy.map((r) => r.id)).toContain(item.id);
  });

  it("never returns work items from a project the caller cannot reach", async () => {
    const { member, type, template, app, create, search } = await seedWorld();
    const visible = await create("Walrus visible");
    // The hidden project holds a real, matching item created by someone who DOES reach it.
    const hidden = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await provisionProject(
      member.workspace.id,
      hidden.project.id,
      type.id,
      template.id,
    );
    const insider = await addMember(member.workspace.id, "member");
    await grantProjectRole(insider.user.id, hidden.project.id, [
      "work_item:read",
      "work_item:create",
      "project:read",
    ]);
    const hiddenItem = await createItemAs(
      app,
      insider.user,
      hidden.project.id,
      type.id,
      "Walrus hidden",
    );
    const [stored] = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, hiddenItem.id));
    expect(stored?.id).toBe(hiddenItem.id);

    mockAuthenticatedSession(member.user);
    const results = await search("walrus");
    const items = results.filter((r) => r.type === "work_item");
    expect(items.map((r) => r.id)).toEqual([visible.id]);
    expect(results.map((r) => r.id)).not.toContain(hiddenItem.id);
    // Not findable by its key either.
    const byKey = await search(hiddenItem.key);
    expect(byKey.map((r) => r.id)).not.toContain(hiddenItem.id);
  });

  it("never returns another workspace's items, and refuses a search scoped to it", async () => {
    const { member, search } = await seedWorld();
    const foreign = await createWorkspaceMember({ role: "admin" });
    const foreignProject = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    await grantProjectRole(foreign.user.id, foreignProject.project.id, [
      "work_item:read",
      "work_item:create",
      "project:read",
    ]);
    const now = new Date();
    const [foreignType] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: foreign.workspace.id,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!foreignType) throw new Error("foreign type fixture failed");
    await provisionProject(
      foreign.workspace.id,
      foreignProject.project.id,
      foreignType.id,
    );
    const { app } = createApp();
    const foreignItem = await createItemAs(
      app,
      foreign.user,
      foreignProject.project.id,
      foreignType.id,
      "Narwhal foreign",
    );

    mockAuthenticatedSession(member.user);
    const own = await search("narwhal");
    expect(own.map((r) => r.id)).not.toContain(foreignItem.id);
    const scopedToForeign = await app.request(
      `/api/search?q=narwhal&workspaceId=${foreign.workspace.id}`,
    );
    expect(scopedToForeign.status).not.toBe(200);
    expect(await scopedToForeign.text()).not.toContain(foreignItem.id);
  });

  it("a customer principal gets no staff work items from global search", async () => {
    const { member, create } = await seedWorld();
    const item = await create("Okapi internal");
    const customer = await createCustomerPrincipal();
    const identity = await resolveIdentity({
      userId: customer.user.id,
      credential: "session",
    });
    expect(identity?.side).toBe("customer");

    mockAuthenticatedSession(customer.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/search?q=okapi&workspaceId=${member.workspace.id}`,
    );
    const body = await response.text();
    expect([200, 401, 403, 404]).toContain(response.status);
    expect(body).not.toContain(item.id);
  });

  it("returns the caller's own saved views and workspace members by name", async () => {
    const { member, search } = await seedWorld();
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id));
    if (!person) throw new Error("fixture person missing");
    await db.insert(schema.savedViewTable).values({
      workspaceId: member.workspace.id,
      createdBy: person.id,
      name: "Lemur backlog",
      scope: "workspace",
      scopeId: member.workspace.id,
      visibility: "private",
      query: { entity: "work_item" },
      layout: "list",
    });
    const views = await search("lemur");
    expect(views.map((r) => r.type)).toContain("saved_view");
    const people = await search(member.user.name.slice(0, 4));
    expect(people.some((r) => r.type === "person" && r.id === person.id)).toBe(
      true,
    );
  });
});
