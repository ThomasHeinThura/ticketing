import { useEffect } from "react";
import useBulkSelectionStore from "@/store/bulk-selection";

type ControlledSelection = {
  selectAll: () => void;
  clearSelection: () => void;
};

/** Canonical callers supply their loaded-key controller, preserving the original
 * shortcut behavior without sharing legacy task IDs or taking over open dialogs. */
export function useBulkSelectionKeyboardShortcuts(
  enabled = true,
  controlled?: ControlledSelection,
) {
  const storeSelectAll = useBulkSelectionStore((state) => state.selectAll);
  const storeClearSelection = useBulkSelectionStore(
    (state) => state.clearSelection,
  );
  const selectAll = controlled?.selectAll ?? storeSelectAll;
  const clearSelection = controlled?.clearSelection ?? storeClearSelection;
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.defaultPrevented ||
        target?.closest(
          "input, textarea, [contenteditable='true'], .ProseMirror, [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']",
        )
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAll();
      }
      if (event.key === "Escape") {
        // The sortable owns Escape during an active task drag. Leaving the event
        // untouched lets its KeyboardSensor cancel, including while that
        // sensor's document listener is still being attached after Space.
        if (document.querySelector('[data-task-dragging="true"]')) return;
        event.preventDefault();
        clearSelection();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [clearSelection, enabled, selectAll]);
}
