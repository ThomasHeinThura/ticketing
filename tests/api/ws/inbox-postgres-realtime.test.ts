import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInboxPostgresRealtime,
  INBOX_NOTIFICATION_CHANNEL,
  parseInboxCreatedNotification,
} from "../../../apps/api/src/ws/inbox-postgres-realtime";

class FakeListenerClient extends EventEmitter {
  queries: string[] = [];
  releases: Array<Error | undefined> = [];
  queryError: Error | null = null;
  emitQueryError = false;

  async query(query: string) {
    this.queries.push(query);
    if (this.queryError) {
      if (this.emitQueryError) this.emit("error", this.queryError);
      throw this.queryError;
    }
    return { rows: [] };
  }

  release(error?: Error) {
    this.releases.push(error);
  }

  notify(channel: string, payload: string) {
    this.emit("notification", { channel, payload });
  }
}

function makePool(clients: FakeListenerClient[]) {
  return {
    connect: vi.fn(async () => {
      const client = clients.shift();
      if (!client) throw new Error("No test client available");
      return client as unknown as PoolClient;
    }),
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("PostgreSQL inbox realtime listener", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("parses only bounded user-only payloads on the fixed channel", () => {
    expect(
      parseInboxCreatedNotification(
        INBOX_NOTIFICATION_CHANNEL,
        JSON.stringify({ userId: "user-1" }),
      ),
    ).toEqual({ userId: "user-1" });
    expect(
      parseInboxCreatedNotification("another_channel", '{"userId":"user-1"}'),
    ).toBeNull();
    expect(
      parseInboxCreatedNotification(
        INBOX_NOTIFICATION_CHANNEL,
        '{"userId":"user-1","commentId":"private"}',
      ),
    ).toBeNull();
    expect(
      parseInboxCreatedNotification(INBOX_NOTIFICATION_CHANNEL, "not-json"),
    ).toBeNull();
    expect(
      parseInboxCreatedNotification(
        INBOX_NOTIFICATION_CHANNEL,
        JSON.stringify({ userId: "x".repeat(257) }),
      ),
    ).toBeNull();
  });

  it("LISTENs on a dedicated client and delivers only local invalidations", async () => {
    const client = new FakeListenerClient();
    const pool = makePool([client]);
    const deliver = vi.fn();
    const listener = createInboxPostgresRealtime({
      pool,
      deliverLocalInvalidation: deliver,
    });

    listener.start();
    await flushMicrotasks();

    expect(client.queries).toEqual([`LISTEN ${INBOX_NOTIFICATION_CHANNEL}`]);
    client.notify(INBOX_NOTIFICATION_CHANNEL, '{"userId":"customer-1"}');
    client.notify("wrong_channel", '{"userId":"customer-2"}');
    client.notify(
      INBOX_NOTIFICATION_CHANNEL,
      '{"userId":"customer-3","resourceId":"must-not-pass"}',
    );
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith("customer-1");

    await listener.stop();
    expect(client.queries).toEqual([
      `LISTEN ${INBOX_NOTIFICATION_CHANNEL}`,
      `UNLISTEN ${INBOX_NOTIFICATION_CHANNEL}`,
    ]);
    expect(client.releases).toHaveLength(1);
  });

  it("reconnects with capped backoff after one deduplicated connection error", async () => {
    const broken = new FakeListenerClient();
    const recovered = new FakeListenerClient();
    const pool = makePool([broken, recovered]);
    const onReady = vi.fn();
    const listener = createInboxPostgresRealtime({
      pool,
      deliverLocalInvalidation: vi.fn(),
      onReady,
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 200,
    });

    listener.start();
    await flushMicrotasks();
    const errorListener = broken.listeners("error")[0] as (
      error: Error,
    ) => void;
    errorListener(new Error("test disconnect"));
    errorListener(new Error("duplicate disconnect"));
    await flushMicrotasks();

    expect(broken.releases).toHaveLength(1);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(recovered.queries).toEqual([`LISTEN ${INBOX_NOTIFICATION_CHANNEL}`]);
    expect(onReady).toHaveBeenCalledTimes(2);

    await listener.stop();
    expect(recovered.queries.at(-1)).toBe(
      `UNLISTEN ${INBOX_NOTIFICATION_CHANNEL}`,
    );
  });

  it("releases a client that resolves after stop without LISTENing or retrying", async () => {
    const client = new FakeListenerClient();
    let resolveConnect!: (client: PoolClient) => void;
    const pool = {
      connect: vi.fn(
        () =>
          new Promise<PoolClient>((resolve) => {
            resolveConnect = resolve;
          }),
      ),
    };
    const listener = createInboxPostgresRealtime({
      pool,
      deliverLocalInvalidation: vi.fn(),
      baseRetryDelayMs: 100,
    });

    listener.start();
    const stopping = listener.stop();
    resolveConnect(client as unknown as PoolClient);
    await stopping;
    await flushMicrotasks();

    expect(client.queries).toEqual([]);
    expect(client.releases).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });

  it("does not release twice when the client errors while LISTEN is pending", async () => {
    const client = new FakeListenerClient();
    client.queryError = new Error("LISTEN failed");
    client.emitQueryError = true;
    const pool = makePool([client]);
    const listener = createInboxPostgresRealtime({
      pool,
      deliverLocalInvalidation: vi.fn(),
      baseRetryDelayMs: 100,
    });

    listener.start();
    await flushMicrotasks();
    expect(client.releases).toHaveLength(1);
    await listener.stop();
    expect(client.releases).toHaveLength(1);
  });

  it("cancels reconnect and unlistens on graceful stop", async () => {
    const client = new FakeListenerClient();
    const pool = makePool([client]);
    const listener = createInboxPostgresRealtime({
      pool,
      deliverLocalInvalidation: vi.fn(),
      baseRetryDelayMs: 100,
    });

    listener.start();
    await flushMicrotasks();
    await listener.stop();
    await vi.advanceTimersByTimeAsync(1000);

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.releases).toHaveLength(1);
  });
});
