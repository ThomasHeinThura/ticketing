import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskCrumbSelect from "./task-crumb-select";

const mocks = vi.hoisted(() => ({ useGetTasks: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: (...args: unknown[]) => mocks.useGetTasks(...args),
}));

vi.mock("@taskdesk/ui", async () => {
  const React = await import("react");
  const MenuContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>({ open: false, onOpenChange: () => undefined });
  const group = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children);
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement("button", props, children),
    DropdownMenu: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: React.ReactNode;
    }) =>
      React.createElement(
        MenuContext.Provider,
        { value: { open, onOpenChange } },
        children,
      ),
    DropdownMenuTrigger: ({
      render,
      children,
    }: {
      render: React.ReactElement;
      children: React.ReactNode;
    }) => {
      const menu = React.useContext(MenuContext);
      return React.cloneElement(
        render as React.ReactElement<
          React.ButtonHTMLAttributes<HTMLButtonElement>
        >,
        { onClick: () => menu.onOpenChange(!menu.open) },
        children,
      );
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => {
      const menu = React.useContext(MenuContext);
      return menu.open ? React.createElement("div", null, children) : null;
    },
    DropdownMenuGroup: group,
    DropdownMenuLabel: group,
    DropdownMenuSeparator: () => React.createElement("hr"),
    DropdownMenuItem: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement("button", props, children),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskCrumbSelect", () => {
  it("subscribes to the project task list only while the picker is open", () => {
    mocks.useGetTasks.mockReturnValue({
      data: {
        columns: [
          {
            tasks: [
              { id: "task-1", number: 1, title: "Current task" },
              { id: "task-2", number: 2, title: "Next task" },
            ],
          },
        ],
        plannedTasks: [],
        archivedTasks: [],
      },
    });
    const onSelectTask = vi.fn();

    render(
      <TaskCrumbSelect
        projectId="project-1"
        taskId="task-1"
        taskLabel="PRJ-1"
        onSelectTask={onSelectTask}
      />,
    );

    expect(mocks.useGetTasks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "PRJ-1" }));
    expect(mocks.useGetTasks).toHaveBeenCalledExactlyOnceWith("project-1");
    expect(screen.getByText("#2 Next task")).toBeInTheDocument();
    fireEvent.click(screen.getByText("#2 Next task"));
    expect(onSelectTask).toHaveBeenCalledExactlyOnceWith("task-2");
  });
});
