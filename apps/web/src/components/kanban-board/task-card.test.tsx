import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskCard from "./task-card";

const mocks = vi.hoisted(() => ({
  openContextMenu: vi.fn(),
  openTask: vi.fn(),
  dragStart: vi.fn(),
  dragKeyDown: vi.fn(),
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
  useSortable: ({ disabled }: { disabled: boolean }) => ({
    attributes: { role: "button", tabIndex: 0, "aria-disabled": disabled },
    listeners: { onPointerDown: mocks.dragStart, onKeyDown: mocks.dragKeyDown },
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@taskdesk/ui", async () => {
  const { Button, Avatar, AvatarFallback, AvatarImage } =
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
    Button,
    Avatar,
    AvatarFallback,
    AvatarImage,
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

describe("canonical work-item card", () => {
  it("keeps a non-draggable canonical card and its native link enabled without drag activators", () => {
    render(
      <TaskCard
        task={task}
        disableDragDrop
        taskHref="/agent/work-items/PRJ-1"
        projectSlug="PRJ"
        taskIsCompleted={false}
        displayPreferences={displayPreferences}
        isSelected={false}
        isFocused={false}
        onOpenTask={mocks.openTask}
        t={((key: string) => key) as unknown as TFunction}
        onContextMenuTask={mocks.openContextMenu}
      />,
    );
    const link = screen.getByRole("link", { name: "PRJ-1 Keyboard task" });
    const card = link.closest('[role="button"]');
    if (!(card instanceof HTMLElement))
      throw new Error("Expected enabled card");
    expect(card).not.toHaveAttribute("aria-disabled");
    expect(link.closest('[aria-disabled="true"]')).toBeNull();
    expect(card).toHaveAttribute("tabindex", "0");
    link.focus();
    expect(link).toHaveFocus();
    // The link's Enter default remains available; the card must not intercept or open a second task.
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(true);
    expect(mocks.openTask).not.toHaveBeenCalled();
    const nativeClick = vi.fn((event: MouseEvent) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });
    link.addEventListener("click", nativeClick);
    fireEvent.click(link);
    expect(nativeClick).toHaveBeenCalledOnce();
    fireEvent.pointerDown(card);
    fireEvent.keyDown(card, { key: " " });
    expect(mocks.dragStart).not.toHaveBeenCalled();
    expect(mocks.dragKeyDown).not.toHaveBeenCalled();
    card.focus();
    fireEvent.keyDown(card, { key: "Enter" });
    expect(mocks.openTask).toHaveBeenCalledExactlyOnceWith(task.id);
  });
  it("preserves enabled legacy drag activators", () => {
    const card = renderTaskCard();
    if (!(card instanceof HTMLElement)) throw new Error("Expected card");
    fireEvent.pointerDown(card);
    fireEvent.keyDown(card, { key: " " });
    expect(mocks.dragStart).toHaveBeenCalledOnce();
    expect(mocks.dragKeyDown).toHaveBeenCalledOnce();
  });

  it("renders person assignment and delegates selection without touching the legacy task selection store", () => {
    const onToggleSelection = vi.fn();
    render(
      <TaskCard
        task={{
          ...task,
          assigneeId: "person-9",
          assigneeName: "Thomas Example",
        }}
        projectSlug="PRJ"
        taskIsCompleted={false}
        displayPreferences={{ ...displayPreferences, showAssignees: true }}
        isSelected={false}
        isFocused={false}
        onOpenTask={mocks.openTask}
        t={((key: string) => key) as unknown as TFunction}
        taskHref="/agent/work/PRJ-1"
        onContextMenuTask={mocks.openContextMenu}
        onToggleSelection={onToggleSelection}
      />,
    );
    const link = screen.getByRole("link", { name: "PRJ-1 Keyboard task" });
    expect(link).toHaveAttribute("href", "/agent/work/PRJ-1");
    expect(screen.getByText("TE")).toBeInTheDocument();
    const card = link.closest('[role="button"]');
    if (!card) throw new Error("Expected Kaneo card button");
    fireEvent.click(card, { ctrlKey: true });
    expect(onToggleSelection).toHaveBeenCalledOnce();
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
  });
});
