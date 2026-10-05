import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export default function WorkItemCreateTrigger({
  onPreload,
  onClick,
}: {
  onPreload: () => void;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission();

  if (isCheckingPermissions || !canCreateTasks()) return null;

  return (
    <Button
      size="sm"
      onPointerEnter={onPreload}
      onFocus={onPreload}
      onClick={onClick}
      data-testid="create-work-item-trigger"
    >
      {t("workItems:create.trigger")}
    </Button>
  );
}
