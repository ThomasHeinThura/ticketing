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
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CreateWorkItemDialogProps } from "./create-work-item-dialog-form";

type FormModule = typeof import("./create-work-item-dialog-form");

let formModulePromise: Promise<FormModule> | undefined;

function loadCreateWorkItemDialogForm(): Promise<FormModule> {
  if (!formModulePromise) {
    formModulePromise = import("./create-work-item-dialog-form").catch(
      (error: unknown) => {
        formModulePromise = undefined;
        throw error;
      },
    );
  }
  return formModulePromise;
}

type Props = CreateWorkItemDialogProps & { open: boolean };

type ContentProps = CreateWorkItemDialogProps;

export function CreateWorkItemDialogContent({
  onClose,
  projectId,
  workspaceId,
}: ContentProps) {
  const [Form] = useState(() => lazy(loadCreateWorkItemDialogForm));
  const { t } = useTranslation();

  const retry = () => {
    window.location.reload();
  };

  return (
    <ErrorBoundary
      fallback={() => (
        <div role="alert" className="flex flex-col gap-3">
          <p>{t("common:error.title")}</p>
          <Button size="sm" variant="outline" onClick={retry}>
            {t("common:error.tryAgain")}
          </Button>
        </div>
      )}
    >
      <Suspense
        fallback={
          <div
            className="flex flex-col gap-4"
            role="status"
            aria-busy="true"
            aria-live="polite"
            data-testid="create-work-item-dialog-loading"
          >
            <span className="sr-only">{t("common:empty.loading")}</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-9 w-32 self-end" />
          </div>
        }
      >
        <Form
          onClose={onClose}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      </Suspense>
    </ErrorBoundary>
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
        <CreateWorkItemDialogContent
          onClose={onClose}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      </DialogContent>
    </Dialog>
  );
}
