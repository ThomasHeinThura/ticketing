import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskCard from "./task-card";

const mocks = vi.hoisted(() => ({
  openContextMenu: vi.fn(),
  openTask: vi.fn(),
  toggleSelection: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

vi.mock("@/store/bulk-selection", () => ({
  default: Object.assign(
    (
      selector: (state: {
        toggleSelection: typeof mocks.toggleSelection;
        selectedTaskIds: Set<string>;
        focusedTaskId: string | null;
      }) => unknown,
    ) => {
      const state = {
        toggleSelection: mocks.toggleSelection,
        selectedTaskIds: new Set<string>(),
        focusedTaskId: null,
      };
      return selector(state);
    },
    {
      getState: () => ({
        toggleSelection: mocks.toggleSelection,
        selectedTaskIds: new Set<string>(),
        focusedTaskId: null,
      }),
    },
  ),
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
      isTaskSelected={false}
      isTaskFocused={false}
      toggleSelection={mocks.toggleSelection}
      onOpenTask={mocks.openTask}
      t={((key: string) => key) as unknown as TFunction}
      workspaceId="workspace-1"
      workspaceUsersById={new Map()}
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

  it("renders board-owned selection state supplied by the parent", () => {
    const props = {
      task,
      taskIsCompleted: false,
      workspaceId: "workspace-1",
      workspaceUsersById: new Map(),
      onContextMenuTask: mocks.openContextMenu,
      displayPreferences,
      isTaskSelected: false,
      isTaskFocused: false,
      toggleSelection: mocks.toggleSelection,
      onOpenTask: mocks.openTask,
      t: ((key: string) => key) as unknown as TFunction,
      projectSlug: "PRJ",
    };
    const { rerender } = render(<TaskCard {...props} />);
    expect(
      screen.getByText("Keyboard task").closest('[role="button"]'),
    ).not.toHaveAttribute("data-task-selected", "true");

    rerender(<TaskCard {...props} isTaskSelected />);
    expect(
      screen.getByText("Keyboard task").closest('[role="button"]'),
    ).toHaveAttribute("data-task-selected", "true");
  });
});
