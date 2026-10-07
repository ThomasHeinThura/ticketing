import { Button } from "@taskdesk/ui";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export default function WorkItemCreateTrigger({
  onClick,
  buttonRef,
}: {
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission();

  if (isCheckingPermissions || !canCreateTasks()) return null;

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
