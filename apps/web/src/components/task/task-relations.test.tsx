import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskRelations from "./task-relations";

const mocks = vi.hoisted(() => ({ useGetTasks: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task-relation/use-delete-task-relation", () => ({
  default: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { slug: "PRJ" } }),
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({ data: [{ id: "backlog", isFinal: false }] }),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: (...args: unknown[]) => mocks.useGetTasks(...args),
}));
vi.mock("@/hooks/queries/task-relation/use-get-task-relations", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({ useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }) }),
);
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));
vi.mock("./subtask-assignee-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./subtask-status-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@taskdesk/ui", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      // ui-exempt: this test double preserves the shared Button's click semantics.
      <button {...props}>{children}</button>
    ),
    Collapsible: passthrough,
    CollapsibleContent: passthrough,
    CollapsibleTrigger: passthrough,
    CommandDialog: () => null,
    CommandDialogPopup: passthrough,
    Command: passthrough,
    CommandCollection: passthrough,
    CommandEmpty: passthrough,
    CommandFooter: passthrough,
    CommandGroup: passthrough,
    CommandGroupLabel: passthrough,
    CommandInput: () => null,
    CommandItem: passthrough,
    CommandList: passthrough,
    CommandPanel: passthrough,
    CommandSeparator: passthrough,
    ContextMenu: passthrough,
    ContextMenuContent: passthrough,
    ContextMenuItem: passthrough,
    ContextMenuSeparator: passthrough,
    ContextMenuTrigger: passthrough,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskRelations task-list subscription", () => {
  it("keeps the full project query inactive until the relation picker opens", () => {
    mocks.useGetTasks.mockReturnValue({ data: { columns: [] } });

    render(
      <TaskRelations
        taskId="task-1"
        projectId="project-1"
        workspaceId="workspace-1"
      />,
    );

    expect(mocks.useGetTasks).toHaveBeenCalledExactlyOnceWith(
      "project-1",
      false,
    );
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons.at(-1) as HTMLButtonElement);

    expect(mocks.useGetTasks).toHaveBeenLastCalledWith("project-1", true);
  });
});
