import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@taskdesk/ui";
import {
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
  workspaceId: "ws-1",
  isMobile: false,
  closeMobile: vi.fn(),
  paint: { resolve: () => {} },
  getSavedViews: vi.fn(),
  countSavedView: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@taskdesk/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@taskdesk/ui")>();
  return {
    ...actual,
    useSidebar: () => ({
      isMobile: mocks.isMobile,
      setOpenMobile: mocks.closeMobile,
    }),
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
  default: () => ({ data: { id: mocks.workspaceId } }),
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

const view = (
  id: string,
  name: string,
  isPinned: boolean,
  visibility: "private" | "team" | "workspace" = "private",
) => ({
  id,
  name,
  isPinned,
  visibility,
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
  mocks.workspaceId = "ws-1";
  mocks.isMobile = false;
  mocks.closeMobile.mockReset();
  mocks.navigate.mockReset();
  mocks.getSavedViews.mockResolvedValue([
    view("v-pinned", "Escalations", true, "private"),
    view("v-workspace", "Workspace open", false, "workspace"),
    view("v-pinned-2", "Everything open", true, "team"),
    view("v-private", "Private unpinned", false, "private"),
    view("v-team", "Team unpinned", false, "team"),
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
    expect(mocks.closeMobile).not.toHaveBeenCalled();
  });

  it("closes the mobile drawer after navigating from the index and a pinned view", async () => {
    mocks.isMobile = true;
    renderNav();
    mocks.paint.resolve();

    fireEvent.click(screen.getByRole("button", { name: "Saved views" }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/agent/views" });
    expect(mocks.closeMobile).toHaveBeenCalledWith(false);

    mocks.navigate.mockClear();
    mocks.closeMobile.mockClear();
    fireEvent.click(
      await screen.findByRole("button", { name: /Escalations/u }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/agent/views/$id",
      params: { id: "v-pinned" },
    });
    expect(mocks.closeMobile).toHaveBeenCalledWith(false);
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

  it("lists pinned reachable views and every workspace view, pinned first under Saved views", async () => {
    renderNav();
    mocks.paint.resolve();
    expect(
      await screen.findByRole("button", { name: /Escalations/u }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Workspace open/u }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Private unpinned/u }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Team unpinned/u })).toBeNull();
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId("saved-view-count-badge")
          .map((badge) => badge.textContent),
      ).toEqual(["12", "148", "148"]),
    );
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.replace(/\d+$/u, ""));
    expect(labels.indexOf("Saved views")).toBe(
      labels.indexOf("Escalations") - 1,
    );
    expect(labels.indexOf("Escalations")).toBeLessThan(
      labels.indexOf("Workspace open"),
    );
  });

  it("deduplicates ids and preserves the server order within pinned and workspace groups", async () => {
    mocks.getSavedViews.mockResolvedValue([
      view("workspace-first", "Workspace first", false, "workspace"),
      view("pinned-first", "Pinned first", true, "private"),
      view("workspace-first", "Duplicate workspace row", false, "workspace"),
      view("pinned-second", "Pinned second", true, "team"),
    ]);
    renderNav();
    mocks.paint.resolve();
    const first = await screen.findByRole("button", { name: /Pinned first/u });
    const second = await screen.findByRole("button", {
      name: /Pinned second/u,
    });
    const workspace = await screen.findByRole("button", {
      name: /Workspace first/u,
    });
    expect(
      screen.queryByRole("button", { name: /Duplicate workspace row/u }),
    ).toBeNull();
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels.indexOf(first.textContent)).toBeLessThan(
      labels.indexOf(second.textContent),
    );
    expect(labels.indexOf(second.textContent)).toBeLessThan(
      labels.indexOf(workspace.textContent),
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
      ).toEqual(["148", "148"]),
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

  it("keys the list separately by workspace as well as viewer", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = renderNav(client);
    mocks.paint.resolve();
    await screen.findByRole("button", { name: /Escalations/u });
    first.unmount();

    mocks.workspaceId = "ws-2";
    mocks.getSavedViews.mockResolvedValue([
      view("v-ws-two", "Workspace two", false, "workspace"),
    ]);
    renderNav(client);
    mocks.paint.resolve();
    expect(
      await screen.findByRole("button", { name: /Workspace two/u }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Workspace open/u }),
    ).toBeNull();
    expect(mocks.getSavedViews).toHaveBeenCalledWith("ws-2");
  });

  it("reads nothing without a signed-in viewer", async () => {
    mocks.user = undefined;
    renderNav();
    mocks.paint.resolve();
    await Promise.resolve();
    expect(mocks.getSavedViews).not.toHaveBeenCalled();
  });
});
