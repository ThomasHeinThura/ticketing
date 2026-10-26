import { useQueryClient } from "@tanstack/react-query";
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
