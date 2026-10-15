import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  pathname: "/agent/views",
  search: {} as { query?: string },
  navigate: vi.fn(),
  getSavedViews: vi.fn(),
  getShareableViewTeams: vi.fn(),
  countSavedView: vi.fn(),
  createSavedView: vi.fn(),
  toggleSavedViewPin: vi.fn(),
  requestSavedViewDeletion: vi.fn(),
  canShare: false,
  canManage: false,
  audienceProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: ReactNode;
    to: string;
    params: { id: string };
    search?: unknown;
  }) => (
    // ui-exempt: test double for the router link
    <a
      href={`${to.replace("$id", params.id)}`}
      data-search={JSON.stringify(search)}
    >
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  useLocation: () => ({ pathname: mocks.pathname }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(
        `savedViews:${
          typeof options?.count === "number"
            ? `${key}_${options.count === 1 ? "one" : "other"}`
            : key
        }`,
        options,
      ),
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "viewer-1" } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" }, isLoading: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canShareSavedViews: () => mocks.canShare,
    canManageWorkspaceSettings: () => mocks.canManage,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/components/saved-view/saved-view-audience-fields", () => ({
  SavedViewAudienceFields: (props: Record<string, unknown>) => {
    mocks.audienceProps = props;
    const MockButton = (p: ComponentProps<"button">) => (
      // ui-exempt: test double standing in for the shared design-system button.
      <button type="button" {...p} />
    );
    return (
      <div>
        <MockButton
          onClick={() =>
            (props.onVisibilityChange as (v: string) => void)("team")
          }
        >
          pick-team
        </MockButton>
        <MockButton
          onClick={() => (props.onTeamChange as (v: string) => void)("team-1")}
        >
          pick-team-id
        </MockButton>
      </div>
    );
  },
}));
vi.mock("@/fetchers/saved-views", () => ({
  getSavedViews: (...args: unknown[]) => mocks.getSavedViews(...args),
  getShareableViewTeams: (...args: unknown[]) =>
    mocks.getShareableViewTeams(...args),
  countSavedView: (...args: unknown[]) => mocks.countSavedView(...args),
  createSavedView: (...args: unknown[]) => mocks.createSavedView(...args),
  toggleSavedViewPin: (...args: unknown[]) => mocks.toggleSavedViewPin(...args),
  requestSavedViewDeletion: (...args: unknown[]) =>
    mocks.requestSavedViewDeletion(...args),
}));

import { Route } from "./views";

const base = {
  workspaceId: "ws-1",
  createdBy: "person-1",
  scope: "workspace",
  scopeId: "ws-1",
  sharedWithTeamId: null,
  layout: "list",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const views = [
  {
    ...base,
    id: "v-pinned",
    name: "Escalations",
    visibility: "private",
    isPinned: true,
    query: {
      entity: "work_item",
      filter: { field: "priority", op: "eq", value: "urgent" },
    },
  },
  {
    ...base,
    id: "v-open",
    name: "Everything open",
    visibility: "workspace",
    isPinned: false,
    query: { entity: "work_item", groupBy: "state" },
  },
];

function renderIndex() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as () => React.JSX.Element;
  return render(<Component />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  mocks.pathname = "/agent/views";
  mocks.search = {};
  mocks.canShare = false;
  mocks.canManage = false;
  mocks.audienceProps = undefined;
  mocks.navigate.mockReset();
  mocks.getSavedViews.mockResolvedValue(views);
  mocks.getShareableViewTeams.mockResolvedValue([]);
  mocks.countSavedView.mockImplementation(async (id: string) =>
    id === "v-pinned" ? 12 : 3,
  );
  mocks.createSavedView.mockResolvedValue({ ...views[0], id: "v-new" });
  mocks.toggleSavedViewPin.mockResolvedValue({ pinnedViewIds: [] });
  mocks.requestSavedViewDeletion.mockResolvedValue({
    pendingActionId: "pa-1",
  });
  vi.spyOn(Route, "useSearch").mockImplementation(
    (() => mocks.search) as never,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("saved views index", () => {
  it("renders the child route's outlet instead of the index under /agent/views/{id}", () => {
    mocks.pathname = "/agent/views/v-pinned";
    renderIndex();
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Saved views" })).toBeNull();
  });

  it("lists the views in the server's order (pinned first) with each viewer-specific count", async () => {
    renderIndex();
    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Escalations",
      "Everything open",
    ]);
    expect(
      await screen.findByText(/Pinned · .*12 matching work items/u),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Visibility: Workspace · 3 matching work items/u),
    ).toBeInTheDocument();
  });

  it("links each view with its whole definition in the URL, so the link can be shared (SV-19)", async () => {
    renderIndex();
    const link = await screen.findByRole("link", { name: "Escalations" });
    expect(link).toHaveAttribute("href", "/agent/views/v-pinned");
    expect(JSON.parse(link.getAttribute("data-search") ?? "{}")).toEqual({
      workspaceId: "ws-1",
      scope: "workspace",
      scopeId: "ws-1",
      layout: "list",
      filter: "priority:urgent",
    });
  });

  it("shows no count for a view the server will not count, without breaking the row", async () => {
    mocks.countSavedView.mockImplementation(async (id: string) => {
      if (id === "v-open") throw new HttpError(422, "unsupported");
      return 12;
    });
    renderIndex();
    expect(
      await screen.findByText(/12 matching work items/u),
    ).toBeInTheDocument();
    const row = screen
      .getByRole("heading", { name: "Everything open" })
      .closest("div");
    expect(row?.textContent).not.toMatch(/matching/u);
  });

  it("filters by name from the URL", async () => {
    mocks.search = { query: "every" };
    renderIndex();
    expect(
      await screen.findByRole("heading", { name: "Everything open" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Escalations" })).toBeNull();
  });

  it("says when nothing matches the name and when there are no views", async () => {
    mocks.search = { query: "zzz" };
    renderIndex();
    expect(
      await screen.findByText(translate("savedViews:emptySearch")),
    ).toBeInTheDocument();
    cleanup();
    mocks.search = {};
    mocks.getSavedViews.mockResolvedValue([]);
    renderIndex();
    expect(
      await screen.findByText(translate("savedViews:empty")),
    ).toBeInTheDocument();
  });

  it("offers a retry when the list cannot be loaded", async () => {
    mocks.getSavedViews.mockRejectedValueOnce(new HttpError(500, "x"));
    renderIndex();
    expect(
      await screen.findByText(translate("savedViews:loadError")),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Escalations" }),
    ).toBeInTheDocument();
  });
});

describe("creating (SV-15, SV-16, SV-18)", () => {
  it("creates a private workspace-scoped list view by default", async () => {
    renderIndex();
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "  My queue " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create view" }));
    await waitFor(() => expect(mocks.createSavedView).toHaveBeenCalled());
    expect(mocks.createSavedView).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      name: "My queue",
      scope: "workspace",
      scopeId: "ws-1",
      visibility: "private",
      layout: "list",
      query: { entity: "work_item" },
    });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.navigate.mock.calls[0]?.[0]).toMatchObject({
      to: "/agent/views/$id",
      params: { id: "v-new" },
    });
  });

  it("will not create a view without a name, or a team view without its team", async () => {
    mocks.canShare = true;
    renderIndex();
    expect(screen.getByRole("button", { name: "Create view" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Team queue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "pick-team" }));
    expect(screen.getByRole("button", { name: "Create view" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "pick-team-id" }));
    expect(screen.getByRole("button", { name: "Create view" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Create view" }));
    await waitFor(() => expect(mocks.createSavedView).toHaveBeenCalled());
    expect(mocks.createSavedView).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: "team",
        sharedWithTeamId: "team-1",
      }),
    );
  });

  it("hands the audience chooser the caller's real capabilities and nothing more", async () => {
    mocks.canShare = true;
    mocks.canManage = false;
    renderIndex();
    expect(mocks.audienceProps).toMatchObject({
      canShare: true,
      canManageSettings: false,
      visibility: "private",
    });
  });

  it("says why a creation was refused when the server answers 403", async () => {
    mocks.createSavedView.mockRejectedValue(new HttpError(403, "no"));
    renderIndex();
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create view" }));
    expect(
      await screen.findByText(translate("savedViews:createForbidden")),
    ).toBeInTheDocument();
  });
});

describe("pinning and duplicating (SV-20, SV-21)", () => {
  it("toggles the viewer's own pin", async () => {
    renderIndex();
    fireEvent.click(
      await screen.findByRole("button", { name: "Unpin Escalations" }),
    );
    await waitFor(() => expect(mocks.toggleSavedViewPin).toHaveBeenCalled());
    expect(mocks.toggleSavedViewPin.mock.calls[0]?.[0]).toBe("v-pinned");
  });

  it("says when a pin could not be changed", async () => {
    mocks.toggleSavedViewPin.mockRejectedValue(new HttpError(404, "x"));
    renderIndex();
    fireEvent.click(
      await screen.findByRole("button", { name: "Pin Everything open" }),
    );
    expect(
      await screen.findByText(translate("savedViews:pinError")),
    ).toBeInTheDocument();
  });

  it("duplicates in one click as a private view, copying the stored query verbatim", async () => {
    renderIndex();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Duplicate Everything open as a private view",
      }),
    );
    await waitFor(() => expect(mocks.createSavedView).toHaveBeenCalled());
    expect(mocks.createSavedView).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      name: "Everything open copy",
      scope: "workspace",
      scopeId: "ws-1",
      visibility: "private",
      layout: "list",
      // A query this screen cannot run is still copied exactly, never rewritten.
      query: { entity: "work_item", groupBy: "state" },
    });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  });
});

describe("deletion is a request (pending action)", () => {
  it("opens the pending action for review and deletes nothing itself", async () => {
    renderIndex();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Request deletion of Escalations",
      }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.requestSavedViewDeletion.mock.calls[0]?.[0]).toBe("v-pinned");
    expect(mocks.navigate.mock.calls[0]?.[0]).toEqual({
      to: "/agent/settings/profile/pending-actions/$id",
      params: { id: "pa-1" },
    });
  });

  it.each([
    [403, "deleteForbidden"],
    [409, "deleteAlreadyRequested"],
    [500, "deleteError"],
  ])(
    "explains a %s answer and leaves the list where it is",
    async (status, key) => {
      mocks.requestSavedViewDeletion.mockRejectedValue(
        new HttpError(status, "x"),
      );
      renderIndex();
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Request deletion of Escalations",
        }),
      );
      expect(
        await screen.findByText(translate(`savedViews:${key}`)),
      ).toBeInTheDocument();
      expect(mocks.navigate).not.toHaveBeenCalled();
      const list = screen.getByRole("region", { name: "Saved views" });
      expect(
        within(list).getByRole("heading", { name: "Escalations" }),
      ).toBeInTheDocument();
    },
  );

  it("disables further requests while one is in flight", async () => {
    let resolve: (value: { pendingActionId: string }) => void = () => {};
    mocks.requestSavedViewDeletion.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderIndex();
    const button = await screen.findByRole("button", {
      name: "Request deletion of Escalations",
    });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(
      screen.getByRole("button", {
        name: "Request deletion of Everything open",
      }),
    ).toBeDisabled();
    await act(async () => resolve({ pendingActionId: "pa-2" }));
  });
});
