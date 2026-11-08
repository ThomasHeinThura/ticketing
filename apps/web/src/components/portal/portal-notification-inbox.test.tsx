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
      targetKind: "submission",
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

  it("P2R1-04: links a customer approver's approval event to the Approvals screen", async () => {
    mocks.get.mockReset().mockResolvedValue({
      ...page,
      data: [
        {
          id: "notification-2",
          kind: "approval.requested",
          isRead: false,
          createdAt: "2026-10-26T11:00:00.000Z",
          targetKind: "approval",
          requestRef: null,
          commentId: null,
        },
      ],
    });
    renderInbox();
    expect(
      await screen.findByRole("link", {
        name: "notifications.events.approvalRequested",
      }),
    ).toHaveAttribute("href", "/approvals");
    expect(screen.queryByText("notifications.requestReference")).toBeNull();
  });

  it("U-12: links a comment on a request the team raised to its portal request page", async () => {
    mocks.get.mockReset().mockResolvedValue({
      ...page,
      data: [
        {
          id: "notification-3",
          kind: "work_item.commented",
          isRead: false,
          createdAt: "2026-10-26T12:00:00.000Z",
          targetKind: "request",
          requestRef: "HELP-8",
          commentId: "comment-8",
        },
      ],
    });
    renderInbox();
    expect(
      await screen.findByRole("link", { name: "notifications.events.comment" }),
    ).toHaveAttribute("href", "/requests/HELP-8#comment-comment-8");
  });

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

  it("reads a notification when it is opened and refreshes the unread count", async () => {
    mocks.get
      .mockReset()
      .mockResolvedValueOnce(page)
      .mockResolvedValue({
        ...page,
        data: [{ ...page.data[0], isRead: true }],
        unreadCount: 0,
      });
    renderInbox();
    const link = await screen.findByRole("link", {
      name: "notifications.events.comment",
    });
    fireEvent.click(link);
    await waitFor(() =>
      expect(mocks.read).toHaveBeenCalledWith("notification-1"),
    );
    expect(mocks.unread).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    // A read notification opened again is not toggled back to unread.
    fireEvent.click(
      await screen.findByRole("link", { name: "notifications.events.comment" }),
    );
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.unread).not.toHaveBeenCalled();
  });

  it("dates each notification like the rest of the portal and keeps its reference in the header", async () => {
    renderInbox();
    await screen.findByRole("link", { name: "notifications.events.comment" });
    const time = document.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-10-26T10:00:00.000Z");
    const expected = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date("2026-10-26T10:00:00.000Z"));
    expect(time).toHaveTextContent(expected);
    expect(time?.textContent).not.toBe(
      new Date("2026-10-26T10:00:00.000Z").toLocaleString(),
    );
    // The reference and the time share one muted line under the event text (P7).
    const meta = time?.closest("[data-slot=portal-notification-meta]");
    expect(meta).toHaveTextContent("notifications.requestReference");
    expect(meta).toHaveClass("truncate", "text-muted-foreground");
    expect(document.title).toBe("notifications.title · navigation.title");
  });

  it("renders compact rows: unread dot, whole-row link and an icon read toggle (CP-8, P7)", async () => {
    mocks.get.mockReset().mockResolvedValue({
      ...page,
      data: [
        page.data[0],
        {
          ...page.data[0],
          id: "notification-9",
          isRead: true,
          requestRef: "SUB-9",
          commentId: null,
        },
      ],
    });
    renderInbox();
    const [unreadLink, readLink] = await screen.findAllByRole("link", {
      name: "notifications.events.comment",
    });
    const [unreadRow, readRow] = [
      unreadLink.closest("li"),
      readLink.closest("li"),
    ];
    // The link's overlay covers the row, so the whole row opens the request.
    expect(unreadRow).toHaveClass("relative");
    expect(unreadLink).toHaveClass("after:absolute", "after:inset-0");
    // Unread: a leading dot and a heavier title; read: neither.
    expect(
      unreadRow?.querySelector("[data-slot=portal-notification-dot]"),
    ).toHaveClass("bg-primary");
    expect(unreadLink).toHaveClass("font-semibold");
    expect(
      readRow?.querySelector("[data-slot=portal-notification-dot]"),
    ).not.toHaveClass("bg-primary");
    expect(readLink).not.toHaveClass("font-semibold");
    // The toggle is an icon button named for what it does, above the overlay.
    const markRead = screen.getByRole("button", {
      name: "notifications.markRead",
    });
    expect(markRead).toHaveTextContent("");
    expect(markRead.querySelector("svg")).not.toBeNull();
    expect(markRead).toHaveClass("relative", "z-10");
    expect(
      screen.getByRole("button", { name: "notifications.markUnread" }),
    ).toHaveTextContent("");
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
