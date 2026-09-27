/**
 * `GET /api/work-items/{key}`'s display-field resolution (#23's work-item detail-page
 * slice): `stateName`, `stateCategory` and `assigneeName` -- the same values the list
 * route resolves, now on the single-item read the detail page
 * (`docs/02-design/screen-inventory.md` "Work item — full page") uses.
 *
 * The route's own 404 semantics (unknown key, out-of-reach workspace, soft-deleted
 * project, NUL byte in the key) are already covered in
 * `work-item-create-read-list.test.ts` and unchanged by this slice; this file covers what
 * is NEW: the resolved fields, their null semantics, and the `assigneeName`
 * workspace-scoping property the list route's own S3 note documents (applied here to the
 * same class of join).
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
} from "./helpers/fixtures";

// ── Fixture builders, the same shapes `work-item-create-read-list.test.ts` builds ──

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("makeWorkItemType: insert returned no row");
  return type;
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const [stateTemplate] = await db
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
  if (!stateTemplate) {
    throw new Error("makeDefaultState: state_template insert returned no row");
  }

  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeDefaultState: state insert returned no row");
  return state;
}

async function setupProjectWithDefaultState() {
  const creator = await createWorkspaceMember({ role: "member" });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const type = await makeWorkItemType(creator.workspace.id);
  const state = await makeDefaultState(creator.workspace.id, project.id);
  return { creator, project, type, state };
}

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A `person` row in its OWN organisation, optionally linked to a `user`. */
async function makePerson(options: { userId?: string | null }) {
  const [organisation] = await db
    .insert(schema.organisationTable)
    .values({ key: `org-${randomUUID()}`, name: "Org" })
    .returning();
  if (!organisation) throw new Error("organisation insert failed");

  const [person] = await db
    .insert(schema.personTable)
    .values({
      userId: options.userId ?? null,
      organisationId: organisation.id,
      side: "agent",
    })
    .returning();
  if (!person) throw new Error("person insert failed");
  return person;
}

async function makeUser(name: string) {
  const userId = randomUUID();
  await db.insert(schema.userTable).values({
    id: userId,
    name,
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  return userId;
}

describe("API integration: work item detail resolution (#23)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("resolves stateName/stateCategory from the item's own state template, alongside the raw ids", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Detail me",
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { key: string; id: string };

    const response = await app.request(`/api/work-items/${createdBody.key}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.id).toBe(createdBody.id);
    expect(body.stateName).toBe("Backlog");
    expect(body.stateCategory).toBe("backlog");
    // The raw ids stay in the response; the resolved fields are additive.
    expect(typeof body.stateId).toBe("string");
    // Unassigned: `assigneeName` is null AND consistent with the raw column.
    expect(body.assigneeId).toBeNull();
    expect(body.assigneeName).toBeNull();
  });

  it("resolves assigneeName when the assignee's user is a member of this workspace", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Assigned item",
    });
    const createdBody = (await created.json()) as { key: string; id: string };

    const memberUserId = await makeUser("Real Teammate");
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: creator.workspace.id,
      userId: memberUserId,
      role: "member",
      joinedAt: new Date(),
    });
    const memberPerson = await makePerson({ userId: memberUserId });

    await db
      .update(schema.workItemTable)
      .set({ assigneeId: memberPerson.id })
      .where(eq(schema.workItemTable.id, createdBody.id));

    const response = await app.request(`/api/work-items/${createdBody.key}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.assigneeId).toBe(memberPerson.id);
    expect(body.assigneeName).toBe("Real Teammate");
  });

  it("scopes assigneeName to the work item's own workspace: a foreign assignee's real name never resolves", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Foreign assignee",
    });
    const createdBody = (await created.json()) as { key: string; id: string };

    // A person in a COMPLETELY different organisation, in no workspace of this one,
    // linked to a real user -- reproduced with a direct SQL write, since no live route
    // writes `work_item.assignee_id` today (assignment is unbuilt).
    const foreignUserId = await makeUser("Secret Foreign Person");
    const foreignPerson = await makePerson({ userId: foreignUserId });

    await db
      .update(schema.workItemTable)
      .set({ assigneeId: foreignPerson.id })
      .where(eq(schema.workItemTable.id, createdBody.id));

    const response = await app.request(`/api/work-items/${createdBody.key}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    // The raw id is still honest; the name never resolves; the secret never appears.
    expect(body.assigneeId).toBe(foreignPerson.id);
    expect(body.assigneeName).toBeNull();
    expect(JSON.stringify(body)).not.toContain("Secret Foreign Person");
  });

  it("returns assigneeName: null for a placeholder person with no linked user (assigned, name unresolvable)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Placeholder assignee",
    });
    const createdBody = (await created.json()) as { key: string; id: string };

    const placeholderPerson = await makePerson({ userId: null });
    await db
      .update(schema.workItemTable)
      .set({ assigneeId: placeholderPerson.id })
      .where(eq(schema.workItemTable.id, createdBody.id));

    const response = await app.request(`/api/work-items/${createdBody.key}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.assigneeId).toBe(placeholderPerson.id);
    expect(body.assigneeName).toBeNull();
  });
});
