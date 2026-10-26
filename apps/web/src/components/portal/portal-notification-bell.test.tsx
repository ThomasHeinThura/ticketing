import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalNotificationBell from "./portal-notification-bell";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/fetchers/portal-notifications", () => ({
  getPortalNotifications: vi.fn().mockResolvedValue({
    data: [],
    unreadCount: 0,
    hasMore: false,
    nextCursor: null,
  }),
}));

vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({ t: (key: string) => key }),
}));

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
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PortalNotificationBell realtime lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubEnv("VITE_API_URL", "");
    vi.useFakeTimers();
    MockWebSocket.instances = [];
  });

  it("owns one socket per mounted bell and closes it when the authenticated shell unmounts", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { unmount } = render(<PortalNotificationBell />, { wrapper });

    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = MockWebSocket.instances[0];
    expect(socket?.url).toContain("/api/ws/portal/notification");

    unmount();
    expect(socket?.closeArgs[0]?.[0]).toBe(1000);
    vi.advanceTimersByTime(20_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
