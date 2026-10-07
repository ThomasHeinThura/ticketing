import { Button, ErrorBoundary, Skeleton } from "@taskdesk/ui";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

type DialogModule = typeof import("./work-item-create-dialog-shell");
type Props = Parameters<DialogModule["default"]>[0];

let dialogModulePromise: Promise<DialogModule> | undefined;

function loadDialog(): Promise<DialogModule> {
  if (!dialogModulePromise) {
    dialogModulePromise = import("./work-item-create-dialog-shell").catch(
      (error: unknown) => {
        dialogModulePromise = undefined;
        throw error;
      },
    );
  }
  return dialogModulePromise;
}

function LoadingDialog() {
  const { t } = useTranslation();
  return (
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
    </div>
  );
}

export default function WorkItemCreateDialogLoader(props: Props) {
  const { t } = useTranslation();
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission();
  const canCreate = !isCheckingPermissions && canCreateTasks();
  const [DialogShell, setDialogShell] = useState(() => lazy(loadDialog));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!canCreate) props.onClose();
  }, [canCreate, props.onClose]);

  const retry = () => {
    dialogModulePromise = undefined;
    setDialogShell(() => lazy(loadDialog));
    setAttempt((current) => current + 1);
  };

  if (!canCreate) return null;

  return (
    <ErrorBoundary
      key={attempt}
      fallback={() => (
        <div role="alert" className="flex flex-col gap-3">
          <p>{t("common:error.title")}</p>
          <Button size="sm" variant="outline" onClick={retry}>
            {t("common:error.tryAgain")}
          </Button>
        </div>
      )}
    >
      <Suspense fallback={<LoadingDialog />}>
        <DialogShell {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
