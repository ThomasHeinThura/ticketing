import enUS from "@i18n/en-US.json";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./board";

type SearchRecord = Record<string, unknown>;
type NavigateOptions = {
  to?: string;
  search?: SearchRecord | ((previous: SearchRecord) => SearchRecord);
  replace?: boolean;
};

const routerState = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  sessionUserId: "user-1" as string | undefined,
  profileViewMode: "board" as "board" | "list",
  shortcuts: undefined as
    | Record<string, Record<string, () => void>>
    | undefined,
}));

const project = {
  id: "project-1",
  name: "Roadmap",
  slug: "RM",
  columns: [
    {
      id: "todo",
      name: "To do",
      tasks: [{ id: "t1", title: "Alpha", number: 1, priority: "low" }],
    },
  ],
  plannedTasks: [],
  archivedTasks: [],
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => ({ workspaceId: "workspace-1", projectId: "project-1" }),
    useSearch: () => routerState.search,
  }),
  useNavigate: () => routerState.navigate,
  useLocation: () => ({ searchStr: "?q=urgent&status=todo" }),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({ data: project }),
}));
vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({ data: [] }),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: [] }),
  }),
);
vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  hasPendingTaskUpdate: () => false,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: routerState.sessionUserId
        ? { user: { id: routerState.sessionUserId } }
        : null,
    }),
  },
}));
vi.mock("@/store/project", () => ({
  default: () => ({ project, setProject: vi.fn() }),
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: { viewMode: "board" | "list" }) => unknown,
  ) => selector({ viewMode: routerState.profileViewMode }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: (config: {
    sequentialShortcuts: Record<string, Record<string, () => void>>;
  }) => {
    routerState.shortcuts = config.sequentialShortcuts;
  },
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({
    children,
    headerActions,
  }: {
    children: ReactNode;
    headerActions?: ReactNode;
  }) => (
    <div>
      {headerActions}
      {children}
    </div>
  ),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/task/task-details-sheet", () => ({
  default: ({ taskId, onClose }: { taskId?: string; onClose: () => void }) => (
    // ui-exempt: this test double stands in for the task details sheet's close control.
    <button type="button" onClick={onClose}>
      close-sheet:{taskId ?? "none"}
    </button>
  ),
}));
vi.mock("@/components/kanban-board", () => ({
  default: () => <div data-testid="kanban" />,
}));
vi.mock("@/components/list-view", () => ({
  default: () => <div data-testid="list-view" />,
}));
vi.mock("@/components/board/board-toolbar", () => {
  const MockButton = ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick: () => void;
  }) => (
    // ui-exempt: this test double stands in for the board toolbar's design-system buttons.
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );
  return {
    default: ({
      viewMode,
      setViewMode,
      onSortChange,
      updateFilter,
      filters,
    }: {
      viewMode: string;
      setViewMode: (mode: "board" | "list") => void;
      onSortChange: (sort: { field: string; direction: string }) => void;
      updateFilter: (key: string, value: string[]) => void;
      filters: { status: string[] };
    }) => (
      <div data-testid="toolbar" data-mode={viewMode}>
        <span data-testid="status-filter">{filters.status.join(",")}</span>
        <MockButton onClick={() => setViewMode("list")}>to-list</MockButton>
        <MockButton onClick={() => setViewMode("board")}>to-board</MockButton>
        <MockButton
          onClick={() => onSortChange({ field: "priority", direction: "desc" })}
        >
          sort
        </MockButton>
        <MockButton onClick={() => updateFilter("status", ["todo"])}>
          filter
        </MockButton>
      </div>
    ),
  };
});

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const [namespace, path] = key.split(":");
      const source = path
        .split(".")
        .reduce<unknown>(
          (accumulator, part) =>
            (accumulator as Record<string, unknown> | undefined)?.[part],
          (enUS as Record<string, unknown>)[namespace],
        );
      if (typeof source !== "string") return key;
      return source.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? `{{${name}}}`),
      );
    },
  }),
}));

const BoardRoute = (Route as unknown as { component: ComponentType }).component;

function render(ui: ReactNode) {
  return rtlRender(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
  );
}

function lastNavigation() {
  const options = routerState.navigate.mock.calls.at(
    -1,
  )?.[0] as NavigateOptions;
  const resolved =
    typeof options.search === "function"
      ? options.search(routerState.search)
      : options.search;
  return { options, resolved };
}

beforeEach(() => {
  routerState.search = { q: "urgent", status: ["todo"], taskId: "t1" };
  routerState.navigate.mockReset();
  routerState.sessionUserId = "user-1";
  routerState.profileViewMode = "board";
  routerState.shortcuts = undefined;
  window.localStorage.clear();
});
afterEach(cleanup);

describe("project board route URL state", () => {
  it("reads search and filters from the URL", () => {
    render(<BoardRoute />);
    expect(screen.getByPlaceholderText("Search tickets...")).toHaveValue(
      "urgent",
    );
    expect(screen.getByTestId("status-filter")).toHaveTextContent("todo");
  });

  it("lets the URL layout win over the remembered and profile layouts", () => {
    window.localStorage.setItem(
      "taskdesk:project-layout:user-1:project-1",
      "list",
    );
    routerState.search = { layout: "board" };
    render(<BoardRoute />);
    expect(screen.getByTestId("toolbar")).toHaveAttribute("data-mode", "board");
    expect(screen.getByTestId("kanban")).toBeInTheDocument();
  });

  it("falls back to the remembered per-project layout, then the profile default", () => {
    routerState.search = {};
    window.localStorage.setItem(
      "taskdesk:project-layout:user-1:project-1",
      "list",
    );
    render(<BoardRoute />);
    expect(screen.getByTestId("toolbar")).toHaveAttribute("data-mode", "list");
    cleanup();

    window.localStorage.clear();
    routerState.profileViewMode = "list";
    render(<BoardRoute />);
    expect(screen.getByTestId("toolbar")).toHaveAttribute("data-mode", "list");
  });

  it("pushes history for a layout move, keeps state and remembers the choice", () => {
    render(<BoardRoute />);
    fireEvent.click(screen.getByText("to-list"));
    const { options, resolved } = lastNavigation();
    expect(options.replace).toBeUndefined();
    expect(options.to).toBe(
      "/dashboard/workspace/$workspaceId/project/$projectId/board",
    );
    expect(resolved).toEqual({
      layout: "list",
      q: "urgent",
      status: ["todo"],
      taskId: "t1",
    });
    expect(
      window.localStorage.getItem("taskdesk:project-layout:user-1:project-1"),
    ).toBe("list");
  });

  it("does not remember a layout without a signed-in user", () => {
    routerState.sessionUserId = undefined;
    render(<BoardRoute />);
    fireEvent.click(screen.getByText("to-list"));
    expect(window.localStorage.length).toBe(0);
    expect(lastNavigation().resolved).toMatchObject({ layout: "list" });
  });

  it("pushes history for sort and filter changes and keeps the search", () => {
    render(<BoardRoute />);
    fireEvent.click(screen.getByText("sort"));
    let { options, resolved } = lastNavigation();
    expect(options.replace).toBeUndefined();
    expect(resolved).toMatchObject({
      sort: "priority",
      dir: "desc",
      q: "urgent",
    });

    fireEvent.click(screen.getByText("filter"));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBeUndefined();
    expect(resolved).toMatchObject({ status: ["todo"], q: "urgent" });
  });

  it("replaces history for search typing, clearing and closing the task sheet", () => {
    render(<BoardRoute />);
    const search = screen.getByPlaceholderText("Search tickets...");
    fireEvent.change(search, { target: { value: "true" } });
    let { options, resolved } = lastNavigation();
    expect(options.replace).toBe(true);
    expect(resolved).toMatchObject({ q: "true", status: ["todo"] });

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBe(true);
    expect(resolved).not.toHaveProperty("q");
    expect(resolved).toMatchObject({ status: ["todo"] });

    fireEvent.click(screen.getByText("close-sheet:t1"));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBe(true);
    expect(resolved).not.toHaveProperty("taskId");
    expect(resolved).toMatchObject({ q: "urgent" });
  });

  it("switches views with shortcuts, keeping the query string and remembering board/list", () => {
    render(<BoardRoute />);
    const view = routerState.shortcuts?.v ?? {};
    view.c();
    view.g();
    view.k();
    view.l();
    expect(
      routerState.navigate.mock.calls.map(
        (call) => (call[0] as { href: string }).href,
      ),
    ).toEqual([
      "/dashboard/workspace/workspace-1/project/project-1/calendar?q=urgent&status=todo",
      "/dashboard/workspace/workspace-1/project/project-1/gantt?q=urgent&status=todo",
      "/dashboard/workspace/workspace-1/project/project-1/backlog?q=urgent&status=todo",
      "/dashboard/workspace/workspace-1/project/project-1/board?q=urgent&status=todo&layout=list",
    ]);
    expect(
      window.localStorage.getItem("taskdesk:project-layout:user-1:project-1"),
    ).toBe("list");
  });
});
