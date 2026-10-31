import { type Query, useQueryClient } from "@tanstack/react-query";
import { windowId } from "@taskdesk/libs";
import { useEffect, useRef } from "react";
import { getApiUrl, toWebSocketBase } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";

export function getUserWsUrl() {
  const wsBase = toWebSocketBase(getApiUrl("ws"));
  return `${wsBase}/user?windowId=${encodeURIComponent(windowId)}`;
}

const MAX_RETRIES = 5;
const BASE_DELAY = 1000;
const WS_PING_INTERVAL_MS = 30_000;
/**
 * The first connection follows the page's own inbox read, so it does not ask it again. It
 * refreshes once a read that realtime marked as changed (`isInvalidated`) or one made before this
 * connection started (served from cache, for example after the shell remounts). A read in flight,
 * or one that has not run, is left to its own request.
 */
function refreshOnFirstConnect(query: Query, connectionStartedAt: number) {
  const { dataUpdatedAt, errorUpdatedAt, fetchStatus, isInvalidated, status } =
    query.state;
  if (fetchStatus === "fetching") return false;
  // A failed read is always flagged invalidated by TanStack Query, so for it only its age counts.
  if (isInvalidated && status !== "error") return true;
  const lastRead = Math.max(dataUpdatedAt, errorUpdatedAt);
  return lastRead > 0 && lastRead < connectionStartedAt;
}

/**
 * Maintains a user-scoped WebSocket connection for receiving user-targeted
 * real-time events (e.g. NOTIFICATION_CREATED). Invalidates TanStack Query
 * caches as needed, so no polling is required.
 */
export function useUserWebSocket() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;

    retriesRef.current = 0;
    const connectionStartedAt = Date.now();
    // Set once a socket has closed: a reconnect refreshes notifications missed while
    // disconnected; the first open refreshes only an inbox served from an old cache.
    let hasDisconnected = false;

    function clearPing() {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    }

    function connect() {
      const url = getUserWsUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retriesRef.current = 0;
        // Recover persisted notifications missed while this socket was disconnected.
        void queryClient.invalidateQueries({
          queryKey: ["notifications"],
          ...(hasDisconnected
            ? {}
            : {
                predicate: (query: Query) =>
                  refreshOnFirstConnect(query, connectionStartedAt),
              }),
        });
        clearPing();
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, WS_PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as {
            type?: string;
          };
          if (message.type === "NOTIFICATION_CREATED") {
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        clearPing();
        wsRef.current = null;
        hasDisconnected = true;

        if (retriesRef.current < MAX_RETRIES) {
          const delay = BASE_DELAY * 2 ** retriesRef.current;
          retriesRef.current += 1;
          timeoutRef.current = setTimeout(connect, delay);
        }
      };
    }

    connect();

    return () => {
      retriesRef.current = MAX_RETRIES; // prevent reconnect after unmount
      clearPing();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [session?.user?.id, queryClient]);
}
