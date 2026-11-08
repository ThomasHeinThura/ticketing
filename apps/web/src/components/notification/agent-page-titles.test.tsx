import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotificationInbox from "@/components/notification/notification-inbox";
import MyWork from "@/components/work-item/my-work";

// WCAG 2.4.2: the agent's My work and Inbox pages name themselves in the browser tab.

vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "navigation:sidebar.myWork": "My work",
        "navigation:sidebar.inbox": "Inbox",
      })[key] ?? key,
    i18n: { language: "en-US", resolvedLanguage: "en-US" },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
}));

vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  )),
  useInfiniteQuery: () => ({ data: undefined, isLoading: true }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: undefined }),
}));
vi.mock("@/hooks/queries/approval/use-get-my-approvals", () => ({
  default: () => ({ data: undefined, isLoading: true }),
}));
vi.mock("@/hooks/queries/notification/use-get-notifications", () => ({
  default: () => ({ data: undefined, isLoading: true }),
}));
vi.mock(
  "@/hooks/mutations/notification/use-mark-all-notifications-as-read",
  () => ({ default: () => ({ mutate: vi.fn(), isPending: false }) }),
);
vi.mock("@/hooks/mutations/notification/use-mark-notification-as-read", () => ({
  default: () => ({ mutate: vi.fn() }),
}));
vi.mock(
  "@/hooks/mutations/notification/use-mark-notification-as-unread",
  () => ({ default: () => ({ mutate: vi.fn() }) }),
);
vi.mock("@/components/notification/notification-dropdown", () => ({
  getNotificationContent: () => "",
  getNotificationTitle: () => "",
  useNotificationClick: () => vi.fn(),
}));
vi.mock("@/components/work-item/work-item-list", () => ({
  default: () => null,
}));

afterEach(() => cleanup());

describe("agent page titles", () => {
  it("titles My work", () => {
    render(
      <MyWork
        lens="assigned"
        item={undefined}
        onLensChange={() => undefined}
        onItemChange={() => undefined}
      />,
    );
    expect(document.title).toBe("My work · TaskDesk");
  });

  it("titles the Inbox", () => {
    render(<NotificationInbox filter="all" onFilterChange={() => undefined} />);
    expect(document.title).toBe("Inbox · TaskDesk");
  });

  // UX-1a (DS-01): both pages show their name as a visible page title, not only to screen readers.
  it.each([
    [
      "My work",
      () => (
        <MyWork
          lens="assigned"
          item={undefined}
          onLensChange={() => undefined}
          onItemChange={() => undefined}
        />
      ),
    ],
    [
      "Inbox",
      () => <NotificationInbox filter="all" onFilterChange={() => undefined} />,
    ],
  ])("shows %s as the one visible page title", (name, Page) => {
    render(<Page />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(name);
    expect(headings[0]).not.toHaveClass("sr-only");
    expect(headings[0]).toHaveAttribute("data-slot", "page-header-title");
  });
});
