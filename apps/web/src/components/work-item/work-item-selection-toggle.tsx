import { Button } from "@taskdesk/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

/**
 * The "Select items" switch for bulk actions. It lives in its own chunk so the work route does
 * not statically import the capability hook (G11 route graph), and it reports the strict
 * `assignTasks` result upward so the list and board can show their per-row controls only while
 * selection mode is on and the capability is present. Nothing renders without the capability;
 * the server still enforces every bulk write.
 */
export default function WorkItemSelectionToggle({
  selectionMode,
  onToggle,
  onCapabilityChange,
}: {
  selectionMode: boolean;
  onToggle: () => void;
  onCapabilityChange: (canAssign: boolean) => void;
}) {
  const { t } = useTranslation();
  const {
    canAssignTasks,
    canSetPriorityTasks,
    canTransitionTasks,
    canDeleteTasks,
    isCheckingPermissions,
  } = useWorkspacePermission();
  const canBulkAct =
    !isCheckingPermissions &&
    (canAssignTasks() ||
      (canSetPriorityTasks?.() ?? false) ||
      (canTransitionTasks?.() ?? false) ||
      (canDeleteTasks?.() ?? false));

  useEffect(() => {
    onCapabilityChange(canBulkAct);
    return () => onCapabilityChange(false);
  }, [canBulkAct, onCapabilityChange]);

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
