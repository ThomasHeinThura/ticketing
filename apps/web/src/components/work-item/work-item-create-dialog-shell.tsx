import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ErrorBoundary,
} from "@taskdesk/ui";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ErrorDisplay } from "@/components/errors/error-display";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

type ContentModule = typeof import("./create-work-item-dialog");
type ContentComponent = ContentModule["CreateWorkItemDialogContent"];

let contentModulePromise: Promise<{ default: ContentComponent }> | undefined;

function loadCreateWorkItemDialogContent(): Promise<{
  default: ContentComponent;
}> {
  if (!contentModulePromise) {
    contentModulePromise = import("./create-work-item-dialog")
      .then(({ CreateWorkItemDialogContent }) => ({
        default: CreateWorkItemDialogContent,
      }))
      .catch((error: unknown) => {
        contentModulePromise = undefined;
        throw error;
      });
  }
  return contentModulePromise;
}

const CreateWorkItemDialogContent = lazy(loadCreateWorkItemDialogContent);

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

  const retryContent = () => {
    contentModulePromise = undefined;
    window.location.reload();
  };

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
          <ErrorBoundary
            fallback={({ error }) => (
              <ErrorDisplay
                error={error}
                onRetry={retryContent}
                className="min-h-0 p-0"
              />
            )}
          >
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-busy="true"
                  aria-live="polite"
                  data-testid="create-work-item-content-loading"
                >
                  <span className="sr-only">{t("common:empty.loading")}</span>
                </div>
              }
            >
              <CreateWorkItemDialogContent
                onClose={onClose}
                projectId={projectId}
                workspaceId={workspaceId}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </DialogContent>
    </Dialog>
  );
}
