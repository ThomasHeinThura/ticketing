import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  LoadingStatus,
  Skeleton,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

/**
 * Placeholder while the create-workspace dialog's strings load (its `workspace` copy is in the
 * deferred namespace group). It has the shape of the form that follows: the breadcrumb title, the
 * large name and description lines, and the owner row, so the dialog does not resize on reveal.
 * Nothing paints until `visible` (the boundary's ~150 ms delay); the dialog still gets its name
 * from the first frame, and Escape or the backdrop closes it.
 */
export default function CreateWorkspaceModalSkeleton({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const hidden = { visibility: visible ? "visible" : "hidden" } as const;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">
          {t("common:modals.createWorkspace.title")}
        </DialogTitle>
        <LoadingStatus visible={visible} label={t("common:empty.loading")}>
          <DialogHeader>
            <Skeleton className="h-5 w-44" style={hidden} />
          </DialogHeader>
          <div
            className="flex flex-col gap-4 px-6 pb-6"
            aria-busy="true"
            data-testid="create-workspace-modal-loading"
          >
            <Skeleton className="h-8 w-3/4" style={hidden} />
            <Skeleton className="h-6 w-1/2" style={hidden} />
            <Skeleton className="h-9 w-full" style={hidden} />
          </div>
        </LoadingStatus>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog when its strings failed to load: the error and a retry sit inside a dialog the user
 * can dismiss (Escape, backdrop or Close), so a failed load never leaves an open state behind.
 */
export function CreateWorkspaceModalError({
  onRetry,
  onClose,
}: {
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        className="max-w-md"
        showCloseButton={false}
        data-testid="create-workspace-modal-error"
      >
        <DialogHeader>
          <DialogTitle>{t("common:modals.createWorkspace.title")}</DialogTitle>
        </DialogHeader>
        <DialogPanel role="alert">
          {t("common:error.messages.unknown")}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("common:actions.close")}
          </Button>
          <Button type="button" size="sm" onClick={onRetry}>
            {t("common:actions.retry")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
