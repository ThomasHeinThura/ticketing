import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

async function responseShape(response: Response) {
  const requestId = response.headers.get("x-taskdesk-request-id");
  expect(requestId).toMatch(/^[0-9a-f]{32}$/);

  return {
    status: response.status,
    body: await response.clone().text(),
    headers: [...response.headers.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([name]) => name !== "x-taskdesk-request-id"),
    requestId,
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

function queriesForTable(
  calls: readonly (readonly [unknown, ...unknown[]])[],
  table: string,
): number {
  const source = `from "${table.toLowerCase()}"`;
  return calls.filter(([query]) =>
    queryText(query).toLowerCase().includes(source),
  ).length;
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
  const [foreignShape, missingShape] = await Promise.all([
    responseShape(foreign),
    responseShape(missing),
  ]);
  const { requestId: foreignRequestId, ...foreignEqualityShape } = foreignShape;
  const { requestId: missingRequestId, ...missingEqualityShape } = missingShape;
  expect(foreignRequestId).not.toBe(missingRequestId);
  expect(foreignEqualityShape).toEqual(missingEqualityShape);
}

describe("P0 #317 response correlation witness", () => {
  const response = (headers: HeadersInit = {}) =>
    new Response("same response", { status: 404, headers });

  it.each([
    undefined,
    "",
    "0123456789abcdef0123456789abcdeG",
    "0123456789ABCDEF0123456789abcdef",
    "0123456789abcdef0123456789abcde",
  ])("rejects missing or malformed server request id %s", async (requestId) => {
    const headers = new Headers();
    if (requestId !== undefined) {
      headers.set("x-taskdesk-request-id", requestId);
    }
    await expect(
      compareResponses(
        response(headers),
        response({
          "x-taskdesk-request-id": "0123456789abcdef0123456789abcdef",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a reflected request id", async () => {
    const reflectedId = "0123456789abcdef0123456789abcdef";
    await expect(
      compareResponses(
        response({ "x-taskdesk-request-id": reflectedId }),
        response({ "x-taskdesk-request-id": reflectedId }),
      ),
    ).rejects.toThrow();
  });

  it("ignores only the distinct request id while preserving header equality", async () => {
    const commonHeaders = { "cache-control": "no-store" };
    await expect(
      compareResponses(
        response({
          ...commonHeaders,
          "x-taskdesk-request-id": "0123456789abcdef0123456789abcdef",
        }),
        response({
          ...commonHeaders,
          "x-taskdesk-request-id": "fedcba9876543210fedcba9876543210",
        }),
      ),
    ).resolves.toBeUndefined();

    await expect(
      compareResponses(
        response({
          "cache-control": "no-store",
          "x-taskdesk-request-id": "0123456789abcdef0123456789abcdef",
        }),
        response({
          "cache-control": "public",
          "x-taskdesk-request-id": "fedcba9876543210fedcba9876543210",
        }),
      ),
    ).rejects.toThrow();
  });
});

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

  it("S1/S4: asset foreign and missing lookups use the same single database round trip", async () => {
    // Before the fold, the asset row was fetched by id alone (1 query), then a
    // separate `validateWorkspaceAccess` call ran for a foreign id only (2 more
    // queries) -- an other-tenant id cost 3 round trips against a missing id's
    // 1. `loadReachableAsset` (`authorize-asset-access.ts`) now folds
    // `reachableWorkspacePredicate` into the same query as the row lookup, so
    // both cases cost exactly one.
    const { caller, asset } = await foreignAssetFixture();
    mockAuthenticatedSession(caller.user);
    const { app } = createApp();
    const querySpy = vi.spyOn(getDatabasePool(), "query");

    const foreign = await app.request(`/api/asset/${asset.id}`);
    const foreignQueries = queriesForTable(querySpy.mock.calls, "asset");
    querySpy.mockClear();
    const missing = await app.request("/api/asset/asset-does-not-exist");
    const missingQueries = queriesForTable(querySpy.mock.calls, "asset");

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreignQueries).toBe(1);
    expect(missingQueries).toBe(foreignQueries);
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
    const foreignQueries = queriesForTable(querySpy.mock.calls, "label");
    querySpy.mockClear();
    const missing = await app.request("/api/label/missing-label-s4");
    const missingQueries = queriesForTable(querySpy.mock.calls, "label");

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

  it("keeps project reads fail-closed for an API key whose owner has project authority", async () => {
    const caller = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: caller.workspace.id,
    });
    await grantProjectRole(caller.user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    const rawKey = await createApiKeyFor(caller.user.id);
    const { app } = createApp();

    const response = await app.request(
      `/api/projects/${project.id}/work-items`,
      { headers: { "x-api-key": rawKey } },
    );

    // The current key schema has no canonical capability-subset column. The identity
    // loader therefore resolves keyCapabilities as [], which must continue to clamp
    // the owner's otherwise-valid project role rather than infer a translation from
    // Better Auth's unrelated permission shape.
    expect(response.status).toBe(403);
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
    await grantProjectRole(caller.user.id, ownProject.id, [
      "project:read",
      "work_item:read",
    ]);
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

    const foreignLabelDelete = await app.request(
      `/api/label/${foreignLabel.id}`,
      { method: "DELETE" },
    );
    const missingLabelDelete = await app.request(
      "/api/label/missing-caller-owned-predicate",
      { method: "DELETE" },
    );
    await compareResponses(foreignLabelDelete, missingLabelDelete);
    expect(foreignLabelDelete.status).toBe(404);
    expect(
      await db.query.labelTable.findFirst({
        where: eq(schema.labelTable.id, foreignLabel.id),
      }),
    ).toBeDefined();

    expect((await app.request(`/api/task/${ownTask.id}`)).status).toBe(200);
    const foreignTaskResponse = await app.request(
      `/api/task/${foreignTask.id}`,
    );
    const missingTaskResponse = await app.request(
      "/api/task/missing-caller-owned-predicate",
    );
    await compareResponses(foreignTaskResponse, missingTaskResponse);
    expect(foreignTaskResponse.status).toBe(404);
  });

  it("websocket: an authenticated caller receives the unknown-project response for a foreign project", async () => {
    const { caller, project } = await foreignProjectFixture();
    mockAuthenticatedSession(caller.user);
    const { app } = createApp();
    const headers = {
      host: "localhost:1337",
      origin: "http://localhost:1337",
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

  it("S1/S4: websocket foreign and missing lookups use the same single database round trip", async () => {
    // Same fold as the asset route, applied to `/api/ws/:projectId`
    // (`index.ts`): before, a foreign project ran the project lookup plus a
    // separate `validateWorkspaceAccess` (3 queries); a missing one ran only
    // the lookup (1). Both are now one query.
    const { caller, project } = await foreignProjectFixture();
    mockAuthenticatedSession(caller.user);
    const { app } = createApp();
    const headers = {
      host: "localhost:1337",
      origin: "http://localhost:1337",
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": Buffer.from("the sample nonce").toString("base64"),
    };
    const querySpy = vi.spyOn(getDatabasePool(), "query");

    const foreign = await app.request(`/api/ws/${project.id}`, { headers });
    const foreignQueries = queriesForTable(querySpy.mock.calls, "project");
    querySpy.mockClear();
    const missing = await app.request("/api/ws/project-does-not-exist", {
      headers,
    });
    const missingQueries = queriesForTable(querySpy.mock.calls, "project");

    expect(foreign.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(foreignQueries).toBe(1);
    expect(missingQueries).toBe(foreignQueries);
  });
});
