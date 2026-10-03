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
const seenEventIds = new Set<string>();

function hasSeenEvent(eventId: string) {
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
  const [isUnavailable, setIsUnavailable] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retriesRef = useRef(0);
  const topicKey = topics.join("\u0000");

  useEffect(() => {
    if (!session?.user?.id || topics.length === 0) {
      setIsUnavailable(false);
      return;
    }
    const selectedTopics = topicKey.split("\u0000");
    const unacknowledgedTopics = new Set(selectedTopics);
    let isDisposed = false;
    let socket: WebSocket | null = null;

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
      if (projectId) {
        void queryClient.invalidateQueries({
          queryKey: ["work-items", projectId],
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["work-items"] });
      }
      if (frame.payload?.key) {
        void queryClient.invalidateQueries({
          queryKey: ["work-items", "detail", frame.payload.key],
        });
        void queryClient.invalidateQueries({
          queryKey: ["work-items", "activity", frame.payload.key],
        });
      }
    }

    function connect() {
      if (isDisposed) return;
      const nextSocket = new WebSocket(realtimeUrl());
      socket = nextSocket;
      socketRef.current = nextSocket;
      setIsUnavailable(true);

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
          setIsUnavailable(unacknowledgedTopics.size > 0);
          return;
        }
        if (frame.type === "subscription_denied") {
          setIsUnavailable(true);
          void queryClient.invalidateQueries({ queryKey: ["work-items"] });
          return;
        }
        if (!frame.eventId || hasSeenEvent(frame.eventId)) return;
        invalidateAffected(frame);
      };

      nextSocket.onerror = () => setIsUnavailable(true);
      nextSocket.onclose = () => {
        stopPing();
        if (socketRef.current === nextSocket) socketRef.current = null;
        setIsUnavailable(true);
        if (isDisposed) return;
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
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      if (socketRef.current === socket) socketRef.current = null;
      socket?.close();
    };
  }, [session?.user?.id, topicKey, queryClient, topics.length]);

  return { isUnavailable };
}
