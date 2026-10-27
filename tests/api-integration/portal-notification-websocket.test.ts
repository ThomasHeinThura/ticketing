import { randomUUID } from "node:crypto";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portalAuth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp, createNodeServer } from "../../apps/api/src/index";
import {
  broadcastNativeWorkItemHint,
  broadcastToUser,
  initializeWebSocketAdapter,
  shutdownWebSocketAdapter,
} from "../../apps/api/src/ws";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { seedIntake, submitAs } from "./helpers/intake-http";

interface TestSocket {
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
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type TestWebSocketConstructor = {
  new (url: string, options: { headers: Record<string, string> }): TestSocket;
};

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const WebSocket = apiRequire("ws") as TestWebSocketConstructor;
const portalHost = "portal.localhost:5174";
const portalOrigin = `http://${portalHost}`;

function websocketUrl(port: number) {
  return `ws://127.0.0.1:${port}/api/ws/portal/notification`;
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
      reject(
        new Error(
          "rejected portal notification websocket unexpectedly upgraded",
        ),
      );
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

async function expectNoMessage(socket: TestSocket) {
  const received = await Promise.race([
    new Promise<boolean>((resolve, reject) => {
      socket.once("message", () => resolve(true));
      socket.once("error", reject);
    }),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
  ]);
  expect(received).toBe(false);
}

describe("portal notification websocket boundary", () => {
  let closeServer: (() => Promise<unknown>) | undefined;

  beforeEach(async () => {
    await resetTestDatabase();
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
    await shutdownWebSocketAdapter();
    vi.restoreAllMocks();
  });

  it("accepts the customer portal cookie only on its exact host/origin and sends safe invalidations", async () => {
    const seed = await seedIntake(`no16-portal-ws-${randomUUID()}`);
    mockAuthenticatedSession(seed.customer.user, { portal: "customer" });
    const { app } = createApp();
    const node = createNodeServer(app, 0, { hostname: "127.0.0.1" });
    closeServer = node.close;
    await new Promise<void>((resolve, reject) => {
      node.server.once("listening", resolve);
      node.server.once("error", reject);
    });
    const address = node.server.address() as AddressInfo;
    const url = websocketUrl(address.port);
    const cookie = "__Host-tdk_portal_session=integration-session";

    expect(
      await rejectHandshake(url, {
        host: portalHost,
        origin: "https://attacker.example",
        cookie,
      }),
    ).toBe(403);
    expect(
      await rejectHandshake(url, {
        host: "localhost:1337",
        origin: "http://localhost:1337",
        cookie,
      }),
    ).toBe(404);
    expect(
      await rejectHandshake(url, {
        host: portalHost,
        origin: portalOrigin,
        cookie,
        "x-api-key": "invalid-explicit-credential",
      }),
    ).toBe(403);

    mockAnonymousSession();
    expect(
      await rejectHandshake(url, {
        host: portalHost,
        origin: portalOrigin,
      }),
    ).toBe(401);

    mockAuthenticatedSession(seed.customer.user);
    expect(
      await rejectHandshake(url, {
        host: portalHost,
        origin: portalOrigin,
        cookie: cookie.replace(
          "__Host-tdk_portal_session=",
          "__Host-tdk_agent_session=",
        ),
      }),
    ).toBe(401);

    // P4R2-M2: a push is admitted for a recent notification whose project has the customer
    // portal on (fan-out writes the row before it broadcasts).
    const ref = await submitAs(seed, seed.customer);
    const [submission] = await db
      .select({ id: schema.submissionTable.id })
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.number, Number(ref.slice(4))));
    await db.insert(schema.notificationTable).values({
      userId: seed.customer.user.id,
      personId: seed.customer.person.id,
      type: "task_comment",
      kind: "submission.replied",
      title: "Reply",
      content: "Reply",
      resourceType: "submission",
      resourceId: submission?.id ?? null,
      isRead: false,
    });
    mockAuthenticatedSession(seed.customer.user, { portal: "customer" });
    const socket = await openSocket(url, {
      host: portalHost,
      origin: portalOrigin,
      cookie,
    });

    const safeNotice = nextMessage(socket);
    broadcastToUser(seed.customer.user.id, {
      type: "NOTIFICATION_CREATED",
      title: "must be suppressed",
    });
    broadcastToUser(seed.customer.user.id, { type: "NOTIFICATION_CREATED" });
    await expect(safeNotice).resolves.toEqual({ type: "NOTIFICATION_CREATED" });

    socket.send(
      JSON.stringify({ type: "subscribe", topic: "project:private" }),
    );
    await broadcastNativeWorkItemHint({
      projectId: `project-${randomUUID()}`,
      topics: ["project:private"],
      eventId: `evt-${randomUUID()}`,
      eventType: "work_item.updated",
      at: new Date().toISOString(),
      key: "PRIVATE-1",
      customerVisible: true,
    });
    await expectNoMessage(socket);

    const closed = new Promise<number>((resolve) =>
      socket.once("close", (code) => resolve(code)),
    );
    vi.spyOn(portalAuth.api, "getSession").mockResolvedValue(null as never);
    broadcastToUser(seed.customer.user.id, { type: "NOTIFICATION_CREATED" });
    await expect(closed).resolves.toBe(1008);
  });
});
