import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";
import { NavMain } from "./nav-main";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  user: { id: "viewer-1" } as { id: string } | undefined,
  paint: { resolve: () => {} },
  getSavedViews: vi.fn(),
  countSavedView: vi.fn(),
  getWorkspaceResolvedFeatures: vi.fn(),
  logTime: true,
}));

/** A stand-in for the router's location store: only subscribers re-render when it changes. */
const router = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { pathname: "/agent/views" };
  return {
    state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    go(pathname: string) {
      state.pathname = pathname;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("@tanstack/react-router", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useNavigate: () => mocks.navigate,
    useLocation: <T,>(options?: {
      select?: (location: { pathname: string }) => T;
    }) => {
      const pathname = useSyncExternalStore(
        router.subscribe,
        () => router.state.pathname,
      );
      return options?.select ? options.select({ pathname }) : { pathname };
    },
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: mocks.user }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canLogTime: () => mocks.logTime }),
}));
vi.mock("@/hooks/queries/invitation/use-pending-invitations", () => ({
  usePendingInvitations: () => ({ data: [] }),
}));
vi.mock("@/lib/i18n/after-first-paint", () => ({
  afterFirstPaint: () =>
    new Promise<void>((resolve) => {
      mocks.paint.resolve = resolve;
    }),
}));
vi.mock("@/fetchers/saved-views", () => ({
  getSavedViews: (...args: unknown[]) => mocks.getSavedViews(...args),
  countSavedView: (...args: unknown[]) => mocks.countSavedView(...args),
}));

vi.mock("@/fetchers/feature-flags", () => ({
  getWorkspaceResolvedFeatures: (...args: unknown[]) =>
    mocks.getWorkspaceResolvedFeatures(...args),
}));

const view = (id: string, name: string, isPinned: boolean) => ({
  id,
  name,
  isPinned,
  updatedAt: "2026-10-01T00:00:00.000Z",
});

function renderNav(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SidebarProvider>{children}</SidebarProvider>
    </QueryClientProvider>
  );
  return { client, ...render(<NavMain />, { wrapper }) };
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as MediaQueryList,
  );
  mocks.user = { id: "viewer-1" };
  router.state.pathname = "/agent/views";
  mocks.navigate.mockReset();
  mocks.getWorkspaceResolvedFeatures.mockResolvedValue([]);
  mocks.getSavedViews.mockResolvedValue([
    view("v-pinned", "Escalations", true),
    view("v-other", "Not pinned", false),
    view("v-pinned-2", "Everything open", true),
  ]);
  mocks.countSavedView.mockImplementation(async (id: string) =>
    id === "v-pinned" ? 12 : 148,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("NavMain saved views (SV-20, SV-22)", () => {
  it("always links to the saved views index", () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: "Saved views" }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/agent/views" });
  });

  it("reads nothing until the page has painted (G11)", async () => {
    renderNav();
    await Promise.resolve();
    expect(mocks.getSavedViews).not.toHaveBeenCalled();
    mocks.paint.resolve();
    await waitFor(() =>
      expect(mocks.getSavedViews).toHaveBeenCalledWith("ws-1"),
    );
  });

  it("lists only the viewer's pinned views, directly under Saved views, each with its count badge", async () => {
    renderNav();
    mocks.paint.resolve();
    expect(
      await screen.findByRole("button", { name: /Escalations/u }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Not pinned/u })).toBeNull();
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId("saved-view-count-badge")
          .map((badge) => badge.textContent),
      ).toEqual(["12", "148"]),
    );
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.replace(/\d+$/u, ""));
    expect(labels.indexOf("Saved views")).toBe(
      labels.indexOf("Escalations") - 1,
    );
  });

  it("opens a pinned view by its id; the screen fills in the rest of its definition", async () => {
    renderNav();
    mocks.paint.resolve();
    fireEvent.click(
      await screen.findByRole("button", { name: /Escalations/u }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/agent/views/$id",
      params: { id: "v-pinned" },
    });
  });

  it("keeps a view with no count in the list and shows no badge for it", async () => {
    mocks.countSavedView.mockImplementation(async (id: string) => {
      if (id === "v-pinned") throw new HttpError(422, "unsupported");
      return 148;
    });
    renderNav();
    mocks.paint.resolve();
    expect(
      await screen.findByRole("button", { name: /Escalations/u }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId("saved-view-count-badge")
          .map((badge) => badge.textContent),
      ).toEqual(["148"]),
    );
  });

  it("never reuses one viewer's list or counts for another on the same client", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = renderNav(client);
    mocks.paint.resolve();
    await screen.findByRole("button", { name: /Escalations/u });
    expect(mocks.getSavedViews).toHaveBeenCalledTimes(1);
    first.unmount();

    mocks.user = { id: "viewer-2" };
    mocks.getSavedViews.mockResolvedValue([
      view("v-two", "Viewer two only", true),
    ]);
    mocks.countSavedView.mockResolvedValue(1);
    renderNav(client);
    mocks.paint.resolve();
    expect(
      await screen.findByRole("button", { name: /Viewer two only/u }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Escalations/u })).toBeNull();
    expect(mocks.getSavedViews).toHaveBeenCalledTimes(2);
  });

  it("reads nothing without a signed-in viewer", async () => {
    mocks.user = undefined;
    renderNav();
    mocks.paint.resolve();
    await Promise.resolve();
    expect(mocks.getSavedViews).not.toHaveBeenCalled();
  });
});

describe("NavMain feature entries (P5-R4-04)", () => {
  const on = (...keys: string[]) => keys.map((key) => ({ key, enabled: true }));

  it("shows the gated entries from the resolved read, which every workspace member may call", async () => {
    mocks.getWorkspaceResolvedFeatures.mockResolvedValue([
      ...on(
        "feature.knowledge_base",
        "feature.time_tracking",
        "feature.reports",
      ),
    ]);
    renderNav();
    mocks.paint.resolve();
    for (const name of ["Knowledge base", "Timesheet", "Reports", "Dashboard"])
      expect(await screen.findByRole("button", { name })).toBeInTheDocument();
    expect(mocks.getWorkspaceResolvedFeatures).toHaveBeenCalledWith("ws-1");
  });

  it("hides the Timesheet entry from a caller without time_entry:create even with the flag on (R6-02)", async () => {
    mocks.getWorkspaceResolvedFeatures.mockResolvedValue([
      ...on("feature.time_tracking", "feature.reports"),
    ]);
    mocks.logTime = false;
    renderNav();
    mocks.paint.resolve();
    expect(
      await screen.findByRole("button", { name: "Reports" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Timesheet" })).toBeNull();
    mocks.logTime = true;
  });

  it("hides an entry whose flag is off and all of them when the read fails", async () => {
    mocks.getWorkspaceResolvedFeatures.mockResolvedValue(
      on("feature.knowledge_base"),
    );
    const first = renderNav();
    mocks.paint.resolve();
    expect(
      await screen.findByRole("button", { name: "Knowledge base" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Timesheet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reports" })).toBeNull();
    first.unmount();

    mocks.getWorkspaceResolvedFeatures.mockRejectedValue(
      new HttpError(403, "no"),
    );
    renderNav();
    mocks.paint.resolve();
    await waitFor(() =>
      expect(mocks.getWorkspaceResolvedFeatures).toHaveBeenCalledTimes(2),
    );
    expect(screen.queryByRole("button", { name: "Knowledge base" })).toBeNull();
  });
});

describe("NavMain highlight follows the router", () => {
  const activeEntries = () =>
    screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("data-active") === "true")
      .map((button) => button.textContent?.replace(/\d+$/u, ""));

  it("moves the highlight when the route changes, without any other re-render", async () => {
    mocks.getWorkspaceResolvedFeatures.mockResolvedValue([
      { key: "feature.knowledge_base", enabled: true },
    ]);
    renderNav();
    mocks.paint.resolve();
    await screen.findByRole("button", { name: "Knowledge base" });
    expect(activeEntries()).toEqual(["Saved views"]);

    act(() => router.go("/agent/triage"));
    expect(activeEntries()).toEqual(["Triage"]);

    act(() => router.go("/agent/kb/article-1"));
    expect(activeEntries()).toEqual(["Knowledge base"]);

    // Back to Saved views, as the browser Back button would.
    act(() => router.go("/agent/views"));
    expect(activeEntries()).toEqual(["Saved views"]);
  });

  it("highlights only the pinned view on its own page, not the Saved views index (SV-20)", async () => {
    renderNav();
    mocks.paint.resolve();
    await screen.findByRole("button", { name: /Escalations/u });

    act(() => router.go("/agent/views/v-pinned"));
    expect(activeEntries()).toEqual(["Escalations"]);
  });
});

describe("NavMain settings entry (L-03)", () => {
  it("has no sidebar Settings group; settings open from the avatar, workspace and project menus", () => {
    renderNav();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Project settings" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "God Mode" })).toBeNull();
    // The workspace pages that have no settings frame of their own keep their entries.
    expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Invitations" }),
    ).toBeInTheDocument();
  });
});
