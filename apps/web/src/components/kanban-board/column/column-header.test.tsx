import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => false,
    canCreateTasks: () => true,
  }),
}));

vi.mock("@/components/shared/modals/archive-tasks-modal", () => ({
  ArchiveTasksModal: () => null,
}));

import useProjectStore from "@/store/project";
import { ColumnHeader } from "./column-header";

const project = {
  id: "project-1",
  columns: [],
} as unknown as ProjectWithTasks;

const t = ((key: string) => key) as unknown as TFunction;

function column(id: string): ProjectWithTasks["columns"][number] {
  return {
    id,
    slug: id,
    name: id,
    icon: null,
    isFinal: false,
    tasks: [],
  };
}

afterEach(() => {
  cleanup();
  useProjectStore.setState({ project: undefined });
  vi.clearAllMocks();
});

describe("kanban column create dialog lifecycle", () => {
  it("sends the selected column's status to the shared create dialog host", () => {
    useProjectStore.setState({ project });
    const createTask = vi.fn();
    render(
      <>
        <ColumnHeader
          column={column("backlog")}
          onCreateTask={createTask}
          t={t}
        />
        <ColumnHeader
          column={column("in-progress")}
          onCreateTask={createTask}
          t={t}
        />
      </>,
    );

    fireEvent.click(screen.getAllByTitle("tasks:kanban.addTask")[1]);
    expect(createTask).toHaveBeenCalledExactlyOnceWith(
      "in-progress",
      expect.any(HTMLButtonElement),
    );

    fireEvent.click(screen.getAllByTitle("tasks:kanban.addTask")[0]);
    expect(createTask).toHaveBeenNthCalledWith(
      2,
      "backlog",
      expect.any(HTMLButtonElement),
    );
  });
});
