import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifications: [] as Array<Record<string, unknown>>,
  navigate: vi.fn(),
  markAsRead: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { info: mocks.toastInfo } }));
vi.mock("@/hooks/queries/notification/use-get-notifications", () => ({
  default: () => ({
    data: {
      pages: [
        {
          data: mocks.notifications,
          unreadCount: mocks.notifications.length,
        },
      ],
    },
  }),
}));
vi.mock("@/hooks/mutations/notification/use-clear-notifications", () => ({
  default: () => ({ mutate: vi.fn() }),
}));
vi.mock(
  "@/hooks/mutations/notification/use-mark-all-notifications-as-read",
  () => ({ default: () => ({ mutate: vi.fn() }) }),
);
vi.mock("@/hooks/mutations/notification/use-mark-notification-as-read", () => ({
  default: () => ({ mutate: mocks.markAsRead }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: () => {},
}));
vi.mock("@/lib/format", () => ({ formatRelativeTime: () => "1m" }));

import NotificationDropdown, {
  isLegacyTaskNotification,
  type NotificationDropdownRef,
} from "./notification-dropdown";

const base = {
  isRead: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  title: null,
  content: null,
};

async function openMenu() {
  const ref = createRef<NotificationDropdownRef>();
  render(<NotificationDropdown ref={ref} />);
  await act(async () => ref.current?.toggle());
  return screen.findByRole("menu");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.notifications = [];
});

describe("legacy task notification (never opens an old task URL)", () => {
  it("is recognised only for a task resource with no canonical work item key", () => {
    expect(isLegacyTaskNotification({ resourceType: "task" })).toBe(true);
    expect(
      isLegacyTaskNotification({ resourceType: "task", workItemKey: null }),
    ).toBe(true);
    expect(
      isLegacyTaskNotification({ resourceType: "task", workItemKey: "HELP-1" }),
    ).toBe(false);
    expect(isLegacyTaskNotification({ resourceType: "comment" })).toBe(false);
  });

  it("shows the item as unavailable and a message instead of navigating", async () => {
    mocks.notifications = [
      {
        ...base,
        id: "n-legacy",
        type: "task_assigned",
        resourceType: "task",
        resourceId: "task-1",
        eventData: {
          workspaceId: "ws-1",
          projectId: "p-1",
          taskTitle: "Reset password",
        },
      },
    ];
    const menu = await openMenu();
    expect(within(menu).getByText("notifications:unavailable")).toBeVisible();

    fireEvent.click(within(menu).getByText(/task_assigned/));

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toastInfo).toHaveBeenCalledExactlyOnceWith(
      "notifications:unavailableMessage",
    );
    expect(mocks.markAsRead).toHaveBeenCalledExactlyOnceWith("n-legacy");
  });

  it("still opens the canonical work item when the notification has its key", async () => {
    mocks.notifications = [
      {
        ...base,
        id: "n-item",
        type: "task_assigned",
        resourceType: "task",
        resourceId: "task-1",
        workItemKey: "HELP-7",
        eventData: { workspaceId: "ws-1", projectId: "p-1" },
      },
    ];
    const menu = await openMenu();
    expect(
      within(menu).queryByText("notifications:unavailable"),
    ).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByText(/task_assigned/));

    expect(mocks.toastInfo).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledOnce();
    const href = String(mocks.navigate.mock.calls[0]?.[0]?.href);
    expect(href).toContain("/agent/work-items/HELP-7");
    expect(href).not.toContain("/dashboard/workspace/");
  });
});
