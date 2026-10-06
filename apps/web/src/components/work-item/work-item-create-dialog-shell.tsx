import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ErrorBoundary,
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
        <ErrorBoundary
          fallback={() => (
            <div role="alert">
              <p>{t("common:error.title")}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                {t("common:error.tryAgain")}
              </Button>
            </div>
          )}
        >
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
