import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalNotificationPage } from "@/fetchers/portal-notifications";
import { PortalNotificationInbox } from "./portal-notification-inbox";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  read: vi.fn(),
  unread: vi.fn(),
  readAll: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    hash,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    hash?: string;
    [key: string]: unknown;
  }) => (
    <a
      href={`${to.replace("$ref", params?.ref ?? "")}${hash ? `#${hash}` : ""}`}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/fetchers/portal-notifications", () => ({
  getPortalNotifications: mocks.get,
  markPortalNotificationRead: mocks.read,
  markPortalNotificationUnread: mocks.unread,
  markAllPortalNotificationsRead: mocks.readAll,
}));

vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({
    t: (key: string, options?: { count?: number; ref?: string }) =>
      key
        .replace("{{count}}", String(options?.count ?? ""))
        .replace("{{ref}}", options?.ref ?? ""),
  }),
}));

const page: PortalNotificationPage = {
  data: [
    {
      id: "notification-1",
      kind: "work_item.commented",
      isRead: false,
      createdAt: "2026-10-26T10:00:00.000Z",
      requestRef: "SUB-7",
      commentId: "comment-7",
    },
  ],
  unreadCount: 1,
  hasMore: false,
  nextCursor: null,
};

function renderInbox() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PortalNotificationInbox />
    </QueryClientProvider>,
  );
}

describe("portal notification inbox", () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue(page);
    mocks.read.mockReset().mockResolvedValue({ success: true });
    mocks.unread.mockReset().mockResolvedValue({ success: true });
    mocks.readAll.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => cleanup());

  it("shows only customer filters and links to the exact public comment", async () => {
    renderInbox();

    expect(
      await screen.findByRole("link", { name: "notifications.events.comment" }),
    ).toHaveAttribute("href", "/submissions/SUB-7#comment-comment-7");
    expect(
      screen.getByRole("tab", { name: "notifications.filterAll" }),
    ).toBeVisible();
    expect(
      screen.getByRole("tab", { name: "notifications.filterUnread" }),
    ).toBeVisible();
    expect(
      screen.getByRole("tab", { name: "notifications.filterMentions" }),
    ).toBeVisible();
    expect(screen.queryByRole("tab", { name: /assignment/iu })).toBeNull();
    expect(screen.queryByText(/staff|internal triage/iu)).toBeNull();
  });

  it("uses customer-scoped read controls and sends the selected filter to the API", async () => {
    renderInbox();
    await screen.findByRole("link", { name: "notifications.events.comment" });

    fireEvent.click(
      screen.getByRole("button", { name: "notifications.markRead" }),
    );
    await waitFor(() =>
      expect(mocks.read).toHaveBeenCalledWith("notification-1"),
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "notifications.filterMentions" }),
    );
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        expect.objectContaining({ filter: "mentions" }),
      ),
    );
  });
});
