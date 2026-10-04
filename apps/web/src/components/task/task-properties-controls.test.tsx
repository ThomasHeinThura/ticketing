import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import type { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import type Task from "@/types/task";
import TaskPropertiesControls from "./task-properties-controls";

const renders = vi.hoisted(() => ({
  status: vi.fn(),
  priority: vi.fn(),
  assignee: vi.fn(),
  startDate: vi.fn(),
  dueDate: vi.fn(),
  dueStartDates: [] as Array<string | null>,
}));
const translations = vi.hoisted(() => ({
  ready: true,
  language: "en",
  t: (key: string) =>
    key === "tasks:popover.assignee.unassigned" && translations.ready
      ? translations.language === "de"
        ? "Nicht zugewiesen"
        : "Unassigned"
      : key,
}));

vi.mock("@taskdesk/ui", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    ...translations,
    i18n: { language: translations.language },
  }),
}));
vi.mock("@/components/avatar", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  AvatarImage: () => null,
}));
vi.mock("@/components/task/task-status-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    renders.status();
    return <div>{children}</div>;
  },
}));
vi.mock("@/components/task/task-priority-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    renders.priority();
    return <div>{children}</div>;
  },
}));
vi.mock("@/components/task/task-assignee-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    renders.assignee();
    return <div>{children}</div>;
  },
}));
vi.mock("@/components/task/task-start-date-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    renders.startDate();
    return <div>{children}</div>;
  },
}));
vi.mock("@/components/task/task-due-date-popover", () => ({
  default: ({
    children,
    task: currentTask,
  }: {
    children: React.ReactNode;
    task: Pick<Task, "startDate">;
  }) => {
    renders.dueDate();
    renders.dueStartDates.push(currentTask.startDate);
    return <div>{children}</div>;
  },
}));
vi.mock("@/lib/column", () => ({ getColumnIcon: () => null }));
vi.mock("@/lib/due-date-status", () => ({
  dueDateStatusColors: {},
  getDueDateStatus: () => "far-future",
  isTaskCompleted: () => false,
}));
vi.mock("@/lib/format", () => ({ formatDateShort: (value: string) => value }));
vi.mock("@/lib/get-initials", () => ({
  getInitials: (value: string) => value,
}));
vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (value: string) => value,
  getStatusDisplayLabel: (value: string, name?: string) => name ?? value,
}));
vi.mock("@/lib/priority", () => ({ getPriorityIcon: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  renders.dueStartDates.length = 0;
  translations.ready = true;
  translations.language = "en";
});

const task: Task = {
  id: "task-1",
  title: "Control task",
  number: 1,
  description: null,
  status: "backlog",
  priority: "low",
  startDate: null,
  dueDate: null,
  position: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  version: 1,
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
};

const columns = [
  {
    id: "backlog",
    slug: "backlog",
    name: "Backlog",
    isFinal: false,
    projectId: "project-1",
    position: 0,
    icon: null,
    color: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
] satisfies NonNullable<ReturnType<typeof useGetColumns>["data"]>;

function renderControls(currentTask: Task) {
  return (
    <TaskPropertiesControls
      task={currentTask}
      taskForMutation={currentTask}
      columns={columns}
      workspaceUsers={
        {
          members: [
            {
              userId: "agent-1",
              user: {
                id: "agent-1",
                name: "G11 Agent",
                email: "agent@example.invalid",
                image: null,
              },
            },
          ],
        } as ReturnType<typeof useGetActiveWorkspaceUsers>["data"]
      }
      compact={false}
      columnsLoading={false}
      columnsError={false}
    />
  );
}

describe("task property render boundaries", () => {
  it("refreshes memoized labels when the translation namespace becomes ready", () => {
    translations.ready = false;
    const { rerender } = render(renderControls(task));
    expect(
      screen.getByRole("button", {
        name: "tasks:popover.assignee.unassigned",
      }),
    ).toBeVisible();

    translations.ready = true;
    rerender(renderControls(task));

    expect(screen.getByRole("button", { name: "Unassigned" })).toBeVisible();
    translations.ready = false;
  });

  it("refreshes memoized labels when the active language changes", () => {
    translations.language = "en";
    const { rerender } = render(renderControls(task));
    expect(screen.getByRole("button", { name: "Unassigned" })).toBeVisible();

    translations.language = "de";
    rerender(renderControls(task));

    expect(
      screen.getByRole("button", { name: "Nicht zugewiesen" }),
    ).toBeVisible();
  });

  it("updates the selected property without rebuilding unrelated controls", () => {
    const { rerender } = render(renderControls(task));
    expect(screen.getByRole("button", { name: "Backlog" })).toBeVisible();

    rerender(
      renderControls({
        ...task,
        userId: "agent-1",
        assigneeId: "agent-1",
        assigneeName: "G11 Agent",
        version: 2,
      }),
    );

    expect(screen.getByRole("button", { name: /G11 Agent/ })).toBeVisible();
    expect(renders.status).toHaveBeenCalledTimes(1);
    expect(renders.priority).toHaveBeenCalledTimes(1);
    expect(renders.assignee).toHaveBeenCalledTimes(2);
    expect(renders.startDate).toHaveBeenCalledTimes(1);
    expect(renders.dueDate).toHaveBeenCalledTimes(1);
  });

  it("refreshes the due-date constraint when only the start date changes", () => {
    const { rerender } = render(renderControls(task));
    expect(renders.dueStartDates).toEqual([null]);

    const updatedStartDate = "2026-10-15T00:00:00.000Z";
    rerender(
      renderControls({
        ...task,
        startDate: updatedStartDate,
        version: task.version + 1,
      }),
    );

    expect(renders.dueStartDates).toEqual([null, updatedStartDate]);
    expect(renders.dueDate).toHaveBeenCalledTimes(2);
  });
});
