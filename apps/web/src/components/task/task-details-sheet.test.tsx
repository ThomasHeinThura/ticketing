import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskDetailsSheet from "./task-details-sheet";

const mocks = vi.hoisted(() => ({ bodyLoaded: false }));

vi.mock("./task-details-sheet-body", () => {
  mocks.bodyLoaded = true;
  return {
    default: ({ taskId }: { taskId: string }) => (
      <div data-testid="task-details-sheet-body">{taskId}</div>
    ),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("TaskDetailsSheet", () => {
  it("loads task detail data only after a task is selected", async () => {
    const props = {
      projectId: "project-1",
      workspaceId: "workspace-1",
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <TaskDetailsSheet {...props} taskId={undefined} />,
    );

    expect(mocks.bodyLoaded).toBe(false);
    expect(screen.queryByTestId("task-details-sheet-body")).toBeNull();

    rerender(<TaskDetailsSheet {...props} taskId="task-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("task-details-sheet-body")).toHaveTextContent(
        "task-1",
      );
    });
    expect(mocks.bodyLoaded).toBe(true);
  });
});
