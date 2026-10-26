import { Button } from "@taskdesk/ui";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getDefaultAgentTerm } from "@/lib/i18n/agent-translation";

export default function WorkItemCreateTrigger({
  workspaceId,
  projectId,
  onClick,
  buttonRef,
  pending = false,
}: {
  workspaceId: string;
  projectId: string;
  onClick: () => void;
  /** The dialog code is still loading after a click. */
  pending?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const { t, i18n } = useTranslation();
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission(
    workspaceId,
    projectId,
  );
  const canCreate = !isCheckingPermissions && canCreateTasks();

  if (!canCreate) return null;

  return (
    <Button
      ref={buttonRef}
      size="sm"
      loading={pending}
      aria-busy={pending || undefined}
      onClick={onClick}
      title={getDefaultAgentTerm(i18n, "work_item", 1)}
      data-testid="create-work-item-trigger"
    >
      {t("workItems:create.trigger")}
    </Button>
  );
}
