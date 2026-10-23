import { create } from "zustand";

/** The pending action whose approval is open in place on the current screen. */
const usePendingActionDialogStore = create<{
  pendingActionId: string | null;
  open: (pendingActionId: string) => void;
  close: () => void;
}>((set) => ({
  pendingActionId: null,
  open: (pendingActionId) => set({ pendingActionId }),
  close: () => set({ pendingActionId: null }),
}));

export default usePendingActionDialogStore;
