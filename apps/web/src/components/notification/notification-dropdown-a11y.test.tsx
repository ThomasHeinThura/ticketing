import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifications: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
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
  default: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: () => {},
}));
vi.mock("@/lib/format", () => ({ formatRelativeTime: () => "1m" }));

import NotificationDropdown, {
  type NotificationDropdownRef,
} from "./notification-dropdown";

/** Roles a `menu` may own (WAI-ARIA 1.2), the set axe's aria-required-children checks. */
const MENU_CHILD_ROLES = new Set([
  "group",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "separator",
]);
const IMPLICIT_ROLES: Record<string, string> = {
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  P: "paragraph",
  UL: "list",
  LI: "listitem",
};

/** Every element a menu owns: walk through role-less wrappers until a role is met. */
function ownedRoles(element: Element): string[] {
  const roles: string[] = [];
  for (const child of Array.from(element.children)) {
    const role =
      child.getAttribute("role") ?? IMPLICIT_ROLES[child.tagName] ?? null;
    if (role === "presentation" || role === "none" || role === null) {
      roles.push(...ownedRoles(child));
    } else {
      roles.push(role);
    }
  }
  return roles;
}

async function openMenu() {
  const ref = createRef<NotificationDropdownRef>();
  render(<NotificationDropdown ref={ref} />);
  await act(async () => ref.current?.toggle());
  return screen.findByRole("menu");
}

afterEach(() => {
  cleanup();
  mocks.notifications = [];
});

describe("NotificationDropdown menu semantics (axe aria-required-children)", () => {
  it("owns only groups and items when empty, and names its group", async () => {
    const menu = await openMenu();
    const roles = ownedRoles(menu);
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) expect(MENU_CHILD_ROLES).toContain(role);

    const group = within(menu).getByRole("group");
    expect(group).toHaveAccessibleName("notifications:title");
    for (const role of ownedRoles(group))
      expect(["menuitem", "separator", "group"]).toContain(role);
    expect(within(menu).getByTestId("notifications-empty")).toHaveAttribute(
      "role",
      "menuitem",
    );
  });

  it("owns only groups and items with notifications", async () => {
    mocks.notifications = [
      {
        id: "n1",
        type: "task_assigned",
        isRead: false,
        createdAt: "2026-11-01T00:00:00.000Z",
        eventData: { taskTitle: "Reset" },
      },
    ];
    const menu = await openMenu();
    for (const role of ownedRoles(menu))
      expect(MENU_CHILD_ROLES).toContain(role);
    const group = within(menu).getByRole("group");
    for (const role of ownedRoles(group))
      expect(["menuitem", "separator", "group"]).toContain(role);
  });
});
