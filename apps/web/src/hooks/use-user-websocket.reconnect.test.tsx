import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@taskdesk/libs", () => ({ windowId: "test-window-id" }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "person-1" } } }),
  },
}));

import { useUserWebSocket } from "./use-user-websocket";

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }

  send() {}

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  frame(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockWebSocket);
  MockWebSocket.instances = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useUserWebSocket inbox refresh", () => {
  it("reads the inbox once per load, refreshing it only on a reconnect or a new notification", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const inbox = vi.fn(async () => ({ items: [] }));
    function Inbox() {
      useQuery({
        queryKey: ["notifications", "inbox", "all"],
        queryFn: inbox,
      });
      useUserWebSocket();
      return null;
    }
    render(<Inbox />, { wrapper: wrapperFor(client) });
    await waitFor(() => expect(inbox).toHaveBeenCalledTimes(1));
    const first = MockWebSocket.instances[0];
    if (!first) throw new Error("Expected the user socket");

    act(() => first.open());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(inbox).toHaveBeenCalledTimes(1);

    act(() => first.frame({ type: "NOTIFICATION_CREATED" }));
    await waitFor(() => expect(inbox).toHaveBeenCalledTimes(2));

    vi.useFakeTimers();
    act(() => first.close());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    vi.useRealTimers();
    const second = MockWebSocket.instances[1];
    if (!second) throw new Error("Expected the reconnected user socket");
    act(() => second.open());
    // Notifications missed while disconnected are recovered once.
    await waitFor(() => expect(inbox).toHaveBeenCalledTimes(3));
  });

  it("refreshes an inbox served from an old cache once on first connect", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnMount: false } },
    });
    client.setQueryData(
      ["notifications", "inbox"],
      { items: [] },
      {
        updatedAt: Date.now() - 60_000,
      },
    );
    const inbox = vi.fn(async () => ({ items: [] }));
    function Inbox() {
      useQuery({ queryKey: ["notifications", "inbox"], queryFn: inbox });
      useUserWebSocket();
      return null;
    }
    render(<Inbox />, { wrapper: wrapperFor(client) });
    const socket = MockWebSocket.instances[0];
    if (!socket) throw new Error("Expected the user socket");
    expect(inbox).not.toHaveBeenCalled();
    act(() => socket.open());
    await waitFor(() => expect(inbox).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("refreshes the inbox when a socket that never opened is replaced", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const inbox = vi.fn(async () => ({ items: [] }));
    function Inbox() {
      useQuery({ queryKey: ["notifications", "inbox"], queryFn: inbox });
      useUserWebSocket();
      return null;
    }
    render(<Inbox />, { wrapper: wrapperFor(client) });
    await waitFor(() => expect(inbox).toHaveBeenCalledTimes(1));
    const first = MockWebSocket.instances[0];
    if (!first) throw new Error("Expected the user socket");

    vi.useFakeTimers();
    act(() => first.close());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    vi.useRealTimers();
    const second = MockWebSocket.instances[1];
    if (!second) throw new Error("Expected the replacement user socket");
    act(() => second.open());
    await waitFor(() => expect(inbox).toHaveBeenCalledTimes(2));
  });
});
