import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const state = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  hookArgs: undefined as Record<string, unknown> | undefined,
  hookError: undefined as unknown,
  panelProps: undefined as Record<string, unknown> | undefined,
  controlsProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/work-item/work-item-create-trigger", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-create-dialog-shell", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-selection-toggle", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-list-loading", () => ({
  default: () => <div data-testid="list-loading" />,
}));
vi.mock("@/components/work-item/work-items-panel", () => ({
  default: (props: Record<string, unknown>) => {
    state.panelProps = props;
    return <div data-testid="panel" />;
  },
}));
vi.mock("@/components/work-item/work-item-board-view", () => ({
  default: () => <div data-testid="board" />,
}));
vi.mock("@/components/work-item/work-item-list-controls", () => ({
  default: (props: Record<string, unknown>) => {
    state.controlsProps = props;
    return <div data-testid="controls" />;
  },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws_1" }, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [{ id: "proj_1", slug: "WLP", name: "Wallop", workspaceId: "ws_1" }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-items", () => ({
  default: (args: Record<string, unknown>) => {
    state.hookArgs = args;
    return {
      data: { items: [], hasPartialFailure: false, hasMore: false },
      isLoading: false,
      isError: state.hookError !== undefined,
      error: state.hookError,
      refetch: vi.fn(),
    };
  },
}));

import { Route } from "./work";

async function renderRoute() {
  const Component = Route.options.component as () => React.JSX.Element;
  const view = render(<Component />);
  await screen.findByTestId(
    state.search.layout === "board" ? "board" : "panel",
  );
  return view;
}

/** Calls a callback prop the mocked controls captured, failing loudly if never rendered. */
function callControl(name: string, ...args: unknown[]) {
  const fn = state.controlsProps?.[name];
  if (typeof fn !== "function") throw new Error(`prop ${name} not captured`);
  fn(...args);
}

function navigatedSearch(
  call = 0,
  prev: Record<string, unknown> = state.search,
) {
  const update = state.navigate.mock.calls[call]?.[0] as {
    search: (prev: Record<string, unknown>) => Record<string, unknown>;
    replace?: boolean;
  };
  return { next: update.search(prev), replace: update.replace };
}

beforeEach(() => {
  state.search = { layout: "list", sort: "key", dir: "asc" };
  state.hookArgs = undefined;
  state.hookError = undefined;
  state.panelProps = undefined;
  state.controlsProps = undefined;
  state.navigate.mockReset();
  vi.spyOn(Route, "useParams").mockReturnValue({ projectKey: "WLP" } as never);
  vi.spyOn(Route, "useSearch").mockImplementation(
    (() => state.search) as never,
  );
  vi.spyOn(Route, "useNavigate").mockReturnValue(state.navigate as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("work route structured filter (SV-11, SV-12, VW-1)", () => {
  it("validates the search with the shared parser, keeping filter, mode and columns", () => {
    const validate = Route.options.validateSearch;
    if (typeof validate !== "function")
      throw new Error("the work route must validate its search");
    const parsed = validate({
      filter: "priority:high",
      filterMode: "text",
      columns: ["key", "state"],
      sort: "title",
    } as never);
    expect(parsed).toEqual({
      layout: "list",
      sort: "title",
      dir: "asc",
      filter: "priority:high",
      filterMode: "text",
      columns: ["key", "state"],
    });
  });

  it("reads through the list route when no filter is set, and keeps the editor unloaded", async () => {
    await renderRoute();
    expect(state.hookArgs).toMatchObject({
      projectId: "proj_1",
      projectSlug: "WLP",
      workspaceId: "ws_1",
      filter: undefined,
    });
    expect(state.panelProps?.isFiltered).toBe(false);
    expect(screen.queryByTestId("controls")).toBeNull();
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("passes the URL filter, columns and scope to the read and the panel, and opens the editor", async () => {
    state.search = {
      layout: "list",
      sort: "priority",
      dir: "desc",
      filter: "assignee:@me",
      filterMode: "text",
      columns: ["key", "priority"],
    };
    await renderRoute();
    expect(state.hookArgs).toMatchObject({
      projectId: "proj_1",
      projectSlug: "WLP",
      workspaceId: "ws_1",
      filter: "assignee:@me",
      sort: "priority",
      dir: "desc",
      columns: ["key", "priority"],
    });
    expect(state.panelProps).toMatchObject({
      isFiltered: true,
      columns: ["key", "priority"],
    });
    await screen.findByTestId("controls");
    expect(state.controlsProps).toMatchObject({
      filter: "assignee:@me",
      mode: "text",
    });
    // A filtered list never looks unfiltered, even with the editor collapsed (VW-34).
    expect(
      screen.getByRole("button", { name: "Filter (on)" }),
    ).toBeInTheDocument();
  });

  it("opens and closes the editor from the Filter control", async () => {
    await renderRoute();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await screen.findByTestId("controls");
    expect(state.controlsProps?.mode).toBe("visual");
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await waitFor(() => expect(screen.queryByTestId("controls")).toBeNull());
  });

  it("applying a filter navigates (a history entry) and keeps sort, columns and mode", async () => {
    state.search = {
      layout: "list",
      sort: "priority",
      dir: "desc",
      columns: ["key", "priority"],
      filterMode: "text",
    };
    await renderRoute();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await screen.findByTestId("controls");
    callControl("onApply", "priority:high");
    const { next, replace } = navigatedSearch();
    expect(replace).toBeUndefined();
    expect(next).toEqual({
      layout: "list",
      sort: "priority",
      dir: "desc",
      columns: ["key", "priority"],
      filterMode: "text",
      filter: "priority:high",
    });
  });

  it("applying an empty filter removes it from the URL", async () => {
    state.search = {
      layout: "list",
      sort: "key",
      dir: "asc",
      filter: "priority:high",
    };
    await renderRoute();
    await screen.findByTestId("controls");
    callControl("onApply", "   ");
    expect(navigatedSearch().next.filter).toBeUndefined();
  });

  it("switching the editor mode navigates and keeps the filter text", async () => {
    state.search = {
      layout: "list",
      sort: "key",
      dir: "asc",
      filter: "assignee:@me",
    };
    await renderRoute();
    await screen.findByTestId("controls");
    callControl("onModeChange", "text");
    const { next, replace } = navigatedSearch();
    expect(replace).toBeUndefined();
    expect(next).toMatchObject({ filter: "assignee:@me", filterMode: "text" });
  });

  it("hands the read's error to the editor so a refused filter is explained beside it", async () => {
    const error = new Error("refused");
    state.hookError = error;
    state.search = {
      layout: "list",
      sort: "key",
      dir: "asc",
      filter: "label:urgent",
    };
    await renderRoute();
    await screen.findByTestId("controls");
    expect(state.controlsProps?.workItemsError).toBe(error);
  });

  it("the board does not apply the filter and says so instead of looking unfiltered", async () => {
    state.search = {
      layout: "board",
      sort: "key",
      dir: "asc",
      filter: "priority:high",
    };
    await renderRoute();
    expect(screen.getByTestId("board-filter-notice")).toHaveTextContent(
      translate("workItems:filter.boardNotice"),
    );
    expect(screen.queryByRole("button", { name: /^Filter/ })).toBeNull();
    expect(screen.queryByTestId("controls")).toBeNull();
  });

  it("offers no export control (F3 hold)", async () => {
    state.search = { layout: "list", sort: "key", dir: "asc", filter: "x" };
    await renderRoute();
    await screen.findByTestId("controls");
    expect(
      screen.queryByRole("button", { name: /export|download/i }),
    ).toBeNull();
  });
});
