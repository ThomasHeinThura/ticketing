import { useControlledBulkSelectionKeyboardShortcuts } from "@/hooks/use-controlled-bulk-selection-keyboard-shortcuts";
import useBulkSelectionStore from "@/store/bulk-selection";

/** Keyboard shortcuts for the legacy task selection store. */
export function useBulkSelectionKeyboardShortcuts(enabled = true) {
  const selectAll = useBulkSelectionStore((state) => state.selectAll);
  const clearSelection = useBulkSelectionStore((state) => state.clearSelection);
  useControlledBulkSelectionKeyboardShortcuts(enabled, {
    selectAll,
    clearSelection,
  });
}
