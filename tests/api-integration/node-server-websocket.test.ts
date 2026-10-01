import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, createNodeServer } from "../../apps/api/src/index";
import {
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
      { host: "127.0.0.1", port, path, method: "GET" },
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

describe("P0 #557: real Node HTTP and WebSocket adapter", () => {
  const originalAgentUrl = process.env.TASKDESK_AGENT_URL;
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    await resetTestDatabase();
    process.env.TASKDESK_AGENT_URL = "http://localhost:5173";
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
    await shutdownWebSocketAdapter();
    vi.restoreAllMocks();
    if (originalAgentUrl === undefined) {
      delete process.env.TASKDESK_AGENT_URL;
    } else {
      process.env.TASKDESK_AGENT_URL = originalAgentUrl;
    }
  });

  it("rejects unauthenticated upgrades before 101, then authenticates real cookie upgrades", async () => {
    const member = await createWorkspaceMember();
    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);

    const headers = { origin: "http://localhost:5173" };
    const url = websocketUrl(node.server, "/api/ws/user");
    expect(await rejectHandshake(url, headers)).toBe(401);

    mockAuthenticatedSession(member.user);
    let serverSendSpy: ReturnType<typeof vi.spyOn> | undefined;
    node.websocketServer.once("connection", (serverSocket) => {
      serverSendSpy = vi.spyOn(serverSocket, "send");
    });
    const socket = await openSocket(url, {
      ...headers,
      cookie: "taskdesk.session_token=integration-session",
    });
    const event = nextMessage(socket);
    broadcastToUser(member.user.id, {
      type: "NOTIFICATION_CREATED",
      id: "notice-1",
    });
    await expect(event).resolves.toEqual({
      type: "NOTIFICATION_CREATED",
      id: "notice-1",
    });
    if (!serverSendSpy) {
      throw new Error("expected the real Node WebSocket connection callback");
    }
    expect(serverSendSpy).toHaveBeenCalledTimes(1);

    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    socket.close();
    await closed;
    await vi.waitFor(() => expect(node.websocketServer.clients.size).toBe(0));
    serverSendSpy.mockClear();
    broadcastToUser(member.user.id, {
      type: "NOTIFICATION_CREATED",
      id: "after-close",
    });
    expect(serverSendSpy).not.toHaveBeenCalled();
  });

  it("preserves project reach masking, windowId fanout, and real shutdown", async () => {
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
      origin: "http://localhost:5173",
      cookie: "taskdesk.session_token=integration-session",
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

    const created = await fetch(`${httpBase}/api/project`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Real listener JSON body",
        icon: "FolderKanban",
        slug: "real-listener-json-body",
      }),
    });
    expect(created.status).toBe(200);
    expect(created.headers.get("access-control-allow-origin")).toBe(
      headers.origin,
    );
    expect(created.headers.get("content-type")).toContain("application/json");
    await expect(created.json()).resolves.toMatchObject({
      workspaceId: member.workspace.id,
      name: "Real listener JSON body",
      slug: "real-listener-json-body",
    });

    const base = websocketUrl(
      node.server,
      `/api/ws/${project.id}?windowId=window-7`,
    );
    const socket = await openSocket(base, headers);
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

  it("stops accepting before a stalled adapter and bounds shutdown", async () => {
    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await listening(node.server);

    let releaseAdapter: (() => void) | undefined;
    const pendingAdapter = new Promise<void>((resolve) => {
      releaseAdapter = resolve;
    });
    const port = (node.server.address() as AddressInfo).port;
    const startedAt = Date.now();
    const closing = node.close(() => pendingAdapter);

    expect(node.server.listening).toBe(false);
    await expect(
      fetch(`http://127.0.0.1:${port}/api/public/health/live`),
    ).rejects.toThrow();
    await closing;
    closeServer = undefined;
    expect(Date.now() - startedAt).toBeLessThan(6_000);
    releaseAdapter?.();
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
});
