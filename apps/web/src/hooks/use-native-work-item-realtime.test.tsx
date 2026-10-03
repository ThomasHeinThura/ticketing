import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  useSession: vi.fn(() => ({ data: { user: { id: "person-1" } } })),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: authMocks.useSession },
}));
vi.mock("@/fetchers/work-item/get-work-items", () => ({
  default: vi.fn().mockResolvedValue({ items: [] }),
}));

import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

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

function intervalFor(client: QueryClient) {
  const options = client.getQueryCache().getAll()[0]?.options as
    | { refetchInterval?: number | false }
    | undefined;
  return options?.refetchInterval;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", MockWebSocket);
  MockWebSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("native work-item realtime recovery", () => {
  it("polls only during an outage and resumes socket invalidation after reconnect", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () =>
        useGetWorkItems({
          projectId: "project-1",
          sort: "key",
          dir: "desc",
        }),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(intervalFor(client)).toBe(30_000);
    const first = MockWebSocket.instances[0];
    expect(first).toBeDefined();
    act(() => {
      first.open();
      first.frame({ type: "subscribed", topic: "project:project-1" });
    });
    expect(result.current.isRealtimeUnavailable).toBe(false);
    expect(intervalFor(client)).toBe(false);

    vi.spyOn(Math, "random").mockReturnValue(0);
    act(() => first.close());
    expect(result.current.isRealtimeUnavailable).toBe(true);
    expect(intervalFor(client)).toBe(30_000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const second = MockWebSocket.instances[1];
    expect(second).toBeDefined();
    act(() => {
      second.open();
      second.frame({ type: "subscribed", topic: "project:project-1" });
    });
    expect(result.current.isRealtimeUnavailable).toBe(false);
    expect(intervalFor(client)).toBe(false);
  });
});
