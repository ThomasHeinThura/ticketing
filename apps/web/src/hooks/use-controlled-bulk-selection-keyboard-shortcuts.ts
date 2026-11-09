import { useEffect } from "react";

type ControlledSelection = {
  selectAll: () => void;
  clearSelection: () => void;
};

/** Keyboard shortcuts for a caller-owned selection, without loading the legacy store. */
export function useControlledBulkSelectionKeyboardShortcuts(
  enabled: boolean,
  { selectAll, clearSelection }: ControlledSelection,
) {
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
