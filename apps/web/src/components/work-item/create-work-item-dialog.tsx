import { Button, Skeleton } from "@taskdesk/ui";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { CreateWorkItemDialogProps } from "./create-work-item-dialog-form";

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
