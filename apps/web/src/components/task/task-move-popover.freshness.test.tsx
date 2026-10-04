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
import TaskMovePopover from "./task-move-popover";

const mocks = vi.hoisted(() => ({
  getTasks: vi.fn(),
  moveTask: vi.fn(),
}));

vi.mock("@taskdesk/ui", async () => {
  const React = await import("react");
  const PopoverContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  } | null>(null);
  const SelectContext = React.createContext<{
    onValueChange: (value: string) => void;
    disabled: boolean;
  } | null>(null);
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    Label: ({ children }: { children: React.ReactNode }) => (
      <span>{children}</span>
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
        onClick: () => popover?.onOpenChange(true),
      });
    },
    PopoverContent: ({ children }: { children: React.ReactNode }) => {
      const popover = React.useContext(PopoverContext);
      return popover?.open ? <div>{children}</div> : null;
    },
    Select: ({
      disabled = false,
      onValueChange,
      children,
    }: {
      disabled?: boolean;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={{ onValueChange, disabled }}>
        {children}
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    SelectItem: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: string;
    }) => {
      const select = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => select?.onValueChange(value)}>
          {children}
        </button>
      );
    },
    SelectTrigger: ({
      children,
      disabled: disabledProp,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
    }) => {
      const select = React.useContext(SelectContext);
      return (
        <button
          type="button"
          data-testid="select-trigger"
          disabled={disabledProp || select?.disabled}
        >
          {children}
        </button>
      );
    },
    SelectValue: ({ children }: { children: React.ReactNode }) => (
      <span>{children}</span>
    ),
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [
      { id: "project-current", name: "Current" },
      { id: "project-destination", name: "Destination" },
    ],
  }),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: (projectId: string) => mocks.getTasks(projectId),
}));
vi.mock("@/hooks/mutations/task/use-move-task", () => ({
  useMoveTask: () => ({ mutateAsync: mocks.moveTask, isPending: false }),
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
  projectId: "project-current",
};

describe("TaskMovePopover query cache freshness", () => {
  it("reads the latest status when opened and tracks status changes while open", async () => {
    mocks.getTasks.mockImplementation((projectId: string) => ({
      data:
        projectId === "project-destination"
          ? {
              columns: [{ id: "in-progress", name: "In progress" }],
            }
          : undefined,
      isLoading: false,
      isError: false,
    }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["task", task.id], {
      ...task,
      status: "in-progress",
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TaskMovePopover task={task} workspaceId="workspace-1" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "tasks:move.title" }));
    fireEvent.click(screen.getByRole("button", { name: "Destination" }));

    const statusTrigger = screen.getAllByTestId("select-trigger")[1];
    await waitFor(() => expect(statusTrigger).toBeDisabled());

    await act(async () => {
      queryClient.setQueryData(["task", task.id], {
        ...task,
        status: "done",
        version: 2,
      });
    });

    await waitFor(() => expect(statusTrigger).toBeEnabled());
  });
});
