import { dayToIso, isoToDay } from "@/lib/work-item-date";

export { dayToIso, isoToDay } from "@/lib/work-item-date";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Calendar,
  Fieldset,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ShortcutNumber,
  Textarea,
} from "@taskdesk/ui";
import {
  CalendarClock,
  CalendarDays,
  Check,
  Copy,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/avatar";
import { TaskPropertiesPresentation } from "@/components/task/task-detail-presentation";
import assignWorkItem from "@/fetchers/work-item/assign-work-item";
import { getWorkItemLabels } from "@/fetchers/work-item/get-work-item-labels";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";
import unassignWorkItem from "@/fetchers/work-item/unassign-work-item";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";
import useGetWorkItemTransitions from "@/hooks/queries/work-item/use-get-work-item-transitions";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { HttpError } from "@/lib/http-error";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import {
  assigneeDisplayText,
  resolveAssigneeDisplay,
} from "@/lib/work-item-assignee-display";
import {
  isWorkItemAccessLost,
  WorkItemVersionConflictError,
} from "@/lib/work-item-errors";
import { workItemTransitionReasonKey } from "@/lib/work-item-transition-reasons";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { WorkItemDetailField, WorkItemDetailRow } from "@/types/work-item";
import {
  isClosingCategory,
  useOpenChildrenGuard,
} from "./open-children-warning";
import WorkItemAgileRows from "./work-item-agile-rows";
import {
  useHasWorkItemFeedback,
  useWorkItemFeedback,
  WorkItemFeedbackProvider,
} from "./work-item-feedback";
import WorkItemImportOrigin from "./work-item-import-origin";
import WorkItemParentControl from "./work-item-parent-control";
import {
  useRefreshWorkItem,
  useSaveWorkItemFields,
  workItemDetailKey,
  workItemMutationScope,
  writeWorkItemResponse,
} from "./work-item-save";
import UnavailableField from "./work-item-unavailable-field";

/** Kaneo's property-row trigger (`task-properties-controls.tsx` `buttonClass`). */
const rowClass = (compact: boolean) =>
  cn("justify-start h-7 px-1.5 gap-1.5", !compact && "lg:w-full");

/** A v2 state category drawn with kaneo's column icons. */
const CATEGORY_ICON: Record<string, string> = {
  backlog: "planned",
  unstarted: "to-do",
  started: "in-progress",
  completed: "done",
  cancelled: "archived",
};

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

/** Let the confirmed assignment render before refreshing related queries. Hidden pages
 * may not receive animation frames, so refresh immediately when visibility is lost. */
function afterAssignmentPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (document.hidden || typeof requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    let frame: number;
    const finish = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resolve();
    };
    const onVisibilityChange = () => {
      if (document.hidden) finish();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(finish);
    });
  });
}

/** Kaneo's small muted inline message inside a popover or under a field. */
function InlineMessage({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-1.5 text-muted-foreground text-xs" role="alert">
      {children}
    </p>
  );
}

/** A property-row failure: 404 → access lost, 409 → the inline conflict alert, else toast. */
function usePropertyFailureHandler(
  item: WorkItemDetailRow,
  onAccessLost: () => void,
) {
  const { t } = useTranslation();
  const refresh = useRefreshWorkItem(item);
  const { reportConflict } = useWorkItemFeedback();
  return (error: unknown) => {
    if (isWorkItemAccessLost(error)) {
      onAccessLost();
      return;
    }
    if (error instanceof WorkItemVersionConflictError) {
      reportConflict();
      void refresh();
      return;
    }
    toast.error(t("workItems:properties.saveFailed"));
    void refresh();
  };
}

/** Saves a property row's change with the item's current version (`If-Match`). */
export function useUpdateWorkItemFields(
  item: WorkItemDetailRow,
  onAccessLost: () => void,
) {
  const { t } = useTranslation();
  const { announce, clearConflict } = useWorkItemFeedback();
  const onError = usePropertyFailureHandler(item, onAccessLost);
  return useSaveWorkItemFields(item, {
    onSuccess: () => {
      clearConflict();
      announce(t("workItems:journey.editSaved"));
    },
    onError,
  });
}

/** A 404 from a query the row reads (transitions, assignable people) means access lost. */
function useAccessLostOnQueryError(error: unknown, onAccessLost: () => void) {
  useEffect(() => {
    if (isWorkItemAccessLost(error)) onAccessLost();
  }, [error, onAccessLost]);
}

/**
 * The API's dates are UTC instants; the calendar edits only the calendar day. The day is
 * the instant's UTC date, shown as a local date (`isoToDay`), and the trigger formats that
 * same day, so the label and the calendar never disagree in a UTC−x zone. A changed day
 * keeps the stored time of day (UTC); a new date lands on UTC midnight.
 */
export function formatWorkItemDay(value: string) {
  return formatDateMedium(isoToDay(value) as Date);
}

type ControlProps = {
  item: WorkItemDetailRow;
  compact: boolean;
  onAccessLost: () => void;
};

/** A row whose value failed validation: its icon and the "Unavailable" badge, read-only. */
function UnavailableRow({
  compact,
  icon,
  field,
}: {
  compact: boolean;
  icon: ReactNode;
  field: WorkItemDetailField;
}) {
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-1.5 px-1.5",
        !compact && "lg:w-full",
      )}
      data-testid={`work-item-${field}-unavailable`}
    >
      {icon}
      <UnavailableField field={field} />
    </div>
  );
}

function StateControl({ item, compact, onAccessLost }: ControlProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { announce } = useWorkItemFeedback();
  const [open, setOpen] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const transitions = useGetWorkItemTransitions({
    key: item.key,
    enabled: open,
  });
  useAccessLostOnQueryError(transitions.error, onAccessLost);
  const refresh = useRefreshWorkItem(item);
  const offers = transitions.data ?? [];
  const transition = useMutation({
    scope: workItemMutationScope(item.key),
    mutationFn: async (input: {
      toStateTemplateId: string;
      note?: string;
      toStateName: string;
    }) => {
      const result = await transitionWorkItem({
        key: item.key,
        toStateTemplateId: input.toStateTemplateId,
        ...(input.note ? { note: input.note } : {}),
      });
      writeWorkItemResponse(queryClient, item.key, result, {
        stateName: input.toStateName,
        ...(result && typeof result === "object" && "stateId" in result
          ? { stateId: (result as { stateId: string }).stateId }
          : {}),
      });
      return result;
    },
    onSuccess: async (_result, input) => {
      setOpen(false);
      setNoteFor(null);
      setNote("");
      setError("");
      announce(
        t("workItems:journey.transitionDone", { state: input.toStateName }),
      );
      await refresh();
    },
    onError: async (mutationError) => {
      if (isWorkItemAccessLost(mutationError)) {
        onAccessLost();
        return;
      }
      setNoteFor(null);
      setError(
        mutationError instanceof HttpError && mutationError.status === 409
          ? t("workItems:journey.transitionConflict")
          : mutationError instanceof HttpError && mutationError.status === 422
            ? t("workItems:journey.transitionUnavailable")
            : t("workItems:journey.saveError"),
      );
      // The offers may have changed under us; show the server's current ones.
      await refresh();
    },
  });
  const { canTransitionTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  const dispatching = useRef(false);
  const childrenGuard = useOpenChildrenGuard();
  const canMove =
    canTransitionTasks() && !item.unavailableFields.includes("stateName");
  const chooseOffer = (offer: (typeof offers)[number]) => {
    const onlyNote =
      offer.blockedBy.length > 0 &&
      offer.blockedBy.every((reason) => reason.reasonCode === "note.required");
    if (
      !canMove ||
      transition.isPending ||
      dispatching.current ||
      (!offer.available && !onlyNote)
    )
      return;
    setError("");
    // `RH-10`/`WI-18`: closing a parent that still has open children asks first (and never
    // closes the children). Not asked again for the note step: the move is already chosen.
    const proceed = () => {
      if (offer.notePolicy && offer.notePolicy !== "none") {
        // The warning dialog may have taken focus and closed the popover; reopen it so
        // the note form is always reachable after "Close anyway".
        setOpen(true);
        setNoteFor(offer.transitionId);
        return;
      }
      dispatching.current = true;
      transition.mutate(
        {
          toStateTemplateId: offer.toStateTemplateId,
          toStateName: offer.toStateName,
        },
        {
          onSettled: () => {
            dispatching.current = false;
          },
        },
      );
    };
    void childrenGuard.guard({
      key: item.key,
      closing:
        isClosingCategory(offer.toStateCategory) &&
        !isClosingCategory(item.stateCategory),
      proceed,
    });
  };
  useNumberedShortcuts(
    open &&
      !noteFor &&
      canMove &&
      !transition.isPending &&
      !transitions.isLoading &&
      !transitions.isError,
    offers.map((offer) => ({
      onSelect: () => chooseOffer(offer),
      disabled:
        !offer.available &&
        !(
          offer.blockedBy.length > 0 &&
          offer.blockedBy.every(
            (reason) => reason.reasonCode === "note.required",
          )
        ),
    })),
  );
  const icon = getColumnIcon(CATEGORY_ICON[item.stateCategory] ?? "to-do");
  if (item.unavailableFields.includes("stateName")) {
    return <UnavailableRow compact={compact} icon={icon} field="stateName" />;
  }
  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={rowClass(compact)}
      data-testid="work-item-state-control"
    >
      {icon}
      <span className="truncate font-semibold text-xs">{item.stateName}</span>
    </Button>
  );
  if (!canTransitionTasks()) return trigger;
  const noteOffer = offers.find((offer) => offer.transitionId === noteFor);
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setNoteFor(null);
            setNote("");
            setError("");
          }
        }}
      >
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          {error ? <InlineMessage>{error}</InlineMessage> : null}
          {noteOffer ? (
            <form
              className="flex flex-col gap-2 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                transition.mutate({
                  toStateTemplateId: noteOffer.toStateTemplateId,
                  toStateName: noteOffer.toStateName,
                  note: note.trim() || undefined,
                });
              }}
            >
              <p className="font-medium text-sm">{noteOffer.toStateName}</p>
              <Textarea
                aria-label={t("workItems:properties.transitionNote")}
                placeholder={t("workItems:properties.transitionNote")}
                value={note}
                maxLength={4000}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                disabled={
                  transition.isPending ||
                  (noteOffer.notePolicy === "required" && !note.trim())
                }
              >
                {t("workItems:properties.move")}
              </Button>
            </form>
          ) : transitions.isLoading ? (
            <p className="p-3 text-muted-foreground text-sm" role="status">
              {t("common:empty.loading")}
            </p>
          ) : transitions.isError ? (
            <p className="p-3 text-muted-foreground text-sm" role="alert">
              {t("workItems:journey.transitionsError")}
            </p>
          ) : offers.length === 0 ? (
            <p className="p-3 text-muted-foreground text-sm">
              {t("workItems:properties.noTransitions")}
            </p>
          ) : (
            <div>
              {offers.map((offer, index) => {
                // Blocked only for want of a note: runnable once the note is written.
                const onlyNote =
                  offer.blockedBy.length > 0 &&
                  offer.blockedBy.every(
                    (reason) => reason.reasonCode === "note.required",
                  );
                const blocked = !offer.available && !onlyNote;
                const reasons = offer.blockedBy.length
                  ? offer.blockedBy.map((reason) =>
                      t(workItemTransitionReasonKey(reason.reasonCode)),
                    )
                  : [t("workItems:journey.reasonUnknown")];
                return (
                  <Button
                    key={offer.transitionId}
                    variant="ghost"
                    size="sm"
                    disabled={blocked || transition.isPending}
                    className="h-auto min-h-8 w-full flex-col items-start gap-0 rounded-none px-2 py-1.5 first:rounded-t-md last:rounded-b-md"
                    onClick={() => chooseOffer(offer)}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="text-sm">{offer.toStateName}</span>
                      <ShortcutNumber number={index + 1} />
                    </span>
                    {blocked ? (
                      <span className="text-muted-foreground text-xs">
                        {reasons.join(", ")}
                      </span>
                    ) : null}
                  </Button>
                );
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {childrenGuard.dialog}
    </>
  );
}

function PriorityControl({ item, compact, onAccessLost }: ControlProps) {
  const [open, setOpen] = useState(false);
  const update = useUpdateWorkItemFields(item, onAccessLost);
  const { canUpdateTasks, canSetPriorityTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  const current = item.priority ?? "no-priority";
  const dispatching = useRef(false);
  const canEdit =
    canUpdateTasks() &&
    canSetPriorityTasks() &&
    !item.unavailableFields.includes("priority");
  const choosePriority = (priority: (typeof PRIORITIES)[number] | null) => {
    if (
      !canEdit ||
      update.isPending ||
      dispatching.current ||
      priority === item.priority
    )
      return;
    dispatching.current = true;
    update.mutate(
      { priority },
      {
        onSuccess: () => setOpen(false),
        onSettled: () => {
          dispatching.current = false;
        },
      },
    );
  };
  useNumberedShortcuts(
    open && canEdit && !update.isPending,
    [null, ...PRIORITIES].map((priority) => ({
      onSelect: () => choosePriority(priority),
    })),
  );

  if (item.unavailableFields.includes("priority")) {
    return (
      <UnavailableRow
        compact={compact}
        icon={getPriorityIcon("no-priority")}
        field="priority"
      />
    );
  }
  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={rowClass(compact)}
      data-testid="work-item-priority-control"
    >
      {getPriorityIcon(current)}
      <span className="truncate font-semibold text-xs">
        {getPriorityLabel(current)}
      </span>
    </Button>
  );
  // PATCH needs `work_item:update`; a priority in the body also needs
  // `work_item:set_priority` (`rbac.md`).
  if (!canUpdateTasks() || !canSetPriorityTasks()) return trigger;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <div>
          {[null, ...PRIORITIES].map((priority, index) => {
            const value = priority ?? "no-priority";
            return (
              <Button
                key={value}
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start gap-2 rounded-none px-2 first:rounded-t-md last:rounded-b-md"
                disabled={update.isPending}
                onClick={() => choosePriority(priority)}
              >
                {getPriorityIcon(value)}
                <span className="text-sm">{getPriorityLabel(value)}</span>
                {current === value ? (
                  <Check className="ml-auto h-4 w-4" />
                ) : (
                  <ShortcutNumber number={index + 1} />
                )}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AssigneeControl({ item, compact, onAccessLost }: ControlProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { announce } = useWorkItemFeedback();
  const [open, setOpen] = useState(false);
  // `AS-3`: taking work already held by someone else needs an explicit second step.
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  // A confirmation was for the holder the screen showed; if the holder moves, it lapses.
  const [seenHolder, setSeenHolder] = useState(item.assigneeId);
  if (seenHolder !== item.assigneeId) {
    setSeenHolder(item.assigneeId);
    setConfirmFor(null);
  }
  const people = useGetAssignablePeople({
    projectId: item.projectId,
    enabled: open,
  });
  useAccessLostOnQueryError(people.error, onAccessLost);
  const refresh = useRefreshWorkItem(item);
  const assign = useMutation({
    scope: workItemMutationScope(item.key),
    mutationFn: async ({
      person,
      holder,
    }: {
      person: { personId: string; name: string | null } | null;
      holder: string | null;
    }) => {
      const result =
        person === null
          ? await unassignWorkItem(item.key, holder)
          : await assignWorkItem({
              key: item.key,
              assigneeId: person.personId,
              expectedCurrentAssigneeId: holder,
            });
      writeWorkItemResponse(queryClient, item.key, result, {
        assigneeId: person?.personId ?? null,
        assigneeName: person?.name ?? null,
        // The picker only offers active people on the project roster (AS-5).
        assigneeActive: person ? true : null,
        assigneeOnProject: person ? true : null,
      });
      return result;
    },
    onSuccess: async (_result, { person }) => {
      setOpen(false);
      setConfirmFor(null);
      setError("");
      announce(
        person === null
          ? t("workItems:journey.unassignDone")
          : t("workItems:journey.assignDone", {
              name: person.name ?? t("workItems:journey.unnamedPerson"),
            }),
      );
      await afterAssignmentPaint();
      await refresh();
    },
    onError: async (mutationError, { person }) => {
      setConfirmFor(null);
      if (isWorkItemAccessLost(mutationError)) {
        onAccessLost();
        return;
      }
      setError(
        mutationError instanceof HttpError && mutationError.status === 409
          ? t("workItems:journey.assignmentConflict")
          : person === null
            ? t("workItems:journey.unassignmentError")
            : t("workItems:journey.assignmentError"),
      );
      await queryClient.invalidateQueries({
        queryKey: workItemDetailKey(item.key),
      });
    },
  });
  const { canUpdateTasks, canAssignTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  // `AS-8`: "Jane Smith (inactive)" / "(no longer on this project)".
  const name =
    item.assigneeId === null
      ? null
      : assigneeDisplayText(resolveAssigneeDisplay(item), {
          unassigned: t("workItems:detail.unassigned"),
          inactive: t("workItems:detail.inactiveAssignee"),
          notOnProject: t("workItems:list.assigneeNotOnProject"),
        });
  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={rowClass(compact)}
      data-testid="work-item-assignee-control"
    >
      {name ? (
        <Avatar className="h-[16px] w-[16px]">
          <AvatarFallback className="text-[8px]">
            {getInitials(item.assigneeName ?? name)}
          </AvatarFallback>
        </Avatar>
      ) : null}
      <span
        className={cn(
          "truncate font-semibold text-xs",
          !name && "text-muted-foreground",
        )}
      >
        {name ?? t("workItems:detail.unassigned")}
      </span>
    </Button>
  );
  const list = people.data ?? [];
  // An update-only roster contains only the caller; never offer clearing another holder.
  const canUnassign =
    item.assigneeId !== null &&
    (canAssignTasks() ||
      (canUpdateTasks() &&
        list.some((person) => person.personId === item.assigneeId)));
  const confirmPerson = list.find((person) => person.personId === confirmFor);
  const dispatching = useRef(false);
  const canEdit = canUpdateTasks() || canAssignTasks();
  const dispatchAssignment = (
    person: { personId: string; name: string | null } | null,
  ) => {
    if (
      !canEdit ||
      assign.isPending ||
      dispatching.current ||
      (person === null && !canUnassign)
    )
      return;
    dispatching.current = true;
    assign.mutate(
      { person, holder: item.assigneeId },
      {
        onSettled: () => {
          dispatching.current = false;
        },
      },
    );
  };
  const choosePerson = (person: (typeof list)[number] | null) => {
    if (
      !canEdit ||
      assign.isPending ||
      dispatching.current ||
      person?.personId === item.assigneeId ||
      (person === null && !canUnassign)
    )
      return;
    setError("");
    if (person && item.assigneeId && item.assigneeId !== person.personId) {
      setConfirmFor(person.personId);
      return;
    }
    dispatchAssignment(
      person ? { personId: person.personId, name: person.name ?? null } : null,
    );
  };
  useNumberedShortcuts(
    open &&
      !confirmFor &&
      canEdit &&
      !assign.isPending &&
      !people.isLoading &&
      !people.isError,
    [
      { onSelect: () => choosePerson(null), disabled: !canUnassign },
      ...list.slice(0, 8).map((person) => ({
        onSelect: () => choosePerson(person),
        disabled: item.assigneeId === person.personId,
      })),
    ],
  );
  if (!canEdit) return trigger;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setConfirmFor(null);
          setError("");
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        {error ? <InlineMessage>{error}</InlineMessage> : null}
        {confirmPerson ? (
          <div className="flex flex-col gap-2 p-2" role="alert">
            <p className="font-medium text-sm">
              {t("workItems:journey.confirmReassign")}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("workItems:journey.confirmReassignDescription")}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={assign.isPending}
                onClick={() =>
                  dispatchAssignment({
                    personId: confirmPerson.personId,
                    name: confirmPerson.name ?? null,
                  })
                }
              >
                {t("workItems:journey.confirmAssignment")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmFor(null)}
              >
                {t("workItems:journey.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start gap-2 rounded-none px-2 text-muted-foreground"
              disabled={assign.isPending || !canUnassign}
              onClick={() => choosePerson(null)}
            >
              {t("workItems:detail.unassigned")}
              {item.assigneeId === null ? (
                <Check className="ml-auto h-4 w-4" />
              ) : (
                <ShortcutNumber number={1} />
              )}
            </Button>
            {people.isLoading ? (
              <p className="p-3 text-muted-foreground text-sm" role="status">
                {t("common:empty.loading")}
              </p>
            ) : people.isError && !isWorkItemAccessLost(people.error) ? (
              <p className="p-3 text-muted-foreground text-sm" role="alert">
                {t("workItems:journey.peopleError")}
              </p>
            ) : (
              list.map((person, index) => (
                <Button
                  key={person.personId}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start gap-2 rounded-none px-2"
                  disabled={
                    assign.isPending || item.assigneeId === person.personId
                  }
                  onClick={() => choosePerson(person)}
                >
                  <Avatar className="h-[16px] w-[16px]">
                    <AvatarFallback className="text-[8px]">
                      {getInitials(person.name ?? "")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-sm">
                    {person.name ?? t("workItems:journey.unnamedPerson")}
                  </span>
                  {item.assigneeId === person.personId ? (
                    <Check className="ml-auto h-4 w-4" />
                  ) : index < 8 ? (
                    <ShortcutNumber number={index + 2} />
                  ) : null}
                </Button>
              ))
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DateControl({
  item,
  compact,
  onAccessLost,
  field,
}: ControlProps & { field: "startDate" | "dueDate" }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const update = useUpdateWorkItemFields(item, onAccessLost);
  const { canUpdateTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  const value = item[field];
  const Icon = field === "startDate" ? CalendarDays : CalendarClock;
  const icon = <Icon className="h-4 w-4 text-muted-foreground" />;
  if (item.unavailableFields.includes(field)) {
    return <UnavailableRow compact={compact} icon={icon} field={field} />;
  }
  const emptyLabel =
    field === "startDate"
      ? t("workItems:properties.noStartDate")
      : t("workItems:detail.noDueDate");
  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={rowClass(compact)}
      data-testid={`work-item-${field}-control`}
    >
      {icon}
      <span
        className={cn(
          "truncate font-semibold text-xs",
          !value && "text-muted-foreground",
        )}
      >
        {value ? formatWorkItemDay(value) : emptyLabel}
      </span>
    </Button>
  );
  if (!canUpdateTasks()) return trigger;
  const save = (day: Date | undefined) =>
    update.mutate(
      { [field]: dayToIso(day, value) },
      { onSuccess: () => setOpen(false) },
    );
  const bound =
    field === "dueDate" && item.startDate
      ? { before: isoToDay(item.startDate) as Date }
      : field === "startDate" && item.dueDate
        ? { after: isoToDay(item.dueDate) as Date }
        : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Calendar
          mode="single"
          selected={isoToDay(value)}
          onSelect={save}
          disabled={bound}
          className="w-full bg-popover"
          weekStartsOn={weekStartsOn}
        />
        {value ? (
          <div className="border-border border-t pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => save(undefined)}
            >
              <X className="h-4 w-4" />
              {t("workItems:properties.clearDate")}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** A save answered 409: the field was reset to the server's value; this says so and offers
 * to load the latest of everything else. */
function ConflictNotice({ item }: { item: WorkItemDetailRow }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { conflict, clearConflict } = useWorkItemFeedback();
  if (!conflict) return null;
  return (
    <div className="px-2 pt-2 lg:px-3">
      <Alert variant="warning" data-testid="work-item-conflict">
        <TriangleAlert />
        <AlertDescription>
          <p className="text-xs">{t("workItems:properties.conflict")}</p>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              clearConflict();
              void queryClient.invalidateQueries({
                queryKey: workItemDetailKey(item.key),
              });
            }}
          >
            {t("workItems:properties.reloadLatest")}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}

function LabelsControl({
  item,
  onAccessLost,
}: {
  item: WorkItemDetailRow;
  compact: boolean;
  onAccessLost: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const { canUpdateTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  const query = useQuery({
    queryKey: [
      "labels",
      item.workspaceId,
      "work-items",
      item.key,
      item.version,
    ],
    queryFn: () => getWorkItemLabels(item.key),
  });
  const save = useUpdateWorkItemFields(item, onAccessLost);
  useAccessLostOnQueryError(query.error, onAccessLost);
  const labels = query.data ?? [];
  const selected = labels.filter((label) => label.assigned);
  const title = t("tasks:properties.labels");
  const unavailable =
    query.isPending || query.isFetching || query.isError || save.isPending;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-auto min-h-5 flex-wrap justify-start gap-1.5 px-0 py-0 font-normal"
            aria-label={title}
            disabled={!canUpdateTasks() || unavailable}
          />
        }
      >
        {selected.map((label) => (
          <Badge
            key={label.id}
            variant="outline"
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px]"
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: resolveLabelColor(label.color) }}
            />
            <span className="max-w-[60px] truncate">{label.name}</span>
          </Badge>
        ))}
        <Plus className="size-3" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("tasks:popover.labels.searchPlaceholder")}
          aria-label={t("tasks:popover.labels.searchPlaceholder")}
        />
        <div className="max-h-64 overflow-y-auto py-1">
          {labels
            .filter((label) =>
              label.name
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
            )
            .map((label) => (
              <Button
                key={label.id}
                role="checkbox"
                aria-checked={label.assigned}
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                disabled={unavailable}
                onClick={() =>
                  save.mutate({
                    labelIds: label.assigned
                      ? selected
                          .filter((current) => current.id !== label.id)
                          .map((current) => current.id)
                      : [...selected.map((current) => current.id), label.id],
                  })
                }
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: resolveLabelColor(label.color) }}
                />
                <span className="truncate">{label.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t(
                    label.projectId
                      ? "settings:projectLabels.projectScope"
                      : "settings:projectLabels.workspaceScope",
                  )}
                </span>
                {label.assigned ? <Check className="ml-auto size-3" /> : null}
              </Button>
            ))}
          {!labels.some((label) =>
            label.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          ) ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("tasks:popover.labels.empty")}
            </p>
          ) : null}
        </div>
      </PopoverContent>
      {query.isError ? (
        <div role="alert" className="text-xs">
          <span>{t("tasks:popover.labels.updateError")}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void query.refetch()}
          >
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : null}
    </Popover>
  );
}

type WorkItemPropertiesProps = {
  item: WorkItemDetailRow;
  compact?: boolean;
  readOnly?: boolean;
  onAccessLost: () => void;
  /** v2 panels (SLA, approvals, metadata) under the property rows. */
  children?: ReactNode;
};

/**
 * Kaneo's task "Properties" panel (`task-properties-sidebar.tsx`), fed by the v2 work
 * item: state moves through the workflow's transitions, priority/dates save with the item
 * version, assignment goes through the assignable list. Each control is read-only without
 * the capability, as kaneo's are, and a field that failed validation is read-only with
 * its "Unavailable" badge. `compact` is kaneo's horizontal strip (side pane).
 */
export default function WorkItemProperties(props: WorkItemPropertiesProps) {
  // The page provides the feedback shared with the title and description; standalone,
  // the panel keeps its own.
  if (!useHasWorkItemFeedback()) {
    return (
      <WorkItemFeedbackProvider>
        <WorkItemPropertiesPanel {...props} />
      </WorkItemFeedbackProvider>
    );
  }
  return <WorkItemPropertiesPanel {...props} />;
}

function WorkItemPropertiesPanel({
  item,
  compact = false,
  readOnly = false,
  onAccessLost,
  children,
}: WorkItemPropertiesProps) {
  const { t } = useTranslation();
  const controlProps = { item, compact, onAccessLost };
  const copyLink = () => {
    const url = new URL(
      routes.workItemDetail.build({ key: item.key }),
      window.location.origin,
    ).toString();
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success(t("workItems:properties.linkCopied")));
  };
  return (
    <div
      className={cn("flex w-full flex-col gap-2", !compact && "min-h-full")}
      data-testid="work-item-properties"
      data-read-only={readOnly || undefined}
    >
      <TaskPropertiesPresentation>
        {!compact ? (
          <div className="hidden items-center justify-between px-3 py-2 lg:flex">
            <p className="flex-1 font-medium text-foreground text-sm">
              {t("workItems:properties.title")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-foreground"
              aria-label={t("workItems:properties.copyLink")}
              onClick={copyLink}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        ) : null}
        <ConflictNotice item={item} />
        <div
          className={cn(
            "flex w-full flex-row-reverse gap-2 border-b border-border",
            !compact && "lg:flex-col lg:gap-0 lg:border-b-0",
          )}
        >
          <div className={cn("flex px-3 py-2", !compact && "lg:hidden")}>
            <Button
              variant="outline"
              size="sm"
              className="text-foreground"
              aria-label={t("workItems:properties.copyLink")}
              onClick={copyLink}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <Fieldset
            disabled={readOnly}
            data-testid="work-item-property-controls"
            className={cn(
              "flex w-full max-w-none flex-row flex-wrap items-center gap-1 p-2",
              !compact &&
                "lg:flex-col lg:items-stretch lg:gap-2 lg:px-3 lg:py-3",
            )}
          >
            <StateControl
              key={`StateControl:${item.workspaceId}:${item.projectId}:${item.key}`}
              {...controlProps}
            />
            <PriorityControl
              key={`PriorityControl:${item.workspaceId}:${item.projectId}:${item.key}`}
              {...controlProps}
            />
            <AssigneeControl
              key={`AssigneeControl:${item.workspaceId}:${item.projectId}:${item.key}`}
              {...controlProps}
            />
            <DateControl {...controlProps} field="startDate" />
            <DateControl {...controlProps} field="dueDate" />
            <WorkItemAgileRows item={item} compact={compact} />
          </Fieldset>
        </div>
        <Fieldset
          disabled={readOnly}
          className="flex max-w-none flex-col gap-3 p-2 px-3"
          data-testid="work-item-labels-group"
        >
          <div className="flex flex-col gap-1">
            <span className="px-2 text-xs font-medium text-foreground">
              {t("tasks:properties.labels")}
            </span>
            <div className="flex flex-wrap items-center gap-1.5 px-2">
              <LabelsControl {...controlProps} />
            </div>
          </div>
        </Fieldset>
        <Fieldset disabled={readOnly} className="max-w-none gap-0 px-3">
          <WorkItemParentControl {...controlProps} />
        </Fieldset>
        <WorkItemImportOrigin item={item} />
        {children ? (
          <div className="flex flex-col gap-1 px-3 py-2">{children}</div>
        ) : null}
      </TaskPropertiesPresentation>
    </div>
  );
}
