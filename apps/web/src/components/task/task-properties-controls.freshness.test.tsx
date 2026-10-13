import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskPropertiesControls from "./task-properties-controls";

const mocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  updateTask: vi.fn(),
  propertyControlRenders: vi.fn(),
}));

vi.mock("@taskdesk/ui", async () => {
  const React = await import("react");
  const { Button } =
    await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
  const PopoverContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  } | null>(null);
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <Button {...props}>{children}</Button>
    ),
    Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => (
      <Button
        type="button"
        onClick={() => onSelect(new Date("2026-10-12T00:00:00.000Z"))}
      >
        Choose date
      </Button>
    ),
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: React.ReactNode;
    }) => (
      <PopoverContext.Provider value={{ open, onOpenChange }}>
        {children}
      </PopoverContext.Provider>
    ),
    PopoverTrigger: ({
      children,
    }: {
      children: React.ReactElement<{
        onClick?: React.MouseEventHandler<HTMLButtonElement>;
      }>;
    }) => {
      const popover = React.useContext(PopoverContext);
      return React.cloneElement(children, {
        onClick: (event) => {
          children.props.onClick?.(event);
          popover?.onOpenChange(true);
        },
      });
    },
    PopoverContent: ({ children }: { children: React.ReactNode }) => {
      const popover = React.useContext(PopoverContext);
      return popover?.open ? <div>{children}</div> : null;
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    ready: true,
    i18n: { language: "en" },
  }),
}));
vi.mock("@/fetchers/task/get-task", () => ({
  default: (...args: unknown[]) => mocks.getTask(...args),
}));
vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: mocks.updateTask }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    select: (state: { weekStartsOn: number }) => number,
  ) => select({ weekStartsOn: 1 }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/avatar", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  AvatarImage: () => null,
}));
vi.mock("@/components/task/task-status-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    mocks.propertyControlRenders();
    return <div>{children}</div>;
  },
}));
vi.mock("@/components/task/task-priority-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    mocks.propertyControlRenders();
    return <div>{children}</div>;
  },
}));
vi.mock("@/components/task/task-assignee-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    mocks.propertyControlRenders();
    return <div>{children}</div>;
  },
}));
vi.mock("@/components/task/task-due-date-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    mocks.propertyControlRenders();
    return <div>{children}</div>;
  },
}));
vi.mock("@/lib/column", () => ({ getColumnIcon: () => null }));
vi.mock("@/lib/due-date-status", () => ({
  dueDateStatusColors: {},
  getDueDateStatus: () => "far-future",
  isTaskCompleted: () => false,
}));
vi.mock("@/lib/format", () => ({ formatDateShort: (value: string) => value }));
vi.mock("@/lib/get-initials", () => ({
  getInitials: (value: string) => value,
}));
vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (value: string) => value,
  getStatusDisplayLabel: (value: string, name?: string) => name ?? value,
}));
vi.mock("@/lib/priority", () => ({ getPriorityIcon: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const task: Task = {
  id: "task-1",
  title: "Original title",
  number: 1,
  description: "Original description",
  status: "backlog",
  priority: "low",
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

function mount(currentTask: Task) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["task", currentTask.id], currentTask);
  mocks.getTask.mockResolvedValue(currentTask);
  const controls = (taskId: string) => (
    <>
      <TaskPropertiesControls
        taskId={taskId}
        columns={[]}
        workspaceUsers={{ members: [] }}
        compact={false}
        columnsLoading={false}
        columnsError={false}
      />
    </>
  );
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = render(controls(currentTask.id), { wrapper });
  return { queryClient, controls, ...view };
}

function startDateButton(buttons: Array<HTMLElement>) {
  const button = buttons[0];
  if (!button) throw new Error("Start date control did not render");
  return button;
}

describe("WI-7a: task property mutation freshness", () => {
  it("updates the controls from their focused property subscription", async () => {
    const { queryClient } = mount(task);
    await screen.findByRole("button", { name: "backlog" });
    await waitFor(() =>
      expect(queryClient.getQueryState(["task", task.id])?.fetchStatus).toBe(
        "idle",
      ),
    );

    await act(async () => {
      queryClient.setQueryData(["task", task.id], {
        ...task,
        status: "in-progress",
        version: 2,
      });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "in-progress" }),
      ).toBeInTheDocument(),
    );
  });

  it("uses the full task cache version after an omitted description update", async () => {
    const { queryClient } = mount(task);
    const dateButtons = await screen.findAllByRole("button", {
      name: "tasks:properties.noDate",
    });
    await waitFor(() =>
      expect(queryClient.getQueryState(["task", task.id])?.fetchStatus).toBe(
        "idle",
      ),
    );
    const rendersBeforeCacheUpdate =
      mocks.propertyControlRenders.mock.calls.length;

    const updatedTask = {
      ...task,
      title: "Updated title",
      description: "Updated description",
      version: 2,
    };
    await act(async () => {
      queryClient.setQueryData(["task", task.id], updatedTask);
    });
    expect(queryClient.getQueryData<Task>(["task", task.id])?.version).toBe(2);
    expect(mocks.propertyControlRenders).toHaveBeenCalledTimes(
      rendersBeforeCacheUpdate,
    );

    fireEvent.click(startDateButton(dateButtons));
    fireEvent.click(screen.getByRole("button", { name: "Choose date" }));

    await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledTimes(1));
    expect(mocks.updateTask).toHaveBeenCalledWith({
      ...updatedTask,
      startDate: "2026-10-12T00:00:00.000Z",
    });
  });

  it("resets the mutation snapshot when task and project identity changes", async () => {
    const { queryClient, controls, rerender } = mount(task);
    await screen.findAllByRole("button", {
      name: "tasks:properties.noDate",
    });
    const nextTask: Task = {
      ...task,
      id: "task-2",
      title: "Next task",
      description: "Next description",
      projectId: "project-2",
      version: 7,
    };
    queryClient.setQueryData(["task", nextTask.id], nextTask);
    mocks.getTask.mockResolvedValue(nextTask);
    rerender(controls(nextTask.id));

    fireEvent.click(
      startDateButton(
        await screen.findAllByRole("button", {
          name: "tasks:properties.noDate",
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose date" }));

    await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledTimes(1));
    expect(mocks.updateTask).toHaveBeenCalledWith({
      ...nextTask,
      startDate: "2026-10-12T00:00:00.000Z",
    });
  });
});
