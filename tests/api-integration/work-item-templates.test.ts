/**
 * WI-5: work item templates and checklist templates. Needs migration 0136 (the three template
 * tables) and the integration database; run by the coordinator after the migration lands.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { json, setupWorld, type World } from "./helpers/reach-world";

type App = ReturnType<typeof createApp>["app"];

describe("API integration: work item templates (WI-5)", () => {
  let world: World;
  let app: App;
  const base = () => `/api/workspace/${world.workspaceId}`;

  beforeEach(async () => {
    await resetTestDatabase();
    world = await setupWorld();
    app = createApp().app;
  });

  async function createLabel(name: string) {
    const [label] = await db
      .insert(schema.labelTable)
      .values({ workspaceId: world.workspaceId, name, color: "#ff0000" })
      .returning();
    if (!label) throw new Error("label");
    return label;
  }

  it("managing templates is a workspace-settings action; a project member without it is refused", async () => {
    mockAuthenticatedSession(world.admin.user);
    const created = await json(app, "POST", `${base()}/work-item-templates`, {
      name: "Bug report",
      typeId: world.type.id,
      title: "Bug: ",
    });
    expect(created.status, await created.clone().text()).toBe(200);

    mockAuthenticatedSession(world.outsiderMember.user);
    const refused = await json(app, "POST", `${base()}/work-item-templates`, {
      name: "Nope",
      typeId: world.type.id,
      title: "x",
    });
    expect(refused.status).toBe(403);
    const manage = await json(
      app,
      "GET",
      `${base()}/work-item-templates/manage`,
    );
    expect(manage.status).toBe(403);
  });

  it("creates from a template: description, labels and checklist copied, never assignee or dates", async () => {
    const label = await createLabel("Bug");
    mockAuthenticatedSession(world.admin.user);
    const checklist = await json(app, "POST", `${base()}/checklist-templates`, {
      name: "Triage",
      items: ["Reproduce", "Find owner"],
    });
    const checklistBody = (await checklist.json()) as { id: string };
    const description = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Steps" }] },
      ],
    };
    const template = await json(app, "POST", `${base()}/work-item-templates`, {
      name: "Bug report",
      typeId: world.type.id,
      title: "Bug: ",
      description,
      labelIds: [label.id],
      checklistTemplateId: checklistBody.id,
    });
    const templateBody = (await template.json()) as { id: string };

    const response = await json(
      app,
      "POST",
      `/api/projects/${world.project.id}/work-items`,
      {
        typeId: world.type.id,
        title: "Crash on save",
        templateId: templateBody.id,
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const created = (await response.json()) as {
      id: string;
      description: unknown;
      assigneeId: string | null;
      dueDate: string | null;
      startDate: string | null;
    };
    expect(created.description).toEqual(description);
    expect(created.assigneeId).toBeNull();
    expect(created.dueDate).toBeNull();
    expect(created.startDate).toBeNull();
    const labels = await db
      .select()
      .from(schema.workItemLabelTable)
      .where(eq(schema.workItemLabelTable.workItemId, created.id));
    expect(labels.map((row) => row.labelId)).toEqual([label.id]);
    const items = await db.execute<{ text: string }>(
      sql`SELECT text FROM checklist_item WHERE work_item_id = ${created.id} ORDER BY position`,
    );
    expect(items.rows.map((row) => row.text)).toEqual([
      "Reproduce",
      "Find owner",
    ]);
  });

  it("explicit request fields win over the template, and a type mismatch is refused", async () => {
    mockAuthenticatedSession(world.admin.user);
    const template = await json(app, "POST", `${base()}/work-item-templates`, {
      name: "T",
      typeId: world.type.id,
      title: "T",
      description: { type: "doc", content: [] },
    });
    const { id } = (await template.json()) as { id: string };
    const own = { type: "doc", content: [{ type: "paragraph" }] };
    const response = await json(
      app,
      "POST",
      `/api/projects/${world.project.id}/work-items`,
      {
        typeId: world.type.id,
        title: "Mine",
        description: own,
        templateId: id,
      },
    );
    expect(
      ((await response.json()) as { description: unknown }).description,
    ).toEqual(own);
  });

  it("a template from another workspace or an archived one is a 404 on create", async () => {
    mockAuthenticatedSession(world.admin.user);
    const template = await json(app, "POST", `${base()}/work-item-templates`, {
      name: "Archive me",
      typeId: world.type.id,
      title: "T",
    });
    const { id } = (await template.json()) as { id: string };
    const archived = await json(
      app,
      "POST",
      `${base()}/work-item-templates/${id}/archive`,
    );
    expect(archived.status).toBe(200);
    const create = (templateId: string) =>
      json(app, "POST", `/api/projects/${world.project.id}/work-items`, {
        typeId: world.type.id,
        title: "X",
        templateId,
      });
    expect((await create(id)).status).toBe(404);

    // A REAL, live template that belongs to another workspace (not a fabricated id): the
    // create path must refuse to resolve it, and must not create an item from it.
    const other = await createWorkspaceMember({ role: "admin" });
    const now = new Date();
    const [foreignType] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: other.workspace.id,
        key: `type-${randomUUID()}`,
        name: "Foreign ticket",
        category: "service",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!foreignType) throw new Error("foreign type fixture");
    mockAuthenticatedSession(other.user);
    const foreign = await json(
      app,
      "POST",
      `/api/workspace/${other.workspace.id}/work-item-templates`,
      {
        name: "Foreign template",
        typeId: foreignType.id,
        title: "Foreign: ",
      },
    );
    expect(foreign.status, await foreign.clone().text()).toBe(200);
    const { id: foreignTemplateId } = (await foreign.json()) as { id: string };
    const stored = await db.execute<{ id: string }>(
      sql`SELECT id FROM work_item_template WHERE id = ${foreignTemplateId}`,
    );
    expect(stored.rows.map((row) => row.id)).toEqual([foreignTemplateId]);

    mockAuthenticatedSession(world.admin.user);
    const crossed = await create(foreignTemplateId);
    expect([404, 422]).toContain(crossed.status);
    const leaked = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.title, "X"));
    expect(leaked).toHaveLength(0);
    // And an unknown id stays a plain 404.
    expect((await create(`${other.workspace.id}-nope`)).status).toBe(404);
  });
});
