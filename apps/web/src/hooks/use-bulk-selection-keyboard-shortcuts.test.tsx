import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("leaves Escape available to a focused child input", () => {
    const clearSelection = vi.fn();
    renderHook(() =>
      useBulkSelectionKeyboardShortcuts(true, {
        selectAll: vi.fn(),
        clearSelection,
      }),
    );
    const input = document.createElement("input");
    document.body.append(input);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    act(() => input.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(clearSelection).not.toHaveBeenCalled();
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

describe("controlled canonical loaded-key shortcuts", () => {
  it("delegates select-all and escape to the canonical controller without modifying legacy task selection", () => {
    const selectAll = vi.fn();
    const clearSelection = vi.fn();
    renderHook(() =>
      useBulkSelectionKeyboardShortcuts(true, { selectAll, clearSelection }),
    );
    act(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    act(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(selectAll).toHaveBeenCalledOnce();
    expect(clearSelection).toHaveBeenCalledOnce();
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
  });
  it.each(["dialog", "alertdialog", "menu", "listbox"])(
    "does not take keyboard ownership inside an open %s",
    (role) => {
      const selectAll = vi.fn();
      const clearSelection = vi.fn();
      renderHook(() =>
        useBulkSelectionKeyboardShortcuts(true, { selectAll, clearSelection }),
      );
      const target = document.createElement("div");
      target.setAttribute("role", role);
      document.body.append(target);
      act(() =>
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "a",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      act(() =>
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(selectAll).not.toHaveBeenCalled();
      expect(clearSelection).not.toHaveBeenCalled();
      target.remove();
    },
  );
});
