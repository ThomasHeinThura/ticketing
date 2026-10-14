import { Button } from "@taskdesk/ui";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export default function WorkItemCreateTrigger({
  onClick,
  buttonRef,
  pending = false,
}: {
  onClick: () => void;
  /** The dialog code is still loading after a click. */
  pending?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission();
  const canCreate = !isCheckingPermissions && canCreateTasks();

  if (!canCreate) return null;

  return (
    <Button
      ref={buttonRef}
      size="sm"
      loading={pending}
      aria-busy={pending || undefined}
      onClick={onClick}
      data-testid="create-work-item-trigger"
    >
      {t("workItems:create.trigger")}
    </Button>
  );
}
