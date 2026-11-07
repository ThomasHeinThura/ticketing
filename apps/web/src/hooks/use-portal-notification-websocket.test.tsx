import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPortalNotificationWsUrl,
  usePortalNotificationWebSocket,
} from "./use-portal-notification-websocket";

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closeArgs: unknown[][] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send() {}

  close(...args: unknown[]) {
    this.closeArgs.push(args);
    this.readyState = 3;
    this.onclose?.({
      code: typeof args[0] === "number" ? args[0] : 1000,
    } as CloseEvent);
  }

  frame(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function firstSocket() {
  const socket = MockWebSocket.instances[0];
  if (!socket) throw new Error("Expected the portal websocket to connect");
  return socket;
}

describe("portal notification WebSocket", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubEnv("VITE_API_URL", "");
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the portal-only same-origin endpoint", () => {
    const expectedScheme =
      window.location.protocol === "https:" ? "wss:" : "ws:";
    expect(getPortalNotificationWsUrl()).toBe(
      `${expectedScheme}//${window.location.host}/api/ws/portal/notification`,
    );
  });

  it("invalidates only the portal notification cache for the exact payload-free event", () => {
    const { queryClient, wrapper } = setup();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue();
    const { unmount } = renderHook(() => usePortalNotificationWebSocket(), {
      wrapper,
    });
    const socket = firstSocket();

    act(() => {
      socket.frame({
        type: "NOTIFICATION_CREATED",
        userId: "must-not-be-forwarded",
      });
      socket.frame({ type: "WORK_ITEM_UPDATED" });
      socket.frame({ type: "NOTIFICATION_CREATED" });
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["portal", "notifications"],
    });
    unmount();
    expect(socket.closeArgs[0]?.[0]).toBe(1000);
  });

  it("refreshes persisted inbox after connecting and reconnecting without polling", () => {
    const { queryClient, wrapper } = setup();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue();
    const { unmount } = renderHook(() => usePortalNotificationWebSocket(), {
      wrapper,
    });
    const socket = firstSocket();
    act(() => socket.onopen?.());
    expect(invalidate).toHaveBeenCalledTimes(1);
    // The first open refreshes only reads served from an old or invalidated cache.
    expect(invalidate).toHaveBeenLastCalledWith({
      queryKey: ["portal", "notifications"],
      predicate: expect.any(Function),
    });
    act(() => vi.advanceTimersByTime(90_000));
    expect(invalidate).toHaveBeenCalledTimes(1);
    act(() => socket.onclose?.({ code: 1006 } as CloseEvent));
    act(() => vi.advanceTimersByTime(1000));
    act(() => MockWebSocket.instances[1]?.onopen?.());
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith({
      queryKey: ["portal", "notifications"],
    });
    unmount();
  });

  it("does not ask the page's own inbox reads again when the first connection opens", async () => {
    const { queryClient, wrapper } = setup();
    const inboxRead = vi.fn(async () => ({ unreadCount: 0 }));
    // The inbox list was read for this visit, after the socket started connecting.
    vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
    const { unmount } = renderHook(() => usePortalNotificationWebSocket(), {
      wrapper,
    });
    vi.setSystemTime(new Date("2026-11-07T00:00:01Z"));
    await queryClient.fetchQuery({
      queryKey: ["portal", "notifications", "all"],
      queryFn: inboxRead,
    });
    // A read still in flight when the socket opens is not cancelled and sent again.
    let finish!: (value: { unreadCount: number }) => void;
    const bellRead = vi.fn(
      () =>
        new Promise<{ unreadCount: number }>((resolve) => {
          finish = resolve;
        }),
    );
    const bell = queryClient.fetchQuery({
      queryKey: ["portal", "notifications"],
      queryFn: bellRead,
    });
    const socket = firstSocket();
    act(() => socket.onopen?.());
    finish({ unreadCount: 0 });
    await bell;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Before this change the open refreshed both: 2 inbox reads and 2 bell reads.
    expect(inboxRead).toHaveBeenCalledTimes(1);
    expect(bellRead).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("refreshes an inbox read served from a cache older than the connection", async () => {
    const { queryClient, wrapper } = setup();
    vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
    const inboxRead = vi.fn(async () => ({ unreadCount: 0 }));
    const observer = renderHook(
      () => {
        usePortalNotificationWebSocket();
      },
      { wrapper },
    );
    observer.unmount();
    await queryClient.fetchQuery({
      queryKey: ["portal", "notifications", "all"],
      queryFn: inboxRead,
    });
    // The layout mounts again later; its socket opens over the older cached read.
    vi.setSystemTime(new Date("2026-11-07T00:01:00Z"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { unmount } = renderHook(() => usePortalNotificationWebSocket(), {
      wrapper,
    });
    const socket = MockWebSocket.instances.at(-1);
    act(() => socket?.onopen?.());
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryState(["portal", "notifications", "all"])
        ?.isInvalidated,
    ).toBe(true);
    unmount();
  });

  it("stops reconnecting after server authentication rejection", () => {
    const { wrapper } = setup();
    const { unmount } = renderHook(() => usePortalNotificationWebSocket(), {
      wrapper,
    });
    const socket = firstSocket();

    act(() => socket.onclose?.({ code: 1008 } as CloseEvent));
    act(() => vi.advanceTimersByTime(20_000));

    expect(MockWebSocket.instances).toHaveLength(1);
    unmount();
  });

  it("retries transient disconnects with bounded backoff and cancels on unmount", () => {
    const { wrapper } = setup();
    const { unmount } = renderHook(() => usePortalNotificationWebSocket(), {
      wrapper,
    });
    const socket = firstSocket();

    act(() => socket.onclose?.({ code: 1006 } as CloseEvent));
    act(() => vi.advanceTimersByTime(999));
    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(MockWebSocket.instances).toHaveLength(2);
    unmount();
    act(() => vi.advanceTimersByTime(20_000));
    expect(MockWebSocket.instances).toHaveLength(2);
  });
});
