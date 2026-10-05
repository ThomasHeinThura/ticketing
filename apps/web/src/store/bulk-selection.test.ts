import { afterEach, describe, expect, it } from "vitest";
import useBulkSelectionStore from "./bulk-selection";

afterEach(() => {
  useBulkSelectionStore.setState({
    availableTaskIds: [],
    focusedTaskId: null,
    selectedTaskIds: new Set(),
    isSelectMode: false,
  });
});

describe("bulk selection task registration", () => {
  it("does not publish unchanged task order or empty focus resets", () => {
    const taskIds = ["task-1", "task-2"];
    useBulkSelectionStore.getState().setAvailableTasks(taskIds);
    useBulkSelectionStore.getState().clearFocus();
    const before = useBulkSelectionStore.getState();
    let notifications = 0;
    const unsubscribe = useBulkSelectionStore.subscribe(() => {
      notifications += 1;
    });

    useBulkSelectionStore.getState().setAvailableTasks([...taskIds]);
    useBulkSelectionStore.getState().clearFocus();

    unsubscribe();
    expect(useBulkSelectionStore.getState()).toBe(before);
    expect(notifications).toBe(0);
  });

  it("publishes task order changes needed by keyboard navigation", () => {
    useBulkSelectionStore.getState().setAvailableTasks(["task-1", "task-2"]);
    useBulkSelectionStore.getState().setFocusedTask("task-1");

    useBulkSelectionStore.getState().setAvailableTasks(["task-2", "task-1"]);

    expect(useBulkSelectionStore.getState().availableTaskIds).toEqual([
      "task-2",
      "task-1",
    ]);
    expect(useBulkSelectionStore.getState().focusedTaskId).toBe("task-1");
  });
});
