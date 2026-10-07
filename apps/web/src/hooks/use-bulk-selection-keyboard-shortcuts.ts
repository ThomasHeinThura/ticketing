import { useEffect } from "react";
import useBulkSelectionStore from "@/store/bulk-selection";

export function useBulkSelectionKeyboardShortcuts(enabled = true) {
  const selectAll = useBulkSelectionStore((state) => state.selectAll);
  const clearSelection = useBulkSelectionStore((state) => state.clearSelection);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingContext = Boolean(
        target?.closest(
          "input, textarea, [contenteditable='true'], .ProseMirror",
        ),
      );

      if ((event.metaKey || event.ctrlKey) && event.key === "a") {
        if (isTypingContext) return;
        event.preventDefault();
        selectAll();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [clearSelection, enabled, selectAll]);
}
