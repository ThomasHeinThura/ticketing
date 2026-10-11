import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/events", () => ({
  subscribeToEvent: vi.fn(),
  publishEvent: vi.fn(),
}));

const { logTaskDesk } = vi.hoisted(() => ({ logTaskDesk: vi.fn() }));
const { handleNativeAuthorizationInvalidation, reloadAuthConfiguration } =
  vi.hoisted(() => ({
    handleNativeAuthorizationInvalidation: vi.fn(),
    reloadAuthConfiguration: vi.fn().mockResolvedValue(true),
  }));
vi.mock("../../../apps/api/src/auth", () => ({
  reloadAuthConfiguration: (...args: unknown[]) =>
    reloadAuthConfiguration(...args),
}));
vi.mock("../../../apps/api/src/instance/observability/runtime", () => ({
  logTaskDesk: (...args: unknown[]) => logTaskDesk(...args),
}));
vi.mock("../../../apps/api/src/ws/native-work-item-realtime", () => ({
  deliverNativeBroadcast: vi.fn(),
  handleNativeAuthorizationInvalidation: (...args: unknown[]) =>
    handleNativeAuthorizationInvalidation(...args),
  addNativeConnection: vi.fn(),
  handleNativeFrame: vi.fn(),
  reauthorizeNativeConnection: vi.fn(),
  removeNativeConnection: vi.fn(),
}));

const publish = vi.fn();
const listeners: Array<(p: string, c: string, d: string) => void> = [];
const messageListeners: Array<(channel: string, data: string) => void> = [];
const subscriber = {
  psubscribe: vi.fn().mockResolvedValue(undefined),
  punsubscribe: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  on: vi.fn((event: string, fn: (...args: string[]) => void) => {
    if (event === "pmessage")
      listeners.push(fn as (p: string, c: string, d: string) => void);
    if (event === "message")
      messageListeners.push(fn as (channel: string, data: string) => void);
  }),
  off: vi.fn(
    (_event: string, fn: (p: string, c: string, d: string) => void) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
      const messageIndex = messageListeners.indexOf(
        fn as (channel: string, data: string) => void,
      );
      if (messageIndex >= 0) messageListeners.splice(messageIndex, 1);
    },
  ),
};

vi.mock("../../../apps/api/src/redis", () => ({
  isRedisConfigured: () => true,
  getRedisPub: () => ({ publish }),
  getRedisSub: () => subscriber,
  closeRedis: vi.fn().mockResolvedValue(undefined),
}));

import {
  addUserConnection,
  broadcastNativeWorkItemHint,
  broadcastToUser,
  initializeWebSocketAdapter,
  publishAuthReload,
  removeUserConnection,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws/index";

const USER_PATTERN = "taskdesk:ws-user:*:broadcast";
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

function makeFakeWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    raw: undefined,
    url: null,
    protocol: null,
  } as never;
}

function sendMock(ws: unknown) {
  return (ws as { send: ReturnType<typeof vi.fn> }).send;
}

function emitUserBroadcast(payload: unknown, channelUserId = "user-1") {
  const data = JSON.stringify(payload);
  for (const fn of [...listeners]) {
    fn(USER_PATTERN, `taskdesk:ws-user:${channelUserId}:broadcast`, data);
  }
}

describe("broadcastToUser with the redis adapter", () => {
  beforeEach(async () => {
    publish.mockReset().mockResolvedValue(1);
    logTaskDesk.mockClear();
    consoleError.mockClear();
    handleNativeAuthorizationInvalidation.mockReset();
    reloadAuthConfiguration.mockReset().mockResolvedValue(true);
    listeners.length = 0;
    messageListeners.length = 0;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it("delivers to local sockets without waiting on redis", async () => {
    const ws = makeFakeWs();
    const conn = addUserConnection("user-1", ws);

    broadcastToUser("user-1", { type: "NOTIFICATION_CREATED" });

    expect(sendMock(ws)).toHaveBeenCalledTimes(1);
    const [firstSend] = sendMock(ws).mock.calls;
    if (firstSend === undefined) {
      throw new Error("expected send() to have been called at least once");
    }
    expect(JSON.parse(firstSend[0]).type).toBe("NOTIFICATION_CREATED");

    removeUserConnection("user-1", conn);
  });

  it("still delivers locally when the publish fails", async () => {
    const sensitiveFailure = new Error("redis credential=do-not-log");
    publish.mockRejectedValue(sensitiveFailure);

    const ws = makeFakeWs();
    const conn = addUserConnection("user-1", ws);

    broadcastToUser("user-1", { type: "NOTIFICATION_CREATED" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sendMock(ws)).toHaveBeenCalledTimes(1);
    expect(logTaskDesk).toHaveBeenCalledWith({
      module: "realtime",
      message: "realtime.failure",
      level: "error",
      result: "failed",
    });
    expect(consoleError).not.toHaveBeenCalled();

    removeUserConnection("user-1", conn);
  });

  it("contains native publish failures to the finite realtime log event", async () => {
    const sensitiveFailure = new Error("redis token=must-not-appear");
    publish.mockRejectedValue(sensitiveFailure);

    await broadcastNativeWorkItemHint({
      projectId: "project-1",
      topics: ["project:project-1"],
      eventId: "event-1",
      eventType: "work_item.updated",
      at: new Date().toISOString(),
      key: "project:project-1:work_item.updated:item-1",
      customerVisible: false,
    });

    expect(logTaskDesk).toHaveBeenCalledWith({
      module: "realtime",
      message: "realtime.failure",
      level: "error",
      result: "failed",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs malformed subscriber messages without including payload data", async () => {
    const sensitivePayload = '{"userId":"private-user","token":"do-not-log"';
    for (const fn of [...listeners]) {
      fn(USER_PATTERN, "taskdesk:ws-user:user-1:broadcast", sensitivePayload);
    }

    expect(logTaskDesk).toHaveBeenCalledWith({
      module: "realtime",
      message: "realtime.failure",
      level: "error",
      result: "failed",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("publishes and consumes auth.reload control messages", async () => {
    await publishAuthReload();
    expect(publish).toHaveBeenCalledWith(
      "taskdesk:control",
      JSON.stringify({ type: "auth.reload" }),
    );

    for (const listener of [...messageListeners]) {
      listener("taskdesk:control", JSON.stringify({ type: "auth.reload" }));
    }
    await vi.waitFor(() =>
      expect(reloadAuthConfiguration).toHaveBeenCalledTimes(1),
    );
  });

  it("contains rejected async authorization invalidation handlers", async () => {
    handleNativeAuthorizationInvalidation.mockRejectedValue(
      new Error("session-cookie=do-not-log"),
    );
    for (const listener of [...messageListeners]) {
      listener(
        "taskdesk:control",
        JSON.stringify({ type: "identity.invalidate", userId: "user-1" }),
      );
    }
    await vi.waitFor(() => expect(logTaskDesk).toHaveBeenCalledTimes(1));

    expect(logTaskDesk).toHaveBeenCalledWith({
      module: "realtime",
      message: "realtime.failure",
      level: "error",
      result: "failed",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("ignores its own echo so the socket is written once", async () => {
    const ws = makeFakeWs();
    const conn = addUserConnection("user-1", ws);

    broadcastToUser("user-1", { type: "NOTIFICATION_CREATED" });
    expect(publish).toHaveBeenCalledTimes(1);

    const [firstPublish] = publish.mock.calls;
    if (firstPublish === undefined) {
      throw new Error("expected publish() to have been called at least once");
    }
    const published = JSON.parse(firstPublish[1]);
    expect(published.origin).toEqual(expect.any(String));

    emitUserBroadcast(published);

    expect(sendMock(ws)).toHaveBeenCalledTimes(1);

    removeUserConnection("user-1", conn);
  });

  it("delivers a broadcast published by another instance", async () => {
    const ws = makeFakeWs();
    const conn = addUserConnection("user-1", ws);

    emitUserBroadcast({
      userId: "user-1",
      message: { type: "NOTIFICATION_CREATED" },
      origin: "some-other-instance",
    });

    expect(sendMock(ws)).toHaveBeenCalledTimes(1);

    removeUserConnection("user-1", conn);
  });

  it("drops a message whose payload disagrees with its channel", async () => {
    const ws = makeFakeWs();
    const conn = addUserConnection("user-1", ws);

    emitUserBroadcast(
      {
        userId: "user-1",
        message: { type: "NOTIFICATION_CREATED" },
        origin: "some-other-instance",
      },
      "user-2",
    );

    expect(sendMock(ws)).not.toHaveBeenCalled();

    removeUserConnection("user-1", conn);
  });
});
