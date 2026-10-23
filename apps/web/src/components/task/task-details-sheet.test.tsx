import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskDetailsSheet, { TaskDetailsSheetFrame } from "./task-details-sheet";

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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

it("retains the selected body for the pinned 300ms exit and cancels a stale clear when reopened", () => {
  vi.useFakeTimers();
  const body = vi.fn((key: string) => <div>{key}</div>);
  const onClose = vi.fn();
  const frame = (itemId?: string) => (
    <TaskDetailsSheetFrame itemId={itemId} onClose={onClose} ariaLabel="Task">
      {body}
    </TaskDetailsSheetFrame>
  );
  const view = render(frame("HELP-1"));
  view.rerender(frame());
  expect(body).toHaveBeenLastCalledWith("HELP-1");
  act(() => vi.advanceTimersByTime(299));
  view.rerender(frame());
  expect(body).toHaveBeenLastCalledWith("HELP-1");
  act(() => vi.advanceTimersByTime(1));
  body.mockClear();
  view.rerender(frame());
  expect(body).not.toHaveBeenCalled();
  view.rerender(frame("HELP-2"));
  view.rerender(frame());
  act(() => vi.advanceTimersByTime(100));
  view.rerender(frame("HELP-3"));
  act(() => vi.advanceTimersByTime(300));
  expect(body).toHaveBeenLastCalledWith("HELP-3");
});
