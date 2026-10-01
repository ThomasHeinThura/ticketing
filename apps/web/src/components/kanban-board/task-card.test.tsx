import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskCard from "./task-card";

const mocks = vi.hoisted(() => ({
  openContextMenu: vi.fn(),
  navigate: vi.fn(),
  useSortable: vi.fn(),
}));

const displayPreferences = {
  showAssignees: false,
  showPriority: false,
  showDueDates: false,
  showLabels: false,
  showTaskNumbers: false,
  showTaskItemCounts: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useBulkSelectionStore.getState().clearSelection();
  useBulkSelectionStore.getState().clearFocus();
});

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => {
    mocks.useSortable();
    return {
      attributes: { role: "button", tabIndex: 0 },
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false,
    };
  },
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@taskdesk/ui", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    AlertDialog: passthrough,
    AlertDialogClose: passthrough,
    AlertDialogContent: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogTitle: passthrough,
    Button: passthrough,
    Badge: passthrough,
    HoverCard: passthrough,
    HoverCardContent: passthrough,
    HoverCardTrigger: passthrough,
  };
});

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/store/project", () => ({
  default: () => ({
    project: { id: "project-1", slug: "PRJ", columns: [] },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const task = {
  id: "task-1",
  title: "Keyboard task",
  number: 1,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  version: 1,
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
} as const satisfies Task;

const populatedTask = {
  ...task,
  description: "- [ ] first\n- [x] second",
  dueDate: "2099-01-01T00:00:00.000Z",
  labels: [{ id: "label-1", name: "Customer", color: "blue" }],
  priority: "high",
  userId: "assignee-1",
} satisfies Task;

const otherTask = { ...task, id: "task-2", title: "Second task" };

function renderTaskCard(preferences = displayPreferences) {
  const result = render(
    <TaskCard
      task={task}
      workspaceId="workspace-1"
      workspaceUsers={undefined}
      onContextMenuTask={mocks.openContextMenu}
      projectSlug="PRJ"
      taskIsCompleted={false}
      displayPreferences={preferences}
    />,
  );
  return {
    ...result,
    card: () => screen.getByText("Keyboard task").closest('[role="button"]'),
  };
}

describe("TaskCard keyboard context menu", () => {
  it("G10: opens the focused card menu with Shift+F10", () => {
    const { card } = renderTaskCard();

    expect(card()).not.toBeNull();
    fireEvent.keyDown(card() as HTMLElement, { key: "F10", shiftKey: true });

    expect(mocks.openContextMenu).toHaveBeenCalledExactlyOnceWith("task-1");
  });

  it("G10: opens the focused card menu with the ContextMenu key", () => {
    const { card } = renderTaskCard();

    expect(card()).not.toBeNull();
    fireEvent.keyDown(card() as HTMLElement, { key: "ContextMenu" });

    expect(mocks.openContextMenu).toHaveBeenCalledExactlyOnceWith("task-1");
  });

  it("WI-24: updates project labels and display preferences from the board snapshot", () => {
    const { rerender } = renderTaskCard();

    expect(screen.queryByText("PRJ-1")).not.toBeInTheDocument();

    rerender(
      <TaskCard
        task={task}
        workspaceId="workspace-1"
        workspaceUsers={undefined}
        onContextMenuTask={mocks.openContextMenu}
        projectSlug="OPS"
        taskIsCompleted={false}
        displayPreferences={{ ...displayPreferences, showTaskNumbers: true }}
      />,
    );

    expect(screen.getByText("OPS-1")).toBeInTheDocument();
  });

  it("WI-24: applies all card display preferences without changing task identity", () => {
    const { rerender } = render(
      <TaskCard
        task={populatedTask}
        workspaceId="workspace-1"
        workspaceUsers={undefined}
        onContextMenuTask={mocks.openContextMenu}
        projectSlug="OPS"
        taskIsCompleted={false}
        displayPreferences={displayPreferences}
      />,
    );

    expect(screen.queryByText("OPS-1")).not.toBeInTheDocument();
    expect(screen.queryByText("Customer")).not.toBeInTheDocument();
    expect(screen.queryByText("1/2")).not.toBeInTheDocument();

    rerender(
      <TaskCard
        task={populatedTask}
        workspaceId="workspace-1"
        workspaceUsers={undefined}
        onContextMenuTask={mocks.openContextMenu}
        projectSlug="OPS"
        taskIsCompleted={false}
        displayPreferences={{
          showAssignees: true,
          showPriority: true,
          showDueDates: true,
          showLabels: true,
          showTaskNumbers: true,
          showTaskItemCounts: true,
        }}
      />,
    );

    expect(screen.getByText("OPS-1")).toBeInTheDocument();
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("Jan 1")).toBeInTheDocument();
    expect(screen.getByText("??")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("WI-24: opens the task link when activated by keyboard", () => {
    const { card } = renderTaskCard();

    fireEvent.keyDown(card() as HTMLElement, { key: "Enter" });

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: ".",
      search: { taskId: "task-1" },
    });
  });

  it("WI-24: reflects selected and focused state for the matching task", () => {
    const { card } = renderTaskCard();

    act(() => {
      useBulkSelectionStore.getState().selectTask("task-1");
      useBulkSelectionStore.getState().setFocusedTask("task-1");
    });

    expect(card()).toHaveClass("bg-accent/50");
    expect(card()).toHaveClass("ring-2");
  });

  it("WI-24: keeps card renders stable when the board snapshot is unchanged", () => {
    const renderCards = (revision: number) => (
      <div data-board-revision={revision}>
        {[task, otherTask].map((boardTask) => (
          <TaskCard
            key={boardTask.id}
            task={boardTask}
            workspaceId="workspace-1"
            workspaceUsers={undefined}
            onContextMenuTask={mocks.openContextMenu}
            projectSlug="PRJ"
            taskIsCompleted={false}
            displayPreferences={displayPreferences}
          />
        ))}
      </div>
    );
    const { rerender } = render(renderCards(1));
    const initialCalls = mocks.useSortable.mock.calls.length;

    rerender(renderCards(2));

    expect(mocks.useSortable).toHaveBeenCalledTimes(initialCalls);
    expect(screen.getByText("Keyboard task")).toBeInTheDocument();
    expect(screen.getByText("Second task")).toBeInTheDocument();
  });
});
