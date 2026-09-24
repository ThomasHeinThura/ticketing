import { createHash, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

function responseShape(response: Response) {
  return {
    status: response.status,
    body: response.clone().text(),
    headers: [...response.headers.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  };
}

function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function queryText(query: unknown): string {
  if (typeof query === "string") return query;
  if (
    typeof query === "object" &&
    query !== null &&
    "text" in query &&
    typeof query.text === "string"
  ) {
    return query.text;
  }
  return "";
}

async function createApiKeyFor(userId: string): Promise<string> {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "existence oracle S4 test",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

async function compareResponses(foreign: Response, missing: Response) {
  expect(await responseShape(foreign).body).toBe(
    await responseShape(missing).body,
  );
  expect(foreign.status).toBe(missing.status);
  expect(
    [...foreign.headers.entries()].sort(([a], [b]) => a.localeCompare(b)),
  ).toEqual(
    [...missing.headers.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function foreignAssetFixture() {
  const caller = await createWorkspaceMember();
  const owner = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const asset = requireRow(
    await db
      .insert(schema.assetTable)
      .values({
        id: "asset-exists-outside-caller-reach",
        workspaceId: owner.workspace.id,
        projectId: project.id,
        objectKey: `workspace/${owner.workspace.id}/hidden.png`,
        filename: "hidden.png",
        mimeType: "image/png",
        size: 1,
        createdBy: owner.user.id,
      })
      .returning(),
    "foreign asset",
  );
  return { caller, asset };
}

async function foreignProjectFixture() {
  const caller = await createWorkspaceMember();
  const owner = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  return { caller, project };
}

describe("P0 #317: existence equality outside workspace middleware", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asset: an authenticated caller receives the same response for a foreign and missing id", async () => {
    const { caller, asset } = await foreignAssetFixture();
    mockAuthenticatedSession(caller.user);
    const { app } = createApp();

    const foreign = await app.request(`/api/asset/${asset.id}`);
    const missing = await app.request("/api/asset/asset-does-not-exist");

    await compareResponses(foreign, missing);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe("Asset not found");
  });

  it("asset: unauthenticated callers retain the authentication response", async () => {
    const { asset } = await foreignAssetFixture();
    mockAnonymousSession();
    const { app } = createApp();

    const foreign = await app.request(`/api/asset/${asset.id}`);
    const missing = await app.request("/api/asset/asset-does-not-exist");

    await compareResponses(foreign, missing);
    expect(foreign.status).toBe(401);
  });

  it("P0 S4: foreign and missing lookups use the same single database round trip", async () => {
    const caller = await createWorkspaceMember();
    const owner = await createWorkspaceMember();
    const foreignLabel = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          name: "Private label",
          color: "#123456",
          workspaceId: owner.workspace.id,
        })
        .returning(),
      "foreign label",
    );
    mockAuthenticatedSession(caller.user);
    const { app } = createApp();
    const querySpy = vi.spyOn(getDatabasePool(), "query");

    const foreign = await app.request(`/api/label/${foreignLabel.id}`);
    const foreignQueries = querySpy.mock.calls.length;
    querySpy.mockClear();
    const missing = await app.request("/api/label/missing-label-s4");
    const missingQueries = querySpy.mock.calls.length;

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreignQueries).toBe(1);
    expect(missingQueries).toBe(foreignQueries);

    const medianRequestMs = async (url: string) => {
      const samples: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const startedAt = performance.now();
        await app.request(url);
        samples.push(performance.now() - startedAt);
      }
      samples.sort((left, right) => left - right);
      return samples[Math.floor(samples.length / 2)] ?? 0;
    };
    const foreignP50 = await medianRequestMs(`/api/label/${foreignLabel.id}`);
    const missingP50 = await medianRequestMs("/api/label/missing-label-s4");
    console.info(
      `P0 #317 S4 PG18 integration p50: foreign=${foreignP50.toFixed(2)}ms, missing=${missingP50.toFixed(2)}ms; both used ${foreignQueries} SQL round trip.`,
    );
  });

  it("P0 S4: API-key reach is folded into the same foreign and missing lookup", async () => {
    const caller = await createWorkspaceMember();
    const owner = await createWorkspaceMember();
    const foreignLabel = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          name: "Private API-key label",
          color: "#123456",
          workspaceId: owner.workspace.id,
        })
        .returning(),
      "foreign API-key label",
    );
    const rawKey = await createApiKeyFor(caller.user.id);
    const { app } = createApp();
    const querySpy = vi.spyOn(getDatabasePool(), "query");
    const headers = { "x-api-key": rawKey };

    const foreign = await app.request(`/api/label/${foreignLabel.id}`, {
      headers,
    });
    const foreignLookupCalls = querySpy.mock.calls.filter(([query]) => {
      return queryText(query).toLowerCase().includes('from "label"');
    });
    querySpy.mockClear();
    const missing = await app.request("/api/label/missing-api-key-label-s4", {
      headers,
    });
    const missingLookupCalls = querySpy.mock.calls.filter(([query]) => {
      return queryText(query).toLowerCase().includes('from "label"');
    });

    await compareResponses(foreign, missing);
    expect(foreign.status).toBe(404);
    expect(foreignLookupCalls).toHaveLength(1);
    expect(missingLookupCalls).toHaveLength(1);
    expect(queryText(foreignLookupCalls[0]?.[0])).toContain('"apikey"');
    expect(queryText(foreignLookupCalls[0]?.[0])).toContain(
      '"workspace_member"',
    );
  });

  it("P0 S4: bulk task reach is folded into each foreign and missing lookup", async () => {
    const caller = await createWorkspaceMember();
    const owner = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const foreignTask = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Private bulk task",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
        })
        .returning(),
      "foreign bulk task",
    );
    mockAuthenticatedSession(caller.user);
    const { app } = createApp();
    const querySpy = vi.spyOn(getDatabasePool(), "query");

    const request = (taskId: string) =>
      app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskIds: [taskId],
          operation: "updatePriority",
          value: "high",
        }),
      });

    const foreign = await request(foreignTask.id);
    const foreignLookups = querySpy.mock.calls.filter(([query]) =>
      queryText(query).toLowerCase().includes('from "task"'),
    );
    const foreignQuery = foreignLookups[0]?.[0];
    querySpy.mockClear();
    const missing = await request(`missing-${randomUUID()}`);
    const missingLookups = querySpy.mock.calls.filter(([query]) =>
      queryText(query).toLowerCase().includes('from "task"'),
    );

    await compareResponses(foreign, missing);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe("No tasks found");
    expect(foreignLookups).toHaveLength(1);
    expect(missingLookups).toHaveLength(1);
    expect(queryText(foreignQuery)).toContain('"workspace_member"');
    expect(queryText(foreignQuery)).toContain("EXISTS");
  });

  it("P0 S4: lookup reach predicates stay grouped when caller-owned rows exist", async () => {
    const caller = await createWorkspaceMember();
    const owner = await createWorkspaceMember();
    const ownLabel = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          name: "Caller workspace label",
          color: "#123456",
          workspaceId: caller.workspace.id,
        })
        .returning(),
      "caller label",
    );
    const foreignLabel = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          name: "Foreign workspace label",
          color: "#654321",
          workspaceId: owner.workspace.id,
        })
        .returning(),
      "foreign label",
    );
    const { project: ownProject, columns: ownColumns } =
      await createProjectFixture({ workspaceId: caller.workspace.id });
    const ownTask = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: ownProject.id,
          title: "Caller workspace task",
          status: "to-do",
          columnId: ownColumns.todo.id,
          number: 1,
          position: 1,
        })
        .returning(),
      "caller task",
    );
    const { project: foreignProject, columns: foreignColumns } =
      await createProjectFixture({ workspaceId: owner.workspace.id });
    const foreignTask = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: foreignProject.id,
          title: "Foreign workspace task",
          status: "to-do",
          columnId: foreignColumns.todo.id,
          number: 1,
          position: 1,
        })
        .returning(),
      "foreign task",
    );

    mockAuthenticatedSession(caller.user);
    const { app } = createApp();

    // Direct lookup (`label`) and joined lookup (`task` -> `project`) both
    // need the resource id AND the grouped reach predicate to match one row.
    expect((await app.request(`/api/label/${ownLabel.id}`)).status).toBe(200);
    const foreignLabelResponse = await app.request(
      `/api/label/${foreignLabel.id}`,
    );
    const missingLabelResponse = await app.request(
      "/api/label/missing-caller-owned-predicate",
    );
    await compareResponses(foreignLabelResponse, missingLabelResponse);
    expect(foreignLabelResponse.status).toBe(404);

    expect((await app.request(`/api/task/${ownTask.id}`)).status).toBe(200);
    const foreignTaskResponse = await app.request(
      `/api/task/${foreignTask.id}`,
    );
    const missingTaskResponse = await app.request(
      "/api/task/missing-caller-owned-predicate",
    );
    await compareResponses(foreignTaskResponse, missingTaskResponse);
    expect(foreignTaskResponse.status).toBe(404);

    // `lookupMany` uses the same `inArray AND reach` shape. A mixed bulk write
    // may update the caller's row, but must never mutate the foreign row.
    const bulk = await app.request("/api/task/bulk", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskIds: [ownTask.id, foreignTask.id],
        operation: "updatePriority",
        value: "high",
      }),
    });
    expect(bulk.status).toBe(200);
    const persistedTasks = await db
      .select({ id: schema.taskTable.id, priority: schema.taskTable.priority })
      .from(schema.taskTable)
      .where(inArray(schema.taskTable.id, [ownTask.id, foreignTask.id]));
    expect(
      persistedTasks.find((task) => task.id === ownTask.id)?.priority,
    ).toBe("high");
    expect(
      persistedTasks.find((task) => task.id === foreignTask.id)?.priority,
    ).toBe("low");
  });

  it("websocket: an authenticated caller receives the unknown-project response for a foreign project", async () => {
    const { caller, project } = await foreignProjectFixture();
    mockAuthenticatedSession(caller.user);
    const { app } = createApp();
    const headers = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": Buffer.from("the sample nonce").toString("base64"),
    };

    const foreign = await app.request(`/api/ws/${project.id}`, { headers });
    const missing = await app.request("/api/ws/project-does-not-exist", {
      headers,
    });

    await compareResponses(foreign, missing);
    expect(foreign.status).toBe(401);
    expect(await foreign.text()).toBe("Unauthorized");
  });
});
