import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { TFunction } from "i18next";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTaskItemStats } from "@/lib/get-task-item-stats";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskCard, { type TaskCardProps } from "./task-card";

const mocks = vi.hoisted(() => {
  let sortableState: {
    transform: { x: number; y: number; scaleX: number; scaleY: number } | null;
    isDragging: boolean;
  } = { transform: null, isDragging: false };
  const sortableSubscribers = new Set<() => void>();
  return {
    openContextMenu: vi.fn(),
    openTask: vi.fn(),
    getSortableState: () => sortableState,
    subscribeSortable: (callback: () => void) => {
      sortableSubscribers.add(callback);
      return () => sortableSubscribers.delete(callback);
    },
    updateSortableState: (state: typeof sortableState) => {
      sortableState = state;
      for (const subscriber of sortableSubscribers) subscriber();
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.updateSortableState({ transform: null, isDragging: false });
  useBulkSelectionStore.setState({
    selectedTaskIds: new Set(),
    focusedTaskId: null,
  });
});

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => {
    const sortableState = useSyncExternalStore(
      mocks.subscribeSortable,
      mocks.getSortableState,
      mocks.getSortableState,
    );
    return {
      attributes: { role: "button", tabIndex: 0 },
      listeners: {},
      setNodeRef: vi.fn(),
      transform: sortableState.transform,
      transition: undefined,
      isDragging: sortableState.isDragging,
    };
  },
}));

vi.mock("@/lib/get-task-item-stats", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/get-task-item-stats")
  >("@/lib/get-task-item-stats");
  return {
    ...actual,
    getTaskItemStats: vi.fn(actual.getTaskItemStats),
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@taskdesk/ui", async () => {
  const { Avatar, AvatarFallback, AvatarImage, Badge, Button } =
    await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
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
    Avatar,
    AvatarFallback,
    AvatarImage,
    Badge,
    Button,
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
  it("keeps presentation work out of sortable hook updates until props change", () => {
    const taskWithChecklist = {
      ...task,
      userId: "user-1",
      description: "- [ ] first\n- [x] second",
      externalLinks: [
        {
          id: "pr-1",
          taskId: "task-1",
          externalId: "42",
          url: "https://github.com/example/project/pull/42",
          resourceType: "pull_request",
          metadata: { draft: true },
          title: "Draft change",
        },
      ],
    } as Task;
    const statsSpy = vi.mocked(getTaskItemStats);
    statsSpy.mockClear();
    const initialPreferences = {
      ...displayPreferences,
      showTaskItemCounts: true,
    };
    const initialAssignee = {
      user: { name: "Alice", image: "https://example.test/alice.png" },
    } as NonNullable<TaskCardProps["assignee"]>;
    const initialTranslator = ((key: string) => key) as unknown as TFunction;
    const props: TaskCardProps = {
      task: taskWithChecklist,
      projectSlug: "PRJ",
      taskIsCompleted: false,
      displayPreferences: initialPreferences,
      isSelected: false,
      isFocused: false,
      onOpenTask: mocks.openTask,
      t: initialTranslator,
      workspaceId: "workspace-1",
      assignee: initialAssignee,
      onContextMenuTask: mocks.openContextMenu,
    };

    const view = render(<TaskCard {...props} />);

    expect(statsSpy).toHaveBeenCalledTimes(1);
    const card = screen.getByText("Keyboard task").closest('[role="button"]');
    expect(card).not.toBeNull();
    act(() => {
      mocks.updateSortableState({
        transform: { x: 12, y: 24, scaleX: 1, scaleY: 1 },
        isDragging: true,
      });
    });

    expect(card).toHaveAttribute("data-task-dragging", "true");
    expect(card).toHaveStyle({
      transform: "translate3d(12px, 24px, 0) scaleX(1) scaleY(1)",
    });
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(statsSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "tasks:pr.draft pull request #42" }),
    ).toBeInTheDocument();

    const localizedTranslator = ((key: string) =>
      key === "tasks:pr.draft"
        ? "Draft pull request"
        : key) as unknown as TFunction;
    view.rerender(<TaskCard {...props} t={localizedTranslator} />);
    expect(
      screen.getByRole("button", {
        name: "Draft pull request pull request #42",
      }),
    ).toBeInTheDocument();
    expect(statsSpy).toHaveBeenCalledTimes(2);

    const updatedTask = {
      ...taskWithChecklist,
      title: "Updated task title",
      description: "- [x] completed",
      labels: [{ id: "label-1", name: "Urgent", color: "red" }],
      externalLinks: [
        {
          ...taskWithChecklist.externalLinks?.[0],
          metadata: { merged: true },
        },
      ],
    } as Task;
    const updatedPreferences = {
      ...initialPreferences,
      showLabels: true,
      showTaskNumbers: true,
      showAssignees: true,
    };
    const updatedAssignee = {
      user: { name: "Bob", image: "https://example.test/bob.png" },
    } as NonNullable<TaskCardProps["assignee"]>;
    const mergedTranslator = ((key: string) =>
      key === "tasks:pr.merged" ? "Merged" : key) as unknown as TFunction;
    view.rerender(
      <TaskCard
        {...props}
        task={updatedTask}
        displayPreferences={updatedPreferences}
        assignee={updatedAssignee}
        t={mergedTranslator}
      />,
    );
    expect(screen.getByText("Updated task title")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByText("PRJ-1")).toBeInTheDocument();
    expect(screen.getByText("BO")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Merged pull request #42" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1/1")).toBeInTheDocument();
    expect(statsSpy).toHaveBeenCalledTimes(3);

    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    fireEvent.click(
      screen.getByRole("button", { name: "Merged pull request #42" }),
    );
    expect(openWindow).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/example/project/pull/42",
      "_blank",
    );
    expect(mocks.openTask).not.toHaveBeenCalled();
  });

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

  it("exposes the pull request state in the single pull request action name", () => {
    const pullRequestTask = {
      ...task,
      externalLinks: [
        {
          id: "pr-1",
          externalId: "42",
          url: "https://github.com/example/project/pull/42",
          resourceType: "pull_request",
          metadata: { draft: true },
          title: "Draft change",
        },
      ],
    } as unknown as Task;
    render(
      <TaskCard
        task={pullRequestTask}
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

    expect(
      screen.getByRole("button", {
        name: "tasks:pr.draft pull request #42",
      }),
    ).toBeInTheDocument();
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
