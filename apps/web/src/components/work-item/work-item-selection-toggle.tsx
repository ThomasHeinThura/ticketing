import { Button } from "@taskdesk/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { WorkItemSelectionTogglePlaceholder } from "./work-item-toolbar-placeholders";

/**
 * The "Select items" switch for bulk actions. It lives in its own chunk so the work route does
 * not statically import the capability hook (G11 route graph), and it reports the per-action
 * capability union upward so the list and board can show their per-row controls only while
 * selection mode is on and the capability is present. Nothing renders without the capability;
 * the server still enforces every bulk write.
 */
export default function WorkItemSelectionToggle({
  workspaceId,
  projectId,
  selectionMode,
  onToggle,
  onCapabilityChange,
}: {
  workspaceId?: string;
  projectId?: string;
  selectionMode: boolean;
  onToggle: () => void;
  onCapabilityChange: (canBulkAct: boolean) => void;
}) {
  const { t } = useTranslation();
  const {
    canAssignTasks,
    canUpdateTasks,
    canSetPriorityTasks,
    canTransitionTasks,
    canDeleteTasks,
    isCheckingPermissions,
  } = useWorkspacePermission(workspaceId, projectId);
  const canBulkAct =
    !isCheckingPermissions &&
    (canAssignTasks() ||
      canUpdateTasks() ||
      (canSetPriorityTasks?.() ?? false) ||
      (canTransitionTasks?.() ?? false) ||
      (canDeleteTasks?.() ?? false));

  useEffect(() => {
    onCapabilityChange(canBulkAct);
    return () => onCapabilityChange(false);
  }, [canBulkAct, onCapabilityChange]);

  // While the capabilities load, hold the switch's place (invisible, inert) so the toolbar
  // does not grow, and possibly wrap onto a second row, under the loaded board or list (G13).
  if (isCheckingPermissions) return <WorkItemSelectionTogglePlaceholder />;
  if (!canBulkAct) return null;
  return (
    <Button
      variant={selectionMode ? "secondary" : "outline"}
      size="sm"
      aria-pressed={selectionMode}
      onClick={onToggle}
    >
      {t("workItems:bulk.selectMode")}
    </Button>
  );
}
