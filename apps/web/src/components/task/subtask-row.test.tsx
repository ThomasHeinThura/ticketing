import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import SubtaskRow from "./subtask-row";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock(
  "@/components/kanban-board/task-card-context-menu/task-card-context-menu-content",
  () => ({
    default: () => null,
  }),
);
vi.mock("./subtask-assignee-popover", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./subtask-status-popover", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

afterEach(cleanup);
it("does not read computed styles while rendering the motion transition", () => {
  const computedStyle = vi.spyOn(window, "getComputedStyle");
  try {
    render(
      <SubtaskRow
        task={{ id: "one", title: "Subtask", status: "to-do" } as Task}
        tasks={[]}
        projectId="project"
        workspaceId="workspace"
        isSelected={false}
        isFocused={false}
        isCompleted={false}
        canEdit
        selectionRadius=""
        assignee={null}
        onToggleComplete={vi.fn()}
        onNavigate={vi.fn()}
        onDeleteClick={vi.fn()}
      />,
    );
    expect(computedStyle).not.toHaveBeenCalled();
  } finally {
    computedStyle.mockRestore();
  }
});
