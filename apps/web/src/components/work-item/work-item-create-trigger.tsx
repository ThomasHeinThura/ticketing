import { Button } from "@taskdesk/ui";
import { type Ref, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { preloadWorkItemCreateDialogShell } from "./work-item-create-dialog-shell-loader";

export default function WorkItemCreateTrigger({
  onClick,
  buttonRef,
}: {
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission();
  const canCreate = !isCheckingPermissions && canCreateTasks();

  // Warm the dialog composition once create intent is possible; it is not on the route's
  // initial graph (G11).
  useEffect(() => {
    if (canCreate) preloadWorkItemCreateDialogShell();
  }, [canCreate]);

  if (!canCreate) return null;

  return (
    <Button
      ref={buttonRef}
      size="sm"
      onClick={onClick}
      data-testid="create-work-item-trigger"
    >
      {t("workItems:create.trigger")}
    </Button>
  );
}
