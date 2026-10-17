import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import type { SavedViewUrlSearch } from "@/lib/routes";
import { translate } from "@/test/en-translation";
import SavedViewDetail from "./saved-view-detail";

const mocks = vi.hoisted(() => ({
  getSavedView: vi.fn(),
  getSavedViews: vi.fn(),
  getShareableViewTeams: vi.fn(),
  runSavedView: vi.fn(),
  runSavedViewUrlQuery: vi.fn(),
  countSavedView: vi.fn(),
  createSavedView: vi.fn(),
  updateSavedView: vi.fn(),
  toggleSavedViewPin: vi.fn(),
  getProjects: vi.fn(),
  canShare: false,
  canManage: false,
  editorProps: undefined as Record<string, unknown> | undefined,
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
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canShareSavedViews: () => mocks.canShare,
    canManageWorkspaceSettings: () => mocks.canManage,
  }),
}));
vi.mock("@/fetchers/saved-views", () => ({
  getSavedView: (...args: unknown[]) => mocks.getSavedView(...args),
  getSavedViews: (...args: unknown[]) => mocks.getSavedViews(...args),
  getShareableViewTeams: (...args: unknown[]) =>
    mocks.getShareableViewTeams(...args),
  runSavedView: (...args: unknown[]) => mocks.runSavedView(...args),
  runSavedViewUrlQuery: (...args: unknown[]) =>
    mocks.runSavedViewUrlQuery(...args),
  countSavedView: (...args: unknown[]) => mocks.countSavedView(...args),
  createSavedView: (...args: unknown[]) => mocks.createSavedView(...args),
  updateSavedView: (...args: unknown[]) => mocks.updateSavedView(...args),
  toggleSavedViewPin: (...args: unknown[]) => mocks.toggleSavedViewPin(...args),
}));
vi.mock("@/fetchers/project/get-projects", () => ({
  default: (...args: unknown[]) => mocks.getProjects(...args),
}));
vi.mock("@/components/work-item/work-item-list", () => ({
  default: ({
    workItems,
    isError,
  }: {
    workItems: Array<{ key: string; title: string }>;
    isError: boolean;
  }) =>
    isError ? (
      <div data-testid="list-error" />
    ) : (
      <ul>
        {workItems.map((item) => (
          <li key={item.key}>{item.title}</li>
        ))}
      </ul>
    ),
}));
vi.mock("@/components/saved-view/saved-view-editor", () => ({
  SavedViewEditor: (props: Record<string, unknown>) => {
    mocks.editorProps = props;
    const query = props.query as
      | { onFilterApply: (filter: string) => void }
      | undefined;
    return (
      <div data-testid="editor">
        <button
          type="button"
          onClick={() => (props.onNameChange as (v: string) => void)("Renamed")}
        >
          rename
        </button>
        <button
          type="button"
          onClick={() =>
            (props.onVisibilityChange as (v: string) => void)("workspace")
          }
        >
          workspace
        </button>
        <button
          type="button"
          onClick={() =>
            (props.onVisibilityChange as (v: string) => void)("team")
          }
        >
          team
        </button>
        <button
          type="button"
          onClick={() => (props.onTeamChange as (v: string) => void)("team-1")}
        >
          choose-team
        </button>
        {query ? (
          <button
            type="button"
            onClick={() => query.onFilterApply("priority:low")}
          >
            apply-filter
          </button>
        ) : (
          <span>query-not-editable</span>
        )}
      </div>
    );
  },
}));

const workspaceId = "workspace-1";
const baseView = {
  id: "view-1",
  workspaceId,
  createdBy: "person-1",
  name: "High priority queue",
  scope: "workspace",
  scopeId: workspaceId,
  visibility: "private",
  sharedWithTeamId: null,
  layout: "list",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  query: {
    entity: "work_item",
    filter: { field: "priority", op: "eq", value: "high" },
    sort: [{ field: "key", direction: "asc" }],
  },
};
const storedSearch: SavedViewUrlSearch = {
  workspaceId,
  scope: "workspace",
  scopeId: workspaceId,
  layout: "list",
  filter: "priority:high",
  sort: "key",
  dir: "asc",
};
const page = (titles: string[], total = titles.length) => ({
  items: titles.map((title, index) => ({
    key: `WLP-${index + 1}`,
    title,
    unavailableFields: [],
  })),
  hasPartialFailure: false,
  hasMore: false,
  nextCursor: null,
  total,
});

function renderDetail(
  search: SavedViewUrlSearch,
  handlers: {
    onReplaceSearch?: (search: SavedViewUrlSearch) => void;
    onOpenView?: (id: string, search: SavedViewUrlSearch) => void;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const onReplaceSearch = vi.fn(handlers.onReplaceSearch);
  const onOpenView = vi.fn(handlers.onOpenView);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    <SavedViewDetail
      id="view-1"
      search={search}
      onReplaceSearch={onReplaceSearch}
      onOpenView={onOpenView}
    />,
    { wrapper },
  );
  return { onReplaceSearch, onOpenView };
}

const unreadable = (status: number) =>
  mocks.getSavedView.mockRejectedValue(new HttpError(status, "Unable"));

beforeEach(() => {
  mocks.canShare = false;
  mocks.canManage = false;
  mocks.editorProps = undefined;
  mocks.getSavedView.mockResolvedValue(baseView);
  mocks.getSavedViews.mockResolvedValue([{ ...baseView, isPinned: false }]);
  mocks.getShareableViewTeams.mockResolvedValue([
    { id: "team-1", name: "Service desk" },
  ]);
  mocks.runSavedView.mockResolvedValue(page(["Stored result"], 5));
  mocks.runSavedViewUrlQuery.mockResolvedValue(page(["URL result"], 1));
  mocks.countSavedView.mockResolvedValue(5);
  mocks.getProjects.mockResolvedValue([
    { id: "project-1", slug: "OPS", name: "Ops" },
  ]);
  mocks.createSavedView.mockResolvedValue({ ...baseView, id: "view-copy" });
  mocks.updateSavedView.mockResolvedValue(baseView);
  mocks.toggleSavedViewPin.mockResolvedValue({ pinnedViewIds: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SV-19 saved view the viewer cannot read, complete URL snapshot", () => {
  it.each([403, 404])(
    "runs the URL's definition as the viewer when the view answers %s",
    async (status) => {
      unreadable(status);
      renderDetail({ ...storedSearch, columns: ["key", "title"] });
      expect(await screen.findByText("URL result")).toBeInTheDocument();
      expect(mocks.runSavedViewUrlQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          filter: "priority:high",
          sort: "key",
          dir: "asc",
          columns: ["key", "title"],
        }),
      );
      // The stored view is not run, counted, or even assumed to exist.
      expect(mocks.runSavedView).not.toHaveBeenCalled();
      expect(mocks.countSavedView).not.toHaveBeenCalled();
      expect(screen.getByTestId("saved-view-fallback")).toBeInTheDocument();
      expect(screen.queryByText("loadError")).toBeNull();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Shared view",
      );
      expect(screen.getByText("1 matching work item")).toBeInTheDocument();
    },
  );

  it("offers nothing that needs the view itself: no pin, no edit, but a private copy is possible", async () => {
    unreadable(404);
    renderDetail(storedSearch);
    await screen.findByText("URL result");
    expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit view" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Clone as private view" }),
    ).toBeEnabled();
  });

  it("clones the snapshot it ran into the viewer's own private view", async () => {
    unreadable(404);
    const { onOpenView } = renderDetail(storedSearch);
    await screen.findByText("URL result");
    fireEvent.click(
      screen.getByRole("button", { name: "Clone as private view" }),
    );
    await waitFor(() => expect(mocks.createSavedView).toHaveBeenCalled());
    expect(mocks.createSavedView).toHaveBeenCalledWith({
      workspaceId,
      name: "Shared view copy",
      scope: "workspace",
      scopeId: workspaceId,
      visibility: "private",
      layout: "list",
      query: {
        entity: "work_item",
        filter: { field: "priority", op: "eq", value: "high" },
        sort: [{ field: "key", direction: "asc" }],
      },
    });
    await waitFor(() => expect(onOpenView).toHaveBeenCalled());
    expect(onOpenView.mock.calls[0]?.[0]).toBe("view-copy");
  });

  it("does not enable the URL query for an incomplete snapshot", async () => {
    unreadable(404);
    renderDetail({ workspaceId, filter: "priority:high" });
    expect(
      await screen.findByText(translate("savedViews:viewUnavailable")),
    ).toBeInTheDocument();
    expect(mocks.runSavedViewUrlQuery).not.toHaveBeenCalled();
    expect(mocks.runSavedView).not.toHaveBeenCalled();
    expect(screen.queryByTestId("saved-view-fallback")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Clone as private view" }),
    ).toBeDisabled();
  });

  it("does not treat a server failure as an unreadable view: it asks to retry and runs nothing", async () => {
    unreadable(500);
    renderDetail(storedSearch);
    expect(
      await screen.findByText(translate("savedViews:loadError")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(mocks.runSavedViewUrlQuery).not.toHaveBeenCalled();
    expect(screen.queryByTestId("saved-view-fallback")).toBeNull();
  });

  it("runs nothing for a project the viewer cannot reach, and says so", async () => {
    unreadable(404);
    renderDetail({
      ...storedSearch,
      scope: "project",
      scopeId: "project-elsewhere",
    });
    expect(
      await screen.findByText(translate("savedViews:projectUnavailable")),
    ).toBeInTheDocument();
    expect(mocks.runSavedViewUrlQuery).not.toHaveBeenCalled();
  });

  it("narrows a reachable project snapshot to that project by slug", async () => {
    unreadable(404);
    renderDetail({ ...storedSearch, scope: "project", scopeId: "project-1" });
    await screen.findByText("URL result");
    expect(mocks.runSavedViewUrlQuery).toHaveBeenCalledWith(
      expect.objectContaining({ projectSlug: "OPS" }),
    );
  });

  it("refuses to run a snapshot whose layout this screen cannot render", async () => {
    unreadable(404);
    renderDetail({ ...storedSearch, layout: "board" });
    expect(
      await screen.findByTestId("saved-view-unsupported"),
    ).toBeInTheDocument();
    expect(mocks.runSavedViewUrlQuery).not.toHaveBeenCalled();
  });
});

describe("a saved view the viewer can read", () => {
  it("runs and counts the stored view when the URL is its own definition", async () => {
    renderDetail(storedSearch);
    expect(await screen.findByText("Stored result")).toBeInTheDocument();
    expect(mocks.runSavedView).toHaveBeenCalledWith({
      id: "view-1",
      cursor: undefined,
    });
    await waitFor(() =>
      expect(screen.getByText("5 matching work items")).toBeInTheDocument(),
    );
    expect(mocks.runSavedViewUrlQuery).not.toHaveBeenCalled();
    expect(screen.queryByTestId("saved-view-modified")).toBeNull();
  });

  it("runs a changed URL as a direct search, says it is not the saved definition, and does not count it as the view", async () => {
    renderDetail({ ...storedSearch, filter: "priority:low" });
    expect(await screen.findByText("URL result")).toBeInTheDocument();
    expect(screen.getByTestId("saved-view-modified")).toBeInTheDocument();
    expect(mocks.runSavedView).not.toHaveBeenCalled();
    expect(mocks.countSavedView).not.toHaveBeenCalled();
    expect(screen.getByText("1 matching work item")).toBeInTheDocument();
  });

  it("replaces a bare or incomplete URL with the view's own definition, once", async () => {
    const { onReplaceSearch } = renderDetail({});
    await waitFor(() => expect(onReplaceSearch).toHaveBeenCalledTimes(1));
    expect(onReplaceSearch).toHaveBeenCalledWith({
      ...storedSearch,
      filterMode: undefined,
    });
  });

  it("replaces a URL that names another workspace, scope or layout instead of running it under this name", async () => {
    const { onReplaceSearch } = renderDetail({
      ...storedSearch,
      workspaceId: "workspace-other",
      filter: "priority:urgent",
    });
    await waitFor(() => expect(onReplaceSearch).toHaveBeenCalledTimes(1));
    expect(onReplaceSearch.mock.calls[0]?.[0]).toMatchObject({
      workspaceId,
      filter: "priority:high",
    });
    // What runs meanwhile is the stored definition, never the other workspace's query.
    await screen.findByText("Stored result");
    expect(mocks.runSavedViewUrlQuery).not.toHaveBeenCalled();
  });

  it("does not run, and does not rewrite, a stored query this screen cannot execute", async () => {
    mocks.getSavedView.mockResolvedValue({
      ...baseView,
      query: { entity: "work_item", groupBy: "state" },
    });
    renderDetail({
      ...storedSearch,
      filter: undefined,
      sort: undefined,
      dir: undefined,
    });
    expect(
      await screen.findByTestId("saved-view-unsupported"),
    ).toBeInTheDocument();
    expect(mocks.runSavedView).not.toHaveBeenCalled();
    expect(mocks.runSavedViewUrlQuery).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Clone as private view" }),
    ).toBeDisabled();
    // Renaming and re-sharing stay available, and save leaves the stored query alone.
    fireEvent.click(await screen.findByRole("button", { name: "Edit view" }));
    expect(screen.getByText("query-not-editable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(mocks.updateSavedView).toHaveBeenCalled());
    expect(mocks.updateSavedView).toHaveBeenCalledWith({
      id: "view-1",
      name: "Renamed",
      visibility: "private",
      sharedWithTeamId: null,
    });
  });

  it("shows an explicit unsupported-layout state for a layout it does not render, and runs nothing", async () => {
    mocks.getSavedView.mockResolvedValue({ ...baseView, layout: "board" });
    renderDetail({ ...storedSearch, layout: "board" });
    expect(
      await screen.findByTestId("saved-view-unsupported"),
    ).toBeInTheDocument();
    expect(mocks.runSavedView).not.toHaveBeenCalled();
    expect(mocks.runSavedViewUrlQuery).not.toHaveBeenCalled();
  });
});

describe("editing, sharing, pinning (permissions come from the server)", () => {
  it("saves the name, audience, layout and the query the URL carries", async () => {
    mocks.canManage = true;
    renderDetail({ ...storedSearch, filter: "priority:low" });
    fireEvent.click(await screen.findByRole("button", { name: "Edit view" }));
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    fireEvent.click(screen.getByRole("button", { name: "workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(mocks.updateSavedView).toHaveBeenCalled());
    expect(mocks.updateSavedView).toHaveBeenCalledWith({
      id: "view-1",
      name: "Renamed",
      visibility: "workspace",
      sharedWithTeamId: null,
      layout: "list",
      query: {
        entity: "work_item",
        filter: { field: "priority", op: "eq", value: "low" },
        sort: [{ field: "key", direction: "asc" }],
      },
    });
  });

  it("will not save a team view without its team, and sends the team when chosen", async () => {
    mocks.canShare = true;
    renderDetail(storedSearch);
    fireEvent.click(await screen.findByRole("button", { name: "Edit view" }));
    fireEvent.click(screen.getByRole("button", { name: "team" }));
    expect(screen.getByRole("button", { name: "Save view" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "choose-team" }));
    expect(screen.getByRole("button", { name: "Save view" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(mocks.updateSavedView).toHaveBeenCalled());
    expect(mocks.updateSavedView).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: "team",
        sharedWithTeamId: "team-1",
      }),
    );
  });

  it("passes the viewer's real capabilities to the editor, never widening them", async () => {
    mocks.canShare = false;
    mocks.canManage = false;
    renderDetail(storedSearch);
    fireEvent.click(await screen.findByRole("button", { name: "Edit view" }));
    expect(mocks.editorProps).toMatchObject({
      canShare: false,
      canManageSettings: false,
      currentVisibility: "private",
    });
  });

  it("shows the server's refusal of a save instead of predicting it", async () => {
    mocks.updateSavedView.mockRejectedValue(new HttpError(403, "Forbidden"));
    renderDetail(storedSearch);
    fireEvent.click(await screen.findByRole("button", { name: "Edit view" }));
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(
      await screen.findByText(translate("savedViews:forbidden")),
    ).toBeInTheDocument();
  });

  it("cancelling an edit puts the URL back to the stored definition", async () => {
    const { onReplaceSearch } = renderDetail({
      ...storedSearch,
      filter: "priority:low",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Edit view" }));
    fireEvent.click(screen.getByRole("button", { name: "apply-filter" }));
    expect(onReplaceSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ filter: "priority:low" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(onReplaceSearch).toHaveBeenLastCalledWith(storedSearch);
  });

  it("toggles the viewer's own pin and shows the pinned state from the viewer's list", async () => {
    mocks.getSavedViews.mockResolvedValue([{ ...baseView, isPinned: true }]);
    renderDetail(storedSearch);
    const unpin = await screen.findByRole("button", { name: "Unpin" });
    expect(unpin).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(unpin);
    await waitFor(() =>
      expect(mocks.toggleSavedViewPin).toHaveBeenCalledWith("view-1"),
    );
  });

  it("explains a refused pin or clone as a permission problem", async () => {
    mocks.toggleSavedViewPin.mockRejectedValue(new HttpError(403, "no"));
    renderDetail(storedSearch);
    fireEvent.click(await screen.findByRole("button", { name: "Pin" }));
    expect(
      await screen.findByText(translate("savedViews:forbidden")),
    ).toBeInTheDocument();
  });

  it("clones the displayed definition as a private view and opens it with its own full link", async () => {
    const { onOpenView } = renderDetail(storedSearch);
    await screen.findByText("Stored result");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Clone as private view" }),
      );
    });
    await waitFor(() => expect(onOpenView).toHaveBeenCalled());
    expect(mocks.createSavedView).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "High priority queue copy",
        visibility: "private",
      }),
    );
    expect(onOpenView.mock.calls[0]?.[1]).toMatchObject({
      workspaceId,
      layout: "list",
    });
  });
});

describe("a refused run is explained in translated words", () => {
  it.each([
    [400, "invalid"],
    [403, "forbidden"],
    [422, "unavailable"],
  ])(
    "maps the endpoint's %s to a message and never shows its own text",
    async (status, key) => {
      mocks.runSavedView.mockRejectedValue(
        new HttpError(status, "Filter field unavailable: label"),
      );
      renderDetail(storedSearch);
      const alert = await screen.findByText(
        translate(`savedViews:errors.${key}`),
      );
      expect(alert).toBeInTheDocument();
      expect(screen.queryByText(/Filter field unavailable/u)).toBeNull();
    },
  );
});
