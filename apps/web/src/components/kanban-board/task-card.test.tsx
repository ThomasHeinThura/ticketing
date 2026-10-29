import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { createContext, useContext, useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskCard, {
  deferKeyboardSensorEndKey,
  deferKeyboardSensorKey,
  isDeferredKeyboardSensorEvent,
} from "./task-card";

const SortableUpdate = createContext(0);

const mocks = vi.hoisted(() => ({
  openContextMenu: vi.fn(),
  openTask: vi.fn(),
  dragStart: vi.fn(),
  dragKeyDown: vi.fn(),
  isDragging: false,
  transformX: 0,
  ref: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.isDragging = false;
  mocks.transformX = 0;
  useBulkSelectionStore.setState({
    selectedTaskIds: new Set(),
    focusedTaskId: null,
  });
});

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: ({ disabled }: { disabled: boolean }) => {
    useContext(SortableUpdate);
    return {
      attributes: useMemo(
        () => ({
          role: "button",
          tabIndex: 0,
          "aria-disabled": disabled,
          "aria-pressed": false,
          "aria-roledescription": "sortable",
          "aria-describedby": "dnd-instructions",
        }),
        [disabled],
      ),
      listeners: useMemo(
        () => ({
          onPointerDown: mocks.dragStart,
          onKeyDown: mocks.dragKeyDown,
        }),
        [],
      ),
      setNodeRef: mocks.ref,
      transform: { x: mocks.transformX, y: 0, scaleX: 1, scaleY: 1 },
      transition: undefined,
      isDragging: mocks.isDragging,
    };
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@taskdesk/ui", async () => {
  const {
    Button,
    Fieldset,
    FieldsetLegend,
    Avatar,
    AvatarFallback,
    AvatarImage,
  } = await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
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
    Fieldset,
    FieldsetLegend,
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
      t={mockT}
      workspaceId="workspace-1"
      assignee={undefined}
      onContextMenuTask={mocks.openContextMenu}
    />,
  );
  return screen.getByText("Keyboard task").closest("fieldset");
}

const mockT = ((key: string, options?: Record<string, unknown>) => {
  if (key === "common:a11y.taskContainerLabel")
    return `Task ${options?.key}: ${options?.title}`;
  if (key === "common:a11y.taskOpenAndDragHint")
    return "Press Enter to open. Press Space to start dragging, then use the arrow keys to move.";
  if (key === "common:a11y.taskOpenHint")
    return "Press Enter or Space to open.";
  return key;
}) as unknown as TFunction;

const displayPreferences = {
  showAssignees: false,
  showPriority: false,
  showDueDates: false,
  showLabels: false,
  showTaskNumbers: false,
  showTaskItemCounts: false,
};

describe("TaskCard keyboard context menu", () => {
  it("suppresses deferred Escape for disconnected or inactive cards and marks replay", async () => {
    const disconnected = document.createElement("fieldset");
    disconnected.dataset.taskDragging = "true";
    document.body.append(disconnected);
    const disconnectedDispatch = vi.spyOn(disconnected, "dispatchEvent");
    deferKeyboardSensorEndKey(
      disconnected,
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    disconnected.remove();

    const inactive = document.createElement("fieldset");
    inactive.dataset.taskDragging = "true";
    document.body.append(inactive);
    const inactiveDispatch = vi.spyOn(inactive, "dispatchEvent");
    deferKeyboardSensorEndKey(
      inactive,
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    delete inactive.dataset.taskDragging;

    const active = document.createElement("fieldset");
    active.dataset.taskDragging = "true";
    document.body.append(active);
    const replays: KeyboardEvent[] = [];
    active.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (!isDeferredKeyboardSensorEvent(keyboardEvent)) return;
      replays.push(keyboardEvent);
      deferKeyboardSensorEndKey(active, keyboardEvent);
    });
    deferKeyboardSensorEndKey(
      active,
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(disconnectedDispatch).not.toHaveBeenCalled();
    expect(inactiveDispatch).not.toHaveBeenCalled();
    expect(replays).toHaveLength(1);
    expect(isDeferredKeyboardSensorEvent(replays[0] as KeyboardEvent)).toBe(
      true,
    );
  });

  it("replays one unhandled arrow with its keyboard modifiers and repeat flag", async () => {
    const card = document.createElement("fieldset");
    card.dataset.taskDragging = "true";
    document.body.append(card);
    const replays: KeyboardEvent[] = [];
    card.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (isDeferredKeyboardSensorEvent(keyboardEvent))
        replays.push(keyboardEvent);
    });

    deferKeyboardSensorKey(
      card,
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        bubbles: true,
        cancelable: true,
        altKey: true,
        ctrlKey: true,
        metaKey: true,
        shiftKey: true,
        repeat: true,
      }),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(replays).toHaveLength(1);
    expect(replays[0]).toMatchObject({
      key: "ArrowDown",
      code: "ArrowDown",
      altKey: true,
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
      repeat: true,
    });
    card.remove();
  });

  it("does not replay an arrow already handled by the sensor", async () => {
    const card = document.createElement("fieldset");
    card.dataset.taskDragging = "true";
    document.body.append(card);
    const dispatch = vi.spyOn(card, "dispatchEvent");
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      code: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    deferKeyboardSensorKey(card, event);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(dispatch).not.toHaveBeenCalled();
    card.remove();
  });

  it("replays fast arrows in order before the configured Space drop", async () => {
    mocks.isDragging = true;
    const card = renderTaskCard();
    if (!card) throw new Error("Expected task card");
    const sensorEvents: string[] = [];
    let overKey = "PERF-1863";

    // Match KeyboardSensor's attach order: listener installation is queued after Space
    // starts a drag, then the card queues the early Arrow and Space for replay.
    window.setTimeout(() => {
      card.addEventListener("keydown", (event) => {
        if (isDeferredKeyboardSensorEvent(event as KeyboardEvent)) {
          const keyboardEvent = event as KeyboardEvent;
          if (keyboardEvent.code === "ArrowDown") {
            overKey = overKey === "PERF-1863" ? "PERF-7972" : "PERF-6219";
            sensorEvents.push(`over:${overKey}`);
          }
          if (keyboardEvent.code === "ArrowUp") {
            overKey = "PERF-7972";
            sensorEvents.push(`over:${overKey}`);
          }
          if (keyboardEvent.code === "Space")
            sensorEvents.push(`drop:${overKey}`);
        }
      });
    }, 0);
    fireEvent.keyDown(card, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(card, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(card, { key: "ArrowUp", code: "ArrowUp" });
    fireEvent.keyDown(card, { key: " ", code: "Space" });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(sensorEvents).toEqual([
      "over:PERF-7972",
      "over:PERF-6219",
      "over:PERF-7972",
      "drop:PERF-7972",
    ]);
  });

  it("does not replay arrows for disconnected or inactive cards", async () => {
    const disconnected = document.createElement("fieldset");
    disconnected.dataset.taskDragging = "true";
    document.body.append(disconnected);
    const disconnectedDispatch = vi.spyOn(disconnected, "dispatchEvent");
    deferKeyboardSensorKey(
      disconnected,
      new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown" }),
    );
    disconnected.remove();

    const inactive = document.createElement("fieldset");
    inactive.dataset.taskDragging = "true";
    document.body.append(inactive);
    const inactiveDispatch = vi.spyOn(inactive, "dispatchEvent");
    deferKeyboardSensorKey(
      inactive,
      new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown" }),
    );
    delete inactive.dataset.taskDragging;
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(disconnectedDispatch).not.toHaveBeenCalled();
    expect(inactiveDispatch).not.toHaveBeenCalled();
    inactive.remove();
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
    mocks.openTask.mockClear();
    mocks.dragKeyDown.mockClear();
    fireEvent.keyDown(card as HTMLElement, { key: "Enter" });
    expect(mocks.openTask).toHaveBeenCalledExactlyOnceWith("task-1");
    expect(mocks.dragKeyDown).toHaveBeenCalledOnce();
    mocks.openTask.mockClear();
    mocks.dragKeyDown.mockClear();
    fireEvent.keyDown(card as HTMLElement, { key: " " });
    expect(mocks.openTask).not.toHaveBeenCalled();
    expect(mocks.dragKeyDown).toHaveBeenCalledOnce();
  });

  it("does not open the task or change selection during a keyboard drag", () => {
    mocks.isDragging = true;
    const card = renderTaskCard();

    fireEvent.keyDown(card as HTMLElement, { key: "Enter" });
    expect(mocks.openTask).not.toHaveBeenCalled();
    fireEvent.keyDown(card as HTMLElement, { key: "Escape" });
    expect(useBulkSelectionStore.getState().selectedTaskIds.has("task-1")).toBe(
      false,
    );
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
      t: mockT,
      projectSlug: "PRJ",
    };
    const view = render(<TaskCard {...props} />);
    const card = screen.getByText("Keyboard task").closest("fieldset");
    expect(card).toHaveAccessibleName("Task PRJ-1: Keyboard task");
    expect(card).toHaveAttribute("aria-roledescription", "sortable");
    const descriptions = card?.getAttribute("aria-describedby")?.split(" ");
    expect(descriptions).toContain("dnd-instructions");
    const keyboardHintId = descriptions?.at(-1);
    expect(keyboardHintId).toBeTruthy();
    expect(document.getElementById(keyboardHintId ?? "")).toHaveTextContent(
      "Press Enter to open. Press Space to start dragging",
    );
    expect(card).not.toHaveAttribute("aria-pressed");
    expect(card).not.toHaveAttribute("data-task-selected", "true");

    view.rerender(<TaskCard {...props} isSelected={true} isFocused={true} />);
    const updatedCard = screen.getByText("Keyboard task").closest("fieldset");
    expect(updatedCard).toHaveAttribute("data-task-selected", "true");
    expect(updatedCard).toHaveClass("ring-2");
  });

  it("skips unchanged sortable transforms but renders changed coordinates and task data", () => {
    const translate = vi.fn(mockT);
    const props = {
      task,
      projectSlug: "PRJ",
      taskIsCompleted: false,
      displayPreferences,
      isSelected: false,
      isFocused: false,
      onOpenTask: mocks.openTask,
      onContextMenuTask: mocks.openContextMenu,
      t: translate,
    };
    const view = render(
      <SortableUpdate.Provider value={1}>
        <TaskCard {...props} />
      </SortableUpdate.Provider>,
    );
    const card = screen.getByText("Keyboard task").closest("fieldset");
    translate.mockClear();
    view.rerender(
      <SortableUpdate.Provider value={2}>
        <TaskCard {...props} />
      </SortableUpdate.Provider>,
    );
    expect(translate).not.toHaveBeenCalled();
    mocks.transformX = 12;
    view.rerender(
      <SortableUpdate.Provider value={3}>
        <TaskCard {...props} />
      </SortableUpdate.Provider>,
    );
    expect(translate).toHaveBeenCalled();
    expect(screen.getByText("Keyboard task").closest("fieldset")).toHaveStyle({
      transform: "translate3d(12px, 0px, 0) scaleX(1) scaleY(1)",
    });
    view.rerender(
      <SortableUpdate.Provider value={4}>
        <TaskCard {...props} task={{ ...task, title: "Updated task" }} />
      </SortableUpdate.Provider>,
    );
    expect(screen.getByText("Updated task")).toBeInTheDocument();
    expect(screen.getByText("Updated task").closest("fieldset")).toBe(card);
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
        t={mockT}
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
        t={mockT}
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
        t={mockT}
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
        t={mockT}
        onContextMenuTask={mocks.openContextMenu}
      />,
    );
    const link = screen.getByRole("link", { name: "PRJ-1 Keyboard task" });
    const card = link.closest("fieldset");
    if (!(card instanceof HTMLElement))
      throw new Error("Expected enabled task card");
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
    expect(mocks.openTask).toHaveBeenCalledExactlyOnceWith(task.id);
    mocks.openTask.mockClear();
    card.focus();
    fireEvent.keyDown(card, { key: "Enter" });
    expect(mocks.openTask).toHaveBeenCalledExactlyOnceWith(task.id);
    mocks.openTask.mockClear();
    fireEvent.keyDown(card, { key: " " });
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
        t={mockT}
        taskHref="/agent/work/PRJ-1"
        onContextMenuTask={mocks.openContextMenu}
        onToggleSelection={onToggleSelection}
      />,
    );
    const link = screen.getByRole("link", { name: "PRJ-1 Keyboard task" });
    expect(link).toHaveAttribute("href", "/agent/work/PRJ-1");
    expect(screen.getByText("TE")).toBeInTheDocument();
    const card = link.closest("fieldset");
    if (!card) throw new Error("Expected Kaneo task card group");
    fireEvent.click(card, { ctrlKey: true });
    expect(onToggleSelection).toHaveBeenCalledOnce();
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
  });
});
