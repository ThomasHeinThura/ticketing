import { randomUUID } from "node:crypto";
import { can, defaultRolePayloads } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import type { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { policyShadowTallyTable } from "../../apps/api/src/permissions/shadow-schema";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];
type AuthModule = typeof import("../../apps/api/src/auth");

async function createShadowApp(): Promise<{
  app: App;
  mockUser: (user: { id: string; role?: string | null }) => void;
}> {
  process.env.TASKDESK_POLICY_SHADOW = "on";
  vi.resetModules();
  const indexModule = await import("../../apps/api/src/index");
  const authModule: AuthModule = await import("../../apps/api/src/auth");
  const app = indexModule.createApp().app;
  const request = app.request.bind(app);
  app.request = (input, init, env, executionCtx) => {
    if (typeof input === "string") {
      const normalized = withConfiguredAgentAuthority(input, init);
      return request(normalized.input, normalized.init, env, executionCtx);
    }
    return request(input, init, env, executionCtx);
  };
  return {
    app,
    mockUser: (user) => {
      vi.spyOn(authModule.auth.api, "getSession").mockResolvedValue({
        session: {
          id: `session-${user.id}`,
          token: `token-${user.id}`,
          userId: user.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
          ipAddress: null,
          userAgent: null,
          portal: "agent",
        },
        // User role is a plain user-table column, outside Better Auth's User type.
        // biome-ignore lint/suspicious/noExplicitAny: test session includes the persisted role.
        user: user as any,
      });
    },
  };
}

async function waitForAgreeTally(routeKey: string, previousCount: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await db
      .select()
      .from(policyShadowTallyTable)
      .where(eq(policyShadowTallyTable.routeKey, routeKey));
    const agreeCount = rows
      .filter((row) => row.outcome === "agree" && row.reasonCode === null)
      .reduce((sum, row) => sum + row.count, 0);
    if (agreeCount > previousCount) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`shadow agreement was not written for ${routeKey}`);
}

async function agreeCount(routeKey: string): Promise<number> {
  const rows = await db
    .select()
    .from(policyShadowTallyTable)
    .where(eq(policyShadowTallyTable.routeKey, routeKey));
  return rows
    .filter((row) => row.outcome === "agree" && row.reasonCode === null)
    .reduce((sum, row) => sum + row.count, 0);
}

function shadowRouteKey(path: string): string | undefined {
  const routes: readonly [string, string][] = [
    ["/api/column/", "GET /api/column/{projectId}"],
    ["/api/workflow-rule/", "GET /api/workflow-rule/{projectId}"],
    ["/api/projects/", ""],
    ["/api/task/tasks/", "GET /api/task/tasks/{projectId}"],
    ["/api/task/export/", "GET /api/task/export/{projectId}"],
    ["/api/project/", ""],
    ["/api/task/", ""],
    ["/api/activity/", "GET /api/activity/{taskId}"],
    ["/api/comment/", "GET /api/comment/{taskId}"],
    ["/api/task-relation/", "GET /api/task-relation/{taskId}"],
    ["/api/external-link/task/", "GET /api/external-link/task/{taskId}"],
    ["/api/work-items/", ""],
    ["/api/attachments/", "GET /api/attachments/{id}"],
  ];
  for (const [prefix, routeKey] of routes) {
    if (!path.startsWith(prefix)) continue;
    if (routeKey) return routeKey;
    if (prefix === "/api/projects/") {
      return path.endsWith("/work-items")
        ? "GET /api/projects/{projectId}/work-items"
        : "GET /api/projects/{projectId}/assignable";
    }
    if (prefix === "/api/project/") {
      if (path.endsWith("/milestones"))
        return "GET /api/project/{id}/milestones";
      if (path.endsWith("/prerequisites"))
        return "GET /api/project/{id}/prerequisites";
      if (path.endsWith("/stakeholders"))
        return "GET /api/project/{id}/stakeholders";
      if (path.endsWith("/document-links"))
        return "GET /api/project/{id}/document-links";
      return "GET /api/project/{id}";
    }
    if (prefix === "/api/task/") return "GET /api/task/{id}";
    if (prefix === "/api/work-items/") {
      if (path.endsWith("/tree")) return "GET /api/work-items/{key}/tree";
      if (path.endsWith("/activity"))
        return "GET /api/work-items/{key}/activity";
      if (path.endsWith("/transitions"))
        return "GET /api/work-items/{key}/transitions";
      if (path.endsWith("/attachments"))
        return "GET /api/work-items/{key}/attachments";
      return "GET /api/work-items/{key}";
    }
  }
  return undefined;
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: the shadow switch is read at import time by this integration fixture.
  delete process.env.TASKDESK_POLICY_SHADOW;
  vi.resetModules();
  vi.restoreAllMocks();
});

const PROJECT_READ_ROUTES = [
  (projectId: string) => `/api/column/${projectId}`,
  (projectId: string) => `/api/workflow-rule/${projectId}`,
  (projectId: string) => `/api/projects/${projectId}/work-items`,
  (projectId: string) => `/api/projects/${projectId}/assignable`,
  (projectId: string) => `/api/task/tasks/${projectId}`,
  (projectId: string) => `/api/task/export/${projectId}`,
  (projectId: string) => `/api/project/${projectId}`,
  (projectId: string) => `/api/project/${projectId}/milestones`,
  (projectId: string) => `/api/project/${projectId}/prerequisites`,
  (projectId: string) => `/api/project/${projectId}/stakeholders`,
  (projectId: string) => `/api/project/${projectId}/document-links`,
] as const;

const TASK_READ_ROUTES = [
  (taskId: string) => `/api/task/${taskId}`,
  (taskId: string) => `/api/activity/${taskId}`,
  (taskId: string) => `/api/comment/${taskId}`,
  (taskId: string) => `/api/task-relation/${taskId}`,
  (taskId: string) => `/api/external-link/task/${taskId}`,
] as const;

const WORK_ITEM_READ_ROUTES = [
  (key: string) => `/api/work-items/${key}`,
  (key: string) => `/api/work-items/${key}/tree`,
  (key: string) => `/api/work-items/${key}/activity`,
  (key: string) => `/api/work-items/${key}/transitions`,
  (key: string) => `/api/work-items/${key}/attachments`,
] as const;

const WORK_ITEM_READ_ROUTE_KEYS = new Set([
  "GET /api/projects/{projectId}/work-items",
  "GET /api/projects/{projectId}/assignable",
  "GET /api/task/tasks/{projectId}",
  "GET /api/task/export/{projectId}",
  "GET /api/task/{id}",
  "GET /api/activity/{taskId}",
  "GET /api/comment/{taskId}",
  "GET /api/task-relation/{taskId}",
  "GET /api/external-link/task/{taskId}",
  "GET /api/work-items/{key}",
  "GET /api/work-items/{key}/tree",
  "GET /api/work-items/{key}/activity",
  "GET /api/work-items/{key}/transitions",
  "GET /api/work-items/{key}/attachments",
  "GET /api/attachments/{id}",
]);

async function addWorkspaceActor(
  workspaceId: string,
  role: "admin" | "member",
) {
  const actor = await createWorkspaceMember({ role });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: actor.user.id,
    role,
    joinedAt: new Date(),
  });
  await db
    .insert(schema.workspaceRoleTable)
    .values({
      workspaceId,
      role,
      permission: JSON.stringify(defaultRolePayloads[role]),
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [
        schema.workspaceRoleTable.workspaceId,
        schema.workspaceRoleTable.role,
      ],
    });
  return actor;
}

async function addReachMembership(
  personId: string,
  workspaceId: string,
  projectId: string,
  scope: "project" | "workspace",
  seesAll = false,
  capabilities: readonly string[] = ["project:read", "work_item:read"],
) {
  const role = await db
    .insert(schema.roleTable)
    .values({
      scope,
      workspaceId,
      key: `project-reach-${randomUUID()}`,
      name: "Project reach fixture",
      rank: 1,
      capabilities: [...capabilities],
    })
    .returning()
    .then(([row]) => row);
  if (!role) throw new Error("project reach role insert returned no row");
  await db.insert(schema.membershipTable).values({
    personId,
    scope,
    scopeId: scope === "project" ? projectId : workspaceId,
    roleId: role.id,
    seesAll,
  });
}

describe("native project read reach", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("requires persisted project reach on every project-scoped GET without changing capability gates", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });

    const now = new Date();
    const type = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `project-reach-${randomUUID()}`,
        name: "Project reach fixture",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .then(([row]) => row);
    if (!type) throw new Error("work item type fixture insert returned no row");
    const stateTemplate = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `project-reach-${randomUUID()}`,
        name: "Project reach state",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .then(([row]) => row);
    if (!stateTemplate)
      throw new Error("state template fixture insert returned no row");
    await db.insert(schema.stateTable).values({
      projectId: project.id,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    const [legacyTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Project reach task",
        description: "Fixture",
        priority: "medium",
        status: "to-do",
        number: 1,
        position: 1,
      })
      .returning();
    if (!legacyTask)
      throw new Error("legacy task fixture insert returned no row");

    const fresh = await createShadowApp();
    const { app } = fresh;
    fresh.mockUser(owner.user);
    const createWorkItem = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Project reach work item",
        }),
      },
    );
    expect(createWorkItem.status).toBe(200);
    const createdWorkItem = (await createWorkItem.json()) as { key: string };
    const [workItem] = await db
      .select({
        id: schema.workItemTable.id,
        workspaceId: schema.workItemTable.workspaceId,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdWorkItem.key))
      .limit(1);
    if (!workItem) throw new Error("work item fixture insert returned no row");

    const plainMember = await addWorkspaceActor(owner.workspace.id, "member");
    const directMember = await addWorkspaceActor(owner.workspace.id, "member");
    const seesAllMember = await addWorkspaceActor(owner.workspace.id, "admin");
    const limitedProjectMember = await addWorkspaceActor(
      owner.workspace.id,
      "admin",
    );
    const emptyProjectMember = await addWorkspaceActor(
      owner.workspace.id,
      "admin",
    );
    const globalAdmin = await createWorkspaceMember({ role: "member" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, globalAdmin.user.id));

    const [directPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, directMember.user.id))
      .limit(1);
    const [seesAllPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, seesAllMember.user.id))
      .limit(1);
    const [limitedPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, limitedProjectMember.user.id))
      .limit(1);
    const [emptyPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, emptyProjectMember.user.id))
      .limit(1);
    if (!directPerson || !seesAllPerson || !limitedPerson || !emptyPerson) {
      throw new Error("project reach fixture person was not provisioned");
    }
    await addReachMembership(
      directPerson.id,
      owner.workspace.id,
      project.id,
      "project",
    );
    await addReachMembership(
      seesAllPerson.id,
      owner.workspace.id,
      project.id,
      "workspace",
      true,
    );
    await addReachMembership(
      limitedPerson.id,
      owner.workspace.id,
      project.id,
      "project",
      false,
      ["project:read"],
    );
    await addReachMembership(
      emptyPerson.id,
      owner.workspace.id,
      project.id,
      "project",
      false,
      [],
    );

    const directIdentity = await resolveIdentity({
      userId: directMember.user.id,
      credential: "session",
    });
    const limitedIdentity = await resolveIdentity({
      userId: limitedProjectMember.user.id,
      credential: "session",
    });
    const emptyIdentity = await resolveIdentity({
      userId: emptyProjectMember.user.id,
      credential: "session",
    });
    if (!directIdentity || !limitedIdentity || !emptyIdentity) {
      throw new Error("project authority identity fixture was not resolved");
    }
    expect(
      can(directIdentity, "work_item:read", "work_item", {
        workspaceId: owner.workspace.id,
        workItemProjectId: project.id,
      }),
    ).toBe(true);
    expect(
      can(limitedIdentity, "project:read", "project", {
        workspaceId: owner.workspace.id,
        projectId: project.id,
      }),
    ).toBe(true);
    expect(
      can(limitedIdentity, "work_item:read", "work_item", {
        workspaceId: owner.workspace.id,
        workItemProjectId: project.id,
      }),
    ).toBe(false);
    expect(
      can(emptyIdentity, "project:read", "project", {
        workspaceId: owner.workspace.id,
        projectId: project.id,
      }),
    ).toBe(false);

    const [ownerPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id))
      .limit(1);
    if (!ownerPerson)
      throw new Error("owner person fixture was not provisioned");
    const [attachment] = await db
      .insert(schema.attachmentTable)
      .values({
        workspaceId: workItem.workspaceId,
        workItemId: workItem.id,
        objectKey: `project-reach/${randomUUID()}.txt`,
        filename: "project-reach.txt",
        mimeType: "text/plain",
        size: 1,
        state: "ready",
        uploadedBy: ownerPerson.id,
      })
      .returning();
    if (!attachment)
      throw new Error("attachment fixture insert returned no row");

    const targets = PROJECT_READ_ROUTES.map((route) => route(project.id));
    const resourceReads = [
      ...TASK_READ_ROUTES.map((route) => route(legacyTask.id)),
      ...WORK_ITEM_READ_ROUTES.map((route) => route(createdWorkItem.key)),
      `/api/attachments/${attachment.id}`,
    ];

    for (const actor of [owner, plainMember]) {
      fresh.mockUser(actor.user);
      const readPaths = [...targets, ...resourceReads];
      const baseline = new Map<string, number>();
      for (const path of readPaths) {
        const routeKey = shadowRouteKey(path);
        if (routeKey && !baseline.has(routeKey)) {
          baseline.set(routeKey, await agreeCount(routeKey));
        }
      }
      for (const target of targets) {
        const response = await app.request(target);
        expect(response.status, target).toBe(404);
        expect(await response.text(), target).toBe("Project not found");
      }
      for (const target of resourceReads) {
        const response = await app.request(target);
        expect(response.status, target).toBe(404);
      }
      for (const [routeKey, count] of baseline) {
        const rows = await waitForAgreeTally(routeKey, count);
        expect(
          rows.every(
            (row) => row.outcome === "agree" && row.reasonCode === null,
          ),
          routeKey,
        ).toBe(true);
      }
    }

    for (const actor of [directMember, seesAllMember]) {
      fresh.mockUser(actor.user);
      const readPaths = [...targets, ...resourceReads];
      const baseline = new Map<string, number>();
      for (const path of readPaths) {
        const routeKey = shadowRouteKey(path);
        if (routeKey && !baseline.has(routeKey)) {
          baseline.set(routeKey, await agreeCount(routeKey));
        }
      }
      for (const target of targets) {
        const response = await app.request(target);
        expect(response.status, target).toBe(200);
      }
      for (const target of resourceReads) {
        const response = await app.request(target);
        expect([200, 302], target).toContain(response.status);
      }
      for (const [routeKey, count] of baseline) {
        const rows = await waitForAgreeTally(routeKey, count);
        expect(
          rows.every(
            (row) => row.outcome === "agree" && row.reasonCode === null,
          ),
          routeKey,
        ).toBe(true);
      }
    }

    fresh.mockUser(limitedProjectMember.user);
    const limitedBaseline = new Map<string, number>();
    for (const path of [...targets, ...resourceReads]) {
      const routeKey = shadowRouteKey(path);
      if (routeKey && !limitedBaseline.has(routeKey)) {
        limitedBaseline.set(routeKey, await agreeCount(routeKey));
      }
    }
    for (const target of targets) {
      const response = await app.request(target);
      const routeKey = shadowRouteKey(target);
      expect(response.status, target).toBe(
        routeKey && WORK_ITEM_READ_ROUTE_KEYS.has(routeKey) ? 403 : 200,
      );
    }
    for (const target of resourceReads) {
      const response = await app.request(target);
      expect(response.status, target).toBe(403);
    }
    for (const [routeKey, count] of limitedBaseline) {
      const rows = await waitForAgreeTally(routeKey, count);
      expect(
        rows.every((row) => row.outcome === "agree" && row.reasonCode === null),
        routeKey,
      ).toBe(true);
    }

    fresh.mockUser(emptyProjectMember.user);
    const emptyBaseline = new Map<string, number>();
    for (const path of [...targets, ...resourceReads]) {
      const routeKey = shadowRouteKey(path);
      if (routeKey && !emptyBaseline.has(routeKey)) {
        emptyBaseline.set(routeKey, await agreeCount(routeKey));
      }
    }
    for (const target of [...targets, ...resourceReads]) {
      const response = await app.request(target);
      expect(response.status, target).toBe(403);
    }
    for (const [routeKey, count] of emptyBaseline) {
      const rows = await waitForAgreeTally(routeKey, count);
      expect(
        rows.every((row) => row.outcome === "agree" && row.reasonCode === null),
        routeKey,
      ).toBe(true);
    }

    fresh.mockUser(globalAdmin.user);
    const adminBaseline = new Map<string, number>();
    for (const path of [...targets, ...resourceReads]) {
      const routeKey = shadowRouteKey(path);
      if (routeKey && !adminBaseline.has(routeKey)) {
        adminBaseline.set(routeKey, await agreeCount(routeKey));
      }
    }
    for (const target of [...targets, ...resourceReads]) {
      const response = await app.request(target);
      expect(response.status, target).toBe(403);
    }
    for (const [routeKey, count] of adminBaseline) {
      const rows = await waitForAgreeTally(routeKey, count);
      expect(
        rows.every((row) => row.outcome === "agree" && row.reasonCode === null),
        routeKey,
      ).toBe(true);
    }
  });
});
