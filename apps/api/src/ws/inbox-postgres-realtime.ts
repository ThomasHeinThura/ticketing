import type { Pool, PoolClient } from "pg";
import { getDatabasePool } from "../database";

export const INBOX_NOTIFICATION_CHANNEL = "taskdesk_inbox_created";
const LISTEN_SQL = `LISTEN ${INBOX_NOTIFICATION_CHANNEL}`;
const UNLISTEN_SQL = `UNLISTEN ${INBOX_NOTIFICATION_CHANNEL}`;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 30_000;
const STABLE_CONNECTION_RESET_MS = 60_000;

type InboxCreatedPayload = { userId: string };

/** Parse only the small, closed payload emitted by the inbox INSERT trigger. */
export function parseInboxCreatedNotification(
  channel: string | null | undefined,
  payload: string | null | undefined,
): InboxCreatedPayload | null {
  if (
    channel !== INBOX_NOTIFICATION_CHANNEL ||
    !payload ||
    payload.length > 1024
  )
    return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1
    )
      return null;
    const userId = (parsed as { userId?: unknown }).userId;
    if (typeof userId !== "string" || userId.length < 1 || userId.length > 256)
      return null;
    return { userId };
  } catch {
    return null;
  }
}

type RealtimeClient = Pick<PoolClient, "query" | "release" | "on" | "off">;
type RealtimePool = Pick<Pool, "connect">;
type ClientRecord = {
  client: RealtimeClient;
  closed: boolean;
  onNotification: (message: { channel?: string; payload?: string }) => void;
  onError: (error: Error) => void;
  onEnd: () => void;
};

/**
 * PostgreSQL-backed invalidation listener. Each HTTP process listens on its own
 * checked-out pool connection. PostgreSQL delivers NOTIFY only after the inserting
 * transaction commits; failures reconnect with capped exponential backoff.
 */
export function createInboxPostgresRealtime(options: {
  pool: RealtimePool;
  deliverLocalInvalidation: (userId: string) => void;
  onReady?: () => void;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}) {
  const baseDelay = options.baseRetryDelayMs ?? BASE_RETRY_DELAY_MS;
  const maxDelay = options.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS;
  let active = false;
  let generation = 0;
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let current: ClientRecord | null = null;
  let pendingConnect: Promise<void> | null = null;

  const isCurrentGeneration = (candidate: number) =>
    active && generation === candidate;

  const cancelRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const cancelStableTimer = () => {
    if (stableTimer !== null) clearTimeout(stableTimer);
    stableTimer = null;
  };

  const scheduleReconnect = (candidate: number) => {
    if (!isCurrentGeneration(candidate) || retryTimer !== null) return;
    const exponent = Math.min(retryAttempt, 16);
    const delay = Math.min(baseDelay * 2 ** exponent, maxDelay);
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      launch(candidate);
    }, delay);
  };

  const removeListeners = (record: ClientRecord) => {
    record.client.off("notification", record.onNotification);
    record.client.off("error", record.onError);
    record.client.off("end", record.onEnd);
  };

  const release = async (
    record: ClientRecord,
    options_: { destroy?: Error; unlisten?: boolean } = {},
  ) => {
    if (record.closed) return;
    record.closed = true;
    removeListeners(record);
    if (current === record) current = null;
    if (!options_.destroy && options_.unlisten) {
      try {
        await record.client.query(UNLISTEN_SQL);
      } catch {
        // Releasing the checked-out connection is still required on failed UNLISTEN.
      }
    }
    try {
      record.client.release(options_.destroy);
    } catch {
      // Pool shutdown may race release; connection ownership is already cleared here.
    }
  };

  const failConnection = (
    record: ClientRecord,
    candidate: number,
    error: Error,
  ) => {
    if (record.closed) return;
    cancelStableTimer();
    void release(record, { destroy: error }).finally(() =>
      scheduleReconnect(candidate),
    );
  };

  const connect = async (candidate: number): Promise<void> => {
    let client: RealtimeClient | null = null;
    let record: ClientRecord | null = null;
    try {
      client = await options.pool.connect();
      if (!isCurrentGeneration(candidate)) {
        try {
          client.release();
        } catch {
          // A concurrent pool shutdown already owns this checked-out connection.
        }
        client = null;
        return;
      }
      let connectionRecord!: ClientRecord;
      connectionRecord = {
        client,
        closed: false,
        onNotification: (message) => {
          const parsed = parseInboxCreatedNotification(
            message.channel,
            message.payload,
          );
          if (
            !parsed ||
            connectionRecord.closed ||
            current !== connectionRecord
          )
            return;
          try {
            options.deliverLocalInvalidation(parsed.userId);
          } catch {
            // Realtime is an optimization; the next normal fetch restores the view.
          }
        },
        onError: (error) => failConnection(connectionRecord, candidate, error),
        onEnd: () =>
          failConnection(
            connectionRecord,
            candidate,
            new Error("PostgreSQL listener ended"),
          ),
      };
      record = connectionRecord;
      current = connectionRecord;
      client.on("notification", connectionRecord.onNotification);
      client.on("error", connectionRecord.onError);
      client.on("end", connectionRecord.onEnd);
      await client.query(LISTEN_SQL);
      if (!isCurrentGeneration(candidate) || connectionRecord.closed) {
        await release(connectionRecord, { unlisten: true });
        return;
      }
      cancelStableTimer();
      stableTimer = setTimeout(() => {
        stableTimer = null;
        retryAttempt = 0;
      }, STABLE_CONNECTION_RESET_MS);
      try {
        options.onReady?.();
      } catch {
        // The active sockets will receive another invalidation on the next reconnect.
      }
    } catch {
      if (client) {
        if (record) {
          if (!record.closed) {
            await release(record, { destroy: new Error("LISTEN failed") });
          }
        } else {
          try {
            client.release(new Error("LISTEN failed"));
          } catch {
            // A concurrent stop may already have returned the connection.
          }
        }
      }
      scheduleReconnect(candidate);
    }
  };

  const launch = (candidate: number) => {
    if (!isCurrentGeneration(candidate)) return;
    const task = connect(candidate);
    pendingConnect = task;
    void task.finally(() => {
      if (pendingConnect === task) pendingConnect = null;
    });
  };

  return {
    start() {
      if (active) return;
      active = true;
      retryAttempt = 0;
      const candidate = ++generation;
      launch(candidate);
    },
    async stop() {
      if (!active && !current && !retryTimer && !pendingConnect) return;
      active = false;
      generation += 1;
      cancelRetry();
      cancelStableTimer();
      const pending = pendingConnect;
      if (current) await release(current, { unlisten: true });
      if (pending) await pending;
      if (current) await release(current, { unlisten: true });
    },
    /** Synchronous shutdown path used after the server's graceful-stop deadline. */
    forceStop() {
      active = false;
      generation += 1;
      cancelRetry();
      cancelStableTimer();
      if (current) {
        void release(current, { destroy: new Error("listener stopped") });
      }
    },
  };
}

let processListener: ReturnType<typeof createInboxPostgresRealtime> | null =
  null;

export function startInboxPostgresRealtime(
  deliverLocalInvalidation: (userId: string) => void,
  onReady?: () => void,
) {
  if (!processListener) {
    processListener = createInboxPostgresRealtime({
      pool: getDatabasePool(),
      deliverLocalInvalidation,
      ...(onReady ? { onReady } : {}),
    });
  }
  processListener.start();
}

export async function stopInboxPostgresRealtime() {
  const currentListener = processListener;
  processListener = null;
  await currentListener?.stop();
}

export function forceStopInboxPostgresRealtime() {
  processListener?.forceStop();
  processListener = null;
}
