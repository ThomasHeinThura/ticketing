import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@taskdesk/ui";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { CreateWorkItemDialogProps } from "./create-work-item-dialog-form";

const CreateWorkItemDialogForm = lazy(
  () => import("./create-work-item-dialog-form"),
);

type Props = CreateWorkItemDialogProps & { open: boolean };

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
        <Suspense
          fallback={
            <>
              <DialogHeader>
                <DialogTitle>{t("workItems:create.title")}</DialogTitle>
                <DialogDescription>
                  {t("workItems:create.description")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4" aria-busy="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-9 w-32 self-end" />
              </div>
            </>
          }
        >
          <CreateWorkItemDialogForm
            onClose={onClose}
            projectId={projectId}
            workspaceId={workspaceId}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
