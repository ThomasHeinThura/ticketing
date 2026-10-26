import { useCallback } from "react";
import usePendingActionDialogStore from "@/store/pending-action-dialog";

/**
 * After a deletion request is accepted (`202`) nothing has been removed yet. Opens the
 * approval in place (a Dialog on the current screen, mounted once in the app layout) so the
 * requester keeps their board or settings context; the profile page stays for old links.
 */
export function useOpenPendingAction() {
  const open = usePendingActionDialogStore((state) => state.open);
  return useCallback(
    async (action: {
      pendingActionId: string;
      finalFocus?: () => HTMLElement | false;
    }) => {
      open(action.pendingActionId, action.finalFocus);
    },
    [open],
  );
}
