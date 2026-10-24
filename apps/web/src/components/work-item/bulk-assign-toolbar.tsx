import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@taskdesk/ui";
import { Archive, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BulkAgileActions } from "@/components/agile/bulk-agile-actions";
import { Avatar, AvatarFallback } from "@/components/avatar";
import BulkToolbarPresentation, {
  type BulkActionGroup,
} from "@/components/bulk-selection/bulk-toolbar-presentation";
import { getProjectLabels } from "@/fetchers/label/project-labels";
import bulkAssignWorkItems, {
  type BulkWorkItemsOperationInput,
  bulkWorkItemsOperation,
  requestBulkWorkItemDeletion,
} from "@/fetchers/work-item/bulk-assign-work-items";
import getWorkItem from "@/fetchers/work-item/get-work-item";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useGetProjectStates from "@/hooks/queries/project/use-get-project-states";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import { classifyWorkItemWriteError } from "@/lib/work-item-board";
import { dayToIso } from "@/lib/work-item-date";
import { useOpenChildrenGuard } from "./open-children-warning";
import { creationLabelCatalogue } from "./use-create-work-item-options";

type LocalOperation<T> = T extends unknown
  ? Omit<T, "workspaceId" | "workItemKeys">
  : never;

type BulkResponse = {
  succeeded: string[];
  failed: { id: string; reason: string }[];
};
type AssignmentIntent = {
  workspaceId: string;
  keys: string[];
  selectionKeys: string[];
  preflightFailures: BulkResponse["failed"];
  assigneeId: string;
  name: string;
  observed: Record<string, string | null>;
  holders: { key: string; name: string }[];
  generation: number;
};

/** Original Kaneo presentation; canonical per-item writes and durable deletion only. */
export default function BulkAssignToolbar({
  projectId,
  workspaceId,
  selectedKeys,
  onAssigned,
  onClear,
}: {
  projectId: string;
  workspaceId: string;
  selectedKeys: string[];
  onAssigned: (succeeded: string[]) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const openPendingAction = useOpenPendingAction();
  const permission = useWorkspacePermission(workspaceId, projectId);
  const ready = !permission.isCheckingPermissions;
  const canAssign = ready && permission.canAssignTasks();
  const canPriority = ready && permission.canSetPriorityTasks();
  const canTransition = ready && permission.canTransitionTasks();
  const canUpdate = ready && permission.canUpdateTasks();
  const canDelete = ready && permission.canDeleteTasks();
  const people = useGetAssignablePeople({ projectId, enabled: canAssign });
  const states = useGetProjectStates(projectId, canTransition);
  const globalLabels = useGetLabelsByWorkspace(workspaceId, canUpdate);
  const projectLabels = useQuery({
    queryKey: ["project-labels", projectId],
    queryFn: () => getProjectLabels(projectId),
    enabled: canUpdate,
  });
  const labels = creationLabelCatalogue(
    workspaceId,
    projectId,
    globalLabels.data ?? [],
    projectLabels.data ?? [],
  );
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [result, setResult] = useState<BulkResponse>();
  const [error, setError] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const [confirmation, setConfirmation] = useState<AssignmentIntent>();
  const childrenGuard = useOpenChildrenGuard();
  const busyRef = useRef(false);
  const selectedRef = useRef(selectedKeys);
  selectedRef.current = selectedKeys;
  const lifecycle = useIntentLifecycle(`${workspaceId}:${projectId}`, () => {
    setResult(undefined);
    setError(undefined);
    setConfirmation(undefined);
    setIsActionsOpen(false);
    setIsDatePickerOpen(false);
    setPreparing(false);
    busyRef.current = false;
  });
  const write = useMutation({
    mutationFn: (input: BulkWorkItemsOperationInput) =>
      input.operation === "assign"
        ? bulkAssignWorkItems(input)
        : bulkWorkItemsOperation(input),
  });
  const deletion = useMutation({ mutationFn: requestBulkWorkItemDeletion });
  const isBusy = preparing || write.isPending || deletion.isPending;
  const sameSelection = (keys: string[]) =>
    keys.length === selectedRef.current.length &&
    keys.every((key) => selectedRef.current.includes(key));
  const handleResult = (response: BulkResponse) => {
    setResult(response);
    if (response.succeeded.length && !response.failed.length) {
      toast.success(
        t("workItems:bulk.operationResult", {
          succeeded: response.succeeded.length,
          failed: 0,
        }),
      );
    }
    onAssigned(response.succeeded);
  };
  const invalidate = (keys: string[]) => {
    void queryClient.invalidateQueries({ queryKey: ["work-items", projectId] });
    for (const key of keys) {
      void queryClient.invalidateQueries({
        queryKey: ["work-items", "detail", key],
      });
      void queryClient.invalidateQueries({
        queryKey: ["work-items", "transitions", key],
      });
    }
  };
  const showError = (failure: unknown) =>
    setError(
      t(
        `workItems:bulk.operationFailure.${classifyWorkItemWriteError(failure)}`,
      ),
    );
  async function run(
    input: BulkWorkItemsOperationInput,
    generation = lifecycle.capture(),
    preflightFailures: BulkResponse["failed"] = [],
  ) {
    if (!lifecycle.isCurrent(generation)) return;
    busyRef.current = true;
    setError(undefined);
    setResult(undefined);
    setIsActionsOpen(false);
    setIsDatePickerOpen(false);
    setConfirmation(undefined);
    try {
      const response = await write.mutateAsync(input);
      if (lifecycle.isCurrent(generation))
        handleResult({
          succeeded: response.succeeded,
          failed: [...preflightFailures, ...response.failed],
        });
    } catch (failure) {
      if (lifecycle.isCurrent(generation)) showError(failure);
    } finally {
      invalidate(input.workItemKeys);
      if (lifecycle.isCurrent(generation)) busyRef.current = false;
    }
  }
  function act(input: LocalOperation<BulkWorkItemsOperationInput>) {
    if (busyRef.current || !selectedKeys.length || selectedKeys.length > 500)
      return;
    // Input is built only by the concrete operation callbacks below.
    void run({
      ...input,
      workspaceId,
      workItemKeys: [...selectedKeys],
    } as BulkWorkItemsOperationInput);
  }
  /** `RH-10`: a bulk close asks once about the open children of every selected parent. */
  function transitionTo(toStateTemplateId: string, closing: boolean) {
    if (busyRef.current || !selectedKeys.length || selectedKeys.length > 500)
      return;
    setIsActionsOpen(false);
    void childrenGuard.guard({
      key: [...selectedKeys],
      closing,
      proceed: () => act({ operation: "transition", toStateTemplateId }),
    });
  }
  async function prepareAssignment(assigneeId: string, name: string) {
    if (
      busyRef.current ||
      !canAssign ||
      !selectedKeys.length ||
      selectedKeys.length > 500
    )
      return;
    busyRef.current = true;
    setPreparing(true);
    setError(undefined);
    setResult(undefined);
    setIsActionsOpen(false);
    const generation = lifecycle.capture();
    const keys = [...selectedKeys];
    const observed: Record<string, string | null> = Object.create(null);
    const holders: AssignmentIntent["holders"] = [];
    const preflightFailures: BulkResponse["failed"] = [];
    try {
      // Bounded reads obtain actual current holders, including placeholders. Never
      // derive a person ID from the legacy task store or silently overwrite a holder.
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(8, keys.length) }, async () => {
          while (index < keys.length && lifecycle.isCurrent(generation)) {
            const key = keys[index++];
            try {
              const item = await getWorkItem(key);
              if (
                item.workspaceId !== workspaceId ||
                item.projectId !== projectId
              )
                throw new Error("out of scope");
              observed[key] = item.assigneeId;
              if (item.assigneeId && item.assigneeId !== assigneeId)
                holders.push({
                  key,
                  name: item.assigneeName ?? t("workItems:bulk.unnamedPerson"),
                });
            } catch {
              // No existence or holder disclosure for failed reads; other selected
              // items can still succeed, matching the per-item bulk contract.
              preflightFailures.push({
                id: key,
                reason: t("workItems:bulk.reasonGone"),
              });
            }
          }
        }),
      );
      if (!lifecycle.isCurrent(generation)) return;
      if (!sameSelection(keys)) {
        setError(t("workItems:bulk.selectionUnavailable"));
        return;
      }
      preflightFailures.sort((a, b) => keys.indexOf(a.id) - keys.indexOf(b.id));
      const eligibleKeys = keys.filter((key) => Object.hasOwn(observed, key));
      if (!eligibleKeys.length) {
        handleResult({ succeeded: [], failed: preflightFailures });
        return;
      }
      if (holders.length)
        setConfirmation({
          workspaceId,
          keys: eligibleKeys,
          selectionKeys: keys,
          preflightFailures,
          assigneeId,
          name,
          observed,
          holders: holders.sort(
            (a, b) => keys.indexOf(a.key) - keys.indexOf(b.key),
          ),
          generation,
        });
      else
        await run(
          {
            workspaceId,
            workItemKeys: eligibleKeys,
            operation: "assign",
            assigneeId,
            expectedCurrentAssigneeIds: observed,
          },
          generation,
          preflightFailures,
        );
    } catch {
      if (lifecycle.isCurrent(generation))
        setError(t("workItems:bulk.selectionUnavailable"));
    } finally {
      if (lifecycle.isCurrent(generation)) {
        setPreparing(false);
        busyRef.current = false;
      }
    }
  }
  async function requestDeletion() {
    if (
      busyRef.current ||
      !canDelete ||
      !selectedKeys.length ||
      selectedKeys.length > 500
    )
      return;
    busyRef.current = true;
    const generation = lifecycle.capture();
    const keys = [...selectedKeys];
    setResult(undefined);
    setError(undefined);
    setIsActionsOpen(false);
    try {
      const response = await deletion.mutateAsync({
        workspaceId,
        workItemKeys: keys,
      });
      if (!lifecycle.isCurrent(generation)) return;
      if (response.kind === "pending")
        await openPendingAction({
          pendingActionId: response.pendingActionId,
        });
      else handleResult(response.result);
    } catch (failure) {
      if (lifecycle.isCurrent(generation)) showError(failure);
    } finally {
      if (lifecycle.isCurrent(generation)) busyRef.current = false;
    }
  }
  const groups: BulkActionGroup[] = [];
  if (canDelete || canUpdate)
    groups.push({
      value: "actions",
      label: t("tasks:bulk.actions"),
      items: [
        ...(canDelete
          ? [
              {
                value: "bulk-delete",
                label: t("tasks:bulk.delete"),
                icon: <Trash2 className="h-4 w-4 text-muted-foreground" />,
                onRun: () => void requestDeletion(),
              },
            ]
          : []),
        ...(canUpdate
          ? [
              {
                value: "bulk-archive",
                label: t("tasks:bulk.archive"),
                icon: <Archive className="h-4 w-4 text-muted-foreground" />,
                onRun: () => act({ operation: "archive" }),
              },
            ]
          : []),
      ],
    });
  if (canTransition)
    groups.push({
      value: "status",
      label: t("tasks:bulk.changeStatus"),
      items: (states.data ?? []).map((state) => ({
        value: `state-${state.id}`,
        label: state.name,
        icon: getColumnIcon(
          state.id,
          state.group === "completed" || state.group === "cancelled",
        ),
        onRun: () =>
          transitionTo(
            state.stateTemplateId,
            state.group === "completed" || state.group === "cancelled",
          ),
      })),
    });
  if (canAssign)
    groups.push({
      value: "assign",
      label: t("tasks:bulk.assignTo"),
      items: (people.data ?? []).map((person) => ({
        value: `person-${person.personId}`,
        label: person.name ?? t("workItems:bulk.unnamedPerson"),
        icon: (
          <Avatar className="h-5 w-5">
            <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
          </Avatar>
        ),
        onRun: () =>
          void prepareAssignment(
            person.personId,
            person.name ?? t("workItems:bulk.unnamedPerson"),
          ),
      })),
    });
  if (canPriority)
    groups.push({
      value: "priority",
      label: t("tasks:bulk.setPriority"),
      items: (["urgent", "high", "medium", "low", "no-priority"] as const).map(
        (priority) => ({
          value: `priority-${priority}`,
          label: getPriorityLabel(priority),
          icon: getPriorityIcon(priority),
          onRun: () =>
            act({
              operation: "set_priority",
              priority: priority === "no-priority" ? null : priority,
            }),
        }),
      ),
    });
  if (canUpdate)
    for (const operation of ["add_label", "remove_label"] as const)
      groups.push({
        value: operation,
        label: t(
          `tasks:bulk.${operation === "add_label" ? "addLabel" : "removeLabel"}`,
        ),
        items: labels.map((label) => ({
          value: `${operation}-${label.id}`,
          label: label.name,
          icon: (
            <span
              className="inline-block w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: resolveLabelColor(label.color) }}
            />
          ),
          onRun: () => act({ operation, labelId: label.id }),
        })),
      });
  const backlog = (states.data ?? []).filter(
    (state) => state.group === "backlog",
  );
  const confirmationCurrent =
    confirmation &&
    sameSelection(confirmation.selectionKeys) &&
    lifecycle.isCurrent(confirmation.generation);
  if (
    !ready ||
    !(canAssign || canPriority || canTransition || canUpdate || canDelete)
  )
    return null;
  return (
    <>
      <BulkToolbarPresentation
        selectedCount={selectedKeys.length}
        groupedItems={groups.filter((group) => group.items.length)}
        onClear={onClear}
        onMoveToBacklog={
          canTransition && backlog.length === 1
            ? () =>
                act({
                  operation: "transition",
                  toStateTemplateId: backlog[0].stateTemplateId,
                })
            : undefined
        }
        onDueDateChange={
          canUpdate
            ? (day) =>
                act({ operation: "set_due_date", dueDate: dayToIso(day, null) })
            : undefined
        }
        isActionsOpen={isActionsOpen}
        onActionsOpenChange={setIsActionsOpen}
        isDatePickerOpen={isDatePickerOpen}
        onDatePickerOpenChange={setIsDatePickerOpen}
        busy={isBusy}
        extraActions={
          <BulkAgileActions
            projectId={projectId}
            workspaceId={workspaceId}
            canUpdate={canUpdate}
            selectedKeys={selectedKeys}
            busy={isBusy}
            onDone={(added) => {
              if (added.length) onAssigned(added);
            }}
          />
        }
      >
        {preparing ? (
          <p role="status">{t("workItems:bulk.preparing")}</p>
        ) : null}
        {error ? (
          <Alert variant="error" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {(canAssign && people.isError) ||
        (canTransition && states.isError) ||
        (canUpdate && (globalLabels.isError || projectLabels.isError)) ? (
          <Alert variant="error" role="alert">
            <AlertDescription>
              {t("workItems:bulk.selectionUnavailable")}
            </AlertDescription>
          </Alert>
        ) : null}
        {result ? (
          <Alert
            variant={result.failed.length ? "warning" : "success"}
            role="status"
          >
            <AlertDescription>
              {t("workItems:bulk.operationResult", {
                succeeded: result.succeeded.length,
                failed: result.failed.length,
              })}
              {result.failed.length ? (
                <ul className="mt-2 list-disc pl-5">
                  {result.failed.map((failure) => (
                    <li key={failure.id}>
                      {t("workItems:bulk.failedItem", {
                        key: failure.id,
                        reason: /not found/i.test(failure.reason)
                          ? t("workItems:bulk.reasonGone")
                          : failure.reason,
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </BulkToolbarPresentation>
      {childrenGuard.dialog}
      <AlertDialog
        open={Boolean(confirmationCurrent)}
        onOpenChange={(open) => {
          if (!open) setConfirmation(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("workItems:bulk.confirmReassignTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("workItems:bulk.confirmReassignDescription", {
                name: confirmation?.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-60 overflow-y-auto text-sm">
            {confirmationCurrent
              ? confirmation.holders.map((holder) => (
                  <li key={holder.key}>
                    {t("workItems:bulk.previousHolder", holder)}
                  </li>
                ))
              : null}
          </ul>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              disabled={!confirmationCurrent || !canAssign || isBusy}
              onClick={() => {
                if (confirmationCurrent && canAssign && !busyRef.current)
                  void run(
                    {
                      workspaceId: confirmation.workspaceId,
                      workItemKeys: confirmation.keys,
                      operation: "assign",
                      assigneeId: confirmation.assigneeId,
                      expectedCurrentAssigneeIds: confirmation.observed,
                    },
                    confirmation.generation,
                    confirmation.preflightFailures,
                  );
              }}
            >
              {t("workItems:journey.confirmAssignment")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
