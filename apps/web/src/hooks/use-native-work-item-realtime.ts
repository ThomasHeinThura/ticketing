import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getApiUrl, toWebSocketBase } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";

type NativeFrame = {
  type?: string;
  topic?: string;
  eventId?: string;
  payload?: { key?: string };
};

const MAX_SEEN_EVENTS = 512;
const INVALIDATION_DEBOUNCE_MS = 150;

export type WorkItemRealtimeStatus =
  | "connecting"
  | "available"
  | "unavailable"
  | "idle";

function hasSeenEvent(seenEventIds: Set<string>, eventId: string) {
  if (seenEventIds.has(eventId)) return true;
  seenEventIds.add(eventId);
  if (seenEventIds.size > MAX_SEEN_EVENTS) {
    const oldest = seenEventIds.values().next().value;
    if (oldest) seenEventIds.delete(oldest);
  }
  return false;
}

function realtimeUrl() {
  return toWebSocketBase(getApiUrl("ws"));
}

export function useNativeWorkItemRealtime(topics: readonly string[]) {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [connection, setConnection] = useState<{
    connectionKey: string;
    status: WorkItemRealtimeStatus;
  }>({ connectionKey: "", status: "connecting" });
  const socketRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retriesRef = useRef(0);
  const topicKey = topics.join("\u0000");
  const connectionKey = `${session?.user?.id ?? ""}\u0001${topicKey}`;
  const status =
    connection.connectionKey === connectionKey
      ? connection.status
      : "connecting";

  useEffect(() => {
    if (!session?.user?.id || topics.length === 0) {
      setConnection({ connectionKey, status: "idle" });
      return;
    }
    const selectedTopics = topicKey.split("\u0000");
    let hasOutage = false;
    let isDisposed = false;
    let socket: WebSocket | null = null;
    let invalidationTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingInvalidations = new Map<string, readonly unknown[]>();

    function flushInvalidations() {
      invalidationTimer = null;
      const queryKeys = [...pendingInvalidations.values()];
      pendingInvalidations.clear();
      for (const queryKey of queryKeys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }

    function queueInvalidation(queryKey: readonly unknown[]) {
      pendingInvalidations.set(JSON.stringify(queryKey), queryKey);
      if (invalidationTimer) clearTimeout(invalidationTimer);
      invalidationTimer = setTimeout(
        flushInvalidations,
        INVALIDATION_DEBOUNCE_MS,
      );
    }

    function setStatus(nextStatus: WorkItemRealtimeStatus) {
      setConnection({ connectionKey, status: nextStatus });
    }

    function stopPing() {
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    }

    function invalidateAffected(frame: NativeFrame) {
      const projectId = frame.topic?.startsWith("project:")
        ? frame.topic.slice("project:".length)
        : undefined;
      const type = frame.type;
      const listProjectionMayChange =
        type === "work_item.created" ||
        type === "work_item.updated" ||
        type === "work_item.transitioned" ||
        type === "work_item.assigned" ||
        type === "work_item.unassigned" ||
        type === "work_item.escalated" ||
        type === "work_item.unblocked" ||
        type === "work_item.mentioned" ||
        type === "work_item.deleted";
      if (projectId && listProjectionMayChange) {
        queueInvalidation(["work-items", projectId]);
      }

      const key = frame.topic?.startsWith("work_item:")
        ? frame.payload?.key
        : undefined;
      if (!key) return;
      if (
        type === "work_item.updated" ||
        type === "work_item.transitioned" ||
        type === "work_item.assigned" ||
        type === "work_item.unassigned" ||
        type === "work_item.escalated" ||
        type === "work_item.unblocked" ||
        type === "work_item.mentioned" ||
        type === "work_item.deleted"
      ) {
        queueInvalidation(["work-items", "detail", key]);
      }
      if (
        type === "work_item.escalated" ||
        type === "work_item.unblocked" ||
        type === "work_item.mentioned" ||
        type === "work_item.commented" ||
        type === "work_item.deleted"
      ) {
        queueInvalidation(["work-items", "activity", key]);
      }
    }

    function connect() {
      if (isDisposed) return;
      const seenEventIds = new Set<string>();
      const unacknowledgedTopics = new Set(selectedTopics);
      const nextSocket = new WebSocket(realtimeUrl());
      socket = nextSocket;
      socketRef.current = nextSocket;
      if (!hasOutage) setStatus("connecting");

      nextSocket.onopen = () => {
        if (isDisposed) return;
        retriesRef.current = 0;
        for (const topic of selectedTopics) {
          nextSocket.send(JSON.stringify({ type: "subscribe", topic }));
        }
        stopPing();
        pingTimerRef.current = setInterval(() => {
          if (nextSocket.readyState === WebSocket.OPEN) {
            nextSocket.send(JSON.stringify({ type: "ping" }));
          }
        }, 30_000);
        void queryClient.invalidateQueries({ queryKey: ["work-items"] });
      };

      nextSocket.onmessage = (event) => {
        let frame: NativeFrame;
        try {
          frame = JSON.parse(String(event.data)) as NativeFrame;
        } catch {
          return;
        }
        if (frame.type === "subscribed") {
          if (frame.topic) unacknowledgedTopics.delete(frame.topic);
          if (unacknowledgedTopics.size === 0) {
            hasOutage = false;
            setStatus("available");
          }
          return;
        }
        if (frame.type === "subscription_denied") {
          hasOutage = true;
          setStatus("unavailable");
          void queryClient.invalidateQueries({ queryKey: ["work-items"] });
          return;
        }
        if (!frame.eventId || hasSeenEvent(seenEventIds, frame.eventId)) return;
        invalidateAffected(frame);
      };

      nextSocket.onerror = () => {
        hasOutage = true;
        setStatus("unavailable");
      };
      nextSocket.onclose = () => {
        stopPing();
        if (socketRef.current === nextSocket) socketRef.current = null;
        if (isDisposed) return;
        hasOutage = true;
        setStatus("unavailable");
        const ceiling = Math.min(30_000, 1_000 * 2 ** retriesRef.current);
        retriesRef.current += 1;
        const delay = Math.floor(ceiling * (0.5 + Math.random() * 0.5));
        retryTimerRef.current = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      isDisposed = true;
      stopPing();
      if (invalidationTimer) clearTimeout(invalidationTimer);
      invalidationTimer = null;
      pendingInvalidations.clear();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      if (socketRef.current === socket) socketRef.current = null;
      socket?.close();
    };
  }, [connectionKey, session?.user?.id, topicKey, queryClient, topics.length]);

  return {
    status,
    isUnavailable: status === "unavailable",
  };
}
