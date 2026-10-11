import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskLabelsSection from "./task-labels-section";

const mocks = vi.hoisted(() => ({
  useGetLabelsByWorkspace: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@taskdesk/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({ children }: { children: React.ReactNode }) => (
    // ui-exempt: test double for the shared design-system Button.
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: (...args: unknown[]) => mocks.useGetLabelsByWorkspace(...args),
}));

vi.mock("./task-labels-popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("TaskLabelsSection", () => {
  it("loads workspace label options once for all task label controls", () => {
    mocks.useGetLabelsByWorkspace.mockReturnValue({
      data: [
        { id: "label-1", name: "Bug", color: "red", taskId: null },
        { id: "label-2", name: "Urgent", color: "orange", taskId: null },
      ],
    });

    render(
      <TaskLabelsSection
        taskId="task-1"
        projectId="project-1"
        workspaceId="workspace-1"
        taskLabels={[
          {
            id: "task-label-1",
            name: "Bug",
            color: "red",
            taskId: "task-1",
            workspaceId: "workspace-1",
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
          {
            id: "task-label-2",
            name: "Urgent",
            color: "orange",
            taskId: "task-1",
            workspaceId: "workspace-1",
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        ]}
        heading="Labels"
      />,
    );

    expect(mocks.useGetLabelsByWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.useGetLabelsByWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
