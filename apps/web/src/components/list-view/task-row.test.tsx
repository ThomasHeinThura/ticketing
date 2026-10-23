import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskRow from "./task-row";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
        t={((key: string) => key) as unknown as TFunction}
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
        t={((key: string) => key) as unknown as TFunction}
      />,
    );

    const title = screen.getByText("Row from payload");
    const row = title.closest<HTMLElement>("[data-task-id]");
    expect(row).toHaveAttribute("data-task-id", task.id);
    expect(row).toHaveClass("bg-accent/60", "ring-2");

    title.click();
    expect(onOpenTask).toHaveBeenCalledWith(task.id);
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
      t={((key: string) => key) as unknown as TFunction}
      taskHref="/agent/work/WLP-7"
      disableDragDrop
      isSelected={false}
      onToggleSelection={onToggleSelection}
    />,
  );
  const link = screen.getByRole("link", { name: "WLP-7 Row from payload" });
  expect(link).toHaveAttribute("href", "/agent/work/WLP-7");
  expect(screen.getByText("TE")).toBeInTheDocument();
  const row = link.closest('[role="button"]');
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
      t={((key: string) => key) as unknown as TFunction}
    />,
  );
  const title = screen.getByRole("link", { name: "kan-7 Row from payload" });
  const row = title.closest('[role="button"]');
  expect(row).not.toHaveAttribute("aria-disabled", "true");
  expect(row).toHaveAttribute("tabindex", "0");
  fireEvent.keyDown(title, { key: "Enter" });
  expect(onOpenTask).not.toHaveBeenCalled();
  fireEvent.click(title);
  expect(onOpenTask).toHaveBeenCalledExactlyOnceWith("task-1");
  onOpenTask.mockClear();
  fireEvent.keyDown(row as HTMLElement, { key: "Enter" });
  expect(onOpenTask).toHaveBeenCalledExactlyOnceWith("task-1");
});
