import enUS from "@i18n/en-US.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./calendar";

type SearchRecord = Record<string, unknown>;
type NavigateOptions = {
  to?: string;
  search?: SearchRecord | ((previous: SearchRecord) => SearchRecord);
  replace?: boolean;
  href?: string;
};

const routerState = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => ({ workspaceId: "workspace-1", projectId: "project-1" }),
    useSearch: () => routerState.search,
  }),
  useNavigate: () => routerState.navigate,
  useLocation: () => ({ searchStr: "?month=2026-10&q=urgent" }),
}));

vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({
    data: {
      id: "project-1",
      name: "Roadmap",
      slug: "RM",
      columns: [],
      plannedTasks: [],
      archivedTasks: [],
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));
vi.mock("@taskdesk/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/ui")>()),
  useIsMobile: () => false,
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: { weekStartsOn: number }) => unknown,
  ) => selector({ weekStartsOn: 0 }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: () => undefined,
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
vi.mock("@/components/calendar/month-grid", () => ({
  default: ({ onOpenTask }: { onOpenTask: (taskId: string) => void }) => (
    // ui-exempt: this test double stands in for the calendar's open-task callback.
    <button type="button" onClick={() => onOpenTask("task-9")}>
      open-task
    </button>
  ),
}));
vi.mock("@/components/task/task-details-sheet", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    // ui-exempt: this test double stands in for the task details sheet's close control.
    <button type="button" onClick={onClose}>
      close-sheet
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

const CalendarRoute = (Route as unknown as { component: ComponentType })
  .component;

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
  routerState.search = {
    month: "2026-10",
    q: "urgent",
    status: ["todo"],
    taskId: "task-1",
  };
  routerState.navigate.mockReset();
});
afterEach(cleanup);

describe("project calendar route URL state", () => {
  it("reads the month and search from the URL", () => {
    render(<CalendarRoute />);
    expect(screen.getByPlaceholderText("Search tickets...")).toHaveValue(
      "urgent",
    );
    expect(screen.getByText("October 2026")).toBeInTheDocument();
  });

  it("pushes history for month moves and keeps search, filters and selection", () => {
    render(<CalendarRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    let { options, resolved } = lastNavigation();
    expect(options.replace).toBeUndefined();
    expect(options.to).toBe(
      "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
    );
    expect(resolved).toEqual({
      month: "2026-11",
      q: "urgent",
      status: ["todo"],
      taskId: "task-1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBeUndefined();
    expect(resolved).toMatchObject({ month: "2026-09", q: "urgent" });
  });

  it("returns to the current month by dropping month and pushes history", () => {
    render(<CalendarRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    const { options, resolved } = lastNavigation();
    expect(options.replace).toBeUndefined();
    expect(resolved).toEqual({
      q: "urgent",
      status: ["todo"],
      taskId: "task-1",
    });
  });

  it("replaces history for search typing, clearing, and task selection", () => {
    render(<CalendarRoute />);
    fireEvent.change(screen.getByPlaceholderText("Search tickets..."), {
      target: { value: "123" },
    });
    let { options, resolved } = lastNavigation();
    expect(options.replace).toBe(true);
    expect(resolved).toMatchObject({ q: "123", month: "2026-10" });

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBe(true);
    expect(resolved).not.toHaveProperty("q");

    fireEvent.click(screen.getByText("open-task"));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBe(true);
    expect(resolved).toMatchObject({ taskId: "task-9", month: "2026-10" });

    fireEvent.click(screen.getByText("close-sheet"));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBe(true);
    expect(resolved).not.toHaveProperty("taskId");
    expect(resolved).toMatchObject({ month: "2026-10", q: "urgent" });
  });
});
