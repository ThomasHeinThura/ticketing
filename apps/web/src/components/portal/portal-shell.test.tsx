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
const getPortalReleases = vi.hoisted(() => vi.fn());

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
vi.mock("@/fetchers/portal/releases", () => ({ getPortalReleases }));
vi.mock("@/fetchers/portal/projects", () => ({ getPortalProjects }));
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
        <main>{children}</main>
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
  getPortalReleases.mockReset();
  getPortalReleases.mockResolvedValue({ data: [], nextCursor: null });
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
      ["navigation.updates", "/notifications"],
      ["navigation.announcements", "/releases"],
      ["navigation.settings", "/account"],
    ])
      expect(await screen.findByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
  });

  it("hides Announcements where release notes do not answer", async () => {
    getPortalReleases.mockRejectedValue(new Error("feature off"));
    renderShell();
    await screen.findByRole("link", { name: "navigation.settings" });
    await waitFor(() => expect(getPortalReleases).toHaveBeenCalled());
    expect(
      screen.queryByRole("link", { name: "navigation.announcements" }),
    ).toBeNull();
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

  it("searches the catalogue and offers Get help", async () => {
    renderShell();
    const search = await screen.findByRole("searchbox", {
      name: "shell.search.label",
    });
    fireEvent.change(search, { target: { value: "  vpn access " } });
    fireEvent.submit(search.closest("form") as HTMLFormElement);
    expect(navigate).toHaveBeenCalledWith({
      to: "/catalogue",
      search: { q: "vpn access" },
    });
    expect(screen.getByRole("link", { name: "shell.getHelp" })).toHaveAttribute(
      "href",
      "/catalogue",
    );
    expect(
      screen.getByRole("switch", { name: "shell.theme" }),
    ).toBeInTheDocument();
  });

  it("keeps the project selector off until its API ships", async () => {
    renderShell();
    await screen.findByRole("link", { name: "shell.getHelp" });
    expect(getPortalProjects).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "shell.projectSelector.label" }),
    ).toBeNull();
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
