import { Dialog, DialogContent } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import usePendingActionDialogStore from "@/store/pending-action-dialog";
import { PendingActionApproval } from "./pending-action-approval";

/** One Kaneo Dialog for every in-place deletion approval (typed name, step-up, confirm). */
export default function PendingActionApprovalDialog() {
  const { t } = useTranslation();
  const pendingActionId = usePendingActionDialogStore(
    (state) => state.pendingActionId,
  );
  const close = usePendingActionDialogStore((state) => state.close);
  if (!pendingActionId) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <PendingActionApproval
          id={pendingActionId}
          layout="dialog"
          onExecuted={() => {
            toast.success(t("pendingActions:dialog.executed"));
            close();
          }}
          onCancelled={() => {
            toast.success(t("pendingActions:dialog.cancelled"));
            close();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
