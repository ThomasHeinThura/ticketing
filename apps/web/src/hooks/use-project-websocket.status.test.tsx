import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userId: "user-1" as string | undefined }));

vi.mock("@taskdesk/libs", () => ({ windowId: "test-window-id" }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: mocks.userId ? { user: { id: mocks.userId } } : null,
    }),
  },
}));

import { useProjectWebSocket } from "./use-project-websocket";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closedByClient = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send() {}
  close() {
    this.closedByClient = true;
    // A real socket reports its own close asynchronously.
    queueMicrotask(() => this.onclose?.({ code: 1005, reason: "" }));
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  serverClose(code: number, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function render(projectId: string) {
  const client = new QueryClient();
  return renderHook(({ id }: { id: string }) => useProjectWebSocket(id), {
    initialProps: { id: projectId },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_API_URL", "http://localhost:1337");
  vi.stubGlobal("WebSocket", FakeSocket);
  FakeSocket.instances = [];
  mocks.userId = "user-1";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useProjectWebSocket status (realtime.md, Fallback)", () => {
  it("a pending connection is not an outage, an open one is live", () => {
    const { result } = render("p1");
    expect(result.current.status).toBe("connecting");
    act(() => FakeSocket.instances[0]?.open());
    expect(result.current.status).toBe("live");
  });

  it("a connection-limit close is terminal and leaves the indicator showing, with no reconnect", () => {
    const { result } = render("p1");
    act(() => {
      FakeSocket.instances[0]?.open();
      FakeSocket.instances[0]?.serverClose(1008, "connection limit");
    });
    expect(result.current.status).toBe("unavailable");
    act(() => vi.advanceTimersByTime(120_000));
    expect(FakeSocket.instances).toHaveLength(1);
    expect(result.current.status).toBe("unavailable");
  });

  it("any other close shows the indicator while it backs off, and an open clears it", () => {
    const { result } = render("p1");
    act(() => {
      FakeSocket.instances[0]?.open();
      FakeSocket.instances[0]?.serverClose(1006);
    });
    expect(result.current.status).toBe("unavailable");
    act(() => vi.advanceTimersByTime(1_000));
    expect(FakeSocket.instances).toHaveLength(2);
    expect(result.current.status).toBe("unavailable");
    act(() => FakeSocket.instances[1]?.open());
    expect(result.current.status).toBe("live");
  });

  it("running out of retries is a terminal stop and keeps the indicator", () => {
    const { result } = render("p1");
    for (let attempt = 0; attempt < 6; attempt++) {
      act(() => FakeSocket.instances.at(-1)?.serverClose(1006));
      act(() => vi.advanceTimersByTime(60_000));
    }
    expect(FakeSocket.instances).toHaveLength(6);
    expect(result.current.status).toBe("unavailable");
  });

  it("starting over for another project clears a stopped socket's indicator and connects again", () => {
    const { result, rerender } = render("p1");
    act(() => FakeSocket.instances[0]?.serverClose(1008, "connection limit"));
    expect(result.current.status).toBe("unavailable");
    rerender({ id: "p2" });
    expect(result.current.status).toBe("connecting");
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1]?.url).toContain("/p2?");
    act(() => FakeSocket.instances[1]?.open());
    expect(result.current.status).toBe("live");
  });

  it("a remount retries once and clears the indicator", () => {
    const first = render("p1");
    act(() => FakeSocket.instances[0]?.serverClose(1008, "connection limit"));
    expect(first.result.current.status).toBe("unavailable");
    first.unmount();
    const second = render("p1");
    expect(second.result.current.status).toBe("connecting");
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("a session change starts over too", () => {
    const { result, rerender } = render("p1");
    act(() => FakeSocket.instances[0]?.serverClose(1008, "connection limit"));
    mocks.userId = "user-2";
    rerender({ id: "p1" });
    expect(result.current.status).toBe("connecting");
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("closing the socket ourselves (unmount or switch) is never reported as an outage", async () => {
    const { result, rerender } = render("p1");
    act(() => FakeSocket.instances[0]?.open());
    rerender({ id: "p2" });
    await act(async () => {
      await Promise.resolve();
    });
    // The old socket's own close event must not flip the new connection to unavailable.
    expect(result.current.status).toBe("connecting");
  });

  it("without a signed-in session it opens nothing", () => {
    mocks.userId = undefined;
    const { result } = render("p1");
    expect(FakeSocket.instances).toHaveLength(0);
    expect(result.current.status).toBe("connecting");
  });
});
