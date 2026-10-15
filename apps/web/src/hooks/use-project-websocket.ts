import { useQueryClient } from "@tanstack/react-query";
import { windowId } from "@taskdesk/libs";
import { useEffect, useRef } from "react";
import { getApiUrl, toWebSocketBase } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";

export function getWsUrl(projectId: string) {
  const wsBase = toWebSocketBase(getApiUrl("ws"));
  return `${wsBase}/${encodeURIComponent(projectId)}?windowId=${encodeURIComponent(windowId)}`;
}

const MAX_RETRIES = 5;
const BASE_DELAY = 1000; // 1 second

/** The server closes a person's sixth project socket with exactly this code and reason (#748). */
export const CONNECTION_LIMIT_CLOSE_CODE = 1008;
export const CONNECTION_LIMIT_CLOSE_REASON = "connection limit";

/**
 * How long to wait before reconnecting after a close, or `null` to stop. A close for the
 * per-person connection limit is terminal for that tab: the server accepts the upgrade and then
 * closes, so retrying (and resetting the count on open) would reconnect about once a second for
 * as long as the other tabs stay open. Any other close keeps the exponential backoff.
 */
export function reconnectDelay(
  close: { code: number; reason: string },
  retries: number,
): number | null {
  if (
    close.code === CONNECTION_LIMIT_CLOSE_CODE &&
    close.reason === CONNECTION_LIMIT_CLOSE_REASON
  ) {
    return null;
  }
  if (retries >= MAX_RETRIES) return null;
  return BASE_DELAY * 2 ** retries; // 1s, 2s, 4s, 8s, 16s
}

// Cloudflare closes idle WebSocket connections after 100 seconds of no traffic.
// We send a lightweight ping every 30 seconds to keep the connection alive.
const WS_PING_INTERVAL_MS = 30_000;

export function useProjectWebSocket(projectId: string) {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!projectId || !session?.user?.id) return;

    retriesRef.current = 0;

    function clearPing() {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    }

    function connect() {
      const url = getWsUrl(projectId);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retriesRef.current = 0; // Reset retries on successful connection
        // Start keepalive pings to prevent Cloudflare idle timeout (100s)
        clearPing();
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, WS_PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (
            message.type === "TASK_UPDATED" ||
            message.type === "TASK_CREATED" ||
            message.type === "TASK_DELETED" ||
            message.type === "TASK_LABEL_UPDATED" ||
            message.type === "TASK_MOVED" ||
            message.type === "TASK_RELATION_UPDATED" ||
            message.type === "COMMENT_UPDATED"
          ) {
            queryClient.invalidateQueries({
              queryKey: ["tasks", message.projectId],
            });

            if (message.type === "TASK_RELATION_UPDATED") {
              if (message.sourceTaskId) {
                queryClient.invalidateQueries({
                  queryKey: ["task", message.sourceTaskId],
                });
                queryClient.invalidateQueries({
                  queryKey: ["task-relations", message.sourceTaskId],
                });
              }
              if (message.targetTaskId) {
                queryClient.invalidateQueries({
                  queryKey: ["task", message.targetTaskId],
                });
                queryClient.invalidateQueries({
                  queryKey: ["task-relations", message.targetTaskId],
                });
              }
              if (!message.sourceTaskId && !message.targetTaskId) {
                queryClient.invalidateQueries({
                  queryKey: ["task-relations"],
                });
              }
            } else {
              queryClient.invalidateQueries({
                queryKey: ["task", message.taskId],
              });
            }

            if (message.type === "TASK_LABEL_UPDATED") {
              queryClient.invalidateQueries({
                queryKey: ["labels", message.taskId],
              });
            }

            if (message.type === "COMMENT_UPDATED") {
              queryClient.invalidateQueries({
                queryKey: ["activities", message.taskId],
              });
              queryClient.invalidateQueries({
                queryKey: ["comments", message.taskId],
              });
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        clearPing();
        wsRef.current = null;

        const delay = reconnectDelay(event, retriesRef.current);
        if (delay === null) {
          // Stop for good for this tab; the page keeps working without live updates.
          retriesRef.current = MAX_RETRIES;
          return;
        }
        retriesRef.current += 1;
        timeoutRef.current = setTimeout(connect, delay);
      };
    }
    connect();

    return () => {
      retriesRef.current = MAX_RETRIES; // Prevent reconnect after unmount
      clearPing();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [projectId, session?.user?.id, queryClient]);
}
