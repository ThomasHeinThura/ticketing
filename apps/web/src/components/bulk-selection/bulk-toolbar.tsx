import { Archive } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import { useBulkOperations } from "@/hooks/mutations/task/use-bulk-operations";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useBulkSelectionKeyboardShortcuts } from "@/hooks/use-bulk-selection-keyboard-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import BulkToolbarPresentation, {
  type BulkActionGroup,
} from "./bulk-toolbar-presentation";

function BulkToolbar({
  keyboardShortcutsEnabled = true,
}: {
  keyboardShortcutsEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const { selectedTaskIds, clearSelection } = useBulkSelectionStore();
  const selectedCount = selectedTaskIds.size;

  const priorityOptions = useMemo(
    () => [
      { value: "urgent", label: getPriorityLabel("urgent") },
      { value: "high", label: getPriorityLabel("high") },
      { value: "medium", label: getPriorityLabel("medium") },
      { value: "low", label: getPriorityLabel("low") },
      { value: "no-priority", label: getPriorityLabel("no-priority") },
    ],
    [],
  );
  const { project } = useProjectStore();
  const {
    bulkMoveToBacklog,
    bulkArchive,
    bulkChangeStatus,
    bulkAssign,
    bulkPriority,
    bulkAddLabel,
    bulkDueDate,
  } = useBulkOperations();
  const { data: workspace } = useActiveWorkspace();
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    workspace?.id ?? "",
    selectedCount > 0,
  );
  const { data: workspaceLabels = [] } = useGetLabelsByWorkspace(
    workspace?.id ?? "",
    selectedCount > 0,
  );
  const { canUpdateTasks, canAssignTasks, canUpdateLabels } =
    useWorkspacePermission();
  const canEdit = canUpdateTasks();
  const canAssign = canAssignTasks();
  const canEditLabels = canUpdateLabels();
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const uniqueLabels = useMemo(() => {
    const labelMap = new Map<string, (typeof workspaceLabels)[0]>();
    for (const label of workspaceLabels) {
      const existing = labelMap.get(label.name);
      if (!existing || (label.taskId === null && existing.taskId !== null)) {
        labelMap.set(label.name, label);
      }
    }
    return Array.from(labelMap.values());
  }, [workspaceLabels]);

  useBulkSelectionKeyboardShortcuts(keyboardShortcutsEnabled);

  const handleMoveToBacklog = useCallback(async () => {
    try {
      await bulkMoveToBacklog(Array.from(selectedTaskIds));
      toast.success(
        t("tasks:bulk.moveToBacklogSuccess", { count: selectedCount }),
      );
      clearSelection();
    } catch (_error) {
      toast.error(t("tasks:bulk.moveToBacklogError"));
    }
  }, [bulkMoveToBacklog, selectedTaskIds, selectedCount, clearSelection, t]);

  const handleBulkArchive = useCallback(async () => {
    try {
      await bulkArchive(Array.from(selectedTaskIds));
      toast.success(t("tasks:bulk.archiveSuccess", { count: selectedCount }));
      clearSelection();
      setIsActionsOpen(false);
    } catch (_error) {
      toast.error(t("tasks:bulk.archiveError"));
    }
  }, [bulkArchive, selectedTaskIds, selectedCount, clearSelection, t]);

  const handleBulkChangeStatus = useCallback(
    async (status: string) => {
      try {
        await bulkChangeStatus({
          taskIds: Array.from(selectedTaskIds),
          status,
        });
        toast.success(t("tasks:bulk.updateSuccess", { count: selectedCount }));
        clearSelection();
        setIsActionsOpen(false);
      } catch (_error) {
        toast.error(t("tasks:bulk.updateError"));
      }
    },
    [bulkChangeStatus, selectedTaskIds, selectedCount, clearSelection, t],
  );

  const handleBulkAssign = useCallback(
    async (userId: string) => {
      try {
        await bulkAssign({ taskIds: Array.from(selectedTaskIds), userId });
        toast.success(t("tasks:bulk.assignSuccess", { count: selectedCount }));
        clearSelection();
        setIsActionsOpen(false);
      } catch (_error) {
        toast.error(t("tasks:bulk.assignError"));
      }
    },
    [bulkAssign, selectedTaskIds, selectedCount, clearSelection, t],
  );

  const handleBulkPriority = useCallback(
    async (priority: string) => {
      try {
        await bulkPriority({
          taskIds: Array.from(selectedTaskIds),
          priority,
        });
        toast.success(t("tasks:bulk.updateSuccess", { count: selectedCount }));
        clearSelection();
        setIsActionsOpen(false);
      } catch (_error) {
        toast.error(t("tasks:bulk.updatePriorityError"));
      }
    },
    [bulkPriority, selectedTaskIds, selectedCount, clearSelection, t],
  );

  const handleBulkAddLabel = useCallback(
    async (labelId: string) => {
      try {
        await bulkAddLabel({
          taskIds: Array.from(selectedTaskIds),
          labelId,
        });
        toast.success(
          t("tasks:bulk.addLabelSuccess", { count: selectedCount }),
        );
        clearSelection();
        setIsActionsOpen(false);
      } catch (_error) {
        toast.error(t("tasks:bulk.addLabelError"));
      }
    },
    [bulkAddLabel, selectedTaskIds, selectedCount, clearSelection, t],
  );

  const handleBulkDueDate = useCallback(
    async (date: Date | undefined) => {
      try {
        await bulkDueDate({
          taskIds: Array.from(selectedTaskIds),
          dueDate: date?.toISOString() ?? null,
        });
        toast.success(t("tasks:bulk.updateSuccess", { count: selectedCount }));
        clearSelection();
        setIsDatePickerOpen(false);
      } catch (_error) {
        toast.error(t("tasks:bulk.updateDueDateError"));
      }
    },
    [bulkDueDate, selectedTaskIds, selectedCount, clearSelection, t],
  );

  const groupedItems = useMemo<BulkActionGroup[]>(() => {
    const groups: BulkActionGroup[] = [];
    if (canEdit) {
      groups.push({
        value: "actions",
        label: t("tasks:bulk.actions"),
        items: [
          ...(canEdit
            ? [
                {
                  value: "bulk-archive",
                  label: t("tasks:bulk.archive"),
                  icon: <Archive className="h-4 w-4 text-muted-foreground" />,
                  onRun: () => {
                    void handleBulkArchive();
                  },
                },
              ]
            : []),
        ],
      });
    }
    if (canEdit) {
      groups.push({
        value: "status",
        label: t("tasks:bulk.changeStatus"),
        items: (project?.columns ?? []).map((col) => ({
          value: `status-${col.id}`,
          label: col.name,
          icon: getColumnIcon(col.id, col.isFinal, col.icon),
          onRun: () => {
            void handleBulkChangeStatus(col.id);
          },
        })),
      });
    }
    if (canAssign) {
      groups.push({
        value: "assign",
        label: t("tasks:bulk.assignTo"),
        items: (workspaceUsers?.members ?? []).map((member) => ({
          value: `assign-${member.userId}`,
          label: member.user?.name || t("common:people.someone"),
          icon: (
            <Avatar className="h-5 w-5">
              <AvatarImage
                src={member.user?.image ?? ""}
                alt={member.user?.name || ""}
              />
              <AvatarFallback className="text-xs font-medium border border-border/30">
                {getInitials(member.user?.name)}
              </AvatarFallback>
            </Avatar>
          ),
          onRun: () => {
            void handleBulkAssign(member.userId);
          },
        })),
      });
    }
    if (canEdit) {
      groups.push({
        value: "priority",
        label: t("tasks:bulk.setPriority"),
        items: priorityOptions.map((opt) => ({
          value: `priority-${opt.value}`,
          label: opt.label,
          icon: getPriorityIcon(opt.value),
          onRun: () => {
            void handleBulkPriority(opt.value);
          },
        })),
      });
    }
    if (canEditLabels) {
      groups.push({
        value: "label",
        label: t("tasks:bulk.addLabel"),
        items: uniqueLabels.map((label) => ({
          value: `label-${label.id}`,
          label: label.name,
          icon: (
            <span
              className="inline-block w-3 h-3 rounded-full shrink-0"
              style={{
                backgroundColor: resolveLabelColor(label.color),
              }}
            />
          ),
          onRun: () => {
            void handleBulkAddLabel(label.id);
          },
        })),
      });
    }
    return groups;
  }, [
    canEdit,
    canAssign,
    canEditLabels,
    project?.columns,
    workspaceUsers?.members,
    uniqueLabels,
    handleBulkArchive,
    handleBulkChangeStatus,
    handleBulkAssign,
    handleBulkPriority,
    handleBulkAddLabel,
    priorityOptions,
    t,
  ]);

  if (selectedCount === 0) return null;
  // Nothing the user can do in bulk → no toolbar.
  if (!canEdit && !canAssign && !canEditLabels) return null;

  return (
    <BulkToolbarPresentation
      selectedCount={selectedCount}
      groupedItems={groupedItems}
      onClear={clearSelection}
      onMoveToBacklog={canEdit ? () => void handleMoveToBacklog() : undefined}
      onDueDateChange={
        canEdit ? (date) => void handleBulkDueDate(date) : undefined
      }
      isActionsOpen={isActionsOpen}
      onActionsOpenChange={setIsActionsOpen}
      isDatePickerOpen={isDatePickerOpen}
      onDatePickerOpenChange={setIsDatePickerOpen}
    />
  );
}

export default BulkToolbar;
