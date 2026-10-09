import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@taskdesk/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ErrorDisplay } from "@/components/errors/error-display";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
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
  const {
    canCreateTasks,
    isCheckingPermissions,
    isPermissionError,
    permissionError,
    retryPermissionCheck,
  } = useWorkspacePermission(workspaceId);
  const canCreate = canCreateTasks();

  useEffect(() => {
    if (!isCheckingPermissions && !isPermissionError && !canCreate) onClose();
  }, [canCreate, isCheckingPermissions, isPermissionError, onClose]);

  if (!isCheckingPermissions && !isPermissionError && !canCreate) return null;

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
        {isPermissionError ? (
          <ErrorDisplay
            error={permissionError}
            onRetry={() => void retryPermissionCheck()}
            className="min-h-0 p-0"
          />
        ) : isCheckingPermissions ? (
          <div role="status" aria-busy="true" aria-live="polite">
            <span className="sr-only">{t("common:empty.loading")}</span>
          </div>
        ) : (
          <CreateWorkItemDialogContent
            onClose={onClose}
            projectId={projectId}
            workspaceId={workspaceId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
