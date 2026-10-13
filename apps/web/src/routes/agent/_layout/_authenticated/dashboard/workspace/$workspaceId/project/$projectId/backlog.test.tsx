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
import { Route } from "./backlog";

type SearchRecord = Record<string, unknown>;
type NavigateOptions = {
  search?: SearchRecord | ((previous: SearchRecord) => SearchRecord);
  replace?: boolean;
  href?: string;
};

const routerState = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  shortcuts: undefined as
    | Record<string, Record<string, () => void>>
    | undefined,
}));

const project = {
  id: "project-1",
  name: "Roadmap",
  slug: "RM",
  columns: [],
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
  useLocation: () => ({ searchStr: "?q=urgent&priority=high" }),
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
  default: () => ({ mutate: vi.fn() }),
  useUpdateTask: () => ({ mutate: vi.fn() }),
  hasPendingTaskUpdate: () => false,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));
vi.mock("@/store/project", () => ({
  default: () => ({ project, setProject: vi.fn() }),
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: { weekStartsOn: number }) => unknown,
  ) => selector({ weekStartsOn: 0 }),
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
vi.mock("@/components/backlog-list-view", () => ({ default: () => null }));
vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: () => null,
}));
vi.mock("@/components/task/task-details-sheet", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    // ui-exempt: this test double stands in for the task details sheet's close control.
    <button type="button" onClick={onClose}>
      close-sheet
    </button>
  ),
}));
vi.mock("@/components/common/sort-control", () => ({
  default: ({
    onSortChange,
  }: {
    onSortChange: (sort: { field: string; direction: string }) => void;
  }) => (
    // ui-exempt: this test double stands in for the sort control.
    <button
      type="button"
      onClick={() => onSortChange({ field: "title", direction: "desc" })}
    >
      sort
    </button>
  ),
}));
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

const BacklogRoute = (Route as unknown as { component: ComponentType })
  .component;

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
  routerState.search = { q: "urgent", priority: ["high"], taskId: "t1" };
  routerState.navigate.mockReset();
  routerState.shortcuts = undefined;
  window.localStorage.clear();
});
afterEach(cleanup);

describe("project backlog route URL state", () => {
  it("reads the search from the URL", () => {
    render(<BacklogRoute />);
    expect(screen.getByPlaceholderText("Search tickets...")).toHaveValue(
      "urgent",
    );
  });

  it("replaces history for search typing, clearing and closing the sheet", () => {
    render(<BacklogRoute />);
    fireEvent.change(screen.getByPlaceholderText("Search tickets..."), {
      target: { value: "42" },
    });
    let { options, resolved } = lastNavigation();
    expect(options.replace).toBe(true);
    expect(resolved).toMatchObject({ q: "42", priority: ["high"] });

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBe(true);
    expect(resolved).not.toHaveProperty("q");

    fireEvent.click(screen.getByText("close-sheet"));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBe(true);
    expect(resolved).not.toHaveProperty("taskId");
    expect(resolved).toMatchObject({ q: "urgent" });
  });

  it("pushes history for sort changes and keeps search and filters", () => {
    render(<BacklogRoute />);
    fireEvent.click(screen.getByText("sort"));
    const { options, resolved } = lastNavigation();
    expect(options.replace).toBeUndefined();
    expect(resolved).toMatchObject({
      sort: "title",
      dir: "desc",
      q: "urgent",
      priority: ["high"],
    });
  });

  it("switches views with shortcuts keeping the query string", () => {
    render(<BacklogRoute />);
    const view = routerState.shortcuts?.v ?? {};
    view.b();
    view.c();
    expect(
      routerState.navigate.mock.calls.map(
        (call) => (call[0] as { href: string }).href,
      ),
    ).toEqual([
      "/dashboard/workspace/workspace-1/project/project-1/board?q=urgent&priority=high&layout=board",
      "/dashboard/workspace/workspace-1/project/project-1/calendar?q=urgent&priority=high",
    ]);
    expect(
      window.localStorage.getItem("taskdesk:project-layout:user-1:project-1"),
    ).toBe("board");
  });
});
