import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo, Socket } from "node:net";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth, portalAuth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp, createNodeServer } from "../../apps/api/src/index";
import { recordWorkItemEvent } from "../../apps/api/src/work-item/native-event";
import {
  broadcastNativeWorkItemHint,
  broadcastToProject,
  broadcastToUser,
  initializeWebSocketAdapter,
  shutdownWebSocketAdapter,
} from "../../apps/api/src/ws";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

interface TestSocket {
  readyState: number;
  once(
    event: "unexpected-response",
    listener: (request: ClientRequest, response: IncomingMessage) => void,
  ): TestSocket;
  once(event: "open", listener: () => void): TestSocket;
  once(event: "error", listener: (error: Error) => void): TestSocket;
  once(
    event: "message",
    listener: (data: { toString(): string }) => void,
  ): TestSocket;
  once(event: "close", listener: (code: number) => void): TestSocket;
  off(event: "message", listener: () => void): TestSocket;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type TestWebSocketConstructor = {
  new (url: string, options: { headers: Record<string, string> }): TestSocket;
  OPEN: number;
};

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const WebSocket = apiRequire("ws") as TestWebSocketConstructor;
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const heldHttpStaticRoots = new Set<string>();

function listening(server: ReturnType<typeof createNodeServer>["server"]) {
  return new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

function websocketUrl(
  server: ReturnType<typeof createNodeServer>["server"],
  path: string,
) {
  const address = server.address() as AddressInfo;
  return `ws://127.0.0.1:${address.port}${path}`;
}

function rejectHandshake(url: string, headers: Record<string, string> = {}) {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    socket.once("open", () => {
      socket.close();
      reject(new Error("rejected WebSocket handshake unexpectedly upgraded"));
    });
    socket.once("error", reject);
  });
}

function openSocket(url: string, headers: Record<string, string>) {
  return new Promise<TestSocket>((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket: TestSocket) {
  return new Promise<unknown>((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function rawGet(port: number, path: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { host: "localhost:1337" },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function rawPost(
  port: number,
  path: string,
  origin: string,
  cookie: string,
  body: string,
) {
  return new Promise<{
    status: number;
    headers: IncomingMessage["headers"];
    body: string;
  }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          host: "localhost:1337",
          origin,
          cookie,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          responseBody += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: responseBody,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

function rawRequestToHost(
  port: number,
  path: string,
  method: "GET" | "POST",
  host: string,
  origin: string,
  body: string,
  extraHeaders: Record<string, string> = {},
) {
  return new Promise<{
    status: number;
    headers: IncomingMessage["headers"];
    body: string;
  }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          host,
          origin,
          ...(body
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              }
            : {}),
          ...extraHeaders,
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          responseBody += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: responseBody,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

function rawPostToHost(
  port: number,
  path: string,
  host: string,
  origin: string,
  body: string,
  extraHeaders: Record<string, string> = {},
) {
  return rawRequestToHost(port, path, "POST", host, origin, body, extraHeaders);
}

function rawGetToHost(
  port: number,
  path: string,
  host: string,
  origin: string,
  extraHeaders: Record<string, string> = {},
) {
  return rawRequestToHost(port, path, "GET", host, origin, "", extraHeaders);
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function holdStreamingResponse(port: number) {
  const firstChunk = deferred<void>();
  const bodyComplete = deferred<string>();
  const responseInterrupted = deferred<void>();
  const request = httpRequest(
    {
      host: "127.0.0.1",
      port,
      path: "/__shutdown/hold",
      method: "GET",
      headers: { host: "localhost:1337" },
    },
    (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
        firstChunk.resolve();
      });
      response.on("end", () => bodyComplete.resolve(body));
      response.on("aborted", () => responseInterrupted.resolve());
      response.on("close", () => {
        if (!response.complete) responseInterrupted.resolve();
      });
    },
  );
  request.on("error", () => responseInterrupted.resolve());
  request.end();
  return {
    firstChunk: firstChunk.promise,
    bodyComplete: bodyComplete.promise,
    responseInterrupted: responseInterrupted.promise,
  };
}

function openUnresponsiveWebSocket(port: number, cookie: string) {
  const connected = deferred<Socket>();
  const socket = createConnection({ host: "127.0.0.1", port });
  const key = randomBytes(16).toString("base64");
  let handshake = "";
  socket.on("data", (chunk) => {
    handshake += chunk.toString("latin1");
    const end = handshake.indexOf("\r\n\r\n");
    if (end === -1) return;
    if (!handshake.startsWith("HTTP/1.1 101 ")) {
      connected.reject(new Error("raw WebSocket handshake was rejected"));
      return;
    }
    socket.removeAllListeners("data");
    connected.resolve(socket);
  });
  socket.once("error", (error) => {
    connected.reject(error);
  });
  socket.once("connect", () => {
    socket.write(
      [
        "GET /api/ws HTTP/1.1",
        "Host: localhost:1337",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "Origin: http://localhost:1337",
        `Cookie: ${cookie}`,
        "",
        "",
      ].join("\r\n"),
    );
  });
  return connected.promise;
}

function createHeldHttpApp() {
  // Keep the SPA catch-all from a built web app from intercepting this held route.
  const staticRoot = mkdtempSync(join(tmpdir(), "taskdesk-held-http-static-"));
  heldHttpStaticRoots.add(staticRoot);
  const releaseResponse = deferred<void>();
  const responseStarted = deferred<void>();
  const { app } = createApp({
    staticRoot,
    registerAdditionalRoutes: (routes) => {
      routes.get("/__shutdown/hold", () => {
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("response-start-"));
            responseStarted.resolve();
            await releaseResponse.promise;
            controller.enqueue(new TextEncoder().encode("response-end"));
            controller.close();
          },
        });
        return new Response(body, {
          headers: { "content-type": "text/plain" },
        });
      });
    },
  });
  return { app, releaseResponse, responseStarted };
}

describe("P0 #557: real Node HTTP and WebSocket adapter", () => {
  const originalAgentUrl = process.env.TASKDESK_AGENT_URL;
  let closeServer: (() => Promise<unknown>) | undefined;

  beforeEach(async () => {
    await resetTestDatabase();
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
    for (const staticRoot of heldHttpStaticRoots) {
      rmSync(staticRoot, { recursive: true, force: true });
      heldHttpStaticRoots.delete(staticRoot);
    }
    await shutdownWebSocketAdapter();
    vi.restoreAllMocks();
    if (originalAgentUrl === undefined) {
      delete process.env.TASKDESK_AGENT_URL;
    } else {
      process.env.TASKDESK_AGENT_URL = originalAgentUrl;
    }
  });

  it("authorizes native topics and fans out only key-only hints to subscribed clients", async () => {
    const member = await createWorkspaceMember();
    const project = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const outsider = await createWorkspaceMember();
    const foreignProject = await createProjectFixture({
      workspaceId: outsider.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);
    const headers = {
      host: "localhost:1337",
      origin: "http://localhost:1337",
      cookie: "__Host-tdk_agent_session=integration-session",
    };
    const url = websocketUrl(node.server, "/api/ws");
    expect(
      await rejectHandshake(url, {
        ...headers,
        origin: "https://attacker.example",
      }),
    ).toBe(403);
    expect(
      await rejectHandshake(url, {
        ...headers,
        host: "attacker.example",
      }),
    ).toBe(404);
    expect(
      await rejectHandshake(url, {
        host: headers.host,
        cookie: headers.cookie,
      }),
    ).toBe(403);
    const socket = await openSocket(url, headers);

    const subscribed = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "subscribe",
        topic: `project:${project.project.id}`,
      }),
    );
    await expect(subscribed).resolves.toEqual({
      type: "subscribed",
      topic: `project:${project.project.id}`,
    });

    const deniedMissing = nextMessage(socket);
    socket.send(
      JSON.stringify({ type: "subscribe", topic: "project:missing-project" }),
    );
    await expect(deniedMissing).resolves.toEqual({
      type: "subscription_denied",
    });
    const deniedForeign = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "subscribe",
        topic: `project:${foreignProject.project.id}`,
      }),
    );
    await expect(deniedForeign).resolves.toEqual({
      type: "subscription_denied",
    });

    const hint = nextMessage(socket);
    await broadcastNativeWorkItemHint({
      projectId: project.project.id,
      topics: [`project:${project.project.id}`, "work_item:SUP-1"],
      eventId: "evt_native_test_1",
      eventType: "work_item.updated",
      at: "2026-10-03T00:00:00.000Z",
      key: "SUP-1",
      customerVisible: true,
    });
    await expect(hint).resolves.toEqual({
      type: "work_item.updated",
      topic: `project:${project.project.id}`,
      eventId: "evt_native_test_1",
      at: "2026-10-03T00:00:00.000Z",
      payload: { key: "SUP-1" },
    });

    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    socket.close();
    await closed;
  });

  it("persists native event envelopes with the mutation transaction and rolls them back with it", async () => {
    const member = await createWorkspaceMember();
    const project = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const input = {
      kind: "work_item.updated" as const,
      workItemId: "work-item-native-test",
      key: "SUP-1",
      workspaceId: member.workspace.id,
      projectId: project.project.id,
      actorId: member.user.id,
      actorType: "person" as const,
      customerVisible: false,
      payload: { key: "SUP-1", url: "/agent/work-items/SUP-1" },
    };

    await expect(
      db.transaction(async (tx) => {
        await recordWorkItemEvent(tx, input);
        throw new Error("force transaction rollback");
      }),
    ).rejects.toThrow("force transaction rollback");
    expect(
      await db
        .select({ eventId: schema.outboxTable.eventId })
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.workspaceId, member.workspace.id)),
    ).toEqual([]);

    const committed = await db.transaction((tx) =>
      recordWorkItemEvent(tx, input),
    );
    const [row] = await db
      .select({
        eventId: schema.outboxTable.eventId,
        payload: schema.outboxTable.payload,
      })
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.eventId, committed.id));
    expect(row?.eventId).toBe(committed.id);
    expect(row?.payload).toMatchObject({
      id: committed.id,
      kind: "work_item.updated",
      scope: {
        workspaceId: member.workspace.id,
        projectId: project.project.id,
      },
      payload: input.payload,
    });
  });

  it("rejects unauthenticated upgrades before 101, then authenticates real cookie upgrades", async () => {
    const member = await createWorkspaceMember();
    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);

    const headers = { host: "localhost:1337", origin: "http://localhost:1337" };
    const url = websocketUrl(node.server, "/api/ws");
    expect(await rejectHandshake(url, headers)).toBe(401);

    mockAuthenticatedSession(member.user);
    const socket = await openSocket(url, {
      ...headers,
      cookie: "__Host-tdk_agent_session=integration-session",
    });
    const denied = nextMessage(socket);
    socket.send(
      JSON.stringify({ type: "subscribe", topic: `user:${member.user.id}` }),
    );
    await expect(denied).resolves.toEqual({ type: "subscription_denied" });
    broadcastToUser(member.user.id, {
      type: "NOTIFICATION_CREATED",
      id: "notice-1",
    });

    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    socket.close();
    await closed;
    await vi.waitFor(() => expect(node.websocketServer.clients.size).toBe(0));
    broadcastToUser(member.user.id, {
      type: "NOTIFICATION_CREATED",
      id: "after-close",
    });
  });

  it("rejects session upgrades before 101 for missing, foreign, wrong-host, or wrong-portal boundaries", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);
    const url = websocketUrl(node.server, "/api/ws");
    const cookie = "__Host-tdk_agent_session=integration-session";

    expect(await rejectHandshake(url, { host: "localhost:1337", cookie })).toBe(
      403,
    );
    expect(
      await rejectHandshake(url, {
        host: "localhost:1337",
        origin: "https://attacker.example",
        cookie,
      }),
    ).toBe(403);
    expect(
      await rejectHandshake(url, {
        host: "localhost:5174",
        origin: "http://localhost:1337",
        cookie,
      }),
    ).toBe(404);

    mockAuthenticatedSession(member.user, { portal: "customer" });
    expect(
      await rejectHandshake(url, {
        host: "localhost:1337",
        origin: "http://localhost:1337",
        cookie,
      }),
    ).toBe(403);

    expect(
      await rejectHandshake(url, {
        host: "portal.localhost:5174",
        origin: "http://portal.localhost:5174",
        cookie: "__Host-tdk_portal_session=integration-session",
      }),
    ).toBe(404);
  });

  it("does not let an invalid explicit credential fall back to a valid session cookie", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);
    const url = websocketUrl(node.server, "/api/ws");
    const common = {
      host: "localhost:1337",
      origin: "http://localhost:1337",
      cookie: "__Host-tdk_agent_session=integration-session",
    };

    expect(
      await rejectHandshake(url, {
        ...common,
        authorization: "Bearer invalid-token",
      }),
    ).toBe(401);
    expect(
      await rejectHandshake(url, {
        ...common,
        authorization: "Digest invalid-token",
      }),
    ).toBe(401);
    expect(
      await rejectHandshake(url, { ...common, "x-api-key": "invalid-api-key" }),
    ).toBe(401);
  });

  it("preserves the API-key Origin omission exception and validates supplied Origins", async () => {
    const member = await createWorkspaceMember();
    const rawKey = `taskdesk_test_${randomBytes(16).toString("hex")}`;
    const hashedKey = createHash("sha256")
      .update(rawKey)
      .digest()
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      referenceId: member.user.id,
      userId: member.user.id,
      key: hashedKey,
      name: "realtime handshake",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      createdAt: now,
      updatedAt: now,
    });

    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);
    const url = websocketUrl(node.server, "/api/ws");
    const socket = await openSocket(url, {
      host: "localhost:1337",
      authorization: `Bearer ${rawKey}`,
    });
    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    socket.close();
    await closed;

    expect(
      await rejectHandshake(url, {
        host: "localhost:1337",
        origin: "https://attacker.example",
        authorization: `Bearer ${rawKey}`,
      }),
    ).toBe(403);
  });

  it("keeps the portal edge disabled while its underlying auth instance binds sessions", async () => {
    const member = await createWorkspaceMember();
    await db.insert(schema.accountTable).values({
      id: `credential-${member.user.id}`,
      accountId: member.user.id,
      providerId: "credential",
      userId: member.user.id,
      password: await bcrypt.hash("Realtime-Test-Password-42!", 4),
    });

    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);
    const address = node.server.address() as AddressInfo;
    const signInAgent = async () => {
      const response = await rawPostToHost(
        address.port,
        "/api/auth/sign-in/email",
        "localhost:1337",
        "http://localhost:1337",
        JSON.stringify({
          email: member.user.email,
          password: "Realtime-Test-Password-42!",
        }),
      );
      expect(response.status).toBe(200);
      const cookieName = "__Host-tdk_agent_session=";
      const setCookie = (response.headers["set-cookie"] ?? []).find((header) =>
        header.startsWith(cookieName),
      );
      expect(setCookie).toMatch(/;\s*Path=\//i);
      expect(setCookie).toMatch(/;\s*Secure(?:;|$)/i);
      expect(setCookie).toMatch(/;\s*HttpOnly(?:;|$)/i);
      expect(setCookie).toMatch(/;\s*SameSite=Lax(?:;|$)/i);
      expect(setCookie).not.toMatch(/;\s*Domain=/i);
      const cookie = setCookie?.split(";", 1)[0];
      expect(cookie).toBeDefined();
      return cookie as string;
    };

    const firstCookie = await signInAgent();
    const portalSignInRequest = new Request(
      "http://portal.localhost:5174/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          origin: "http://portal.localhost:5174",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: member.user.email,
          password: "Realtime-Test-Password-42!",
        }),
      },
    );
    const portalSignInResponse = await portalAuth.handler(portalSignInRequest);
    expect(portalSignInResponse.status).toBe(200);
    const portalSetCookie =
      portalSignInResponse.headers.get("set-cookie") ?? "";
    const portalCookie = portalSetCookie.match(
      /__Host-tdk_portal_session=[^;,]+/,
    )?.[0];
    expect(portalCookie).toBeDefined();
    expect(portalSetCookie).toMatch(/;\s*Path=\//i);
    expect(portalSetCookie).toMatch(/;\s*Secure(?:;|$)/i);
    expect(portalSetCookie).toMatch(/;\s*HttpOnly(?:;|$)/i);
    expect(portalSetCookie).toMatch(/;\s*SameSite=Lax(?:;|$)/i);
    expect(portalSetCookie).not.toMatch(/;\s*Domain=/i);

    const portalEdgeSignIn = await rawPostToHost(
      address.port,
      "/api/auth/sign-in/email",
      "portal.localhost:5174",
      "http://portal.localhost:5174",
      JSON.stringify({
        email: member.user.email,
        password: "Realtime-Test-Password-42!",
      }),
    );
    expect(portalEdgeSignIn.status).toBe(404);
    expect(portalEdgeSignIn.body).toBe('{"message":"Not Found"}');
    expect(portalEdgeSignIn.headers["set-cookie"]).toBeUndefined();

    const currentSessions = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, member.user.id));
    expect(currentSessions.some((session) => session.portal === "agent")).toBe(
      true,
    );
    expect(
      currentSessions.some((session) => session.portal === "customer"),
    ).toBe(true);

    const url = websocketUrl(node.server, "/api/ws");
    expect(
      await rejectHandshake(url, {
        host: "localhost:1337",
        origin: "https://attacker.example",
        cookie: firstCookie,
      }),
    ).toBe(403);
    const liveSocket = await openSocket(url, {
      host: "localhost:1337",
      origin: "http://localhost:1337",
      cookie: firstCookie,
    });
    const closed = new Promise<void>((resolve) =>
      liveSocket.once("close", () => resolve()),
    );
    liveSocket.close();
    await closed;

    expect(
      await rejectHandshake(url, {
        host: "portal.localhost:5174",
        origin: "http://portal.localhost:5174",
        cookie: portalCookie as string,
      }),
    ).toBe(404);
    expect(
      await rawGetToHost(
        address.port,
        "/api/auth/get-session",
        "portal.localhost:5174",
        "http://portal.localhost:5174",
        { cookie: portalCookie as string },
      ),
    ).toMatchObject({ status: 404, body: '{"message":"Not Found"}' });
    const portalSession = await portalAuth.api.getSession({
      headers: new Headers({ cookie: portalCookie as string }),
    });
    expect(portalSession?.session.portal).toBe("customer");
    expect(
      await auth.api.getSession({
        headers: new Headers({ cookie: portalCookie as string }),
      }),
    ).toBeNull();
    expect(
      await rejectHandshake(url, {
        host: "localhost:1337",
        origin: "http://localhost:1337",
        cookie: portalCookie as string,
      }),
    ).toBe(401);

    const copiedAgentCookie = `__Host-tdk_portal_session=${firstCookie.split("=", 2)[1]}`;
    expect(
      await rejectHandshake(url, {
        host: "portal.localhost:5174",
        origin: "http://portal.localhost:5174",
        cookie: copiedAgentCookie,
      }),
    ).toBe(404);
    const crossPortalSession = await rawGetToHost(
      address.port,
      "/api/auth/get-session",
      "portal.localhost:5174",
      "http://portal.localhost:5174",
      { cookie: copiedAgentCookie },
    );
    expect(crossPortalSession.status).toBe(404);

    const agentSession = currentSessions.find(
      (session) => session.portal === "agent",
    );
    if (!agentSession)
      throw new Error("agent sign-in did not persist a session");
    await db
      .update(schema.sessionTable)
      .set({ portal: null })
      .where(eq(schema.sessionTable.id, agentSession.id));
    expect(
      await rejectHandshake(url, {
        host: "localhost:1337",
        origin: "http://localhost:1337",
        cookie: firstCookie,
      }),
    ).toBe(403);
    const unboundSession = await rawGetToHost(
      address.port,
      "/api/auth/get-session",
      "localhost:1337",
      "http://localhost:1337",
      { cookie: firstCookie },
    );
    expect(unboundSession.status).toBe(403);

    await db
      .update(schema.sessionTable)
      .set({ portal: "agent" })
      .where(eq(schema.sessionTable.id, agentSession.id));
    const invalidExplicitCredential = await rawPostToHost(
      address.port,
      "/api/auth/sign-out",
      "localhost:1337",
      "http://localhost:1337",
      "",
      { cookie: firstCookie, authorization: "Digest invalid-token" },
    );
    expect(invalidExplicitCredential.status).toBe(401);
    const blankApiKey = await rawPostToHost(
      address.port,
      "/api/auth/sign-out",
      "localhost:1337",
      "http://localhost:1337",
      "",
      { cookie: firstCookie, "x-api-key": " " },
    );
    expect(blankApiKey.status).toBe(401);
    const logout = await rawPostToHost(
      address.port,
      "/api/auth/sign-out",
      "localhost:1337",
      "http://localhost:1337",
      "{}",
      { cookie: firstCookie },
    );
    expect(logout.status).toBe(200);
    expect(
      await rejectHandshake(url, {
        host: "localhost:1337",
        origin: "http://localhost:1337",
        cookie: firstCookie,
      }),
    ).toBe(401);

    const expiredCookie = await signInAgent();
    const sessionsAfterReconnect = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, member.user.id));
    const newSession = sessionsAfterReconnect.find(
      (session) => session.portal === "agent",
    );
    expect(newSession?.portal).toBe("agent");
    if (!newSession) throw new Error("sign-in did not persist its session");
    await db
      .update(schema.sessionTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.sessionTable.id, newSession.id));
    expect(
      await rejectHandshake(url, {
        host: "localhost:1337",
        origin: "http://localhost:1337",
        cookie: expiredCookie,
      }),
    ).toBe(401);
  });

  it("preserves legacy task project reach masking, window fanout, and shutdown", async () => {
    const member = await createWorkspaceMember();
    const stranger = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: stranger.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);

    const headers = {
      origin: "http://localhost:1337",
      host: "localhost:1337",
      cookie: "__Host-tdk_agent_session=integration-session",
    };
    const address = node.server.address() as AddressInfo;
    const httpBase = `http://127.0.0.1:${address.port}`;
    const live = await fetch(`${httpBase}/api/public/health/live`);
    expect(live.status).toBe(200);
    expect(live.headers.get("content-type")).toContain("application/json");
    await expect(live.json()).resolves.toEqual({ status: "ok" });

    const foreignOrigin = await fetch(`${httpBase}/api/public/health/live`, {
      headers: { origin: "https://attacker.example" },
    });
    expect(foreignOrigin.headers.get("access-control-allow-origin")).toBeNull();

    const created = await rawPost(
      address.port,
      "/api/project",
      headers.origin,
      headers.cookie,
      JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Real listener JSON body",
        icon: "FolderKanban",
        slug: "real-listener-json-body",
      }),
    );
    expect(created.status).toBe(200);
    expect(created.headers["access-control-allow-origin"]).toBe(headers.origin);
    expect(created.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(created.body)).toMatchObject({
      workspaceId: member.workspace.id,
      name: "Real listener JSON body",
      slug: "real-listener-json-body",
    });

    const socket = await openSocket(
      websocketUrl(node.server, `/api/ws/${project.id}?windowId=window-7`),
      headers,
    );
    const observer = await openSocket(
      websocketUrl(node.server, `/api/ws/${project.id}?windowId=window-8`),
      headers,
    );
    let ownEchoReceived = false;
    const onOwnEcho = () => {
      ownEchoReceived = true;
    };
    socket.once("message", onOwnEcho);
    const observerEvent = nextMessage(observer);
    broadcastToProject(
      project.id,
      { type: "work_item.updated", projectId: project.id, taskId: "TD-echo" },
      `${member.user.id}:window-7`,
    );
    await expect(observerEvent).resolves.toMatchObject({
      type: "work_item.updated",
      taskId: "TD-echo",
    });
    expect(ownEchoReceived).toBe(false);
    socket.off("message", onOwnEcho);
    expect(socket.readyState).toBe(WebSocket.OPEN);

    const delivered = nextMessage(socket);
    const observerDelivered = nextMessage(observer);
    broadcastToProject(project.id, {
      type: "work_item.updated",
      projectId: project.id,
      taskId: "TD-1",
    });
    await expect(delivered).resolves.toMatchObject({
      type: "work_item.updated",
      projectId: project.id,
      taskId: "TD-1",
    });
    await expect(observerDelivered).resolves.toMatchObject({ taskId: "TD-1" });
    const foreignStatus = await rejectHandshake(
      websocketUrl(node.server, `/api/ws/${foreignProject.id}`),
      headers,
    );
    const missingStatus = await rejectHandshake(
      websocketUrl(node.server, "/api/ws/project-does-not-exist"),
      headers,
    );
    expect(foreignStatus).toBe(401);
    expect(missingStatus).toBe(foreignStatus);

    const clientClose = new Promise<number>((resolve) => {
      socket.once("close", (code) => resolve(code));
    });
    const observerClose = new Promise<void>((resolve) => {
      observer.once("close", () => resolve());
    });
    const serverClose = node.close();
    await expect(clientClose).resolves.toBe(1001);
    await observerClose;
    await serverClose;
  });

  it("joins the active HTTP response before resolving graceful shutdown", async () => {
    const { app, releaseResponse, responseStarted } = createHeldHttpApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);

    const port = (node.server.address() as AddressInfo).port;
    const response = holdStreamingResponse(port);
    await response.firstChunk;
    await responseStarted.promise;

    const httpClosed = deferred<void>();
    node.server.once("close", () => httpClosed.resolve());
    let settled = false;
    const closing = node.close();
    void closing.then(() => {
      settled = true;
    });

    expect(node.server.listening).toBe(false);
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseResponse.resolve();
    await expect(response.bodyComplete).resolves.toBe(
      "response-start-response-end",
    );
    await httpClosed.promise;
    await expect(closing).resolves.toBe("graceful");
    closeServer = undefined;
    expect(settled).toBe(true);
  });

  it("joins one pending adapter callback and returns one idempotent close promise", async () => {
    const { app } = createApp();
    const adapterGate = deferred<void>();
    const adapterStarted = deferred<void>();
    const shutdownAdapter = vi.fn(() => {
      adapterStarted.resolve();
      return adapterGate.promise;
    });
    const forceAdapter = vi.fn();
    const node = createNodeServer(app, 0, {
      shutdownAdapter,
      forceAdapter,
    });
    closeServer = node.close;
    await listening(node.server);

    const httpClosed = deferred<void>();
    node.server.once("close", () => httpClosed.resolve());
    const closing = node.close();
    expect(node.close()).toBe(closing);
    await adapterStarted.promise;
    await httpClosed.promise;
    expect(shutdownAdapter).toHaveBeenCalledTimes(1);
    expect(forceAdapter).not.toHaveBeenCalled();
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    adapterGate.resolve();
    await expect(closing).resolves.toBe("graceful");
    expect(forceAdapter).not.toHaveBeenCalled();
    closeServer = undefined;
  });

  it("serves only public static files through raw Node HTTP paths", async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), "taskdesk-node-static-"));
    const privateFile = join(
      staticRoot,
      "..",
      `taskdesk-private-${Date.now()}.txt`,
    );
    mkdirSync(join(staticRoot, "assets"));
    writeFileSync(join(staticRoot, "index.html"), "public-spa-shell");
    writeFileSync(join(staticRoot, "assets", "app.js"), "public-asset");
    writeFileSync(privateFile, "private-fixture-bytes");

    const { app } = createApp({ staticRoot });
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);
    const port = (node.server.address() as AddressInfo).port;

    try {
      const asset = await rawGet(port, "/assets/app.js");
      expect(asset.status).toBe(200);
      expect(asset.body).toBe("public-asset");

      const shell = await rawGet(port, "/projects/direct-load");
      expect(shell.status).toBe(200);
      expect(shell.body).toBe("public-spa-shell");

      for (const path of [
        `/%2e%2e/${basename(privateFile)}`,
        "/assets/%2Fapp.js",
        "/static/%61dmin/secret.txt",
      ]) {
        const response = await rawGet(port, path);
        expect(response.body).not.toContain("private-fixture-bytes");
      }

      const apiPath = await rawGet(
        port,
        `/api/%2F%2e%2e%2F${basename(privateFile)}`,
      );
      expect(apiPath.body).not.toContain("public-spa-shell");
      expect(apiPath.body).not.toContain("private-fixture-bytes");
    } finally {
      await node.close();
      closeServer = undefined;
      rmSync(staticRoot, { recursive: true, force: true });
      rmSync(privateFile, { force: true });
    }
  });

  it("forces active HTTP, a nonresponsive real WebSocket, and adapter cleanup at one deadline", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createHeldHttpApp();
    const adapterGate = deferred<void>();
    const adapterStarted = deferred<void>();
    const forceStarted = deferred<void>();
    const shutdownAdapter = vi.fn(() => {
      adapterStarted.resolve();
      return adapterGate.promise;
    });
    const forceAdapter = vi.fn(() => forceStarted.resolve());
    const node = createNodeServer(app, 0, {
      shutdownTimeoutMs: 50,
      shutdownAdapter,
      forceAdapter,
    });
    closeServer = node.close;
    await listening(node.server);

    const port = (node.server.address() as AddressInfo).port;
    const response = holdStreamingResponse(port);
    await response.firstChunk;
    const rawSocket = await openUnresponsiveWebSocket(
      port,
      "taskdesk.session_token=integration-session",
    );
    const socketClosed = new Promise<void>((resolve) => {
      rawSocket.once("close", () => resolve());
    });
    await vi.waitFor(() => expect(node.websocketServer.clients.size).toBe(1));

    const httpClosed = deferred<void>();
    node.server.once("close", () => httpClosed.resolve());
    const closing = node.close();
    expect(node.close()).toBe(closing);
    await adapterStarted.promise;
    expect(shutdownAdapter).toHaveBeenCalledTimes(1);
    expect(forceAdapter).not.toHaveBeenCalled();

    await forceStarted.promise;
    await expect(closing).resolves.toBe("forced");
    await response.responseInterrupted;
    await socketClosed;
    await httpClosed.promise;
    await vi.waitFor(() => expect(node.websocketServer.clients.size).toBe(0));
    expect(forceAdapter).toHaveBeenCalledTimes(1);
    adapterGate.resolve();
    closeServer = undefined;
  });
});
