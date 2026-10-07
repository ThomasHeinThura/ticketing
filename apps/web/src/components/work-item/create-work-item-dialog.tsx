import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ErrorBoundary,
  Skeleton,
} from "@taskdesk/ui";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { CreateWorkItemDialogProps } from "./create-work-item-dialog-form";

type Props = CreateWorkItemDialogProps & { open: boolean };

const DefaultCreateWorkItemDialogForm = lazy(
  () => import("./create-work-item-dialog-form"),
);

export function CreateWorkItemDialogContent({
  onClose,
  projectId,
  workspaceId,
}: CreateWorkItemDialogProps) {
  return (
    <Suspense
      fallback={
        <div
          className="flex flex-col gap-4"
          aria-busy="true"
          data-testid="create-work-item-dialog-loading"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-9 w-32 self-end" />
        </div>
      }
    >
      <DefaultCreateWorkItemDialogForm
        onClose={onClose}
        projectId={projectId}
        workspaceId={workspaceId}
      />
    </Suspense>
  );
}

/** Keep the accessible dialog shell available as soon as the route handles intent.
 * The heavier form and its query hooks remain a separate, intent-lazy module. */
export default function CreateWorkItemDialog({
  open,
  onClose,
  projectId,
  workspaceId,
}: Props) {
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
      >
        <DialogHeader>
          <DialogTitle>{t("workItems:create.title")}</DialogTitle>
          <DialogDescription>
            {t("workItems:create.description")}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ErrorBoundary fallback={CreateWorkItemDialogLoadError}>
            <CreateWorkItemDialogContent
              onClose={onClose}
              projectId={projectId}
              workspaceId={workspaceId}
            />
          </ErrorBoundary>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function CreateWorkItemDialogLoadError() {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col gap-3">
      <p>{t("common:error.title")}</p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => window.location.reload()}
      >
        {t("common:error.tryAgain")}
      </Button>
    </div>
  );
}
