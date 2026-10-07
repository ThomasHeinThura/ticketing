import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ErrorBoundary,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import {
  CreateWorkItemDialogContent,
  CreateWorkItemDialogLoadError,
} from "./create-work-item-dialog";

export default function WorkItemCreateDialogShell({
  projectId,
  workspaceId,
  onClose,
  finalFocus,
}: {
  projectId: string;
  workspaceId: string | undefined;
  onClose: () => void;
  finalFocus: () => HTMLElement | false;
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
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("workItems:create.title")}</DialogTitle>
          <DialogDescription>
            {t("workItems:create.description")}
          </DialogDescription>
        </DialogHeader>
        <ErrorBoundary fallback={CreateWorkItemDialogLoadError}>
          <CreateWorkItemDialogContent
            onClose={onClose}
            projectId={projectId}
            workspaceId={workspaceId}
          />
        </ErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}
