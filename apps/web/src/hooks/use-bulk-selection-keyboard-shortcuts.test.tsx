import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import { useBulkSelectionKeyboardShortcuts } from "./use-bulk-selection-keyboard-shortcuts";

afterEach(() => {
  cleanup();
  useBulkSelectionStore.setState({
    availableTaskIds: [],
    focusedTaskId: null,
    selectedTaskIds: new Set(),
    isSelectMode: false,
  });
});

describe("board bulk-selection keyboard shortcuts", () => {
  it("selects every available task from an empty selection", () => {
    useBulkSelectionStore.getState().setAvailableTasks(["task-1", "task-2"]);
    renderHook(() => useBulkSelectionKeyboardShortcuts());
    const event = new KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => document.body.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(useBulkSelectionStore.getState().selectedTaskIds).toEqual(
      new Set(["task-1", "task-2"]),
    );
  });

  it("leaves Ctrl+A available to typing contexts", () => {
    useBulkSelectionStore.getState().setAvailableTasks(["task-1"]);
    renderHook(() => useBulkSelectionKeyboardShortcuts());
    const input = document.createElement("input");
    document.body.append(input);
    const event = new KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => input.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
    input.remove();
  });

  it("removes the document listener when the board shortcut owner unmounts", () => {
    useBulkSelectionStore.getState().setAvailableTasks(["task-1"]);
    const { unmount } = renderHook(() => useBulkSelectionKeyboardShortcuts());
    unmount();
    const event = new KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => document.body.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
  });
});
