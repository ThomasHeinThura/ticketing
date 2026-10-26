import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";
import { ensureCreationWorkflow } from "./helpers/workflow";

async function seedSearchWorld() {
  const member = await createWorkspaceMember({ role: "member" });
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantProjectRole(member.user.id, project.id, [
    "work_item:read",
    "work_item:create",
    "project:read",
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
  if (!type || !template) throw new Error("search fixture failed");
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
  const created = await app.request(`/api/projects/${project.id}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId: type.id, title: "Identity reuse target" }),
  });
  expect(created.status, await created.clone().text()).toBe(200);
  const item = (await created.json()) as { id: string; key: string };
  return { member, project, app, item };
}

async function searchWorkItems(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  headers?: Record<string, string>,
) {
  const response = await app.request(
    `/api/search?q=Identity%20reuse%20target&workspaceId=${workspaceId}&type=work_items`,
    { headers },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as {
    results: { id: string; type: string }[];
  };
}

async function countIdentityLoaderReads<T>(run: () => Promise<T>) {
  const pool = db.$client;
  const original = pool.query.bind(pool);
  let identityLoads = 0;
  let standaloneProjectFactLoads = 0;
  const spy = vi.spyOn(pool, "query").mockImplementation((...args) => {
    const query: unknown = args[0];
    const text =
      typeof query === "string"
        ? query
        : typeof query === "object" && query !== null && "text" in query
          ? String(query.text)
          : "";
    if (
      /from\s+"user"[\s\S]*left join\s+"person"[\s\S]*left join\s+"organisation"/iu.test(
        text,
      )
    )
      identityLoads += 1;
    if (/\bfrom\s+"?project"?(?:\s|$)/iu.test(text))
      standaloneProjectFactLoads += 1;
    return original(...args);
  });
  try {
    const value = await run();
    return { value, identityLoads, standaloneProjectFactLoads };
  } finally {
    spy.mockRestore();
  }
}

describe("global search request-local identity reuse", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("resolves once per request, preserves project authority and key clamp, and sees role revocation on the next request", async () => {
    const { member, project, app, item } = await seedSearchWorld();

    const sessionRequest = await countIdentityLoaderReads(() =>
      searchWorkItems(app, member.workspace.id),
    );
    const sessionResults = sessionRequest.value;
    expect(sessionResults.results.map(({ id }) => id)).toContain(item.id);
    expect(sessionRequest.identityLoads).toBe(1);
    expect(sessionRequest.standaloneProjectFactLoads).toBe(1);

    const apiKey = await createPersonalApiKey(
      { userId: member.user.id },
      {
        name: "global search identity clamp",
        capabilities: ["workspace:read"],
      },
    );
    mockAnonymousSession();
    const keyRequest = await countIdentityLoaderReads(() =>
      searchWorkItems(app, member.workspace.id, {
        "x-api-key": apiKey.key,
      }),
    );
    const keyResults = keyRequest.value;
    expect(keyResults.results.map(({ id }) => id)).not.toContain(item.id);
    expect(keyRequest.identityLoads).toBe(1);
    expect(keyRequest.standaloneProjectFactLoads).toBe(1);

    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id))
      .limit(1);
    if (!person) throw new Error("search fixture person missing");
    const [projectGrant] = await db
      .select({ roleId: schema.membershipTable.roleId })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      )
      .limit(1);
    if (!projectGrant) throw new Error("project read grant missing");
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["project:read"] })
      .where(eq(schema.roleTable.id, projectGrant.roleId));

    mockAuthenticatedSession(member.user);
    const revokedRequest = await countIdentityLoaderReads(() =>
      searchWorkItems(app, member.workspace.id),
    );
    const revokedResults = revokedRequest.value;
    expect(revokedResults.results.map(({ id }) => id)).not.toContain(item.id);
    expect(revokedRequest.identityLoads).toBe(1);
    expect(revokedRequest.standaloneProjectFactLoads).toBe(1);
  });

  it("retains impersonation identity semantics and leaves structured search on fresh resolution", async () => {
    const { member, app, item } = await seedSearchWorld();

    mockAuthenticatedSession(member.user, { impersonatedBy: "acting-admin" });
    const globalRequest = await countIdentityLoaderReads(() =>
      searchWorkItems(app, member.workspace.id),
    );
    const globalResults = globalRequest.value;
    expect(globalResults.results.map(({ id }) => id)).toContain(item.id);
    expect(globalRequest.identityLoads).toBe(1);

    const structuredRequest = await countIdentityLoaderReads(async () => {
      const structured = await app.request("/api/work-items/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: member.workspace.id,
          query: { entity: "work_item" },
          limit: 20,
        }),
      });
      expect(structured.status, await structured.clone().text()).toBe(200);
      return (await structured.json()) as { data: { id: string }[] };
    });
    const body = structuredRequest.value;
    expect(body.data.map(({ id }) => id)).toContain(item.id);
    expect(structuredRequest.identityLoads).toBe(1);
  });
});
