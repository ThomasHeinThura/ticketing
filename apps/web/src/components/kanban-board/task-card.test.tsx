import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskCard from "./task-card";

const mocks = vi.hoisted(() => ({
  openContextMenu: vi.fn(),
  openTask: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  useBulkSelectionStore.setState({
    selectedTaskIds: new Set(),
    focusedTaskId: null,
  });
});

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: { role: "button", tabIndex: 0 },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
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
    HoverCard: passthrough,
    HoverCardContent: passthrough,
    HoverCardTrigger: passthrough,
  };
});

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: Object.assign(
    () => ({
      showAssignees: false,
      showPriority: false,
      showDueDates: false,
      showLabels: false,
      showTaskNumbers: false,
      showTaskItemCounts: false,
    }),
    {
      getState: () => ({
        showAssignees: false,
        showPriority: false,
        showDueDates: false,
        showLabels: false,
        showTaskNumbers: false,
        showTaskItemCounts: false,
      }),
    },
  ),
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

function renderTaskCard() {
  render(
    <TaskCard
      task={task}
      projectSlug="PRJ"
      taskIsCompleted={false}
      displayPreferences={displayPreferences}
      isSelected={false}
      isFocused={false}
      onOpenTask={mocks.openTask}
      t={((key: string) => key) as unknown as TFunction}
      workspaceId="workspace-1"
      assignee={undefined}
      onContextMenuTask={mocks.openContextMenu}
    />,
  );
  return screen.getByText("Keyboard task").closest('[role="button"]');
}

const displayPreferences = {
  showAssignees: false,
  showPriority: false,
  showDueDates: false,
  showLabels: false,
  showTaskNumbers: false,
  showTaskItemCounts: false,
};

describe("TaskCard keyboard context menu", () => {
  it("G10: opens the focused card menu with Shift+F10", () => {
    const card = renderTaskCard();

    expect(card).not.toBeNull();
    fireEvent.keyDown(card as HTMLElement, { key: "F10", shiftKey: true });

    expect(mocks.openContextMenu).toHaveBeenCalledExactlyOnceWith("task-1");
  });

  it("G10: opens the focused card menu with the ContextMenu key", () => {
    const card = renderTaskCard();

    expect(card).not.toBeNull();
    fireEvent.keyDown(card as HTMLElement, { key: "ContextMenu" });

    expect(mocks.openContextMenu).toHaveBeenCalledExactlyOnceWith("task-1");
  });

  it("delegates opening the task sheet to the board owner", () => {
    const card = renderTaskCard();

    fireEvent.click(card as HTMLElement);

    expect(mocks.openTask).toHaveBeenCalledExactlyOnceWith("task-1");
  });

  it("keeps modifier-click selection actions connected to the shared store", () => {
    const card = renderTaskCard();
    fireEvent.click(card as HTMLElement, { ctrlKey: true });
    expect(useBulkSelectionStore.getState().selectedTaskIds.has("task-1")).toBe(
      true,
    );
    expect(mocks.openTask).not.toHaveBeenCalled();
  });

  it("does not register a global store listener for each mounted card", () => {
    const subscribe = vi.spyOn(useBulkSelectionStore, "subscribe");
    renderTaskCard();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("renders projected selection and focus state from the board", () => {
    const props = {
      task,
      taskIsCompleted: false,
      workspaceId: "workspace-1",
      assignee: undefined,
      onContextMenuTask: mocks.openContextMenu,
      displayPreferences,
      isSelected: false,
      isFocused: false,
      onOpenTask: mocks.openTask,
      t: ((key: string) => key) as unknown as TFunction,
      projectSlug: "PRJ",
    };
    const view = render(<TaskCard {...props} />);
    expect(
      screen.getByText("Keyboard task").closest('[role="button"]'),
    ).not.toHaveAttribute("data-task-selected", "true");

    view.rerender(<TaskCard {...props} isSelected={true} isFocused={true} />);
    expect(
      screen.getByText("Keyboard task").closest('[role="button"]'),
    ).toHaveAttribute("data-task-selected", "true");
    expect(
      screen.getByText("Keyboard task").closest('[role="button"]'),
    ).toHaveClass("ring-2");
  });

  it("keeps the label spacing without an empty wrapper when labels are absent", () => {
    const { container } = render(
      <TaskCard
        task={task}
        projectSlug="PRJ"
        taskIsCompleted={false}
        displayPreferences={{ ...displayPreferences, showLabels: true }}
        isSelected={false}
        isFocused={false}
        onOpenTask={mocks.openTask}
        t={((key: string) => key) as unknown as TFunction}
        workspaceId="workspace-1"
        assignee={undefined}
        onContextMenuTask={mocks.openContextMenu}
      />,
    );

    expect(
      container.querySelectorAll('.group > [class~="mb-2.5"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('.kanban-board-task-card > [class*="gap-1.5"]'),
    ).toBeNull();
    expect(screen.getByText("Keyboard task")).toBeInTheDocument();
  });

  it("preserves the visible no-priority marker when priority display is enabled", () => {
    const { container } = render(
      <TaskCard
        task={task}
        projectSlug="PRJ"
        taskIsCompleted={false}
        displayPreferences={{ ...displayPreferences, showPriority: true }}
        isSelected={false}
        isFocused={false}
        onOpenTask={mocks.openTask}
        t={((key: string) => key) as unknown as TFunction}
        workspaceId="workspace-1"
        assignee={undefined}
        onContextMenuTask={mocks.openContextMenu}
      />,
    );

    const metadataRow = container.querySelector(
      '.kanban-board-task-card > [class*="gap-1.5"]',
    );
    expect(metadataRow).not.toBeNull();
    expect(metadataRow?.querySelector("svg")).not.toBeNull();
  });
});
