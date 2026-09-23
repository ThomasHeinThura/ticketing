import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
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

  it("websocket: an authenticated caller receives the unknown-project response for a foreign project", async () => {
    const { caller, project } = await foreignProjectFixture();
    mockAuthenticatedSession(caller.user);
    const { app } = createApp();
    const headers = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
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
