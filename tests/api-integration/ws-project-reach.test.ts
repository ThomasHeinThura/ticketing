/**
 * #745: the legacy project subscription (`GET /api/ws/{projectId}`) decides PROJECT reach, not
 * just workspace membership, at upgrade time and on every re-authorisation.
 *
 * Everything runs against the real Node listener with real sign-ups and memberships. A caller
 * who cannot reach the project must be refused exactly like a caller naming a project that does
 * not exist: same status, same body, no upgrade, and so no subscription.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp, createNodeServer } from "../../apps/api/src/index";
import {
  broadcastToProject,
  initializeWebSocketAdapter,
  shutdownWebSocketAdapter,
} from "../../apps/api/src/ws";
import { callerReachesLegacySocketProject } from "../../apps/api/src/ws/legacy-project-reach";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import { signUpUser } from "./helpers/organization-http";
import { PROJECT_SOCKET_ROUTE_KEYS } from "./helpers/project-reach-route-keys";
import { inviteAndAcceptAsNewMemberNative } from "./helpers/workspace-invitation-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

type TestSocket = {
  once(event: "open", listener: () => void): TestSocket;
  once(event: "error", listener: (error: Error) => void): TestSocket;
  once(
    event: "unexpected-response",
    listener: (request: ClientRequest, response: IncomingMessage) => void,
  ): TestSocket;
  once(
    event: "message",
    listener: (data: { toString(): string }) => void,
  ): TestSocket;
  once(event: "close", listener: (code: number) => void): TestSocket;
  close(): void;
};
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const WebSocket = apiRequire("ws") as {
  new (url: string, options: { headers: Record<string, string> }): TestSocket;
};

type Node = ReturnType<typeof createNodeServer>;

function listening(server: Node["server"]) {
  return new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

function url(node: Node, path: string) {
  return `ws://127.0.0.1:${(node.server.address() as AddressInfo).port}${path}`;
}

/** The refusal an upgrade attempt received: status and body, never an open socket. */
function handshake(target: string, headers: Record<string, string>) {
  return new Promise<{
    status: number;
    body: string;
    headers: Record<string, string | string[] | undefined>;
  }>((resolve, reject) => {
    const socket = new WebSocket(target, { headers });
    socket.once("unexpected-response", (_request, response) => {
      let body = "";
      response.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      response.once("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          body,
          headers: Object.fromEntries(
            Object.entries(response.headers).filter(
              ([name]) =>
                // Per-request id, and CORS headers that echo the request Origin.
                name !== "x-taskdesk-request-id" &&
                !name.startsWith("access-control-") &&
                name !== "vary",
            ),
          ),
        }),
      );
    });
    socket.once("open", () => {
      socket.close();
      reject(new Error("the upgrade unexpectedly succeeded"));
    });
    socket.once("error", reject);
  });
}

function open(target: string, headers: Record<string, string>) {
  return new Promise<TestSocket>((resolve, reject) => {
    const socket = new WebSocket(target, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function next(socket: TestSocket) {
  return new Promise<unknown>((resolve) =>
    socket.once("message", (data) => resolve(JSON.parse(data.toString()))),
  );
}

async function grantProjectRead(
  userId: string,
  workspaceId: string,
  projectId: string,
) {
  const person = requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1),
    "ws project reach fixture person",
  );
  const role = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "project",
        workspaceId,
        key: `ws-reach-${randomUUID()}`,
        name: "WS reach fixture role",
        rank: 1,
        capabilities: ["project:read", "work_item:read"],
      })
      .returning(),
    "ws project reach fixture role",
  );
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "project",
    scopeId: projectId,
    roleId: role.id,
  });
}

async function apiKeyFor(userId: string) {
  const rawKey = `taskdesk_test_${randomBytes(16).toString("hex")}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: createHash("sha256").update(rawKey).digest("base64url"),
    name: "ws project reach",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    createdAt: now,
    updatedAt: now,
  });
  return { host: "localhost:1337", authorization: `Bearer ${rawKey}` };
}

describe("project socket reach (#745)", () => {
  let closeServer: (() => Promise<unknown>) | undefined;

  beforeEach(async () => {
    await resetTestDatabase();
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
    await shutdownWebSocketAdapter();
  });

  async function world() {
    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Socket reach",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const asSession = (cookie: string) => ({
      host: "localhost:1337",
      origin: "http://localhost:1337",
      cookie,
    });
    const invite = (role: string) =>
      inviteAndAcceptAsNewMemberNative(app, owner.cookie, workspace.id, role);
    return { app, node, owner, workspace, project, asSession, invite };
  }

  it("covers every project socket route key", () => {
    expect([...PROJECT_SOCKET_ROUTE_KEYS]).toEqual(["GET /api/ws/{projectId}"]);
  });

  it("an in-reach member subscribes and receives events", async () => {
    const w = await world();
    const member = await w.invite("member");
    await grantProjectRead(member.user.id, w.workspace.id, w.project.id);
    const socket = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(member.cookie),
    );
    const event = {
      type: "work_item.updated",
      projectId: w.project.id,
      taskId: "TD-reach",
    };
    const received = next(socket);
    broadcastToProject(w.project.id, event);
    await expect(received).resolves.toMatchObject(event);
    socket.close();
  });

  it("an in-reach API key subscribes and receives events", async () => {
    const w = await world();
    const member = await w.invite("member");
    await grantProjectRead(member.user.id, w.workspace.id, w.project.id);
    const socket = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      await apiKeyFor(member.user.id),
    );
    const event = {
      type: "work_item.updated",
      projectId: w.project.id,
      taskId: "TD-key",
    };
    const received = next(socket);
    broadcastToProject(w.project.id, event);
    await expect(received).resolves.toMatchObject(event);
    socket.close();
  });

  it("the workspace owner and an admin (sees_all) and an instance admin keep working", async () => {
    const w = await world();
    const admin = await w.invite("admin");
    const instanceAdmin = await signUpUser(w.app);
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, instanceAdmin.user.id));
    for (const cookie of [w.owner.cookie, admin.cookie, instanceAdmin.cookie]) {
      const socket = await open(
        url(w.node, `/api/ws/${w.project.id}`),
        w.asSession(cookie),
      );
      const received = next(socket);
      broadcastToProject(w.project.id, {
        type: "work_item.updated",
        projectId: w.project.id,
        taskId: "TD-all",
      });
      await expect(received).resolves.toMatchObject({ taskId: "TD-all" });
      socket.close();
    }
  });

  it("an out-of-reach member, another workspace's member and a missing project are refused identically", async () => {
    const w = await world();
    const outOfReach = await w.invite("member");
    const stranger = await signUpUser(w.app);
    const strangerWorkspace = (await (
      await createWorkspaceNative(w.app, stranger.cookie, {
        name: "Other workspace",
      })
    ).json()) as { id: string };
    await createProjectFixture({ workspaceId: strangerWorkspace.id });

    const missingPath = "/api/ws/project-does-not-exist";
    const attempts = [
      // same-workspace member with no project membership (the defect)
      [`/api/ws/${w.project.id}`, w.asSession(outOfReach.cookie)],
      // same, through an API key
      [`/api/ws/${w.project.id}`, await apiKeyFor(outOfReach.user.id)],
      // another workspace's owner
      [`/api/ws/${w.project.id}`, w.asSession(stranger.cookie)],
    ] as const;
    const missing = await Promise.all([
      handshake(url(w.node, missingPath), w.asSession(outOfReach.cookie)),
      handshake(url(w.node, missingPath), await apiKeyFor(outOfReach.user.id)),
      handshake(url(w.node, missingPath), w.asSession(stranger.cookie)),
    ]);
    for (const [index, [path, headers]] of attempts.entries()) {
      const refused = await handshake(url(w.node, path), headers);
      expect(refused.status).toBe(401);
      expect(refused).toEqual(missing[index]);
    }
  });

  it("an out-of-reach member receives nothing: no socket exists to deliver to", async () => {
    const w = await world();
    const inReach = await w.invite("member");
    await grantProjectRead(inReach.user.id, w.workspace.id, w.project.id);
    const outOfReach = await w.invite("member");
    const reached = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(inReach.cookie),
    );
    await expect(
      handshake(
        url(w.node, `/api/ws/${w.project.id}`),
        w.asSession(outOfReach.cookie),
      ),
    ).resolves.toMatchObject({ status: 401 });
    const received = next(reached);
    broadcastToProject(w.project.id, {
      type: "work_item.updated",
      projectId: w.project.id,
      taskId: "TD-only-reach",
    });
    await expect(received).resolves.toMatchObject({ taskId: "TD-only-reach" });
    reached.close();
  });

  it("a soft-deleted project is refused like a missing one", async () => {
    const w = await world();
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, w.project.id));
    const gone = await handshake(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(w.owner.cookie),
    );
    const missing = await handshake(
      url(w.node, "/api/ws/project-does-not-exist"),
      w.asSession(w.owner.cookie),
    );
    expect(gone).toEqual(missing);
  });

  it("an open socket closes when its project reach is revoked", async () => {
    const w = await world();
    const member = await w.invite("member");
    await grantProjectRead(member.user.id, w.workspace.id, w.project.id);
    const socket = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(member.cookie),
    );
    const closed = new Promise<number>((resolve) =>
      socket.once("close", resolve),
    );
    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.scopeId, w.project.id));
    broadcastToProject(w.project.id, {
      type: "work_item.updated",
      projectId: w.project.id,
      taskId: "TD-revoked",
    });
    await expect(closed).resolves.toBe(1008);
  });

  it("a foreign Origin is refused before any reach decision, for every caller and project", async () => {
    const w = await world();
    const inReach = await w.invite("member");
    await grantProjectRead(inReach.user.id, w.workspace.id, w.project.id);
    const outOfReach = await w.invite("member");
    const foreign = (cookie: string) => ({
      ...w.asSession(cookie),
      origin: "https://attacker.example",
    });
    const results = await Promise.all([
      handshake(
        url(w.node, `/api/ws/${w.project.id}`),
        foreign(inReach.cookie),
      ),
      handshake(
        url(w.node, `/api/ws/${w.project.id}`),
        foreign(outOfReach.cookie),
      ),
      handshake(
        url(w.node, "/api/ws/project-does-not-exist"),
        foreign(outOfReach.cookie),
      ),
    ]);
    // Origin is decided first, so the status never reveals what the victim can reach.
    for (const result of results) expect(result.status).toBe(403);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("an API key credential is not treated as its owner's session", async () => {
    // A customer person who also has a workspace membership row passes the workspace
    // predicate; as a SESSION they reach their own organisation's project, but a customer
    // identity is never valid for a key credential, so the same caller over a key is refused.
    const { user, workspace } = await createWorkspaceMember({ role: "member" });
    const [org] = await db
      .insert(schema.organisationTable)
      .values({
        key: `customer-org-${randomUUID()}`,
        name: "Customer Org",
        isInternal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!org) throw new Error("organisation insert failed");
    await db
      .update(schema.personTable)
      .set({ side: "customer", organisationId: org.id })
      .where(eq(schema.personTable.userId, user.id));
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: org.id })
      .where(eq(schema.projectTable.id, project.id));
    const key = requireRow(
      await db
        .insert(schema.apikeyTable)
        .values({
          referenceId: user.id,
          userId: user.id,
          key: createHash("sha256")
            .update(randomBytes(16).toString("hex"))
            .digest("base64url"),
          name: "customer key",
          prefix: "taskdesk",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: schema.apikeyTable.id }),
      "customer api key",
    );
    const asSession = { get: () => undefined } as never;
    const asKey = {
      get: (name: string) =>
        name === "apiKey"
          ? { id: key.id, userId: user.id, enabled: true }
          : undefined,
    } as never;
    await expect(
      callerReachesLegacySocketProject(asSession, user.id, project.id),
    ).resolves.toBe(true);
    await expect(
      callerReachesLegacySocketProject(asKey, user.id, project.id),
    ).resolves.toBe(false);
  });

  it("a customer reaches only their own organisation's projects", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "member" });
    const [org] = await db
      .insert(schema.organisationTable)
      .values({
        key: `customer-org-${randomUUID()}`,
        name: "Customer Org",
        isInternal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!org) throw new Error("organisation insert failed");
    await db
      .update(schema.personTable)
      .set({ side: "customer", organisationId: org.id })
      .where(eq(schema.personTable.userId, user.id));
    const { project: own } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: org.id })
      .where(eq(schema.projectTable.id, own.id));
    const { project: other } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const context = { get: () => undefined } as never;
    await expect(
      callerReachesLegacySocketProject(context, user.id, own.id),
    ).resolves.toBe(true);
    await expect(
      callerReachesLegacySocketProject(context, user.id, other.id),
    ).resolves.toBe(false);
  });
});
