import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ContextMenuItem,
} from "@taskdesk/ui";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RemoveFromScopeItem } from "@/components/agile/remove-from-scope-item";
import { ScopedMembershipContext } from "@/components/agile/scoped-membership-context";
import TaskContextMenuPresentation from "@/components/kanban-board/task-card-context-menu/task-context-menu-presentation";
import archiveWorkItem from "@/fetchers/work-item/archive-work-item";
import assignWorkItem from "@/fetchers/work-item/assign-work-item";
import getAssignablePeople from "@/fetchers/work-item/get-assignable-people";
import getWorkItem from "@/fetchers/work-item/get-work-item";
import getWorkItemTransitions from "@/fetchers/work-item/get-work-item-transitions";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";
import unassignWorkItem from "@/fetchers/work-item/unassign-work-item";
import updateWorkItem from "@/fetchers/work-item/update-work-item";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import { dayToIso, isoToDay } from "@/lib/work-item-date";
import {
  isWorkItemAccessLost,
  WorkItemVersionConflictError,
} from "@/lib/work-item-errors";
import {
  WorkItemTransitionBlockedError,
  workItemTransitionReasonKey,
} from "@/lib/work-item-transition-reasons";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { WorkItemDetailRow } from "@/types/work-item";
import MoveWorkItemDialog from "./move-work-item-dialog";
import {
  isClosingCategory,
  useOpenChildrenGuard,
} from "./open-children-warning";
import { useWorkItemDeletion } from "./use-work-item-deletion";
import {
  cachedWorkItem,
  currentWorkItemVersion,
  useRefreshWorkItem,
  workItemDetailKey,
  workItemMutationScope,
  writeWorkItemResponse,
} from "./work-item-save";

type Props = {
  itemKey: string;
  workspaceId: string;
  projectId: string;
  open: boolean;
  onClose: () => void;
  keyboardAnchor?: HTMLElement;
};
export default function WorkItemContextMenuContent(props: Props) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: workItemDetailKey(props.itemKey),
    queryFn: () => getWorkItem(props.itemKey),
    enabled: props.open,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const onAccessLost = useCallback(() => {
    props.onClose();
    client.removeQueries({ queryKey: workItemDetailKey(props.itemKey) });
    void client.invalidateQueries({
      queryKey: ["work-items", props.projectId],
    });
  }, [client, props.onClose, props.itemKey, props.projectId]);
  useEffect(() => {
    if (isWorkItemAccessLost(detail.error)) onAccessLost();
  }, [detail.error, onAccessLost]);
  const item = detail.data;
  const scoped =
    item?.key === props.itemKey &&
    item.projectId === props.projectId &&
    item.workspaceId === props.workspaceId;
  const ready = scoped && detail.isFetchedAfterMount && !detail.isError;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(
          routes.workItemDetail.build({ key: props.itemKey }),
          window.location.origin,
        ).href,
      );
      toast.success(t("tasks:contextMenu.copyLinkSuccess"));
    } catch {
      toast.error(t("common:error.description"));
    }
  };
  if (!ready || !item)
    return (
      <TaskContextMenuPresentation
        keyboardAnchor={props.keyboardAnchor}
        onCopyLink={() => void copyLink()}
        status={
          <ContextMenuItem disabled>
            {t(
              detail.isError
                ? "workItems:properties.saveFailed"
                : "common:empty.loading",
            )}
          </ContextMenuItem>
        }
      />
    );
  return (
    <CanonicalMenuActions
      {...props}
      item={item}
      ready={!detail.isFetching}
      onCopyLink={() => void copyLink()}
      onAccessLost={onAccessLost}
    />
  );
}

type Command =
  | { kind: "priority"; value: "low" | "medium" | "high" | "urgent" | null }
  | { kind: "dueDate"; day?: Date }
  | { kind: "state"; transitionId: string }
  | { kind: "assign"; personId: string | null; holder: string | null }
  | { kind: "archive" };
function CanonicalMenuActions({
  item,
  open,
  ready,
  onClose,
  onCopyLink,
  onAccessLost,
  keyboardAnchor,
}: Props & {
  item: WorkItemDetailRow;
  ready: boolean;
  onCopyLink: () => void;
  onAccessLost: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const scopedMembership = useContext(ScopedMembershipContext);
  const permission = useWorkspacePermission(item.workspaceId, item.projectId);
  const refresh = useRefreshWorkItem(item);
  const lifecycle = useIntentLifecycle(
    `${item.workspaceId}:${item.projectId}:${item.key}`,
    () => setConfirmation(undefined),
  );
  const [confirmation, setConfirmation] = useState<{
    personId: string;
    holder: string;
  }>();
  const [moveOpen, setMoveOpen] = useState(false);
  const childrenGuard = useOpenChildrenGuard();
  const busy = useRef(false);
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const canAct = ready && !permission.isCheckingPermissions;
  const canEdit = canAct && permission.canUpdateTasks();
  const canAssign =
    canAct && (permission.canAssignTasks() || permission.canUpdateTasks());
  const offers = useQuery({
    queryKey: ["work-items", "transitions", item.key],
    queryFn: () => getWorkItemTransitions(item.key),
    enabled: open && canAct && permission.canTransitionTasks(),
    staleTime: 0,
  });
  const people = useQuery({
    queryKey: ["projects", item.projectId, "assignable"],
    queryFn: () => getAssignablePeople(item.projectId),
    enabled: open && canAssign,
    staleTime: 0,
  });
  useEffect(() => {
    if (
      isWorkItemAccessLost(offers.error) ||
      isWorkItemAccessLost(people.error)
    )
      onAccessLost();
  }, [offers.error, people.error, onAccessLost]);
  const offersReady =
    offers.isFetchedAfterMount && !offers.isFetching && !offers.isError;
  const peopleReady =
    people.isFetchedAfterMount && !people.isFetching && !people.isError;
  const deletion = useWorkItemDeletion(item, onAccessLost);
  useEffect(() => {
    if (deletion.failed) toast.error(t("workItems:deletion.requestFailed"));
  }, [deletion.failed, t]);
  const mutation = useMutation({
    scope: workItemMutationScope(item.key),
    mutationFn: async (command: Command) => {
      const current = cachedWorkItem(client, item);
      if (
        current.workspaceId !== item.workspaceId ||
        current.projectId !== item.projectId ||
        current.archivedAt ||
        current.deletedAt
      )
        throw new HttpError(404, "Work item not found");
      if (command.kind === "priority" || command.kind === "dueDate") {
        const fields =
          command.kind === "priority"
            ? { priority: command.value }
            : { dueDate: dayToIso(command.day, current.dueDate) };
        const response = await updateWorkItem({
          key: item.key,
          version: currentWorkItemVersion(client, item),
          ...fields,
        });
        writeWorkItemResponse(client, item.key, response, fields);
      } else if (command.kind === "state") {
        const available = offers.data?.find(
          (offer) =>
            offer.transitionId === command.transitionId && offer.available,
        );
        if (!available) throw new HttpError(422, "Unavailable transition");
        const response = await transitionWorkItem({
          key: item.key,
          toStateTemplateId: available.toStateTemplateId,
        });
        writeWorkItemResponse(client, item.key, response, {});
      } else if (command.kind === "assign") {
        const response =
          command.personId === null
            ? await unassignWorkItem(item.key, command.holder)
            : await assignWorkItem({
                key: item.key,
                assigneeId: command.personId,
                expectedCurrentAssigneeId: command.holder,
              });
        const person = people.data?.find(
          (candidate) => candidate.personId === command.personId,
        );
        writeWorkItemResponse(client, item.key, response, {
          assigneeId: command.personId,
          assigneeName: person?.name ?? null,
        });
      } else {
        await archiveWorkItem({
          key: item.key,
          version: currentWorkItemVersion(client, item),
        });
      }
    },
  });
  async function execute(command: Command) {
    if (!canAct || busy.current || mutation.isPending || deletion.isPending)
      return;
    if (
      (command.kind === "priority" &&
        (!canEdit || !permission.canSetPriorityTasks())) ||
      ((command.kind === "dueDate" || command.kind === "archive") &&
        !canEdit) ||
      (command.kind === "state" && !permission.canTransitionTasks()) ||
      (command.kind === "assign" && !canAssign)
    )
      return;
    if (command.kind === "state" && !offersReady) return;
    if (
      command.kind === "assign" &&
      (!peopleReady ||
        (command.personId === null && !canUnassign) ||
        (command.personId !== null &&
          !people.data?.some((person) => person.personId === command.personId)))
    )
      return;
    const current = cachedWorkItem(client, item);
    if (
      (command.kind === "priority" && current.priority === command.value) ||
      (command.kind === "dueDate" &&
        current.dueDate === dayToIso(command.day, current.dueDate)) ||
      (command.kind === "assign" && current.assigneeId === command.personId)
    )
      return;
    if (command.kind === "state") {
      // `RH-10` / `WI-18`: closing a parent that still has open children asks first.
      const offer = offers.data?.find(
        (candidate) => candidate.transitionId === command.transitionId,
      );
      if (
        offer &&
        isClosingCategory(offer.toStateCategory) &&
        !isClosingCategory(item.stateCategory)
      ) {
        onClose();
        void childrenGuard.guard({
          key: item.key,
          closing: true,
          proceed: () => void run(command),
        });
        return;
      }
    }
    void run(command);
  }
  async function run(command: Command) {
    if (busy.current) return;
    busy.current = true;
    const intent = lifecycle.capture();
    onClose();
    try {
      await mutation.mutateAsync(command);
      if (lifecycle.isCurrent(intent)) {
        setConfirmation(undefined);
        toast.success(t("tasks:update.success"));
      }
    } catch (error) {
      if (!lifecycle.isCurrent(intent)) return;
      setConfirmation(undefined);
      if (isWorkItemAccessLost(error)) onAccessLost();
      else
        toast.error(
          error instanceof WorkItemVersionConflictError
            ? t("workItems:properties.conflict")
            : error instanceof WorkItemTransitionBlockedError
              ? t("workItems:board.transitionBlocked", {
                  key: item.key,
                  reason: error.reasonCodes
                    .map((code) => t(workItemTransitionReasonKey(code)))
                    .join(", "),
                })
              : command.kind === "assign" &&
                  error instanceof HttpError &&
                  error.status === 409
                ? t("workItems:journey.assignmentConflict")
                : t("workItems:properties.saveFailed"),
        );
    } finally {
      busy.current = false;
      try {
        await refresh();
      } catch {
        if (lifecycle.isCurrent(intent))
          toast.error(t("common:error.description"));
      }
    }
  }
  function choosePerson(personId: string) {
    if (!canAssign) return;
    const holder = cachedWorkItem(client, item).assigneeId;
    if (
      personId &&
      !people.data?.some((person) => person.personId === personId)
    )
      return;
    if (personId && holder && holder !== personId) {
      setConfirmation({ personId, holder });
      onClose();
      return;
    }
    void execute({ kind: "assign", personId: personId || null, holder });
  }
  const canUnassign =
    peopleReady &&
    item.assigneeId !== null &&
    (permission.canAssignTasks() ||
      (permission.canUpdateTasks() &&
        people.data?.some((person) => person.personId === item.assigneeId)));
  const confirmationStillCurrent =
    confirmation &&
    confirmation.holder === item.assigneeId &&
    people.data?.some((person) => person.personId === confirmation.personId);
  return (
    <>
      <TaskContextMenuPresentation
        keyboardAnchor={keyboardAnchor}
        onCopyLink={onCopyLink}
        disabled={mutation.isPending || deletion.isPending || !ready}
        priority={
          canEdit &&
          permission.canSetPriorityTasks() &&
          !item.unavailableFields.includes("priority")
            ? {
                value: item.priority,
                onChange: (value) =>
                  void execute({
                    kind: "priority",
                    value:
                      value === "no-priority"
                        ? null
                        : (value as "low" | "medium" | "high" | "urgent"),
                  }),
              }
            : undefined
        }
        states={
          canAct && permission.canTransitionTasks() && !offers.isError
            ? {
                value: item.stateId,
                options: (offersReady ? (offers.data ?? []) : []).map(
                  (offer) => ({
                    value: offer.transitionId,
                    name: offer.available
                      ? offer.toStateName
                      : `${offer.toStateName} (${offer.blockedBy.map((reason) => t(workItemTransitionReasonKey(reason.reasonCode))).join(", ")})`,
                    disabled: !offer.available,
                  }),
                ),
                onChange: (transitionId) =>
                  void execute({ kind: "state", transitionId }),
                emptyLabel: t(
                  !offersReady
                    ? "workItems:journey.loadingTransitions"
                    : "workItems:journey.transitionsEmpty",
                ),
              }
            : undefined
        }
        dueDate={
          canEdit && !item.unavailableFields.includes("dueDate")
            ? {
                value: isoToDay(item.dueDate),
                weekStartsOn,
                onChange: (day) => void execute({ kind: "dueDate", day }),
              }
            : undefined
        }
        assignee={
          canAssign && !people.isError
            ? {
                value: item.assigneeId,
                options: (peopleReady ? (people.data ?? []) : []).map(
                  (person) => ({
                    value: person.personId,
                    label: person.name ?? t("workItems:journey.unnamedPerson"),
                    name: person.name ?? "",
                  }),
                ),
                onChange: choosePerson,
                canUnassign: Boolean(canUnassign),
                emptyLabel: t(
                  !peopleReady
                    ? "workItems:journey.loadingPeople"
                    : "workItems:journey.noPeople",
                ),
              }
            : undefined
        }
        onArchive={
          canEdit ? () => void execute({ kind: "archive" }) : undefined
        }
        extraArchiveAction={
          (canEdit && permission.canCreateTasks()) ||
          (canEdit && scopedMembership?.canEdit) ? (
            <>
              {canEdit && permission.canCreateTasks() ? (
                <ContextMenuItem
                  onClick={() => {
                    onClose();
                    setMoveOpen(true);
                  }}
                >
                  <span>{t("workItems:move.action")}</span>
                </ContextMenuItem>
              ) : null}
              {canEdit && scopedMembership?.canEdit ? (
                <RemoveFromScopeItem
                  membership={scopedMembership}
                  itemKey={item.key}
                  onClose={onClose}
                />
              ) : null}
            </>
          ) : undefined
        }
        onDelete={
          canAct && deletion.canRequest
            ? () => {
                if (busy.current || mutation.isPending) return;
                const returnFocusAnchor = keyboardAnchor;
                onClose();
                void deletion.requestDeletion(() =>
                  returnFocusAnchor?.isConnected ? returnFocusAnchor : false,
                );
              }
            : undefined
        }
        status={
          deletion.failed || offers.isError || people.isError ? (
            <ContextMenuItem disabled>
              {t(
                deletion.failed
                  ? "workItems:deletion.requestFailed"
                  : offers.isError
                    ? "workItems:journey.transitionsError"
                    : "workItems:journey.peopleError",
              )}
            </ContextMenuItem>
          ) : undefined
        }
      />
      {childrenGuard.dialog}
      <MoveWorkItemDialog
        item={item}
        open={moveOpen}
        onOpenChange={setMoveOpen}
      />
      <AlertDialog
        open={Boolean(confirmationStillCurrent)}
        onOpenChange={(next) => {
          if (!next) setConfirmation(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("workItems:journey.confirmReassign")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("workItems:journey.confirmReassignDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              size="sm"
              disabled={mutation.isPending || !canAssign}
              onClick={() => {
                if (confirmationStillCurrent && confirmation)
                  void execute({
                    kind: "assign",
                    personId: confirmation.personId,
                    holder: confirmation.holder,
                  });
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
