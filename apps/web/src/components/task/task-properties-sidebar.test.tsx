import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskPropertiesSidebar from "./task-properties-sidebar";

const mocks = vi.hoisted(() => ({
  useGetTask: vi.fn(),
  getTask: vi.fn(),
  useGetProject: vi.fn(),
  useGetColumns: vi.fn(),
  useGetActiveWorkspaceUsers: vi.fn(),
  useGetLabelsByTask: vi.fn(),
  useGetLabelsByWorkspace: vi.fn(),
  useGetProjects: vi.fn(),
  labelPopoverRender: vi.fn(),
  sidebarChromeRender: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({
    t: (key: string) => key,
    ready: true,
    i18n: { language: "en" },
  }),
}));

vi.mock("@taskdesk/ui", async () => {
  const { Button } =
    await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const tooltipProvider = ({ children }: { children: React.ReactNode }) => {
    mocks.sidebarChromeRender();
    return <div>{children}</div>;
  };
  return {
    Badge: passthrough,
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <Button {...props}>{children}</Button>
    ),
    KbdSequence: passthrough,
    Tooltip: passthrough,
    TooltipContent: passthrough,
    TooltipProvider: tooltipProvider,
    TooltipTrigger: passthrough,
  };
});

vi.mock("@/hooks/queries/task/use-get-task", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    default: <TSelected,>(
      taskId: string,
      select: ((task: Task) => TSelected) | undefined,
      enabled = true,
    ) => {
      mocks.useGetTask(taskId, select, enabled);
      return useQuery({
        queryKey: ["task", taskId],
        queryFn: () => mocks.getTask(taskId) as Promise<Task>,
        enabled,
        select,
        staleTime: 60_000,
      });
    },
  };
});
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: (...args: unknown[]) => mocks.useGetProject(...args),
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: (...args: unknown[]) => mocks.useGetColumns(...args),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: (...args: unknown[]) =>
      mocks.useGetActiveWorkspaceUsers(...args),
  }),
);
vi.mock("@/hooks/queries/label/use-get-labels-by-task", () => ({
  default: (...args: unknown[]) => mocks.useGetLabelsByTask(...args),
}));
vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: (...args: unknown[]) => mocks.useGetLabelsByWorkspace(...args),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: (...args: unknown[]) => mocks.useGetProjects(...args),
}));

vi.mock("./task-status-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="status-popover">{children}</div>
  ),
}));
vi.mock("./task-priority-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="priority-popover">{children}</div>
  ),
}));
vi.mock("./task-assignee-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="assignee-popover">{children}</div>
  ),
}));
vi.mock("./task-start-date-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="start-date-popover">{children}</div>
  ),
}));
vi.mock("./task-due-date-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="due-date-popover">{children}</div>
  ),
}));
vi.mock("./task-labels-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    mocks.labelPopoverRender();
    return <div data-testid="labels-popover">{children}</div>;
  },
}));
vi.mock("./task-move-popover", () => ({
  default: () => <div data-testid="move-popover" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const task: Task = {
  id: "task-1",
  title: "Sidebar task",
  number: 1,
  description: null,
  status: "backlog",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  version: 1,
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
};

function setup() {
  mocks.getTask.mockResolvedValue(task);
  mocks.useGetProject.mockReturnValue({ data: { slug: "PRJ" } });
  mocks.useGetColumns.mockReturnValue({
    data: [{ id: "backlog", slug: "backlog", name: "Backlog", isFinal: false }],
  });
  mocks.useGetActiveWorkspaceUsers.mockReturnValue({ data: { members: [] } });
  mocks.useGetLabelsByTask.mockReturnValue({ data: [] });
  mocks.useGetLabelsByWorkspace.mockReturnValue({ data: [] });
  mocks.useGetProjects.mockReturnValue({ data: [] });

  const props = {
    taskId: "task-1",
    projectId: "project-1",
    workspaceId: "workspace-1",
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["task", task.id], task);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = render(<TaskPropertiesSidebar {...props} />, { wrapper });
  return { props, queryClient, ...view };
}

describe("TaskPropertiesSidebar responsive controls", () => {
  it("mounts one instance of each stateful property popover across responsive layouts", () => {
    setup();

    for (const testId of [
      "status",
      "priority",
      "assignee",
      "start-date",
      "due-date",
    ]) {
      expect(screen.getAllByTestId(`${testId}-popover`)).toHaveLength(1);
    }
    expect(screen.getByRole("button", { name: /Backlog/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /tasks:popover\.assignee\.unassigned/,
      }),
    ).toBeInTheDocument();
  });

  it("keeps sidebar chrome out of property-only task updates", async () => {
    const { queryClient } = setup();
    expect(mocks.labelPopoverRender).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(queryClient.getQueryState(["task", task.id])?.fetchStatus).toBe(
        "idle",
      ),
    );
    const chromeRenders = mocks.sidebarChromeRender.mock.calls.length;

    await act(async () => {
      queryClient.setQueryData(["task", task.id], {
        ...task,
        status: "in-progress",
        version: 2,
      });
    });

    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "in-progress",
    );
    expect(mocks.sidebarChromeRender).toHaveBeenCalledTimes(chromeRenders);
    expect(mocks.labelPopoverRender).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status-popover")).toBeInTheDocument();
  });

  it("subscribes only to sidebar fields and the move-availability result", () => {
    setup();
    expect(mocks.useGetTask).toHaveBeenCalledTimes(2);

    const taskSelectors = mocks.useGetTask.mock.calls
      .map((call) => call[1])
      .filter(
        (selector): selector is (value: Task) => unknown =>
          typeof selector === "function",
      );
    const sidebarSelector = taskSelectors.find((selector) => {
      const selected = selector(task);
      return (
        typeof selected === "object" &&
        selected !== null &&
        !("status" in selected)
      );
    }) as ((value: Task) => Record<string, unknown>) | undefined;
    const controlsSelector = taskSelectors.find((selector) => {
      const selected = selector(task);
      return (
        typeof selected === "object" &&
        selected !== null &&
        "status" in selected
      );
    }) as ((value: Task) => Record<string, unknown>) | undefined;
    const projectSelector = mocks.useGetProjects.mock.calls[0]?.[2] as (
      value: Array<{ id: string }>,
    ) => boolean;

    expect(sidebarSelector).toBeDefined();
    expect(sidebarSelector?.(task)).not.toHaveProperty("description");
    expect(sidebarSelector?.(task)).not.toHaveProperty("version");
    expect(sidebarSelector?.(task)).not.toHaveProperty("status");
    expect(sidebarSelector?.(task)).not.toHaveProperty("priority");
    expect(sidebarSelector?.(task)).not.toHaveProperty("userId");

    expect(controlsSelector).toBeDefined();
    expect(controlsSelector?.(task)).toMatchObject({
      status: task.status,
      priority: task.priority,
      userId: task.userId,
      assigneeId: task.assigneeId,
      startDate: task.startDate,
      dueDate: task.dueDate,
    });
    expect(projectSelector([{ id: "project-1" }])).toBe(false);
    expect(projectSelector([{ id: "project-1" }, { id: "project-2" }])).toBe(
      true,
    );
  });
});
