import { Button, Skeleton } from "@taskdesk/ui";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { CreateWorkItemDialogProps } from "./create-work-item-dialog-form";

const DefaultCreateWorkItemDialogForm = lazy(
  () => import("./create-work-item-dialog-form"),
);

export function CreateWorkItemDialogContent({
  onClose,
  onCancel,
  onDraftStateChange,
  projectId,
  workspaceId,
}: CreateWorkItemDialogProps) {
  return (
    <Suspense
      fallback={
        <div
          className="flex flex-col flex-1 min-h-0 space-y-6 px-6"
          aria-busy="true"
          data-testid="create-work-item-dialog-loading"
        >
          <Skeleton className="h-12 w-full" />
          <Skeleton className="min-h-[200px] w-full" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-32 self-end" />
        </div>
      }
    >
      <DefaultCreateWorkItemDialogForm
        onClose={onClose}
        onCancel={onCancel}
        onDraftStateChange={onDraftStateChange}
        projectId={projectId}
        workspaceId={workspaceId}
      />
    </Suspense>
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
