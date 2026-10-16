/**
 * #632: the legacy `/api/ws/user` and `/api/ws/{projectId}` sockets stop disclosing after the
 * caller's access is revoked, through the REAL revocation paths (not raw table writes), with
 * the real Better Auth cookie that opened the socket.
 *
 * Announced revocations (sign-out, administrator sign-out/suspend, SCIM deactivation) must close
 * an IDLE socket at once, with no event needed to trigger the recheck, and deliver nothing
 * afterwards. A raw database change that nothing announces is found at the next delivery: at
 * once on the user socket (no reuse window) and after the bounded #748 window on the project
 * socket.
 */

import { type ChildProcess, fork } from "node:child_process";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GenericContainer,
  Wait,
} from "../../apps/api/node_modules/testcontainers";
import { sha256 } from "../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { createApp, createNodeServer } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import {
  broadcastToProject,
  broadcastToUser,
  initializeWebSocketAdapter,
  shutdownWebSocketAdapter,
} from "../../apps/api/src/ws";
import { LEGACY_AUTHORIZATION_REUSE_MS } from "../../apps/api/src/ws/legacy-connection-authorization";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import { signUpInstanceAdmin, signUpUser } from "./helpers/organization-http";
import { inviteAndAcceptAsNewMemberNative } from "./helpers/workspace-invitation-write-http";
import { removeWorkspaceMemberNative } from "./helpers/workspace-membership-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

type TestSocket = {
  once(event: "open", listener: () => void): TestSocket;
  once(event: "error", listener: (error: Error) => void): TestSocket;
  once(
    event: "message",
    listener: (data: { toString(): string }) => void,
  ): TestSocket;
  once(event: "close", listener: (code: number) => void): TestSocket;
  on(
    event: "message",
    listener: (data: { toString(): string }) => void,
  ): TestSocket;
  close(): void;
};
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const WebSocket = apiRequire("ws") as {
  new (url: string, options: { headers: Record<string, string> }): TestSocket;
};

type Node = ReturnType<typeof createNodeServer>;

class LoopbackValkeyContainer extends GenericContainer {
  protected override async beforeContainerCreated(): Promise<void> {
    this.hostConfig.PortBindings = {
      ...this.hostConfig.PortBindings,
      "6379/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }],
    };
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function listening(server: Node["server"]) {
  return new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}
function open(node: Node, path: string, cookie: string) {
  const target = `ws://127.0.0.1:${(node.server.address() as AddressInfo).port}${path}`;
  return new Promise<TestSocket>((resolve, reject) => {
    const socket = new WebSocket(target, {
      headers: {
        host: "localhost:1337",
        origin: "http://localhost:1337",
        cookie,
      },
    });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}
function openOnPort(port: number, path: string, cookie: string) {
  const target = `ws://127.0.0.1:${port}${path}`;
  return new Promise<TestSocket>((resolve, reject) => {
    const socket = new WebSocket(target, {
      headers: {
        host: "localhost:1337",
        origin: "http://localhost:1337",
        cookie,
      },
    });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}
function next(socket: TestSocket) {
  return new Promise<unknown>((resolve) =>
    socket.once("message", (data) => resolve(JSON.parse(data.toString()))),
  );
}
/** Resolves with the close code, or `"open"` if the socket is still open after `ms`. */
function closedWithin(socket: TestSocket, ms: number) {
  return new Promise<number | "open">((resolve) => {
    const timer = setTimeout(() => resolve("open"), ms);
    socket.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function startIsolatedApiProcess(valkeyUrl: string) {
  const entry = fileURLToPath(
    new URL("./helpers/legacy-ws-instance-server.ts", import.meta.url),
  );
  const child = fork(entry, [], {
    cwd: process.cwd(),
    detached: true,
    execArgv: ["--import", "tsx"],
    env: { ...process.env, TASKDESK_PORT: "0", TASKDESK_VALKEY_URL: valkeyUrl },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const ready = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("API child startup timed out")),
      15_000,
    );
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("API child failed to start"));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`API child exited before ready (${code ?? "signal"})`));
    });
    child.on("message", (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message)
      )
        return;
      if (message.type === "startup-error") {
        clearTimeout(timer);
        reject(new Error("API child reported startup failure"));
      } else if (
        message.type === "ready" &&
        "port" in message &&
        typeof message.port === "number"
      ) {
        clearTimeout(timer);
        resolve(message.port);
      }
    });
  });
  return { child, ready };
}

async function stopIsolatedApiProcess(child: ChildProcess) {
  const exitReceipt = () => ({
    pid: child.pid ?? null,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
    exited: child.exitCode !== null || child.signalCode !== null,
  });
  if (child.exitCode !== null || child.signalCode !== null)
    return exitReceipt();
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
  });
  const waitBounded = async (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return completed;
  };
  try {
    child.send("stop", () => {});
  } catch {
    // A disconnected IPC channel is handled by the owned-process signal fallback.
  }
  if (await waitBounded(5_000)) return exitReceipt();
  const signalOwnedGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The owned process group may have exited between the check and signal.
    }
  };
  signalOwnedGroup("SIGTERM");
  if (await waitBounded(2_000)) return exitReceipt();
  signalOwnedGroup("SIGKILL");
  if (!(await waitBounded(2_000))) {
    throw new Error("Owned API child did not exit after bounded cleanup");
  }
  return exitReceipt();
}

const KINDS = ["user", "project"] as const;
type Kind = (typeof KINDS)[number];

describe("legacy sockets after access revocation (#632)", () => {
  let closeServer: (() => Promise<unknown>) | undefined;

  const originalEncryptionKey = process.env.TASKDESK_ENCRYPTION_KEY;
  beforeEach(async () => {
    process.env.TASKDESK_ENCRYPTION_KEY = "ab".repeat(32);
    await resetTestDatabase();
  });
  afterEach(async () => {
    if (originalEncryptionKey === undefined)
      delete process.env.TASKDESK_ENCRYPTION_KEY;
    else process.env.TASKDESK_ENCRYPTION_KEY = originalEncryptionKey;
    await closeServer?.();
    closeServer = undefined;
    await shutdownWebSocketAdapter();
  });

  async function world() {
    await initializeWebSocketAdapter();
    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);
    const admin = await signUpInstanceAdmin(app);
    const member = await signUpUser(app);
    const created = await createWorkspaceNative(app, member.cookie, {
      name: "Revocation",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const publish = (kind: Kind, tag: string) => {
      if (kind === "user")
        broadcastToUser(member.user.id, { type: "NOTIFICATION_CREATED" });
      else
        broadcastToProject(project.id, {
          type: "work_item.updated",
          projectId: project.id,
          taskId: tag,
        });
    };
    const openFor = (kind: Kind) =>
      open(
        node,
        kind === "user" ? "/api/ws/user" : `/api/ws/${project.id}`,
        member.cookie,
      );
    return { app, node, admin, member, project, publish, openFor };
  }

  /** Opens the socket, proves it delivers, then returns it ready for the revocation. */
  async function primed(kind: Kind, w: Awaited<ReturnType<typeof world>>) {
    const socket = await w.openFor(kind);
    const first = next(socket);
    w.publish(kind, "TD-prime");
    await expect(first).resolves.toHaveProperty("type");
    // Let the project socket's passing lookup age out so only the revocation can matter.
    if (kind === "project") await sleep(LEGACY_AUTHORIZATION_REUSE_MS + 200);
    return socket;
  }

  const adminPost = (w: Awaited<ReturnType<typeof world>>, path: string) =>
    csrfRequest(
      w.app,
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: w.admin.cookie },
        body: "{}",
      },
      w.admin.cookie,
    );

  const announced: Array<
    [string, (w: Awaited<ReturnType<typeof world>>) => Promise<Response>]
  > = [
    [
      "the member signs out",
      (w) =>
        csrfRequest(
          w.app,
          "/api/auth/sign-out",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: w.member.cookie,
            },
            body: "{}",
          },
          w.member.cookie,
        ),
    ],
    [
      "an administrator signs the user out everywhere",
      (w) => adminPost(w, `/api/instance/users/${w.member.user.id}/sign-out`),
    ],
    [
      "an administrator suspends the user",
      (w) => adminPost(w, `/api/instance/users/${w.member.user.id}/suspend`),
    ],
  ];

  for (const kind of KINDS) {
    for (const [label, revoke] of announced) {
      it(`${kind} socket: closes an idle socket and delivers nothing after ${label}`, async () => {
        const w = await world();
        const socket = await primed(kind, w);
        const received: string[] = [];
        socket.on("message", (data) => received.push(data.toString()));
        const closed = closedWithin(socket, 3_000);
        const response = await revoke(w);
        expect(response.status, await response.clone().text()).toBe(200);
        // No event is published: the announcement alone must close it.
        expect(await closed).toBe(1008);
        w.publish(kind, "TD-after");
        await sleep(300);
        expect(received).toEqual([]);
      });
    }

    for (const via of ["PATCH", "PUT", "DELETE"] as const) {
      it(`${kind} socket: closes an idle socket and delivers nothing after the identity provider deactivates the person over SCIM ${via}`, async () => {
        const w = await world();
        await ensureInternalOrganisation();
        const connectionId = "scim-revocation-connection";
        const token = "R".repeat(43);
        await db.insert(schema.identityConnectionTable).values({
          id: connectionId,
          providerType: "entra",
          portalScope: "agent",
          organisationId: null,
          displayName: "SCIM revocation fixture",
          issuer: "https://login.microsoftonline.com/tenant/v2.0",
          tenantId: "tenant",
          clientId: "client",
          clientSecret: encryptIdentityClientSecret(connectionId, "fixture"),
          redirectUri: "http://localhost:1337/api/identity/callback",
          scopes: ["openid"],
          claimMapping: {},
          domainBindings: [],
          jitPolicy: { enabled: false, requiredEntraAppRole: "staff" },
          maxRoleRank: 10,
          enabled: true,
        });
        await db.insert(schema.scimConnectionTable).values({
          identityConnectionId: connectionId,
          tokenHash: sha256(token),
          tokenPrefix: token.slice(0, 8),
          tokenCreatedAt: new Date(),
          allowedResources: ["users", "groups"],
          enabled: true,
        });
        const person = requireRow(
          await db
            .select({ id: schema.personTable.id })
            .from(schema.personTable)
            .where(eq(schema.personTable.userId, w.member.user.id))
            .limit(1),
          "member person",
        );
        const identityId = "scim-revocation-identity";
        await db.insert(schema.externalIdentityTable).values({
          id: identityId,
          identityConnectionId: connectionId,
          personId: person.id,
          userId: w.member.user.id,
          issuer: "https://login.microsoftonline.com/tenant/v2.0",
          subject: w.member.user.id,
          scimExternalId: w.member.user.id,
          userNameSnapshot: w.member.user.email,
          emailSnapshot: w.member.user.email,
          active: true,
          provisionedVia: "scim",
        });

        const socket = await primed(kind, w);
        const received: string[] = [];
        socket.on("message", (data) => received.push(data.toString()));
        const closed = closedWithin(socket, 3_000);
        const scimHeaders = {
          authorization: `Bearer ${token}`,
          "content-type": "application/scim+json",
        };
        const response = await w.app.request(`/scim/v2/Users/${identityId}`, {
          method: via,
          headers: scimHeaders,
          ...(via === "PATCH"
            ? {
                body: JSON.stringify({
                  schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
                  Operations: [{ op: "replace", path: "active", value: false }],
                }),
              }
            : via === "PUT"
              ? {
                  body: JSON.stringify({
                    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
                    externalId: w.member.user.id,
                    userName: w.member.user.email,
                    displayName: "Deactivated",
                    emails: [{ value: w.member.user.email, primary: true }],
                    active: false,
                  }),
                }
              : {}),
        });
        expect(response.status, await response.clone().text()).toBe(
          via === "DELETE" ? 204 : 200,
        );
        const sessions = await db
          .select()
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.userId, w.member.user.id));
        expect(sessions).toEqual([]);
        expect(await closed).toBe(1008);
        w.publish(kind, "TD-after");
        await sleep(300);
        expect(received).toEqual([]);
      });
    }
  }

  it("user socket: an unannounced database revocation is found at the very next delivery (no reuse window)", async () => {
    for (const change of ["ban", "deactivate", "session"] as const) {
      await resetTestDatabase();
      const w = await world();
      const socket = await primed("user", w);
      const received: string[] = [];
      socket.on("message", (data) => received.push(data.toString()));
      const closed = closedWithin(socket, 3_000);
      if (change === "ban")
        await db
          .update(schema.userTable)
          .set({ banned: true })
          .where(eq(schema.userTable.id, w.member.user.id));
      else if (change === "deactivate")
        await db
          .update(schema.personTable)
          .set({ active: false })
          .where(eq(schema.personTable.userId, w.member.user.id));
      else
        await db
          .delete(schema.sessionTable)
          .where(eq(schema.sessionTable.userId, w.member.user.id));
      w.publish("user", "TD-immediate");
      expect(await closed, change).toBe(1008);
      expect(received, change).toEqual([]);
      await closeServer?.();
      closeServer = undefined;
    }
  });

  it("Valkey: delivers and revokes legacy sockets across independent API processes", async () => {
    const originalValkeyUrl = process.env.TASKDESK_VALKEY_URL;
    const sockets: TestSocket[] = [];
    const valkey = await new LoopbackValkeyContainer("valkey/valkey:9-alpine")
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    const valkeyUrl = `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
    let child: ChildProcess | undefined;
    try {
      process.env.TASKDESK_VALKEY_URL = valkeyUrl;
      await initializeWebSocketAdapter();
      const { app } = createApp();
      const admin = await signUpInstanceAdmin(app);
      const owner = await signUpUser(app);
      const workspaceResponse = await createWorkspaceNative(app, owner.cookie, {
        name: "Cross-instance revocation",
      });
      expect(
        workspaceResponse.status,
        await workspaceResponse.clone().text(),
      ).toBe(200);
      const workspace = (await workspaceResponse.json()) as { id: string };
      const signoutMember = await inviteAndAcceptAsNewMemberNative(
        app,
        owner.cookie,
        workspace.id,
        "member",
      );
      const reachMember = await inviteAndAcceptAsNewMemberNative(
        app,
        owner.cookie,
        workspace.id,
        "member",
      );
      const { project } = await createProjectFixture({
        workspaceId: workspace.id,
      });
      await grantProjectRole(signoutMember.user.id, project.id, [
        "project:read",
        "work_item:read",
      ]);
      await grantProjectRole(reachMember.user.id, project.id, [
        "project:read",
        "work_item:read",
      ]);
      const api = startIsolatedApiProcess(valkeyUrl);
      child = api.child;
      const remotePort = await api.ready;
      const signoutUserSocket = await openOnPort(
        remotePort,
        "/api/ws/user",
        signoutMember.cookie,
      );
      sockets.push(signoutUserSocket);
      const signoutProjectSocket = await openOnPort(
        remotePort,
        `/api/ws/${project.id}`,
        signoutMember.cookie,
      );
      sockets.push(signoutProjectSocket);
      const reachUserSocket = await openOnPort(
        remotePort,
        "/api/ws/user",
        reachMember.cookie,
      );
      sockets.push(reachUserSocket);
      const reachProjectSocket = await openOnPort(
        remotePort,
        `/api/ws/${project.id}`,
        reachMember.cookie,
      );
      sockets.push(reachProjectSocket);

      const signoutUserDelivery = next(signoutUserSocket);
      const signoutProjectDelivery = next(signoutProjectSocket);
      const reachUserDelivery = next(reachUserSocket);
      const reachProjectDelivery = next(reachProjectSocket);
      broadcastToUser(signoutMember.user.id, {
        type: "NOTIFICATION_CREATED",
      });
      broadcastToProject(project.id, {
        type: "work_item.updated",
        projectId: project.id,
        taskId: "TD-cross-instance-project-prime",
      });
      await expect(signoutUserDelivery).resolves.toMatchObject({
        type: "NOTIFICATION_CREATED",
      });
      await expect(signoutProjectDelivery).resolves.toMatchObject({
        type: "work_item.updated",
        taskId: "TD-cross-instance-project-prime",
      });
      await expect(reachProjectDelivery).resolves.toMatchObject({
        type: "work_item.updated",
        taskId: "TD-cross-instance-project-prime",
      });
      broadcastToUser(reachMember.user.id, { type: "NOTIFICATION_CREATED" });
      await expect(reachUserDelivery).resolves.toMatchObject({
        type: "NOTIFICATION_CREATED",
      });

      const signoutMessages: string[] = [];
      signoutUserSocket.on("message", (data) =>
        signoutMessages.push(data.toString()),
      );
      signoutProjectSocket.on("message", (data) =>
        signoutMessages.push(data.toString()),
      );
      const userClosed = closedWithin(signoutUserSocket, 5_000);
      const projectClosed = closedWithin(signoutProjectSocket, 5_000);
      const response = await csrfRequest(
        app,
        `/api/instance/users/${signoutMember.user.id}/sign-out`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: admin.cookie,
          },
          body: "{}",
        },
        admin.cookie,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await userClosed).toBe(1008);
      expect(await projectClosed).toBe(1008);
      broadcastToUser(signoutMember.user.id, {
        type: "NOTIFICATION_CREATED",
      });
      broadcastToProject(project.id, {
        type: "work_item.updated",
        projectId: project.id,
        taskId: "TD-cross-instance-after-signout",
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(signoutMessages).toEqual([]);

      const reachProjectMessages: string[] = [];
      reachProjectSocket.on("message", (data) =>
        reachProjectMessages.push(data.toString()),
      );
      const reachProjectClosed = closedWithin(reachProjectSocket, 5_000);
      const removed = await removeWorkspaceMemberNative(
        app,
        owner.cookie,
        workspace.id,
        reachMember.user.id,
      );
      expect(removed.status, await removed.clone().text()).toBe(200);
      const removedWorkspaceMembership = await db
        .select({ userId: schema.workspaceUserTable.userId })
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.userId, reachMember.user.id),
            eq(schema.workspaceUserTable.workspaceId, workspace.id),
          ),
        );
      expect(removedWorkspaceMembership).toEqual([]);
      const reachPerson = requireRow(
        await db
          .select({ id: schema.personTable.id })
          .from(schema.personTable)
          .where(eq(schema.personTable.userId, reachMember.user.id)),
        "cross-instance reach member person",
      );
      const retainedProjectGrant = await db
        .select({ scopeId: schema.membershipTable.scopeId })
        .from(schema.membershipTable)
        .where(
          and(
            eq(schema.membershipTable.personId, reachPerson.id),
            eq(schema.membershipTable.scope, "project"),
            eq(schema.membershipTable.scopeId, project.id),
          ),
        );
      expect(retainedProjectGrant).toEqual([{ scopeId: project.id }]);
      expect(await reachProjectClosed).toBe(1008);
      broadcastToProject(project.id, {
        type: "work_item.updated",
        projectId: project.id,
        taskId: "TD-cross-instance-after-reach-loss",
      });
      const allowedUserDelivery = next(reachUserSocket);
      broadcastToUser(reachMember.user.id, { type: "NOTIFICATION_CREATED" });
      await expect(allowedUserDelivery).resolves.toMatchObject({
        type: "NOTIFICATION_CREATED",
      });
      expect(await closedWithin(reachUserSocket, 100)).toBe("open");
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(reachProjectMessages).toEqual([]);
    } finally {
      for (const socket of sockets) socket.close();
      try {
        if (child) {
          const receipt = await stopIsolatedApiProcess(child);
          expect(receipt.exited).toBe(true);
          process.stdout.write(
            `${JSON.stringify({
              event: "realtime632_owned_child_exit",
              ...receipt,
            })}\n`,
          );
        }
      } finally {
        try {
          await shutdownWebSocketAdapter();
        } finally {
          if (originalValkeyUrl === undefined)
            delete process.env.TASKDESK_VALKEY_URL;
          else process.env.TASKDESK_VALKEY_URL = originalValkeyUrl;
          await valkey.stop({
            timeout: 5_000,
            remove: true,
            removeVolumes: true,
          });
        }
      }
    }
  });
});
