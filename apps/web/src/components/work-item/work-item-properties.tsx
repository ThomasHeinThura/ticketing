import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
} from "@taskdesk/ui";
import { CalendarClock, CalendarDays, Check, Copy, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/avatar";
import assignWorkItem from "@/fetchers/work-item/assign-work-item";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";
import unassignWorkItem from "@/fetchers/work-item/unassign-work-item";
import updateWorkItem, {
  type UpdateWorkItemInput,
} from "@/fetchers/work-item/update-work-item";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";
import useGetWorkItemTransitions from "@/hooks/queries/work-item/use-get-work-item-transitions";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import {
  isWorkItemAccessLost,
  WorkItemVersionConflictError,
} from "@/lib/work-item-errors";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { WorkItemDetailRow } from "@/types/work-item";

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

/** Server reason codes (`workflows.md`) as readable text; an unknown code never shows raw. */
const REASON_KEYS: Record<string, string> = {
  "note.required": "reasonNoteRequired",
  "guard.assignee_present": "reasonAssigneePresent",
  "guard.children_closed": "reasonChildrenClosed",
  "guard.no_open_blockers": "reasonNoOpenBlockers",
  "guard.field_required": "reasonFieldRequired",
  "guard.change_risk_at_most": "reasonChangeRisk",
  "approval.pending": "reasonApprovalPending",
  "cab.pending": "reasonCabPending",
};

function reasonKey(code: string) {
  return `workItems:journey.${REASON_KEYS[code] ?? "reasonUnknown"}`;
}

/** The item's queries a change must refresh (detail, activity, transitions, lists). */
function useRefreshWorkItem(item: WorkItemDetailRow) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["work-items", "detail", item.key],
      }),
      queryClient.invalidateQueries({
        queryKey: ["work-items", "activity", item.key],
      }),
      queryClient.invalidateQueries({
        queryKey: ["work-items", "transitions", item.key],
      }),
      queryClient.invalidateQueries({
        queryKey: ["work-items", item.projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ["work-items", "sla"] }),
    ]);
}

/** One handler for every mutation's failure: 404 → access lost, 409 → reload, else toast. */
function useFailureHandler(item: WorkItemDetailRow, onAccessLost: () => void) {
  const { t } = useTranslation();
  const refresh = useRefreshWorkItem(item);
  return (error: unknown) => {
    if (isWorkItemAccessLost(error)) {
      onAccessLost();
      return;
    }
    if (error instanceof WorkItemVersionConflictError) {
      toast.error(t("workItems:properties.conflict"));
      void refresh();
      return;
    }
    toast.error(t("workItems:properties.saveFailed"));
    void refresh();
  };
}

/** Saves a partial change with the item's version (`If-Match`); see `useFailureHandler`. */
export function useUpdateWorkItemFields(
  item: WorkItemDetailRow,
  onAccessLost: () => void,
) {
  const refresh = useRefreshWorkItem(item);
  const onError = useFailureHandler(item, onAccessLost);
  return useMutation({
    mutationFn: (fields: Omit<UpdateWorkItemInput, "key" | "version">) =>
      updateWorkItem({ key: item.key, version: item.version, ...fields }),
    onSuccess: () => refresh(),
    onError,
  });
}

/** Calendar day → the API's ISO datetime, keeping the stored time of day (UTC midnight). */
function dayToIso(day: Date | undefined, original: string | null) {
  if (!day) return null;
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  const timeOfDay = original?.slice(10) || "T00:00:00.000Z";
  return `${y}-${m}-${d}${timeOfDay}`;
}

function isoToDay(value: string | null) {
  if (!value) return undefined;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

type ControlProps = {
  item: WorkItemDetailRow;
  compact: boolean;
  onAccessLost: () => void;
};

function ReadOnly({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function StateControl({ item, compact, onAccessLost }: ControlProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const transitions = useGetWorkItemTransitions({
    key: item.key,
    enabled: open,
  });
  const refresh = useRefreshWorkItem(item);
  const onError = useFailureHandler(item, onAccessLost);
  const transition = useMutation({
    mutationFn: transitionWorkItem,
    onSuccess: async () => {
      setOpen(false);
      setNoteFor(null);
      setNote("");
      await refresh();
    },
    onError,
  });
  const { canTransitionTasks } = useWorkspacePermission(item.workspaceId);
  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={rowClass(compact)}
      data-testid="work-item-state-control"
    >
      {getColumnIcon(CATEGORY_ICON[item.stateCategory] ?? "to-do")}
      <span className="truncate font-semibold text-xs">{item.stateName}</span>
    </Button>
  );
  if (!canTransitionTasks()) return <ReadOnly>{trigger}</ReadOnly>;
  const offers = transitions.data ?? [];
  const noteOffer = offers.find((offer) => offer.transitionId === noteFor);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setNoteFor(null);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {noteOffer ? (
          <form
            className="flex flex-col gap-2 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              transition.mutate({
                key: item.key,
                toStateTemplateId: noteOffer.toStateTemplateId,
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
        ) : offers.length === 0 ? (
          <p className="p-3 text-muted-foreground text-sm">
            {t("workItems:properties.noTransitions")}
          </p>
        ) : (
          <div>
            {offers.map((offer) => {
              const onlyNote = offer.blockedBy.every(
                (reason) => reason.reasonCode === "note.required",
              );
              const blocked = !offer.available && !onlyNote;
              return (
                <Button
                  key={offer.transitionId}
                  variant="ghost"
                  size="sm"
                  disabled={blocked || transition.isPending}
                  className="h-auto min-h-8 w-full flex-col items-start gap-0 rounded-none px-2 py-1.5 first:rounded-t-md last:rounded-b-md"
                  onClick={() => {
                    if (offer.notePolicy !== "none" && offer.notePolicy) {
                      setNoteFor(offer.transitionId);
                      return;
                    }
                    transition.mutate({
                      key: item.key,
                      toStateTemplateId: offer.toStateTemplateId,
                    });
                  }}
                >
                  <span className="text-sm">{offer.toStateName}</span>
                  {blocked ? (
                    <span className="text-muted-foreground text-xs">
                      {offer.blockedBy
                        .map((reason) => t(reasonKey(reason.reasonCode)))
                        .join(", ")}
                    </span>
                  ) : null}
                </Button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PriorityControl({ item, compact, onAccessLost }: ControlProps) {
  const [open, setOpen] = useState(false);
  const update = useUpdateWorkItemFields(item, onAccessLost);
  const { canUpdateTasks } = useWorkspacePermission(item.workspaceId);
  const current = item.priority ?? "no-priority";
  const trigger = (
    <Button variant="ghost" size="sm" className={rowClass(compact)}>
      {getPriorityIcon(current)}
      <span className="truncate font-semibold text-xs">
        {getPriorityLabel(current)}
      </span>
    </Button>
  );
  if (!canUpdateTasks()) return <ReadOnly>{trigger}</ReadOnly>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <div>
          {[null, ...PRIORITIES].map((priority) => {
            const value = priority ?? "no-priority";
            return (
              <Button
                key={value}
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start gap-2 rounded-none px-2 first:rounded-t-md last:rounded-b-md"
                onClick={() =>
                  update.mutate(
                    { priority },
                    { onSuccess: () => setOpen(false) },
                  )
                }
              >
                {getPriorityIcon(value)}
                <span className="text-sm">{getPriorityLabel(value)}</span>
                {current === value ? (
                  <Check className="ml-auto h-4 w-4" />
                ) : null}
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
  const [open, setOpen] = useState(false);
  const people = useGetAssignablePeople({
    projectId: item.projectId,
    enabled: open,
  });
  const refresh = useRefreshWorkItem(item);
  const onError = useFailureHandler(item, onAccessLost);
  const assign = useMutation({
    mutationFn: async (personId: string | null) =>
      personId === null
        ? unassignWorkItem(item.key, item.assigneeId)
        : assignWorkItem({
            key: item.key,
            assigneeId: personId,
            expectedCurrentAssigneeId: item.assigneeId,
          }),
    onSuccess: async () => {
      setOpen(false);
      await refresh();
    },
    onError,
  });
  const { canUpdateTasks, canAssignTasks } = useWorkspacePermission(
    item.workspaceId,
  );
  const name =
    item.assigneeId === null
      ? null
      : (item.assigneeName ?? t("workItems:detail.inactiveAssignee"));
  const trigger = (
    <Button variant="ghost" size="sm" className={rowClass(compact)}>
      {name ? (
        <Avatar className="h-[16px] w-[16px]">
          <AvatarFallback className="text-[8px]">
            {getInitials(name)}
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
  if (!canUpdateTasks() && !canAssignTasks()) {
    return <ReadOnly>{trigger}</ReadOnly>;
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="max-h-72 overflow-y-auto">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2 rounded-none px-2 text-muted-foreground"
            disabled={assign.isPending || item.assigneeId === null}
            onClick={() => assign.mutate(null)}
          >
            {t("workItems:detail.unassigned")}
            {item.assigneeId === null ? (
              <Check className="ml-auto h-4 w-4" />
            ) : null}
          </Button>
          {people.isLoading ? (
            <p className="p-3 text-muted-foreground text-sm" role="status">
              {t("common:empty.loading")}
            </p>
          ) : (
            (people.data ?? []).map((person) => (
              <Button
                key={person.personId}
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start gap-2 rounded-none px-2"
                disabled={assign.isPending}
                onClick={() => assign.mutate(person.personId)}
              >
                <Avatar className="h-[16px] w-[16px]">
                  <AvatarFallback className="text-[8px]">
                    {getInitials(person.name ?? "")}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-sm">
                  {person.name ?? person.personId}
                </span>
                {item.assigneeId === person.personId ? (
                  <Check className="ml-auto h-4 w-4" />
                ) : null}
              </Button>
            ))
          )}
        </div>
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
  const { canUpdateTasks } = useWorkspacePermission(item.workspaceId);
  const value = item[field];
  const Icon = field === "startDate" ? CalendarDays : CalendarClock;
  const emptyLabel =
    field === "startDate"
      ? t("workItems:properties.noStartDate")
      : t("workItems:detail.noDueDate");
  const trigger = (
    <Button variant="ghost" size="sm" className={rowClass(compact)}>
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span
        className={cn(
          "truncate font-semibold text-xs",
          !value && "text-muted-foreground",
        )}
      >
        {value ? formatDateMedium(value) : emptyLabel}
      </span>
    </Button>
  );
  if (!canUpdateTasks()) return <ReadOnly>{trigger}</ReadOnly>;
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

/**
 * Kaneo's task "Properties" panel (`task-properties-sidebar.tsx`), fed by the v2 work
 * item: state moves through the workflow's transitions, priority/dates save with the item
 * version, assignment goes through the assignable list. Each control is read-only without
 * the capability, as kaneo's are. `compact` is kaneo's horizontal strip (side pane).
 */
export default function WorkItemProperties({
  item,
  compact = false,
  onAccessLost,
  children,
}: {
  item: WorkItemDetailRow;
  compact?: boolean;
  onAccessLost: () => void;
  /** v2 panels (SLA, approvals, metadata) under the property rows. */
  children?: ReactNode;
}) {
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
      className={cn(
        "flex h-full w-full flex-col gap-2",
        !compact && "lg:w-72 xl:w-80",
      )}
      data-testid="work-item-properties"
    >
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
      <div
        className={cn(
          "flex w-full flex-row flex-wrap items-center gap-1 p-2",
          !compact && "lg:flex-col lg:items-stretch lg:gap-2 lg:px-3 lg:py-3",
        )}
      >
        <StateControl {...controlProps} />
        <PriorityControl {...controlProps} />
        <AssigneeControl {...controlProps} />
        <DateControl {...controlProps} field="startDate" />
        <DateControl {...controlProps} field="dueDate" />
      </div>
      {children ? (
        <div className="flex flex-col gap-4 border-border/80 border-t px-3 py-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
