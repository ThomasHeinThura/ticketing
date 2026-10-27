import { Button } from "@taskdesk/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import { isDeferredKeyboardSensorEvent } from "../kanban-board/task-card";
import TaskRow from "./task-row";

const dndMocks = vi.hoisted(() => ({
  isDragging: false,
  keyDown: vi.fn(),
  mouseDown: vi.fn(),
  touchStart: vi.fn(),
  pointerDown: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {
      role: "button",
      tabIndex: 0,
      "aria-disabled": false,
      "aria-pressed": false,
      "aria-roledescription": "sortable",
      "aria-describedby": "dnd-instructions",
    },
    listeners: {
      onKeyDown: dndMocks.keyDown,
      onMouseDown: dndMocks.mouseDown,
      onTouchStart: dndMocks.touchStart,
      onPointerDown: dndMocks.pointerDown,
    },
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: dndMocks.isDragging,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const mockT = ((key: string, options?: Record<string, unknown>) => {
  if (key === "common:a11y.taskContainerLabel")
    return `Task ${options?.key}: ${options?.title}`;
  if (key === "common:a11y.taskOpenAndDragHint")
    return "Press Enter to open. Press Space to start dragging, then use the arrow keys to move.";
  if (key === "common:a11y.taskOpenHint")
    return "Press Enter or Space to open.";
  return key;
}) as unknown as TFunction;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  dndMocks.isDragging = false;
  useBulkSelectionStore.setState({
    selectedTaskIds: new Set(),
    focusedTaskId: null,
  });
});

const task: Task = {
  id: "task-1",
  title: "Row from payload",
  number: 7,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 1,
  createdAt: "2026-08-05T00:00:00.000Z",
  version: 1,
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
  labels: [{ id: "label-1", name: "Bug", color: "purple" }],
  externalLinks: [
    {
      id: "link-1",
      taskId: "task-1",
      resourceType: "pull_request",
      externalId: "42",
      url: "https://github.com/o/r/pull/42",
      title: "Fix it",
      metadata: { merged: false, draft: false },
    },
  ],
};

describe("TaskRow", () => {
  it("renders row details from its shared parent-provided context", () => {
    render(
      <TaskRow
        task={task}
        projectSlug="kan"
        taskIsCompleted={false}
        displayPreferences={{
          showAssignees: true,
          showPriority: true,
          showDueDates: true,
          showLabels: true,
          showTaskNumbers: true,
        }}
        onOpenTask={vi.fn()}
        t={mockT}
      />,
    );

    expect(screen.getByText("Bug")).toBeVisible();
    expect(screen.getByText("#42")).toBeVisible();
    expect(screen.getByText("Row from payload")).toBeVisible();
    expect(screen.getByText("kan-7")).toBeVisible();
  });

  it("keeps focus, selection, and row opening behavior on the memoized row", async () => {
    const onOpenTask = vi.fn();
    useBulkSelectionStore.setState({
      selectedTaskIds: new Set([task.id]),
      focusedTaskId: task.id,
    });
    render(
      <TaskRow
        task={task}
        projectSlug="kan"
        taskIsCompleted={false}
        displayPreferences={{
          showAssignees: true,
          showPriority: true,
          showDueDates: true,
          showLabels: true,
          showTaskNumbers: true,
        }}
        onOpenTask={onOpenTask}
        t={mockT}
      />,
    );

    const title = screen.getByText("Row from payload");
    const row = title.closest<HTMLElement>("[data-task-id]");
    expect(row).toHaveAttribute("data-task-id", task.id);
    expect(row).toHaveClass("bg-accent/60", "ring-2");
    const activator = title.closest<HTMLElement>("fieldset");
    expect(activator).toHaveAccessibleName("Task kan-7: Row from payload");

    title.click();
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(task.id);
    onOpenTask.mockClear();
    fireEvent.keyDown(activator as HTMLElement, { key: "Enter" });
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(task.id);
  });
});

it("keeps canonical links, person assignment and selection separate from legacy task state", () => {
  const onToggleSelection = vi.fn();
  render(
    <TaskRow
      task={{
        ...task,
        assigneeId: "person-1",
        assigneeName: "Thomas Example",
        externalLinks: [],
      }}
      projectSlug="WLP"
      taskIsCompleted={false}
      displayPreferences={{
        showAssignees: true,
        showPriority: false,
        showDueDates: false,
        showLabels: false,
        showTaskNumbers: true,
      }}
      onOpenTask={vi.fn()}
      t={mockT}
      taskHref="/agent/work/WLP-7"
      disableDragDrop
      isSelected={false}
      onToggleSelection={onToggleSelection}
    />,
  );
  const link = screen.getByRole("link", { name: "WLP-7 Row from payload" });
  expect(link).toHaveAttribute("href", "/agent/work/WLP-7");
  expect(screen.getByText("TE")).toBeInTheDocument();
  const row = link.closest("fieldset");
  if (!row) throw new Error("Expected Kaneo task row");
  fireEvent.click(row, { ctrlKey: true });
  expect(onToggleSelection).toHaveBeenCalledOnce();
  expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
});

it("keeps canonical non-draggable rows keyboard-accessible and lets their native title link own Enter", () => {
  const onOpenTask = vi.fn();
  render(
    <TaskRow
      task={task}
      projectSlug="kan"
      taskIsCompleted={false}
      disableDragDrop
      taskHref="/agent/work-items/KAN-7"
      openTaskOnLinkClick
      displayPreferences={{
        showAssignees: false,
        showPriority: false,
        showDueDates: false,
        showLabels: false,
        showTaskNumbers: true,
      }}
      onOpenTask={onOpenTask}
      t={mockT}
    />,
  );
  const title = screen.getByRole("link", { name: "kan-7 Row from payload" });
  const row = title.closest("fieldset");
  expect(row?.tagName).toBe("FIELDSET");
  expect(row).toHaveAccessibleName("Task kan-7: Row from payload");
  expect(row).toHaveAttribute("tabindex", "0");
  const hintId = row?.getAttribute("aria-describedby");
  expect(hintId).toBeTruthy();
  expect(document.getElementById(hintId ?? "")).toHaveTextContent(
    "Press Enter or Space to open.",
  );
  fireEvent.keyDown(title, { key: "Enter" });
  expect(onOpenTask).not.toHaveBeenCalled();
  fireEvent.click(title);
  expect(onOpenTask).toHaveBeenCalledExactlyOnceWith("task-1");
  onOpenTask.mockClear();
  fireEvent.keyDown(row as HTMLElement, { key: "Enter" });
  expect(onOpenTask).toHaveBeenCalledExactlyOnceWith("task-1");
  onOpenTask.mockClear();
  fireEvent.keyDown(row as HTMLElement, { key: " " });
  expect(onOpenTask).toHaveBeenCalledExactlyOnceWith("task-1");
});

it("opens with Enter while idle and reserves keyboard drag keys while dragging", () => {
  const onOpenTask = vi.fn();
  const props = {
    task,
    projectSlug: "kan",
    taskIsCompleted: false,
    displayPreferences: {
      showAssignees: false,
      showPriority: false,
      showDueDates: false,
      showLabels: false,
      showTaskNumbers: true,
    },
    onOpenTask,
    t: mockT,
  };

  render(<TaskRow {...props} />);
  let row = screen.getByText("Row from payload").closest("fieldset");
  if (!row) throw new Error("Expected task row");

  fireEvent.keyDown(row, { key: "Enter" });
  expect(onOpenTask).toHaveBeenCalledExactlyOnceWith("task-1");
  onOpenTask.mockClear();

  cleanup();
  dndMocks.isDragging = true;
  render(<TaskRow {...props} />);
  row = screen.getByText("Row from payload").closest("fieldset");
  if (!row) throw new Error("Expected task row");
  fireEvent.keyDown(row, { key: "Enter" });
  expect(onOpenTask).not.toHaveBeenCalled();
  expect(dndMocks.keyDown).toHaveBeenCalledWith(
    expect.objectContaining({ key: "Enter" }),
  );
});

it("replays an early active-row arrow once after the keyboard sensor attaches", async () => {
  dndMocks.isDragging = true;
  render(
    <TaskRow
      task={task}
      projectSlug="kan"
      taskIsCompleted={false}
      displayPreferences={{
        showAssignees: false,
        showPriority: false,
        showDueDates: false,
        showLabels: false,
        showTaskNumbers: true,
      }}
      onOpenTask={vi.fn()}
      t={mockT}
    />,
  );
  const row = screen.getByText("Row from payload").closest("fieldset");
  if (!row) throw new Error("Expected task row");
  const replayed: KeyboardEvent[] = [];
  row.addEventListener("keydown", (event) => {
    if (isDeferredKeyboardSensorEvent(event as KeyboardEvent))
      replayed.push(event as KeyboardEvent);
  });

  fireEvent.keyDown(row, { key: "ArrowDown", code: "ArrowDown" });
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  expect(replayed).toHaveLength(1);
  expect(replayed[0]?.code).toBe("ArrowDown");
  expect(dndMocks.keyDown).toHaveBeenCalledOnce();
});

it("keeps inline controls out of row opening and sortable pointer/keyboard handlers", () => {
  const onOpenTask = vi.fn();
  const onInlineClick = vi.fn();
  render(
    <TaskRow
      task={task}
      projectSlug="kan"
      taskIsCompleted={false}
      displayPreferences={{
        showAssignees: true,
        showPriority: true,
        showDueDates: false,
        showLabels: false,
        showTaskNumbers: true,
      }}
      onOpenTask={onOpenTask}
      t={mockT}
      stateControl={
        <Button type="button" onClick={onInlineClick}>
          State editor
        </Button>
      }
      priorityControl={<Button type="button">Priority editor</Button>}
      assigneeControl={<Button type="button">Assignee editor</Button>}
    />,
  );

  const state = screen.getByRole("button", { name: "State editor" });
  fireEvent.pointerDown(state);
  fireEvent.mouseDown(state);
  fireEvent.touchStart(state);
  fireEvent.keyDown(state, { key: " " });
  fireEvent.click(state);
  expect(onInlineClick).toHaveBeenCalledOnce();
  expect(onOpenTask).not.toHaveBeenCalled();
  expect(dndMocks.keyDown).not.toHaveBeenCalled();
  expect(dndMocks.mouseDown).not.toHaveBeenCalled();
  expect(dndMocks.touchStart).not.toHaveBeenCalled();
  expect(dndMocks.pointerDown).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText("Row from payload"));
  expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(task.id);
});

it("P1R2-1: ignores clicks and drag starts React bubbles up from portalled picker content", () => {
  const onOpenTask = vi.fn();
  const onOption = vi.fn();
  render(
    <TaskRow
      task={task}
      projectSlug="kan"
      taskIsCompleted={false}
      displayPreferences={{
        showAssignees: true,
        showPriority: true,
        showDueDates: false,
        showLabels: false,
        showTaskNumbers: true,
      }}
      onOpenTask={onOpenTask}
      t={mockT}
      priorityControl={createPortal(
        <Button type="button" onClick={onOption}>
          Urgent option
        </Button>,
        document.body,
      )}
    />,
  );

  const option = screen.getByRole("button", { name: "Urgent option" });
  fireEvent.pointerDown(option);
  fireEvent.mouseDown(option);
  fireEvent.touchStart(option);
  fireEvent.click(option);
  expect(onOption).toHaveBeenCalledOnce();
  expect(onOpenTask).not.toHaveBeenCalled();
  expect(dndMocks.pointerDown).not.toHaveBeenCalled();
  expect(dndMocks.mouseDown).not.toHaveBeenCalled();
  expect(dndMocks.touchStart).not.toHaveBeenCalled();
});
