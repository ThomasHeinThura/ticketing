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
}: {
  projectId: string;
  workspaceId: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-w-md"
        showCloseButton
        closeLabel={t("workItems:create.close")}
        data-testid="create-work-item-dialog"
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
