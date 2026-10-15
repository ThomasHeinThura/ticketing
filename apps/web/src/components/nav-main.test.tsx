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
  paint: { resolve: () => {} },
  getSavedViews: vi.fn(),
  countSavedView: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
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
  mocks.navigate.mockReset();
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
