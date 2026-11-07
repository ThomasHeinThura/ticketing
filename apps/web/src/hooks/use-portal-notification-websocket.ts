import { type Query, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getApiUrl, toWebSocketBase } from "@/fetchers/get-api-url";
import { portalNotificationQueryKey } from "@/lib/portal-notification-query-keys";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const PING_INTERVAL_MS = 30_000;

export function getPortalNotificationWsUrl() {
  return `${toWebSocketBase(getApiUrl("ws"))}/portal/notification`;
}

function isNotificationInvalidation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === "NOTIFICATION_CREATED" && Object.keys(message).length === 1
  );
}

/**
 * The first connection follows the page's own inbox reads (the bell's count and the inbox list),
 * so it does not ask them again: refreshing them on open sent every inbox read twice, and a read
 * still in flight was cancelled and sent again. It refreshes only a read that was marked changed
 * (`isInvalidated`) or one made before this connection started (served from cache, for example
 * after the layout remounts). A read in flight, or one that has not run, is left to its own
 * request. A reconnect refreshes every read, to recover notifications missed while disconnected.
 * Same rule as the agent socket (`use-user-websocket.ts`), kept here so the portal bundle does
 * not pull in the agent's auth client.
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

/** Customer-layout-only socket; the server sends a payload-free inbox invalidation. */
export function usePortalNotificationWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    let terminal = false;
    const connectionStartedAt = Date.now();
    // Set once a socket has closed: a reconnect refreshes notifications missed while
    // disconnected; the first open refreshes only an inbox served from an old cache.
    let hasDisconnected = false;

    const clearPing = () => {
      if (pingRef.current !== null) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
    };

    const connect = () => {
      if (!active || terminal) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(getPortalNotificationWsUrl());
      } catch {
        scheduleRetry();
        return;
      }
      wsRef.current = socket;

      socket.onopen = () => {
        retriesRef.current = 0;
        // Recover persisted notifications missed while this socket was disconnected.
        void queryClient.invalidateQueries({
          queryKey: portalNotificationQueryKey,
          ...(hasDisconnected
            ? {}
            : {
                predicate: (query: Query) =>
                  refreshOnFirstConnect(query, connectionStartedAt),
              }),
        });
        clearPing();
        pingRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        try {
          const value: unknown = JSON.parse(String(event.data));
          if (isNotificationInvalidation(value)) {
            void queryClient.invalidateQueries({
              queryKey: portalNotificationQueryKey,
            });
          }
        } catch {
          // Ignore malformed frames; the API never sends customer data on this channel.
        }
      };

      socket.onclose = (event) => {
        clearPing();
        if (wsRef.current === socket) wsRef.current = null;
        hasDisconnected = true;
        // Authentication/reach rejection and normal closure are terminal. Transient
        // network failures use bounded backoff and stop once the authenticated layout
        // unmounts on sign-out or route protection.
        if (event.code === 1000 || event.code === 1008 || event.code === 1003) {
          terminal = true;
          return;
        }
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (!active || terminal || retriesRef.current >= MAX_RETRIES) return;
      const delay = BASE_DELAY_MS * 2 ** retriesRef.current;
      retriesRef.current += 1;
      timeoutRef.current = setTimeout(connect, delay);
    };

    connect();
    return () => {
      active = false;
      terminal = true;
      clearPing();
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      const socket = wsRef.current;
      wsRef.current = null;
      socket?.close(1000, "portal layout closed");
    };
  }, [queryClient]);
}
