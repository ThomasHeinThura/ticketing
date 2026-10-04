import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskPropertiesSidebar from "./task-properties-sidebar";

const mocks = vi.hoisted(() => ({
  useGetTask: vi.fn(),
  useGetProject: vi.fn(),
  useGetColumns: vi.fn(),
  useGetActiveWorkspaceUsers: vi.fn(),
  useGetLabelsByTask: vi.fn(),
  useGetProjects: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({
    t: (key: string) => key,
    ready: true,
    i18n: { language: "en" },
  }),
}));

vi.mock("@taskdesk/ui", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Badge: passthrough,
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    KbdSequence: passthrough,
    Tooltip: passthrough,
    TooltipContent: passthrough,
    TooltipProvider: passthrough,
    TooltipTrigger: passthrough,
  };
});

vi.mock("@/hooks/queries/task/use-get-task", () => ({
  default: (...args: unknown[]) => mocks.useGetTask(...args),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: (...args: unknown[]) => mocks.useGetProject(...args),
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: (...args: unknown[]) => mocks.useGetColumns(...args),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: (...args: unknown[]) =>
      mocks.useGetActiveWorkspaceUsers(...args),
  }),
);
vi.mock("@/hooks/queries/label/use-get-labels-by-task", () => ({
  default: (...args: unknown[]) => mocks.useGetLabelsByTask(...args),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: (...args: unknown[]) => mocks.useGetProjects(...args),
}));

vi.mock("./task-status-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="status-popover">{children}</div>
  ),
}));
vi.mock("./task-priority-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="priority-popover">{children}</div>
  ),
}));
vi.mock("./task-assignee-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="assignee-popover">{children}</div>
  ),
}));
vi.mock("./task-start-date-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="start-date-popover">{children}</div>
  ),
}));
vi.mock("./task-due-date-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="due-date-popover">{children}</div>
  ),
}));
vi.mock("./task-labels-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="labels-popover">{children}</div>
  ),
}));
vi.mock("./task-move-popover", () => ({
  default: () => <div data-testid="move-popover" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const task: Task = {
  id: "task-1",
  title: "Sidebar task",
  number: 1,
  description: null,
  status: "backlog",
  priority: null,
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

function setup() {
  mocks.useGetTask.mockReturnValue({ data: task });
  mocks.useGetProject.mockReturnValue({ data: { slug: "PRJ" } });
  mocks.useGetColumns.mockReturnValue({
    data: [{ id: "backlog", slug: "backlog", name: "Backlog", isFinal: false }],
  });
  mocks.useGetActiveWorkspaceUsers.mockReturnValue({ data: { members: [] } });
  mocks.useGetLabelsByTask.mockReturnValue({ data: [] });
  mocks.useGetProjects.mockReturnValue({ data: [] });

  render(
    <TaskPropertiesSidebar
      taskId="task-1"
      projectId="project-1"
      workspaceId="workspace-1"
    />,
  );
}

describe("TaskPropertiesSidebar responsive controls", () => {
  it("mounts one instance of each stateful property popover across responsive layouts", () => {
    setup();

    for (const testId of [
      "status",
      "priority",
      "assignee",
      "start-date",
      "due-date",
    ]) {
      expect(screen.getAllByTestId(`${testId}-popover`)).toHaveLength(1);
    }
    expect(screen.getByRole("button", { name: /Backlog/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /tasks:popover\.assignee\.unassigned/,
      }),
    ).toBeInTheDocument();
  });
});
