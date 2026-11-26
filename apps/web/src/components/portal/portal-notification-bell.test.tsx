import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalNotificationBell from "./portal-notification-bell";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/fetchers/portal-notifications", () => ({
  getPortalNotifications: mocks.get,
}));

vi.mock("@/hooks/use-portal-notification-websocket", () => ({
  usePortalNotificationWebSocket: () => undefined,
}));

vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}(${options.count})`,
  }),
}));

function renderBell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PortalNotificationBell />
    </QueryClientProvider>,
  );
}

describe("PortalNotificationBell (C8-3 / W5, DS-09)", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.get.mockReset().mockResolvedValue({
      data: [],
      unreadCount: 3,
      hasMore: false,
      nextCursor: null,
    });
  });

  afterEach(() => cleanup());

  it("names the trigger with the capped badge text above 99 unread", async () => {
    mocks.get.mockResolvedValue({
      data: [],
      unreadCount: 150,
      hasMore: false,
      nextCursor: null,
    });
    renderBell();
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveTextContent("99+"),
    );
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "notifications.inbox: 99+",
    );
  });

  it("renders a readable 11px unread badge and keeps menu unread status screen-reader-only instead of visually duplicating the badge count", async () => {
    renderBell();
    const trigger = await screen.findByRole("button", {
      name: "notifications.inbox",
    });
    await waitFor(() => expect(trigger).toHaveTextContent("3"));
    // WCAG 2.5.3: the visible badge text is part of the accessible name.
    expect(trigger).toHaveAccessibleName("notifications.inbox: 3");
    const badge = trigger.querySelector("span");
    expect(badge).toHaveClass("text-xs");
    expect(badge).not.toHaveClass("text-[9px]");

    fireEvent.click(trigger);
    const openInbox = await screen.findByRole("menuitem", {
      name: "notifications.inbox",
    });
    expect(openInbox).toBeVisible();
    const status = screen.getByRole("status");
    expect(status).toHaveClass("sr-only");
    expect(status).toHaveTextContent("notifications.unreadCount(3)");

    fireEvent.click(openInbox);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/notifications" });
  });

  it("shows a translated error fallback with retry when loading notifications fails", async () => {
    mocks.get
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        data: [],
        unreadCount: 2,
        hasMore: false,
        nextCursor: null,
      });

    renderBell();
    const trigger = screen.getByRole("button", { name: "notifications.inbox" });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));

    fireEvent.click(trigger);
    expect(await screen.findByText("notifications.loadFailed")).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.retry" }),
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(trigger).toHaveTextContent("2"));
  });
});
