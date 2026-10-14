import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import type { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "./auth";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  prepareAuthenticatedApiFixture,
  requireRow,
  WORK_ITEM_PROJECT_CAPABILITIES,
} from "./fixtures";

export type App = ReturnType<typeof createApp>["app"];

export const MATRIX = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../permissions/matrix.fixture.json", import.meta.url),
    ),
    "utf8",
  ),
) as {
  routes: Record<
    string,
    Record<string, { inReach: string; outOfReach: string }>
  >;
};

export function matrixStatus(answer: string | undefined): number {
  if (!answer) throw new Error("matrix answer missing");
  if (answer === "allow") return 200;
  const status = Number.parseInt(answer, 10);
  if (Number.isNaN(status)) throw new Error(`unparseable matrix: ${answer}`);
  return status;
}

export const TITLE = "Confidential reach probe";

export async function seedWorkspaceRole(workspaceId: string, role: string) {
  const now = new Date();
  await db
    .insert(schema.workspaceRoleTable)
    .values({
      workspaceId,
      role,
      permission: JSON.stringify({}),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

export async function addMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name: `reach ${role}`,
      })
      .returning(),
    "addMember",
  );
  await prepareAuthenticatedApiFixture(user.id);
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  await seedWorkspaceRole(workspaceId, role);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id))
    .limit(1);
  if (!person) throw new Error("addMember: person missing");
  return { user, personId: person.id };
}

export async function makeState(
  workspaceId: string,
  projectId: string,
  group: string,
  isDefault: boolean,
) {
  const now = new Date();
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: group,
        group,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "state_template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        isDefault,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "state",
  );
  return { stateTemplate, state };
}

export async function setupWorld() {
  const admin = await createWorkspaceMember({ role: "admin" });
  const workspaceId = admin.workspace.id;
  const { project } = await createProjectFixture({ workspaceId });
  const backlog = await makeState(workspaceId, project.id, "backlog", true);
  const started = await makeState(workspaceId, project.id, "started", false);

  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({ workspaceId, key: `wf-${randomUUID()}`, name: "Workflow" })
      .returning(),
    "workflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning(),
    "workflow version",
  );
  await db.insert(schema.workflowTransitionTable).values({
    versionId: version.id,
    fromStateTemplateId: backlog.stateTemplate.id,
    toStateTemplateId: started.stateTemplate.id,
    roleId: null,
    guards: [],
    effects: [],
  });
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.workflowTable.id, workflow.id));

  const now = new Date();
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Ticket",
        category: "service",
        workflowId: workflow.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "type",
  );

  // Callers. Strong workspace roles on purpose: the defect was that workspace-level reach
  // plus a workspace role was enough; only the project membership differs between them.
  // The world's own `admin` creates fixture items through the API (`createItem`), which is
  // itself project-reach gated since #720, so it holds the item authority on the project.
  await grantProjectRole(admin.user.id, project.id, [
    ...WORK_ITEM_PROJECT_CAPABILITIES,
  ]);
  const projectMember = await addMember(workspaceId, "admin");
  await grantProjectRole(projectMember.user.id, project.id, [
    ...WORK_ITEM_PROJECT_CAPABILITIES,
  ]);
  const readerLead = await addMember(workspaceId, "lead");
  await grantProjectRole(readerLead.user.id, project.id, [
    "project:read",
    "work_item:read",
  ]);
  const outsiderLead = await addMember(workspaceId, "lead");
  const outsiderMember = await addMember(workspaceId, "member");
  const outsiderAdmin = await addMember(workspaceId, "admin");
  const customerNoRole = await addMember(workspaceId, "customer");
  const customerWithRole = await addMember(workspaceId, "customer");
  await grantProjectRole(customerWithRole.user.id, project.id, [
    ...WORK_ITEM_PROJECT_CAPABILITIES,
  ]);

  return {
    admin,
    workspaceId,
    project,
    type,
    started,
    projectMember,
    readerLead,
    outsiderLead,
    outsiderMember,
    outsiderAdmin,
    customerNoRole,
    customerWithRole,
  };
}

export type World = Awaited<ReturnType<typeof setupWorld>>;

export async function createItem(app: App, world: World, title: string) {
  mockAuthenticatedSession(world.admin.user);
  const response = await app.request(
    `/api/projects/${world.project.id}/work-items`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ typeId: world.type.id, title }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { id: string; key: string };
}

export async function snapshot() {
  const items = await db
    .select()
    .from(schema.workItemTable)
    .orderBy(schema.workItemTable.key);
  const comments = await db.select().from(schema.commentTable);
  const watchers = await db.select().from(schema.watcherTable);
  const attachments = await db.select().from(schema.attachmentTable);
  const activity = await db.select().from(schema.activityTable);
  return JSON.stringify({
    items,
    comments: comments.length,
    watchers: watchers.length,
    attachments: attachments.length,
    activity: activity.length,
  });
}

export type Fixture = {
  key: string;
  neighbourId: string;
  parentKey: string;
  commentId?: string;
  attachmentId?: string;
};

export type RouteCase = {
  /** `METHOD /api/...` key as registered in the policy registry and the matrix fixture. */
  matrixKey: string;
  /** Put the item into the state this route's success path needs. */
  prepare?: (world: World, item: Fixture, app: App) => Promise<void>;
  /** Status the project member with the capability gets. Default 200. */
  successStatus?: number;
  /** "handler": the handler (not the middleware) owns the capability decision, so the reachable-but-incapable 403 case does not apply. */
  capability?: "route" | "handler";
  /** Status a reachable caller holding only read capabilities gets. Default 403. */
  readOnlyStatus?: number;
  /** Status an API key with read-only scope (owned by a fully-capable project member) gets. Default 403. */
  readKeyStatus?: number;
  call: (app: App, world: World, item: Fixture) => Promise<Response>;
};

let ambientHeaders: Record<string, string> = {};

/** Headers (e.g. `x-api-key`) added to every `json()` request until reset with `{}`. */
export function setAmbientHeaders(headers: Record<string, string>) {
  ambientHeaders = headers;
}

export async function json(
  app: App,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...ambientHeaders,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export const ROUTES: RouteCase[] = [
  {
    matrixKey: "PATCH /api/work-items/{key}",
    call: (app, _w, i) =>
      json(
        app,
        "PATCH",
        `/api/work-items/${i.key}`,
        { title: "Overwritten title" },
        { "if-match": '"1"' },
      ),
  },
  {
    matrixKey: "POST /api/work-items/{key}/assign",
    call: (app, w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/assign`, {
        assigneeId: w.projectMember.personId,
      }),
  },
  {
    matrixKey: "DELETE /api/work-items/{key}/assign",
    prepare: async (w, i) => {
      await db
        .update(schema.workItemTable)
        .set({ assigneeId: w.projectMember.personId })
        .where(eq(schema.workItemTable.key, i.key));
    },
    call: (app, _w, i) =>
      json(app, "DELETE", `/api/work-items/${i.key}/assign`),
  },
  {
    matrixKey: "DELETE /api/work-items/{key}",
    call: (app, _w, i) => json(app, "DELETE", `/api/work-items/${i.key}`),
  },
  {
    matrixKey: "POST /api/work-items/{key}/rank",
    call: (app, _w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/rank`, {
        beforeId: i.neighbourId,
      }),
  },
  {
    matrixKey: "POST /api/work-items/{key}/parent",
    call: (app, _w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/parent`, {
        parentKey: i.parentKey,
      }),
  },
  {
    matrixKey: "DELETE /api/work-items/{key}/parent",
    prepare: async (_w, i) => {
      const [parent] = await db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.key, i.parentKey));
      await db
        .update(schema.workItemTable)
        .set({ parentId: parent?.id ?? null })
        .where(eq(schema.workItemTable.key, i.key));
    },
    call: (app, _w, i) =>
      json(app, "DELETE", `/api/work-items/${i.key}/parent`),
  },
  {
    matrixKey: "POST /api/work-items/{key}/watch",
    readOnlyStatus: 200,
    readKeyStatus: 200,
    call: (app, _w, i) => json(app, "POST", `/api/work-items/${i.key}/watch`),
  },
  {
    matrixKey: "DELETE /api/work-items/{key}/watch",
    readOnlyStatus: 200,
    readKeyStatus: 200,
    call: (app, _w, i) => json(app, "DELETE", `/api/work-items/${i.key}/watch`),
  },
  {
    matrixKey: "POST /api/work-items/{key}/transition",
    call: (app, w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/transition`, {
        toStateTemplateId: w.started.stateTemplate.id,
      }),
  },
  {
    matrixKey: "POST /api/work-items/{key}/comments",
    call: (app, _w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/comments`, {
        body: { type: "doc", content: [] },
        visibility: "public",
      }),
  },
  {
    matrixKey: "POST /api/work-items/{key}/attachments/presign",
    call: (app, _w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/attachments/presign`, {
        filename: "probe.png",
        contentType: "image/png",
        size: 1024,
      }),
  },
];

async function asProjectMember(world: World, fn: () => Promise<void>) {
  mockAuthenticatedSession(world.projectMember.user);
  await fn();
}

ROUTES.push(
  {
    matrixKey: "DELETE /api/attachments/{id}",
    prepare: async (w, i, app) => {
      await asProjectMember(w, async () => {
        const r = await json(
          app,
          "POST",
          `/api/work-items/${i.key}/attachments/presign`,
          { filename: "probe.png", contentType: "image/png", size: 1024 },
        );
        expect(r.status, await r.clone().text()).toBe(200);
        i.attachmentId = (
          (await r.json()) as { attachmentId: string }
        ).attachmentId;
      });
    },
    call: (app, _w, i) =>
      json(app, "DELETE", `/api/attachments/${i.attachmentId}`),
  },
  {
    matrixKey: "POST /api/attachments/{id}/complete",
    successStatus: 400,
    prepare: async (w, i, app) => {
      await asProjectMember(w, async () => {
        const r = await json(
          app,
          "POST",
          `/api/work-items/${i.key}/attachments/presign`,
          { filename: "probe.png", contentType: "image/png", size: 1024 },
        );
        expect(r.status, await r.clone().text()).toBe(200);
        i.attachmentId = (
          (await r.json()) as { attachmentId: string }
        ).attachmentId;
      });
    },
    call: (app, _w, i) =>
      json(app, "POST", `/api/attachments/${i.attachmentId}/complete`),
  },
  {
    matrixKey: "POST /api/work-items/{key}/approvals",
    successStatus: 400,
    capability: "handler",
    call: (app, _w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/approvals`, {}),
  },
  {
    matrixKey: "PATCH /api/comments/{id}",
    prepare: async (w, i, app) => {
      await asProjectMember(w, async () => {
        const r = await json(app, "POST", `/api/work-items/${i.key}/comments`, {
          body: { type: "doc", content: [] },
          visibility: "public",
        });
        expect(r.status, await r.clone().text()).toBe(200);
        i.commentId = ((await r.json()) as { id: string }).id;
      });
    },
    call: (app, _w, i) =>
      json(app, "PATCH", `/api/comments/${i.commentId}`, {
        body: { type: "doc", content: [] },
      }),
  },
  {
    matrixKey: "DELETE /api/comments/{id}",
    prepare: async (w, i, app) => {
      await asProjectMember(w, async () => {
        const r = await json(app, "POST", `/api/work-items/${i.key}/comments`, {
          body: { type: "doc", content: [] },
          visibility: "public",
        });
        expect(r.status, await r.clone().text()).toBe(200);
        i.commentId = ((await r.json()) as { id: string }).id;
      });
    },
    call: (app, _w, i) => json(app, "DELETE", `/api/comments/${i.commentId}`),
  },
);

export function hashApiKey(key: string) {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Mint an API key owned by `userId` with the given permission scope (null = unscoped). */
export async function makeApiKey(userId: string, permissions: unknown) {
  const raw = `taskdesk_reach_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKey(raw),
    name: "reach test",
    start: raw.slice(0, 12),
    prefix: "taskdesk",
    permissions:
      permissions === null ? null : JSON.stringify(permissions as object),
    createdAt: now,
    updatedAt: now,
  });
  return raw;
}

export type Seed = {
  taskId: string;
  otherTaskId: string;
  activityId: string;
  relationId: string;
  columnId: string;
};
export async function seedLegacy(
  world: World,
  memberUserId: string,
): Promise<Seed> {
  const [col] = await db
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, world.project.id))
    .limit(1);
  if (!col) throw new Error("no column");
  const mk = async (n: number) => {
    const [t] = await db
      .insert(schema.taskTable)
      .values({
        projectId: world.project.id,
        title: n === 1 ? "Confidential legacy task" : "Other task",
        description: "d",
        priority: "medium",
        status: col.slug,
        columnId: col.id,
        number: n,
        position: n,
      })
      .returning();
    if (!t) throw new Error("task");
    return t;
  };
  const task = await mk(1);
  const other = await mk(2);
  const [activity] = await db
    .insert(schema.taskActivityTable)
    .values({
      taskId: task.id,
      type: "comment",
      userId: memberUserId,
      content: "legacy comment",
    })
    .returning();
  const [relation] = await db
    .insert(schema.taskRelationTable)
    .values({
      sourceTaskId: task.id,
      targetTaskId: other.id,
      relationType: "blocks",
    })
    .returning();
  if (!activity || !relation) throw new Error("seed");
  return {
    taskId: task.id,
    otherTaskId: other.id,
    activityId: activity.id,
    relationId: relation.id,
    columnId: col.id,
  };
}
