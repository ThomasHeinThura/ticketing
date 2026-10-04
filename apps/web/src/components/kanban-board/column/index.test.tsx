import { cleanup, render } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";

const mocks = vi.hoisted(() => ({
  columnHeader: vi.fn(() => <div />),
  columnDropzone: vi.fn(() => <div />),
}));

vi.mock("./column-header", () => ({ ColumnHeader: mocks.columnHeader }));
vi.mock("./column-dropzone", () => ({ ColumnDropzone: mocks.columnDropzone }));

import Column from "./index";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Kanban column rendering", () => {
  it("skips a parent-only rerender when its board data and handlers are stable", () => {
    const column = {
      id: "column-1",
      slug: "todo",
      name: "To do",
      icon: null,
      isFinal: false,
      tasks: [],
    } as ProjectWithTasks["columns"][number];
    const onContextMenuTask = vi.fn();
    const props = {
      column,
      projectSlug: "PRJ",
      projectColumns: [column],
      displayPreferences: {
        showAssignees: true,
        showPriority: true,
        showDueDates: true,
        showLabels: true,
        showTaskNumbers: true,
        showTaskItemCounts: true,
      },
      selectedTaskIds: new Set<string>(),
      focusedTaskId: null,
      toggleSelection: vi.fn(),
      workspaceId: "workspace-1",
      workspaceUsersById: new Map(),
      onContextMenuTask,
      onOpenTask: vi.fn(),
      t: ((key: string) => key) as unknown as TFunction,
    };
    const view = render(<Column {...props} />);

    view.rerender(<Column {...props} />);

    expect(mocks.columnHeader).toHaveBeenCalledOnce();
    expect(mocks.columnDropzone).toHaveBeenCalledOnce();
  });
});
