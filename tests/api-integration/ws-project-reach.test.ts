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
import { reaches } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp, createNodeServer } from "../../apps/api/src/index";
import {
  broadcastToProject,
  initializeWebSocketAdapter,
  invalidateNativeAuthorization,
  shutdownWebSocketAdapter,
} from "../../apps/api/src/ws";
import { LEGACY_AUTHORIZATION_REUSE_MS } from "../../apps/api/src/ws/legacy-connection-authorization";
import { callerReachesLegacySocketProject } from "../../apps/api/src/ws/legacy-project-reach";
import { MAX_REALTIME_CONNECTIONS_PER_PERSON } from "../../apps/api/src/ws/limits";
import { authorizeNativeTopic } from "../../apps/api/src/ws/native-work-item-realtime";
import {
  findSocketProject,
  resolveSocketIdentity,
} from "../../apps/api/src/ws/project-read-authorization";
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
  capabilities: string[] = ["project:read", "work_item:read"],
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
        capabilities,
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
  return role;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reuseWindow = () => sleep(LEGACY_AUTHORIZATION_REUSE_MS + 200);

async function apiKeyFor(
  userId: string,
  permissions: Record<string, string[]> | null = {
    project: ["read"],
    work_item: ["read"],
  },
) {
  const rawKey = `taskdesk_test_${randomBytes(16).toString("hex")}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: createHash("sha256").update(rawKey).digest("base64url"),
    name: "ws project reach",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    permissions: permissions ? JSON.stringify(permissions) : null,
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

  it("the workspace owner and an admin (sees_all) keep working", async () => {
    const w = await world();
    const admin = await w.invite("admin");
    for (const cookie of [w.owner.cookie, admin.cookie]) {
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

  it("an instance admin with no workspace role is refused on both sockets: reach alone is not authority (#748)", async () => {
    const w = await world();
    const instanceAdmin = await signUpUser(w.app);
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, instanceAdmin.user.id));
    const refused = await handshake(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(instanceAdmin.cookie),
    );
    const missing = await handshake(
      url(w.node, "/api/ws/project-does-not-exist"),
      w.asSession(instanceAdmin.cookie),
    );
    expect(refused.status).toBe(401);
    expect(refused).toEqual(missing);
    await expect(
      authorizeNativeTopic(
        { userId: instanceAdmin.user.id, portal: "agent" },
        `project:${w.project.id}`,
      ),
    ).resolves.toBeNull();
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

  it("an in-scope key is clamped to its stored scope, never its owner's authority", async () => {
    const w = await world();
    const member = await w.invite("member");
    await grantProjectRead(member.user.id, w.workspace.id, w.project.id);
    const missing = await handshake(
      url(w.node, "/api/ws/project-does-not-exist"),
      await apiKeyFor(member.user.id),
    );
    const scopes: Array<[string, Record<string, string[]> | null, boolean]> = [
      ["workspace read only", { workspace: ["read"] }, false],
      ["project read only", { project: ["read"] }, false],
      ["work_item read only", { work_item: ["read"] }, false],
      ["no stored scope", null, false],
      [
        "project and work_item read",
        { project: ["read"], work_item: ["read"] },
        true,
      ],
    ];
    for (const [label, permissions, allowed] of scopes) {
      const key = await apiKeyFor(member.user.id, permissions);
      const credential = {
        userId: member.user.id,
        apiKeyEnabled: true,
        apiKeyOwnerUserId: member.user.id,
        apiKeyPermissions: permissions,
        portal: "agent" as const,
      };
      if (allowed) {
        const socket = await open(url(w.node, `/api/ws/${w.project.id}`), key);
        socket.close();
      } else {
        const refused = await handshake(
          url(w.node, `/api/ws/${w.project.id}`),
          key,
        );
        expect(refused.status, label).toBe(401);
        expect(refused, label).toEqual(missing);
      }
      // The native socket gives the same answer for the same key (needs the key id).
      const [row] = await db
        .select({ id: schema.apikeyTable.id })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.start, key.authorization.slice(7, 19)))
        .limit(1);
      const native = await authorizeNativeTopic(
        { ...credential, apiKeyId: row?.id },
        `project:${w.project.id}`,
      );
      expect(native !== null, label).toBe(allowed);
    }
  });

  it("a member whose project role lacks project:read is refused like an out-of-reach one, and closed when it is lost (#748)", async () => {
    const w = await world();
    const readOnlyItems = await w.invite("member");
    // Reach by membership, but the project-scope role replaces the workspace role and lacks
    // `project:read`.
    await grantProjectRead(
      readOnlyItems.user.id,
      w.workspace.id,
      w.project.id,
      ["work_item:read"],
    );
    const refused = await handshake(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(readOnlyItems.cookie),
    );
    const missing = await handshake(
      url(w.node, "/api/ws/project-does-not-exist"),
      w.asSession(readOnlyItems.cookie),
    );
    expect(refused.status).toBe(401);
    expect(refused).toEqual(missing);
    await expect(
      authorizeNativeTopic(
        { userId: readOnlyItems.user.id, portal: "agent" },
        `project:${w.project.id}`,
      ),
    ).resolves.toBeNull();

    // A capable member loses `project:read` while connected: the announced change closes it.
    const lead = await w.invite("member");
    const role = await grantProjectRead(
      lead.user.id,
      w.workspace.id,
      w.project.id,
    );
    const socket = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(lead.cookie),
    );
    const closed = new Promise<number>((resolve) =>
      socket.once("close", resolve),
    );
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["work_item:read"] })
      .where(eq(schema.roleTable.id, role.id));
    await invalidateNativeAuthorization({
      userId: lead.user.id,
      projectId: w.project.id,
    });
    await expect(closed).resolves.toBe(1008);
  });

  it("an archived project is refused like a missing one on both sockets, and closes an open socket (#748)", async () => {
    const w = await world();
    const member = await w.invite("member");
    await grantProjectRead(member.user.id, w.workspace.id, w.project.id);
    const open1 = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(member.cookie),
    );
    const closed = new Promise<number>((resolve) =>
      open1.once("close", resolve),
    );
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, w.project.id));
    await invalidateNativeAuthorization({ projectId: w.project.id });
    await expect(closed).resolves.toBe(1008);

    const archived = await handshake(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(w.owner.cookie),
    );
    const missing = await handshake(
      url(w.node, "/api/ws/project-does-not-exist"),
      w.asSession(w.owner.cookie),
    );
    expect(archived.status).toBe(401);
    expect(archived).toEqual(missing);
    await expect(
      authorizeNativeTopic(
        { userId: w.owner.user.id, portal: "agent" },
        `project:${w.project.id}`,
      ),
    ).resolves.toBeNull();
  });

  it("a customer is decided identically by both sockets, from the PROJECT's customer organisation (#748)", async () => {
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
    const credential = { userId: user.id, portal: "agent" as const };

    // The organisation both sockets read is the project row's, which differs from the
    // workspace's (the operating organisation).
    const row = await findSocketProject(credential, own.id);
    const [ws] = await db
      .select({ organisationId: schema.workspaceTable.organisationId })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspace.id));
    expect(row?.organisationId).toBe(org.id);
    expect(ws?.organisationId).not.toBe(org.id);

    // Reach (rbac.md step 6) follows that organisation...
    const identity = await resolveSocketIdentity(credential);
    if (!identity || !row) throw new Error("customer identity not resolved");
    expect(
      reaches(identity, {
        projectId: own.id,
        workspaceId: workspace.id,
        organisationId: row.organisationId,
        ancestorProjectIds: [],
        ownerTeamId: null,
      }),
    ).toBe(true);
    expect(
      reaches(identity, {
        projectId: other.id,
        workspaceId: workspace.id,
        organisationId: ws?.organisationId ?? null,
        ancestorProjectIds: [],
        ownerTeamId: null,
      }),
    ).toBe(false);

    // ...but the customer role holds no `project:read`, so neither socket admits one, and
    // both say so in the same way.
    for (const projectId of [own.id, other.id]) {
      await expect(
        callerReachesLegacySocketProject(context, user.id, projectId),
      ).resolves.toBe(false);
      await expect(
        authorizeNativeTopic(credential, `project:${projectId}`),
      ).resolves.toBeNull();
    }
  });

  it("holds at most five legacy project sockets per person, across credentials (#748)", async () => {
    const w = await world();
    const member = await w.invite("member");
    await grantProjectRead(member.user.id, w.workspace.id, w.project.id);
    const other = await w.invite("member");
    await grantProjectRead(other.user.id, w.workspace.id, w.project.id);
    expect(MAX_REALTIME_CONNECTIONS_PER_PERSON).toBe(5);

    const held: TestSocket[] = [];
    for (let i = 0; i < MAX_REALTIME_CONNECTIONS_PER_PERSON; i++) {
      held.push(
        await open(
          url(w.node, `/api/ws/${w.project.id}`),
          w.asSession(member.cookie),
        ),
      );
    }
    // The sixth is refused, with the native socket's close.
    const sixth = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(member.cookie),
    );
    await expect(
      new Promise<number>((resolve) => sixth.once("close", resolve)),
    ).resolves.toBe(1008);
    // A key held by the same person counts against the same limit.
    const keyed = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      await apiKeyFor(member.user.id),
    );
    await expect(
      new Promise<number>((resolve) => keyed.once("close", resolve)),
    ).resolves.toBe(1008);
    // Another person is unaffected, and the refused sockets received nothing.
    const otherSocket = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(other.cookie),
    );
    const delivered = next(otherSocket);
    broadcastToProject(w.project.id, {
      type: "work_item.updated",
      projectId: w.project.id,
      taskId: "TD-limit",
    });
    await expect(delivered).resolves.toMatchObject({ taskId: "TD-limit" });
    otherSocket.close();

    // Closing one frees exactly one slot.
    const freed = new Promise<number>((resolve) =>
      held[0]?.once("close", resolve),
    );
    held[0]?.close();
    await freed;
    await sleep(150);
    const replacement = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(member.cookie),
    );
    const stays = await Promise.race([
      new Promise<string>((resolve) =>
        replacement.once("close", () => resolve("closed")),
      ),
      sleep(400).then(() => "open"),
    ]);
    expect(stays).toBe("open");
    replacement.close();
    for (const socket of held.slice(1)) socket.close();
  });

  it("a burst of events costs one authority lookup, not one per event (#748)", async () => {
    const w = await world();
    const member = await w.invite("member");
    await grantProjectRead(member.user.id, w.workspace.id, w.project.id);
    const pg = apiRequire("pg") as {
      Client: { prototype: { query: (...args: unknown[]) => unknown } };
    };
    const original = pg.Client.prototype.query;
    let queries = 0;
    pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
      queries += 1;
      return original.apply(this, args);
    };
    const collect = async (count: number) => {
      const socket = await open(
        url(w.node, `/api/ws/${w.project.id}`),
        w.asSession(member.cookie),
      );
      const seen: unknown[] = [];
      const all = new Promise<void>((resolve) => {
        const onMessage = (data: { toString(): string }) => {
          seen.push(JSON.parse(data.toString()));
          if (seen.length === count) resolve();
          else socket.once("message", onMessage);
        };
        socket.once("message", onMessage);
      });
      return { socket, all };
    };
    try {
      const single = await collect(1);
      queries = 0;
      broadcastToProject(w.project.id, {
        type: "work_item.updated",
        projectId: w.project.id,
        taskId: "TD-single",
      });
      await single.all;
      const oneLookup = queries;
      single.socket.close();
      await sleep(150);

      const burst = await collect(20);
      queries = 0;
      for (let i = 0; i < 20; i++) {
        broadcastToProject(w.project.id, {
          type: "work_item.updated",
          projectId: w.project.id,
          taskId: `TD-burst-${i}`,
        });
      }
      await burst.all;
      const burstLookups = queries;
      burst.socket.close();

      expect(oneLookup).toBeGreaterThan(0);
      // 20 events, one real lookup: the other 19 reuse it.
      expect(burstLookups).toBeLessThanOrEqual(oneLookup);
    } finally {
      pg.Client.prototype.query = original;
    }
  });

  it("an unannounced revocation closes within the reuse window; an announced one closes at once (#748)", async () => {
    const w = await world();
    const member = await w.invite("member");
    await grantProjectRead(member.user.id, w.workspace.id, w.project.id);
    const socket = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(member.cookie),
    );
    const publish = (taskId: string) =>
      broadcastToProject(w.project.id, {
        type: "work_item.updated",
        projectId: w.project.id,
        taskId,
      });
    const primed = next(socket);
    publish("TD-prime");
    await expect(primed).resolves.toMatchObject({ taskId: "TD-prime" });

    // Revoked in the database with no announcement: still within the window, the lookup is
    // reused, so the next event is delivered...
    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.scopeId, w.project.id));
    const within = next(socket);
    publish("TD-within-window");
    await expect(within).resolves.toMatchObject({ taskId: "TD-within-window" });

    // ...and once the window has passed, the next event finds the revocation and closes.
    await reuseWindow();
    const closed = new Promise<number>((resolve) =>
      socket.once("close", resolve),
    );
    publish("TD-after-window");
    await expect(closed).resolves.toBe(1008);

    // An announced change never waits for the window.
    const second = await w.invite("member");
    const role = await grantProjectRead(
      second.user.id,
      w.workspace.id,
      w.project.id,
    );
    const live = await open(
      url(w.node, `/api/ws/${w.project.id}`),
      w.asSession(second.cookie),
    );
    const primedAgain = next(live);
    publish("TD-prime-2");
    await expect(primedAgain).resolves.toMatchObject({ taskId: "TD-prime-2" });
    const liveClosed = new Promise<number>((resolve) =>
      live.once("close", resolve),
    );
    await db
      .update(schema.roleTable)
      .set({ capabilities: [] })
      .where(eq(schema.roleTable.id, role.id));
    await invalidateNativeAuthorization({
      userId: second.user.id,
      projectId: w.project.id,
    });
    await expect(liveClosed).resolves.toBe(1008);
  });
});
