import { Button } from "@taskdesk/ui";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getDefaultAgentTerm } from "@/lib/i18n/agent-translation";
import { WorkItemCreateTriggerPlaceholder } from "./work-item-toolbar-placeholders";

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

  // While permission loads, hold the action's place (invisible, inert) so the toolbar does not
  // grow, and possibly wrap onto a second row, under the loaded board or list (G13).
  if (isCheckingPermissions) return <WorkItemCreateTriggerPlaceholder />;
  if (!canCreate) return null;

  return (
    <ActionTooltip label={getDefaultAgentTerm(i18n, "work_item", 1)}>
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
    </ActionTooltip>
  );
}
