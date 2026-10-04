import { and, eq, isNull } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import { z } from "zod";
import db, { schema } from "../database";
import { assertCallerHasCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import type {
  NativeAuthorizationInvalidation,
  NativeBroadcastMessage,
} from "./broadcast-adapter";
import { logRealtimeFailure } from "./log-realtime-failure";

type NativeCredential = {
  userId: string;
  apiKeyId?: string;
  apiKeyPermissions?: Record<string, string[]> | null;
  portal: "agent" | "customer" | null;
};

type NativeConnection = {
  ws: WSContext;
  credential: NativeCredential;
  reauthenticate: () => Promise<NativeCredential | null>;
  topics: Map<
    string,
    { projectId: string; workspaceId: string; customerVisible: boolean }
  >;
  frameTimes: number[];
  reauthTimer: ReturnType<typeof setInterval>;
};

const subscribeSchema = z
  .object({ type: z.literal("subscribe"), topic: z.string().min(1).max(256) })
  .strict();
const unsubscribeSchema = z
  .object({ type: z.literal("unsubscribe"), topic: z.string().min(1).max(256) })
  .strict();
const pingSchema = z.object({ type: z.literal("ping") }).strict();
const clientFrameSchema = z.discriminatedUnion("type", [
  subscribeSchema,
  unsubscribeSchema,
  pingSchema,
]);
const authorizationInvalidationSchema = z
  .object({
    type: z.literal("identity.invalidate"),
    userId: z.string().min(1).max(256).optional(),
    workspaceId: z.string().min(1).max(256).optional(),
    projectId: z.string().min(1).max(256).optional(),
  })
  .strict()
  .refine(
    (message) =>
      message.userId !== undefined ||
      message.workspaceId !== undefined ||
      message.projectId !== undefined,
  );
const nativeConnections = new Set<NativeConnection>();
const MAX_FRAME_BYTES = 8 * 1024;
const MAX_TOPICS = 50;
const MAX_CONNECTIONS_PER_PERSON = 5;
const FRAME_WINDOW_MS = 1_000;
const MAX_FRAMES_PER_WINDOW = 20;
const REAUTH_INTERVAL_MS = 60_000;

function send(connection: NativeConnection, message: Record<string, unknown>) {
  try {
    const bufferedAmount =
      (connection.ws.raw as { bufferedAmount?: number } | undefined)
        ?.bufferedAmount ?? 0;
    if (bufferedAmount > 64 * 1024) {
      connection.ws.close(1013, "realtime backpressure");
      removeNativeConnection(connection);
      return;
    }
    connection.ws.send(JSON.stringify(message));
  } catch {
    logRealtimeFailure();
    connection.ws.close(1011, "realtime delivery failed");
  }
}

export async function authorizeNativeTopic(
  credential: NativeCredential,
  topic: string,
): Promise<{
  projectId: string;
  workspaceId: string;
  customerVisible: boolean;
} | null> {
  if (!credential.userId) return null;
  if (topic.startsWith("project:")) {
    const projectId = topic.slice("project:".length);
    if (!projectId || projectId.includes("\u0000")) return null;
    const [project] = await db
      .select({
        id: schema.projectTable.id,
        workspaceId: schema.projectTable.workspaceId,
      })
      .from(schema.projectTable)
      .where(
        and(
          eq(schema.projectTable.id, projectId),
          isNull(schema.projectTable.deletedAt),
          isNull(schema.projectTable.archivedAt),
        ),
      )
      .limit(1);
    if (!project) return null;
    try {
      await validateWorkspaceAccess(
        credential.userId,
        project.workspaceId,
        credential.apiKeyId,
      );
      await assertCallerHasCapability(
        project.workspaceId,
        credential.userId,
        "work_item:read",
      );
    } catch {
      return null;
    }
    if (
      credential.apiKeyPermissions &&
      !credential.apiKeyPermissions.work_item?.includes("read")
    )
      return null;
    return {
      projectId,
      workspaceId: project.workspaceId,
      customerVisible: true,
    };
  }

  if (topic.startsWith("work_item:")) {
    const key = topic.slice("work_item:".length);
    if (!key || key.includes("\u0000")) return null;
    const [item] = await db
      .select({
        projectId: schema.workItemTable.projectId,
        workspaceId: schema.workItemTable.workspaceId,
      })
      .from(schema.workItemTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.workItemTable.projectId, schema.projectTable.id),
      )
      .where(
        and(
          eq(schema.workItemTable.key, key),
          isNull(schema.workItemTable.archivedAt),
          isNull(schema.workItemTable.deletedAt),
          isNull(schema.projectTable.deletedAt),
          isNull(schema.projectTable.archivedAt),
        ),
      )
      .limit(1);
    if (!item) return null;
    try {
      await validateWorkspaceAccess(
        credential.userId,
        item.workspaceId,
        credential.apiKeyId,
      );
      await assertCallerHasCapability(
        item.workspaceId,
        credential.userId,
        "work_item:read",
      );
    } catch {
      return null;
    }
    if (
      credential.apiKeyPermissions &&
      !credential.apiKeyPermissions.work_item?.includes("read")
    )
      return null;
    return {
      projectId: item.projectId,
      workspaceId: item.workspaceId,
      customerVisible: true,
    };
  }
  return null;
}

export function addNativeConnection(
  ws: WSContext,
  credential: NativeCredential,
  reauthenticate: () => Promise<NativeCredential | null>,
) {
  const samePersonConnections = [...nativeConnections].filter(
    (connection) => connection.credential.userId === credential.userId,
  );
  if (samePersonConnections.length >= MAX_CONNECTIONS_PER_PERSON) {
    ws.close(1008, "connection limit");
    return null;
  }
  const connection: NativeConnection = {
    ws,
    credential,
    reauthenticate,
    topics: new Map(),
    frameTimes: [],
    reauthTimer: setInterval(() => {
      void reauthorizeNativeConnection(connection);
    }, REAUTH_INTERVAL_MS),
  };
  nativeConnections.add(connection);
  return connection;
}

export async function handleNativeFrame(
  connection: NativeConnection,
  raw: string,
) {
  if (Buffer.byteLength(raw, "utf8") > MAX_FRAME_BYTES) {
    connection.ws.close(1009, "frame too large");
    return;
  }
  const now = Date.now();
  connection.frameTimes = connection.frameTimes.filter(
    (at) => now - at < FRAME_WINDOW_MS,
  );
  connection.frameTimes.push(now);
  if (connection.frameTimes.length > MAX_FRAMES_PER_WINDOW) {
    connection.ws.close(1008, "frame rate exceeded");
    return;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    connection.ws.close(1007, "invalid frame");
    return;
  }
  const parsed = clientFrameSchema.safeParse(decoded);
  if (!parsed.success) {
    connection.ws.close(1007, "invalid frame");
    return;
  }
  if (parsed.data.type === "ping") {
    send(connection, { type: "pong" });
    return;
  }
  if (parsed.data.type === "unsubscribe") {
    connection.topics.delete(parsed.data.topic);
    send(connection, { type: "unsubscribed", topic: parsed.data.topic });
    return;
  }
  if (connection.topics.has(parsed.data.topic)) {
    send(connection, { type: "subscribed", topic: parsed.data.topic });
    return;
  }
  if (connection.topics.size >= MAX_TOPICS) {
    connection.ws.close(1008, "subscription limit");
    return;
  }
  const authorization = await authorizeNativeTopic(
    connection.credential,
    parsed.data.topic,
  );
  if (!authorization) {
    send(connection, { type: "subscription_denied" });
    return;
  }
  connection.topics.set(parsed.data.topic, authorization);
  send(connection, { type: "subscribed", topic: parsed.data.topic });
}

export async function reauthorizeNativeConnection(
  connection: NativeConnection,
) {
  try {
    const credential = await connection.reauthenticate();
    if (
      !credential ||
      credential.userId !== connection.credential.userId ||
      credential.portal !== connection.credential.portal
    ) {
      connection.ws.close(1008, "session expired");
      removeNativeConnection(connection);
      return;
    }
    connection.credential = credential;
    for (const topic of connection.topics.keys()) {
      const authorized = await authorizeNativeTopic(credential, topic);
      if (!authorized) {
        connection.topics.delete(topic);
        send(connection, { type: "subscription_denied" });
      } else {
        connection.topics.set(topic, authorized);
      }
    }
  } catch {
    logRealtimeFailure();
    connection.ws.close(1008, "session expired");
    removeNativeConnection(connection);
  }
}

export async function handleNativeAuthorizationInvalidation(
  input: unknown,
): Promise<void> {
  const parsed = authorizationInvalidationSchema.safeParse(input);
  if (!parsed.success) return;
  const message: NativeAuthorizationInvalidation = parsed.data;
  for (const connection of nativeConnections) {
    if (message.userId && connection.credential.userId !== message.userId) {
      continue;
    }
    if (message.workspaceId || message.projectId) {
      const matches = [...connection.topics.values()].some(
        (topic) =>
          (!message.workspaceId || topic.workspaceId === message.workspaceId) &&
          (!message.projectId || topic.projectId === message.projectId),
      );
      if (!matches) continue;
    }
    await reauthorizeNativeConnection(connection);
  }
}

export function removeNativeConnection(connection: NativeConnection | null) {
  if (!connection) return;
  clearInterval(connection.reauthTimer);
  connection.topics.clear();
  nativeConnections.delete(connection);
}

export function deliverNativeBroadcast(message: NativeBroadcastMessage) {
  const topics = new Set(message.topics);
  for (const connection of nativeConnections) {
    for (const topic of topics) {
      const subscription = connection.topics.get(topic);
      if (!subscription || subscription.projectId !== message.projectId)
        continue;
      if (
        connection.credential.portal === "customer" &&
        !message.customerVisible
      )
        continue;
      send(connection, {
        type: message.eventType,
        topic,
        eventId: message.eventId,
        at: message.at,
        payload: { key: message.key },
      });
      break;
    }
  }
}
