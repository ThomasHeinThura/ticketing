import { Button } from "@taskdesk/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskStatusPopover from "./task-status-popover";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

vi.mock("@/hooks/mutations/task/use-update-task-status", () => ({
  useUpdateTaskStatus: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/use-numbered-shortcuts", () => ({
  useNumberedShortcuts: vi.fn(),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const task: Task = {
  id: "task-1",
  title: "Directly loaded task",
  number: 1,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 1,
  createdAt: "2026-07-17T00:00:00.000Z",
  version: 1,
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
};

describe("TaskStatusPopover", () => {
  it("renders the project status options provided by the details owner", async () => {
    render(
      <TaskStatusPopover
        task={task}
        columns={[
          {
            id: "column-1",
            projectId: "project-1",
            slug: "to-do",
            name: "Ready",
            position: 0,
            icon: null,
            color: null,
            isFinal: false,
            createdAt: "2026-07-17T00:00:00.000Z",
            updatedAt: "2026-07-17T00:00:00.000Z",
          },
        ]}
        isLoading={false}
        isError={false}
      >
        <Button>Status</Button>
      </TaskStatusPopover>,
    );

    expect(screen.queryByRole("button", { name: /Ready/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Status" }));

    expect(await screen.findByRole("button", { name: /Ready/ })).toBeVisible();
  });

  it("shows loading feedback while status options are loading", async () => {
    render(
      <TaskStatusPopover task={task} columns={[]} isLoading isError={false}>
        <Button>Status</Button>
      </TaskStatusPopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Status" }));

    expect(await screen.findByText("common:empty.loading")).toBeVisible();
  });

  it("shows error feedback when status options fail to load", async () => {
    render(
      <TaskStatusPopover task={task} columns={[]} isLoading={false} isError>
        <Button>Status</Button>
      </TaskStatusPopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Status" }));

    expect(await screen.findByText("common:error.title")).toBeVisible();
  });
});
