import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisClient } from "../../../apps/api/src/redis";

type Gate = { promise: Promise<void>; resolve: () => void };

type FakeRedisClient = {
  disconnect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  psubscribe: ReturnType<typeof vi.fn>;
  punsubscribe: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
};

function deferred(): Gate {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeFakeRedisFactory(
  makeClient: () => FakeRedisClient,
  clients: FakeRedisClient[],
) {
  return () => {
    const client = makeClient();
    clients.push(client);
    return client as unknown as RedisClient;
  };
}

describe("Redis adapter shutdown lifecycle", () => {
  const originalValkeyUrl = process.env.TASKDESK_VALKEY_URL;
  const originalSentinels = Reflect.get(process.env, "REDIS_SENTINELS") as
    | string
    | undefined;
  const originalClusterNodes = Reflect.get(
    process.env,
    "REDIS_CLUSTER_NODES",
  ) as string | undefined;
  let redis: typeof import("../../../apps/api/src/redis");
  let ws: typeof import("../../../apps/api/src/ws");

  beforeEach(async () => {
    vi.resetModules();
    process.env.TASKDESK_VALKEY_URL = "redis://test.invalid:6379";
    Reflect.deleteProperty(process.env, "REDIS_SENTINELS");
    Reflect.deleteProperty(process.env, "REDIS_CLUSTER_NODES");
    redis = await import("../../../apps/api/src/redis");
    ws = await import("../../../apps/api/src/ws");
  });

  afterEach(() => {
    if (originalValkeyUrl === undefined) {
      delete process.env.TASKDESK_VALKEY_URL;
    } else {
      process.env.TASKDESK_VALKEY_URL = originalValkeyUrl;
    }
    if (originalSentinels === undefined) {
      Reflect.deleteProperty(process.env, "REDIS_SENTINELS");
    } else {
      Reflect.set(process.env, "REDIS_SENTINELS", originalSentinels);
    }
    if (originalClusterNodes === undefined) {
      Reflect.deleteProperty(process.env, "REDIS_CLUSTER_NODES");
    } else {
      Reflect.set(process.env, "REDIS_CLUSTER_NODES", originalClusterNodes);
    }
    vi.restoreAllMocks();
  });

  it("force-disconnects cached clients during pending publish and blocks late recreation", async () => {
    const clients: FakeRedisClient[] = [];
    const publishGate = deferred();
    const makeClient = () => ({
      disconnect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      publish: vi.fn(() => publishGate.promise),
      psubscribe: vi.fn().mockResolvedValue(undefined),
      punsubscribe: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue("OK"),
    });
    const clientFactory = makeFakeRedisFactory(makeClient, clients);
    await ws.initializeWebSocketAdapter({ redisClientFactory: clientFactory });
    ws.broadcastToProject("project-1", {
      type: "task.updated",
      projectId: "project-1",
      taskId: "task-1",
    });

    const shutdown = ws.shutdownWebSocketAdapter();
    await vi.waitFor(() =>
      expect(clients[1]?.publish).toHaveBeenCalledTimes(1),
    );
    expect(clients).toHaveLength(2);
    ws.forceShutdownWebSocketAdapter();

    for (const client of clients) {
      expect(client.disconnect).toHaveBeenCalledTimes(1);
    }
    expect(() => redis.getRedisPub()).toThrow(/force-closed/);
    expect(() => redis.getRedisSub()).toThrow(/force-closed/);
    expect(clients).toHaveLength(2);

    publishGate.resolve();
    await shutdown;
    expect(clients).toHaveLength(2);
    expect(clients[0]?.punsubscribe).not.toHaveBeenCalled();
    expect(clients[0]?.quit).not.toHaveBeenCalled();
  });

  it("does not start a second unsubscribe or quit after the first unsubscribe is forced", async () => {
    const clients: FakeRedisClient[] = [];
    const unsubscribeGate = deferred();
    const makeClient = () => ({
      disconnect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      publish: vi.fn().mockResolvedValue(1),
      psubscribe: vi.fn().mockResolvedValue(undefined),
      punsubscribe: vi.fn(() => unsubscribeGate.promise),
      quit: vi.fn().mockResolvedValue("OK"),
    });
    const clientFactory = makeFakeRedisFactory(makeClient, clients);
    await ws.initializeWebSocketAdapter({ redisClientFactory: clientFactory });

    const shutdown = ws.shutdownWebSocketAdapter();
    await vi.waitFor(() =>
      expect(clients[0]?.punsubscribe).toHaveBeenCalledTimes(1),
    );
    ws.forceShutdownWebSocketAdapter();

    expect(clients).toHaveLength(1);
    expect(clients[0]?.disconnect).toHaveBeenCalledTimes(1);
    unsubscribeGate.resolve();
    await shutdown;

    expect(clients[0]?.punsubscribe).toHaveBeenCalledTimes(1);
    expect(clients[0]?.quit).not.toHaveBeenCalled();
    expect(clients).toHaveLength(1);
  });

  it("disconnects the actual cached subscriber while quit is pending", async () => {
    const clients: FakeRedisClient[] = [];
    const quitGate = deferred();
    const makeClient = () => ({
      disconnect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      publish: vi.fn().mockResolvedValue(1),
      psubscribe: vi.fn().mockResolvedValue(undefined),
      punsubscribe: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn(() => quitGate.promise),
    });
    const clientFactory = makeFakeRedisFactory(makeClient, clients);
    await ws.initializeWebSocketAdapter({ redisClientFactory: clientFactory });

    const shutdown = ws.shutdownWebSocketAdapter();
    await vi.waitFor(() => expect(clients[0]?.quit).toHaveBeenCalledTimes(1));
    ws.forceShutdownWebSocketAdapter();

    expect(clients[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(() => redis.getRedisSub()).toThrow(/force-closed/);
    expect(clients).toHaveLength(1);
    quitGate.resolve();
    await shutdown;
    expect(clients).toHaveLength(1);
    expect(clients[0]?.punsubscribe).toHaveBeenCalledTimes(2);
  });
});
