import { cleanup, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskRow from "./task-row";

vi.mock("@/store/bulk-selection", () => ({
  default: (selector: (state: { toggleSelection: () => void }) => unknown) =>
    selector({ toggleSelection: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
        focused={false}
        selected={false}
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
        focused
        selected
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
