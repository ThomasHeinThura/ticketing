import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { CreateWorkItemDialogContent } from "./create-work-item-dialog";

export default function WorkItemCreateDialogShell({
  projectId,
  workspaceId,
  onClose,
  finalFocus,
  open = true,
}: {
  projectId: string;
  workspaceId: string | undefined;
  onClose: () => void;
  finalFocus: () => HTMLElement | false;
  open?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-w-md"
        showCloseButton
        closeLabel={t("workItems:create.close")}
        data-testid="create-work-item-dialog"
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("workItems:create.title")}</DialogTitle>
          <DialogDescription>
            {t("workItems:create.description")}
          </DialogDescription>
        </DialogHeader>
        <CreateWorkItemDialogContent
          onClose={onClose}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      </DialogContent>
    </Dialog>
  );
}
