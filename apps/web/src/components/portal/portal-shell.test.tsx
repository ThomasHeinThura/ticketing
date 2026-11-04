import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expectNoA11yViolations } from "@taskdesk/ui/test/a11y";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalLayout from "./portal-layout";

const location = vi.hoisted(() => ({ pathname: "/", search: {} }));
const navigate = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const getPortalProjects = vi.hoisted(() => vi.fn());
const getPortalAnnouncements = vi.hoisted(() => vi.fn());
const getPortalCases = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    cases: [],
    page: { nextCursor: null, hasMore: false },
    meta: { total: 0 },
  }),
);

vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useLocation: (options?: {
      select?: (value: typeof location) => unknown;
    }) => (options?.select ? options.select(location) : location),
    useNavigate: () => navigate,
    Link: React.forwardRef<
      HTMLAnchorElement,
      React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }
    >(({ children, to, ...props }, ref) => (
      <a href={to} ref={ref} {...props}>
        {children}
      </a>
    )),
  };
});

vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key} ${options.name}` : key,
    i18n: {},
  }),
  getDefaultPortalTerm: () => "Requests",
}));

vi.mock("@/fetchers/kb/portal", () => ({
  getPortalKb: vi.fn().mockResolvedValue({ data: [], total: 1 }),
}));
vi.mock("@/fetchers/portal/cases", () => ({ getPortalCases }));
vi.mock("@/fetchers/intake", () => ({
  getPortalCatalogue: vi.fn().mockResolvedValue({ requestTypes: [] }),
}));
vi.mock("@/fetchers/portal/announcements", () => ({
  getPortalAnnouncements,
}));
vi.mock("@/fetchers/portal/projects", () => ({
  getPortalProjects,
  portalProjectKeys: { list: () => ["portal", "projects", "list"] },
}));
vi.mock("@/fetchers/portal-notifications", () => ({
  getPortalNotifications: vi.fn().mockResolvedValue({
    data: [],
    unreadCount: 0,
    hasMore: false,
    nextCursor: null,
  }),
}));
vi.mock("@/hooks/use-portal-notification-websocket", () => ({
  usePortalNotificationWebSocket: () => undefined,
}));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: { signOut },
}));

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("max-width") && width < 768,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderShell(children: ReactNode = <h1>Page</h1>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PortalLayout
        user={{
          name: "Ada Customer",
          email: "ada@example.test",
          image: null,
        }}
      >
        <div>{children}</div>
      </PortalLayout>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  location.pathname = "/";
  location.search = {};
  navigate.mockReset();
  signOut.mockReset();
  getPortalProjects.mockReset();
  getPortalAnnouncements.mockReset();
  getPortalAnnouncements.mockResolvedValue({ data: [], nextCursor: null });
  window.sessionStorage.clear();
  setViewport(1280);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("portal shell", () => {
  it("lists the customer sections with Support's children and Announcements", async () => {
    renderShell();
    const nav = await screen.findByRole("link", {
      name: "navigation.dashboard",
    });
    expect(nav).toHaveAttribute("href", "/");
    for (const [name, href] of [
      ["navigation.support", "/requests"],
      ["navigation.requests", "/requests"],
      ["navigation.catalogue", "/catalogue"],
      ["navigation.approvals", "/approvals"],
      ["navigation.knowledgeBase", "/kb"],
      // Each entry reads like the heading of the page it opens.
      ["notifications.title", "/notifications"],
      ["projects.title", "/projects"],
      ["navigation.announcements", "/announcements"],
      ["navigation.settings", "/account"],
    ])
      expect(await screen.findByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
  });

  it("keeps Announcements active on the release notes tab", async () => {
    location.pathname = "/releases";
    renderShell();
    const announcements = await screen.findByRole("link", {
      name: "navigation.announcements",
    });
    expect(announcements).toHaveAttribute("data-active", "true");
    expect(announcements).not.toHaveAttribute("aria-current");
  });

  it("shows an active incident banner and dismisses it for the session", async () => {
    getPortalAnnouncements.mockResolvedValue({
      data: [
        {
          id: "announcement-1",
          title: "Payments degraded",
          body: "",
          severity: "incident",
          startsAt: "2030-01-01T00:00:00.000Z",
          endsAt: null,
          publishedAt: "2030-01-01T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    renderShell();
    const link = await screen.findByRole("link", {
      name: "Payments degraded",
    });
    expect(link).toHaveAttribute("href", "/announcements/$id");
    expect(getPortalAnnouncements).toHaveBeenCalledWith({
      limit: 3,
      severities: ["incident", "maintenance"],
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "portal:announcements.banner.dismiss",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Payments degraded" }),
      ).toBeNull(),
    );
    expect(
      window.sessionStorage.getItem("taskdesk.portal.dismissedAnnouncements"),
    ).toContain("announcement-1");
  });

  it("shows no banner when announcements do not answer", async () => {
    getPortalAnnouncements.mockRejectedValue(new Error("feature off"));
    renderShell();
    await screen.findByRole("link", { name: "navigation.settings" });
    await waitFor(() => expect(getPortalAnnouncements).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps Support active on a request detail without claiming the page", async () => {
    location.pathname = "/submissions/SUB-7";
    renderShell();
    const support = await screen.findByRole("link", {
      name: "navigation.support",
    });
    expect(support).toHaveAttribute("data-active", "true");
    expect(support).not.toHaveAttribute("aria-current");
    expect(
      screen.getByRole("link", { name: "navigation.requests" }),
    ).toHaveAttribute("data-active", "true");
    expect(
      screen.getByRole("link", { name: "navigation.dashboard" }),
    ).not.toHaveAttribute("data-active", "true");
  });

  it("marks the exact page current", async () => {
    location.pathname = "/approvals";
    renderShell();
    expect(
      await screen.findByRole("link", { name: "navigation.approvals" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("opens the combined help results from the top-bar search and offers Get help", async () => {
    renderShell();
    const search = await screen.findByRole("searchbox", {
      name: "shell.search.label",
    });
    expect(screen.getByRole("link", { name: "shell.getHelp" })).toHaveAttribute(
      "href",
      "/catalogue",
    );
    expect(
      screen.getByRole("switch", { name: "shell.theme" }),
    ).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "  vpn access " } });
    fireEvent.submit(search.closest("form") as HTMLFormElement);
    // Not the request-type filter alone: articles, request types and the customer's requests.
    const dialog = await screen.findByRole("dialog", {
      name: "shell.search.label",
    });
    expect(
      within(dialog).getByRole("combobox", { name: "shell.search.label" }),
    ).toHaveValue("vpn access");
    await waitFor(() =>
      expect(getPortalCases).toHaveBeenCalledWith({
        scope: "mine",
        q: "vpn access",
        limit: 5,
      }),
    );
    expect(navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "/catalogue" }),
    );
  });

  it("shows the project selector only when the organisation has two or more projects", async () => {
    const project = (key: string, name: string) => ({
      key,
      name,
      kind: "project",
      status: "active",
      health: null,
      counts: { actionRequired: 0, outstanding: 0 },
    });
    getPortalProjects.mockResolvedValue({ data: [project("CON", "Contoso")] });
    const single = renderShell();
    await screen.findByRole("link", { name: "shell.getHelp" });
    await waitFor(() => expect(getPortalProjects).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "shell.projectSelector.label" }),
    ).toBeNull();
    single.unmount();
    getPortalProjects.mockResolvedValue({
      data: [project("CON", "Contoso"), project("OPS", "Operations")],
    });
    renderShell();
    expect(
      await screen.findByRole("button", {
        name: "shell.projectSelector.label",
      }),
    ).toBeInTheDocument();
  });

  it("shows the customer in the avatar menu and reports a refused sign-out", async () => {
    signOut.mockResolvedValue({ data: null, error: { status: 500 } });
    renderShell();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "shell.userMenu.label Ada Customer",
      }),
    );
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Ada Customer")).toBeInTheDocument();
    expect(within(menu).getByText("ada@example.test")).toBeInTheDocument();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "navigation.settings" }),
    );
    expect(navigate).toHaveBeenCalledWith({ to: "/account" });
  });

  it("signs out from the avatar menu and keeps the failure visible", async () => {
    signOut.mockResolvedValue({ data: null, error: { status: 500 } });
    renderShell();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "shell.userMenu.label Ada Customer",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "navigation.signOut" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "navigation.signOutFailed",
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("collapses the navigation into a closed sheet on mobile", async () => {
    setViewport(375);
    renderShell();
    await screen.findByRole("link", { name: "shell.getHelp" });
    expect(
      screen.queryByRole("link", { name: "navigation.dashboard" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "common:a11y.toggleSidebar" }),
    );
    expect(
      await screen.findByRole("link", { name: "navigation.dashboard" }),
    ).toBeVisible();
  });

  it("starts with a skip link to the shell's one main and names the navigation", async () => {
    renderShell();
    await screen.findByRole("link", { name: "navigation.dashboard" });
    // WCAG 2.4.1: the first focusable element bypasses the sidebar.
    const skip = screen.getByRole("link", {
      name: "common:a11y.skipToContent",
    });
    const firstFocusable = document.querySelector<HTMLElement>(
      "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    expect(firstFocusable).toBe(skip);
    // Pages render inside the inset, so the shell's inset is the page's only main.
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const main = screen.getByRole("main");
    skip.focus();
    fireEvent.click(skip);
    expect(main).toHaveFocus();
    expect(screen.getAllByRole("navigation").length).toBeGreaterThan(0);
  });

  it("has no serious or critical axe violations (G4)", async () => {
    const { container } = renderShell();
    await screen.findByRole("link", { name: "navigation.announcements" });
    await screen.findByRole("link", { name: "shell.getHelp" });
    // G4 with the shared @taskdesk/ui axe helper; `baseElement` would add portalled menus.
    await expectNoA11yViolations(container, { impact: "serious-or-critical" });
    // The check is live: an unnamed link in the same document fails it.
    const probe = document.createElement("div");
    probe.append(Object.assign(document.createElement("a"), { href: "/x" }));
    document.body.append(probe);
    await expect(expectNoA11yViolations(probe)).rejects.toThrow();
    probe.remove();
  });
});
