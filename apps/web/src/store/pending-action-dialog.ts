import { create } from "zustand";

/** The pending action whose approval is open in place on the current screen. */
const usePendingActionDialogStore = create<{
  pendingActionId: string | null;
  finalFocus: (() => HTMLElement | false) | null;
  open: (
    pendingActionId: string,
    finalFocus?: () => HTMLElement | false,
  ) => void;
  close: () => void;
}>((set) => ({
  pendingActionId: null,
  finalFocus: null,
  open: (pendingActionId, finalFocus = undefined) =>
    set({ pendingActionId, finalFocus: finalFocus ?? null }),
  close: () => set({ pendingActionId: null, finalFocus: null }),
}));

export default usePendingActionDialogStore;
