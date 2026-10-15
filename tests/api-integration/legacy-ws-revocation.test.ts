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
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { createProjectFixture, requireRow } from "./helpers/fixtures";
import { signUpInstanceAdmin, signUpUser } from "./helpers/organization-http";
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

const KINDS = ["user", "project"] as const;
type Kind = (typeof KINDS)[number];

describe("legacy sockets after access revocation (#632)", () => {
  let closeServer: (() => Promise<unknown>) | undefined;

  const originalEncryptionKey = process.env.TASKDESK_ENCRYPTION_KEY;
  beforeEach(async () => {
    process.env.TASKDESK_ENCRYPTION_KEY = "ab".repeat(32);
    await resetTestDatabase();
    await initializeWebSocketAdapter();
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
});
