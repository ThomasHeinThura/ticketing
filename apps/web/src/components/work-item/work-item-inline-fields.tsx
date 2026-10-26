import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  Button,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
} from "@taskdesk/ui";
import { CalendarClock, Check, Pencil, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CustomFieldValueInput } from "@/components/custom-field/custom-field-value-input";
import assignWorkItem from "@/fetchers/work-item/assign-work-item";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";
import unassignWorkItem from "@/fetchers/work-item/unassign-work-item";
import updateWorkItem from "@/fetchers/work-item/update-work-item";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";
import useGetWorkItemTransitions from "@/hooks/queries/work-item/use-get-work-item-transitions";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { formatValue, isValueSet } from "@/lib/custom-field";
import { formatDateShort } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { HttpError } from "@/lib/http-error";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import {
  assigneeDisplayText,
  resolveAssigneeDisplay,
} from "@/lib/work-item-assignee-display";
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
import type {
  WorkItemCustomFieldColumn,
  WorkItemCustomFieldPerson,
  WorkItemPriority,
  WorkItemRow,
} from "@/types/work-item";
import {
  isClosingCategory,
  useOpenChildrenGuard,
} from "./open-children-warning";
import {
  currentWorkItemVersion,
  workItemDetailKey,
  workItemMutationScope,
  writeWorkItemResponse,
} from "./work-item-save";

type InlineFieldSlots = {
  stateControl: ReactNode;
  priorityControl: ReactNode;
  assigneeControl: ReactNode;
  titleControl: ReactNode;
  titleEditor: ReactNode;
  dueDateControl: ReactNode;
  customFieldControls: Record<string, ReactNode>;
};

type Props = {
  item: WorkItemRow;
  disabled?: boolean;
  presentation?: "compact" | "table";
  customFieldColumns?: WorkItemCustomFieldColumn[];
  customFieldPeople?: WorkItemCustomFieldPerson[];
  children: (slots: InlineFieldSlots) => ReactNode;
};

type TransitionOffer = NonNullable<
  ReturnType<typeof useGetWorkItemTransitions>["data"]
>[number];

type Command =
  | { kind: "state"; offer: TransitionOffer; note?: string }
  | { kind: "priority"; value: WorkItemPriority | null }
  | { kind: "title"; value: string }
  | { kind: "dueDate"; value: string | null }
  | { kind: "customField"; key: string; value: unknown }
  | {
      kind: "assign";
      person: { personId: string; name: string | null } | null;
      holder: string | null;
    };

const CATEGORY_ICON: Record<string, string> = {
  backlog: "planned",
  unstarted: "to-do",
  started: "in-progress",
  completed: "done",
  cancelled: "archived",
};

const PRIORITY_OPTIONS = [
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export default function WorkItemInlineFields({
  item,
  disabled = false,
  presentation = "compact",
  customFieldColumns = [],
  customFieldPeople = [],
  children,
}: Props) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const permission = useWorkspacePermission(item.workspaceId, item.projectId);
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const mutable =
    !disabled &&
    !permission.isCheckingPermissions &&
    !item.archivedAt &&
    !item.deletedAt;
  const canTransition =
    mutable &&
    permission.canTransitionTasks() &&
    !item.unavailableFields.includes("stateName");
  const canEditPriority =
    mutable &&
    permission.canUpdateTasks() &&
    permission.canSetPriorityTasks() &&
    !item.unavailableFields.includes("priority");
  const canAssign =
    mutable &&
    (permission.canAssignTasks() || permission.canUpdateTasks()) &&
    !item.unavailableFields.includes("assigneeName");
  const canEditTitle =
    presentation === "table" &&
    mutable &&
    !item.unavailableFields.includes("key") &&
    permission.canUpdateTasks() &&
    !item.unavailableFields.includes("title");
  const canEditDueDate =
    presentation === "table" &&
    mutable &&
    !item.unavailableFields.includes("key") &&
    permission.canUpdateTasks() &&
    !item.unavailableFields.includes("dueDate");
  const canEditCustomField = (key: string) => {
    const field = customFieldColumns.find((candidate) => candidate.key === key);
    const values = item.customFieldValues ?? {};
    if (
      !field ||
      presentation !== "table" ||
      !mutable ||
      !permission.canUpdateTasks() ||
      item.unavailableFields.includes("key") ||
      !Object.hasOwn(values, key)
    ) {
      return false;
    }
    return true;
  };
  const [stateOpen, setStateOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [editingCustomFieldKey, setEditingCustomFieldKey] = useState<
    string | null
  >(null);
  const [customFieldDraft, setCustomFieldDraft] = useState<unknown>(null);
  const customFieldEditButtons = useRef(new Map<string, HTMLButtonElement>());
  const previousCustomFieldKey = useRef<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(item.title);
  const titleRef = useRef<HTMLDivElement>(null);
  const titleTriggerRef = useRef<HTMLButtonElement>(null);
  const wasTitleEditing = useRef(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    person: { personId: string; name: string | null };
    holder: string;
  }>();
  const dispatching = useRef(false);
  const transitions = useGetWorkItemTransitions({
    key: item.key,
    enabled: stateOpen && canTransition,
  });
  const people = useGetAssignablePeople({
    projectId: item.projectId,
    enabled: assigneeOpen && canAssign,
  });
  const editingCustomField = customFieldColumns.find(
    (field) => field.key === editingCustomFieldKey,
  );
  const customFieldPeopleQuery = useGetAssignablePeople({
    projectId: item.projectId,
    enabled:
      Boolean(editingCustomField) &&
      (editingCustomField?.format === "user" ||
        editingCustomField?.format === "multi_user") &&
      permission.canUpdateTasks(),
  });
  const childrenGuard = useOpenChildrenGuard();

  const mutation = useMutation({
    scope: workItemMutationScope(item.key),
    mutationFn: async (command: Command) => {
      if (command.kind === "state") {
        const response = await transitionWorkItem({
          key: item.key,
          toStateTemplateId: command.offer.toStateTemplateId,
          ...(command.note?.trim() ? { note: command.note.trim() } : {}),
        });
        writeWorkItemResponse(client, item.key, response, {
          stateName: command.offer.toStateName,
          ...(response && typeof response === "object" && "stateId" in response
            ? { stateId: (response as { stateId: string }).stateId }
            : {}),
        });
        return;
      }
      if (command.kind === "priority") {
        const response = await updateWorkItem({
          key: item.key,
          version: currentWorkItemVersion(client, item),
          priority: command.value,
        });
        writeWorkItemResponse(client, item.key, response, {
          priority: command.value,
        });
        return;
      }
      if (command.kind === "title") {
        const response = await updateWorkItem({
          key: item.key,
          version: currentWorkItemVersion(client, item),
          title: command.value,
        });
        writeWorkItemResponse(client, item.key, response, {
          title: command.value,
        });
        return;
      }
      if (command.kind === "dueDate") {
        const response = await updateWorkItem({
          key: item.key,
          version: currentWorkItemVersion(client, item),
          dueDate: command.value,
        });
        writeWorkItemResponse(client, item.key, response, {
          dueDate: command.value,
        });
        return;
      }
      if (command.kind === "customField") {
        await updateWorkItem({
          key: item.key,
          version: currentWorkItemVersion(client, item),
          customFields: { [command.key]: command.value },
        });
        return;
      }
      const response = command.person
        ? await assignWorkItem({
            key: item.key,
            assigneeId: command.person.personId,
            expectedCurrentAssigneeId: command.holder,
          })
        : await unassignWorkItem(item.key, command.holder);
      writeWorkItemResponse(client, item.key, response, {
        assigneeId: command.person?.personId ?? null,
        assigneeName: command.person?.name ?? null,
      });
    },
    onSuccess: async () => {
      setStateOpen(false);
      setPriorityOpen(false);
      setAssigneeOpen(false);
      setDueDateOpen(false);
      setTitleEditing(false);
      setTitleDraft(item.title);
      setEditingCustomFieldKey(null);
      setCustomFieldDraft(null);
      setError("");
      setNoteFor(null);
      setNote("");
      setConfirmation(undefined);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["work-items", item.projectId] }),
        client.invalidateQueries({ queryKey: workItemDetailKey(item.key) }),
        client.invalidateQueries({
          queryKey: ["work-items", "transitions", item.key],
        }),
        client.invalidateQueries({
          queryKey: ["work-items", "activity", item.key],
        }),
      ]);
      toast.success(t("workItems:journey.editSaved"));
    },
    onError: (mutationError, command) => {
      if (isWorkItemAccessLost(mutationError)) {
        setStateOpen(false);
        setPriorityOpen(false);
        setAssigneeOpen(false);
        setDueDateOpen(false);
        setTitleEditing(false);
        setEditingCustomFieldKey(null);
        setCustomFieldDraft(null);
        void client.invalidateQueries({
          queryKey: ["work-items", item.projectId],
        });
        return;
      }
      const message =
        mutationError instanceof WorkItemVersionConflictError
          ? t("workItems:properties.conflict")
          : mutationError instanceof WorkItemTransitionBlockedError
            ? t("workItems:board.transitionBlocked", {
                key: item.key,
                reason: mutationError.reasonCodes
                  .map((code) => t(workItemTransitionReasonKey(code)))
                  .join(", "),
              })
            : mutationError instanceof HttpError && mutationError.status === 409
              ? t("workItems:journey.assignmentConflict")
              : t("workItems:properties.saveFailed");
      setError(message);
      toast.error(message);
      if (
        mutationError instanceof WorkItemVersionConflictError &&
        (command.kind === "title" || command.kind === "customField")
      ) {
        setTitleEditing(false);
        if (command.kind === "customField") {
          setEditingCustomFieldKey(null);
          setCustomFieldDraft(null);
        }
        void client
          .invalidateQueries({ queryKey: ["work-items", item.projectId] })
          .then(() =>
            client.invalidateQueries({
              queryKey: workItemDetailKey(item.key),
            }),
          );
      }
      void client.invalidateQueries({
        queryKey: ["work-items", item.projectId],
      });
    },
    onSettled: () => {
      dispatching.current = false;
    },
  });

  useEffect(() => {
    if (isWorkItemAccessLost(transitions.error)) {
      setStateOpen(false);
      void client.invalidateQueries({
        queryKey: ["work-items", item.projectId],
      });
    }
    if (isWorkItemAccessLost(people.error)) {
      setAssigneeOpen(false);
      void client.invalidateQueries({
        queryKey: ["work-items", item.projectId],
      });
    }
  }, [client, item.projectId, people.error, transitions.error]);

  useEffect(() => {
    if (confirmation?.holder !== item.assigneeId) setConfirmation(undefined);
  }, [confirmation?.holder, item.assigneeId]);

  useEffect(() => {
    if (!titleEditing) setTitleDraft(item.title);
  }, [item.title, titleEditing]);

  useEffect(() => {
    if (!canEditTitle && titleEditing) {
      setTitleEditing(false);
      setTitleDraft(item.title);
    }
    if (!canEditDueDate) setDueDateOpen(false);
  }, [canEditDueDate, canEditTitle, item.title, titleEditing]);

  useEffect(() => {
    if (titleEditing) {
      const textarea = titleRef.current?.querySelector("textarea");
      textarea?.focus();
      textarea?.select();
    } else if (wasTitleEditing.current) {
      titleTriggerRef.current?.focus();
    }
    wasTitleEditing.current = titleEditing;
  }, [titleEditing]);

  useEffect(() => {
    if (previousCustomFieldKey.current && !editingCustomFieldKey) {
      customFieldEditButtons.current
        .get(previousCustomFieldKey.current)
        ?.focus();
    }
    previousCustomFieldKey.current = editingCustomFieldKey;
  }, [editingCustomFieldKey]);

  const run = (command: Command) => {
    if (
      !mutable ||
      mutation.isPending ||
      dispatching.current ||
      (command.kind === "state" && !canTransition) ||
      (command.kind === "priority" && !canEditPriority) ||
      (command.kind === "title" && !canEditTitle) ||
      (command.kind === "dueDate" && !canEditDueDate) ||
      (command.kind === "customField" && !canEditCustomField(command.key)) ||
      (command.kind === "assign" && !canAssign)
    )
      return;
    dispatching.current = true;
    setError("");
    void mutation.mutateAsync(command).catch(() => undefined);
  };

  const chooseTransition = (offer: TransitionOffer) => {
    const noteOnly =
      offer.blockedBy.length > 0 &&
      offer.blockedBy.every((reason) => reason.reasonCode === "note.required");
    if (
      !canTransition ||
      mutation.isPending ||
      dispatching.current ||
      (!offer.available && !noteOnly)
    )
      return;
    setError("");
    const proceed = () => {
      if (offer.notePolicy && offer.notePolicy !== "none") {
        setStateOpen(true);
        setNoteFor(offer.transitionId);
        return;
      }
      run({ kind: "state", offer });
    };
    void childrenGuard.guard({
      key: item.key,
      closing:
        isClosingCategory(offer.toStateCategory) &&
        !isClosingCategory(item.stateCategory),
      proceed,
    });
  };

  const selectAssignee = (
    person: { personId: string; name: string | null } | null,
  ) => {
    if (!canAssign || mutation.isPending || dispatching.current) return;
    if (person?.personId === item.assigneeId) return;
    const holder = item.assigneeId;
    setAssigneeOpen(false);
    if (person && holder) {
      setConfirmation({ person, holder });
      return;
    }
    run({ kind: "assign", person, holder });
  };

  const offers = transitions.data ?? [];
  const noteOffer = offers.find((offer) => offer.transitionId === noteFor);
  const canUnassign =
    canAssign &&
    item.assigneeId !== null &&
    (permission.canAssignTasks() ||
      (permission.canUpdateTasks() &&
        (people.data ?? []).some(
          (person) => person.personId === item.assigneeId,
        )));
  const currentPriority = item.priority ?? "no-priority";
  const display = resolveAssigneeDisplay(item);
  const assigneeName = assigneeDisplayText(display, {
    unassigned:
      presentation === "table"
        ? t("workItems:list.unassigned")
        : t("workItems:detail.unassigned"),
    inactive:
      presentation === "table"
        ? t("workItems:list.assigneeInactive")
        : t("workItems:detail.inactiveAssignee"),
    notOnProject: t("workItems:list.assigneeNotOnProject"),
  });

  const titleControl =
    canEditTitle && !titleEditing ? (
      <Button
        ref={titleTriggerRef}
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        aria-label={t("workItems:list.editTitle")}
        data-testid="work-item-inline-title-edit"
        disabled={mutation.isPending}
        onClick={() => {
          setError("");
          setTitleDraft(item.title);
          setTitleEditing(true);
        }}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    ) : null;
  const titleEditor = titleEditing ? (
    <div
      ref={titleRef}
      className="flex min-w-0 items-start gap-1.5 max-sm:flex-col max-sm:items-stretch"
      data-testid="work-item-inline-title-editor"
    >
      <Textarea
        unstyled
        rows={1}
        maxLength={500}
        className="min-w-0 flex-1 max-sm:w-full max-sm:flex-none [&>textarea]:min-h-7 [&>textarea]:max-h-20 [&>textarea]:resize-y [&>textarea]:rounded-md [&>textarea]:border [&>textarea]:border-input [&>textarea]:bg-background [&>textarea]:px-2 [&>textarea]:py-1 [&>textarea]:text-sm [&>textarea]:font-normal"
        aria-label={t("workItems:properties.titleLabel")}
        placeholder={t("workItems:properties.titlePlaceholder")}
        value={titleDraft}
        readOnly={!canEditTitle || mutation.isPending}
        onChange={(event) => setTitleDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setTitleDraft(item.title);
            setTitleEditing(false);
          }
        }}
      />
      <div className="flex shrink-0 items-center gap-0.5 max-sm:self-start">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          data-testid="work-item-inline-title-save"
          disabled={
            !canEditTitle ||
            mutation.isPending ||
            !titleDraft.trim() ||
            titleDraft.trim() === item.title
          }
          onClick={() => {
            const value = titleDraft.trim();
            if (canEditTitle && value && value !== item.title)
              run({ kind: "title", value });
          }}
        >
          {t("common:actions.save")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          data-testid="work-item-inline-title-cancel"
          disabled={!canEditTitle || mutation.isPending}
          onClick={() => {
            setTitleDraft(item.title);
            setTitleEditing(false);
          }}
        >
          {t("common:actions.cancel")}
        </Button>
      </div>
    </div>
  ) : null;

  const dueDateStartDay = item.startDate ? isoToDay(item.startDate) : undefined;
  const dueDateDisabled =
    dueDateStartDay && !Number.isNaN(dueDateStartDay.getTime())
      ? { before: dueDateStartDay }
      : undefined;
  const dueDateControl = canEditDueDate ? (
    <Popover open={dueDateOpen} onOpenChange={setDueDateOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full min-w-0 max-w-full justify-start gap-1.5 px-1.5 text-xs"
          aria-label={`${t("workItems:list.columnDueDate")}: ${item.dueDate ? formatDateShort(item.dueDate) : t("workItems:list.noDueDate")}`}
          data-testid="work-item-inline-due-date"
          disabled={!canEditDueDate || mutation.isPending}
        >
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">
            {item.dueDate
              ? formatDateShort(item.dueDate)
              : t("workItems:list.noDueDate")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={isoToDay(item.dueDate)}
          onSelect={(day) => {
            if (!canEditDueDate || mutation.isPending) return;
            run({ kind: "dueDate", value: dayToIso(day, item.dueDate) });
          }}
          disabled={dueDateDisabled}
          className="w-full bg-popover"
          weekStartsOn={weekStartsOn}
        />
        {item.dueDate ? (
          <div className="border-border border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              data-testid="work-item-inline-due-date-clear"
              disabled={!canEditDueDate || mutation.isPending}
              onClick={() => {
                if (canEditDueDate) run({ kind: "dueDate", value: null });
              }}
            >
              {t("workItems:properties.clearDate")}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  ) : null;

  const customFieldControls: Record<string, ReactNode> = {};
  for (const field of customFieldColumns) {
    const values = item.customFieldValues ?? {};
    if (!Object.hasOwn(values, field.key)) continue;
    const value = values[field.key];
    const peopleForProject = customFieldPeople.filter(
      (person) => person.projectId === item.projectId,
    );
    const names = new Map(
      peopleForProject
        .filter((person) => person.name !== null)
        .map((person) => [person.personId, person.name as string]),
    );
    const displayValue = !isValueSet(value)
      ? t("customFields:value.notSet")
      : field.format === "user"
        ? (names.get(String(value)) ?? t("customFields:value.notOnProject"))
        : field.format === "multi_user" && Array.isArray(value)
          ? value
              .map(
                (personId) =>
                  names.get(String(personId)) ??
                  t("customFields:value.notOnProject"),
              )
              .join(", ")
          : formatValue(field, value);
    if (editingCustomFieldKey === field.key) {
      const editablePeopleById = new Map<string, string>();
      for (const person of customFieldPeople) {
        if (person.projectId === item.projectId && person.name)
          editablePeopleById.set(person.personId, person.name);
      }
      for (const person of customFieldPeopleQuery.data ?? []) {
        if (person.name) editablePeopleById.set(person.personId, person.name);
      }
      const editablePeople = [...editablePeopleById].map(
        ([personId, name]) => ({ personId, name }),
      );
      customFieldControls[field.key] = (
        <fieldset
          className="flex min-w-0 max-w-full flex-col gap-1"
          data-testid={`work-item-inline-custom-field-editor-${field.key}`}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setCustomFieldDraft(null);
            setEditingCustomFieldKey(null);
          }}
        >
          <legend className="sr-only">{field.name}</legend>
          <div className="min-w-0 max-w-full">
            <CustomFieldValueInput
              id={`work-item-inline-custom-field-${field.key}`}
              field={field}
              value={customFieldDraft}
              people={editablePeople}
              disabled={mutation.isPending}
              onChange={setCustomFieldDraft}
            />
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-0.5">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-5 w-5 shrink-0"
              aria-label={t("common:actions.save")}
              data-testid={`work-item-inline-custom-field-save-${field.key}`}
              disabled={
                mutation.isPending ||
                JSON.stringify(customFieldDraft ?? null) ===
                  JSON.stringify(value ?? null)
              }
              onClick={() =>
                run({
                  kind: "customField",
                  key: field.key,
                  value: customFieldDraft ?? null,
                })
              }
            >
              <Check className="size-3" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-5 w-5 shrink-0"
              aria-label={t("common:actions.cancel")}
              data-testid={`work-item-inline-custom-field-cancel-${field.key}`}
              disabled={mutation.isPending}
              onClick={() => {
                setCustomFieldDraft(null);
                setEditingCustomFieldKey(null);
              }}
            >
              <X className="size-3" />
            </Button>
          </div>
          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>
      );
    } else if (canEditCustomField(field.key)) {
      customFieldControls[field.key] = (
        <Button
          ref={(element) => {
            if (element) customFieldEditButtons.current.set(field.key, element);
            else customFieldEditButtons.current.delete(field.key);
          }}
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 min-w-0 max-w-full justify-start overflow-hidden px-1.5 text-xs"
          aria-label={t("edit", { name: field.name })}
          title={displayValue}
          data-testid={`work-item-inline-custom-field-edit-${field.key}`}
          disabled={mutation.isPending}
          onClick={() => {
            setError("");
            setCustomFieldDraft(value ?? null);
            setEditingCustomFieldKey(field.key);
          }}
        >
          <span className="min-w-0 truncate">{displayValue}</span>
          <Pencil className="ml-auto size-3 shrink-0" />
        </Button>
      );
    }
  }

  const stateTrigger = (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 max-w-40 justify-start gap-1.5 px-1.5 text-xs"
      aria-label={`${t("workItems:list.columnState")}: ${item.stateName}`}
      data-testid="work-item-inline-state"
    >
      {getColumnIcon(CATEGORY_ICON[item.stateCategory] ?? "to-do", false, null)}
      <span className="truncate">{item.stateName}</span>
    </Button>
  );
  const stateControl = canTransition ? (
    <Popover
      open={stateOpen}
      onOpenChange={(open) => {
        setStateOpen(open);
        if (!open) {
          setNoteFor(null);
          setNote("");
          setError("");
        }
      }}
    >
      <PopoverTrigger asChild>{stateTrigger}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {error ? (
          <p className="px-2 py-1.5 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {noteOffer ? (
          <form
            className="flex flex-col gap-2 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (noteOffer.notePolicy === "required" && !note.trim()) return;
              run({ kind: "state", offer: noteOffer, note });
            }}
          >
            <p className="text-sm font-medium">{noteOffer.toStateName}</p>
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
                mutation.isPending ||
                dispatching.current ||
                (noteOffer.notePolicy === "required" && !note.trim())
              }
            >
              {t("workItems:properties.move")}
            </Button>
          </form>
        ) : transitions.isLoading ? (
          <p className="p-3 text-sm text-muted-foreground" role="status">
            {t("common:empty.loading")}
          </p>
        ) : transitions.isError ? (
          <p className="p-3 text-sm text-destructive" role="alert">
            {t("workItems:journey.transitionsError")}
          </p>
        ) : offers.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {t("workItems:properties.noTransitions")}
          </p>
        ) : (
          <div>
            {offers.map((offer) => {
              const noteOnly =
                offer.blockedBy.length > 0 &&
                offer.blockedBy.every(
                  (reason) => reason.reasonCode === "note.required",
                );
              const blocked = !offer.available && !noteOnly;
              const reasons = offer.blockedBy.map((reason) =>
                t(workItemTransitionReasonKey(reason.reasonCode)),
              );
              return (
                <Button
                  key={offer.transitionId}
                  data-testid={`work-item-inline-transition-${offer.transitionId}`}
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-8 w-full flex-col items-start gap-0 rounded-none px-2 py-1.5 first:rounded-t-md last:rounded-b-md"
                  disabled={blocked || mutation.isPending || disabled}
                  onClick={() => chooseTransition(offer)}
                >
                  <span className="w-full text-left text-sm">
                    {offer.toStateName}
                  </span>
                  {blocked ? (
                    <span className="text-left text-xs text-muted-foreground">
                      {reasons.join(", ") ||
                        t("workItems:journey.reasonUnknown")}
                    </span>
                  ) : null}
                </Button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  ) : presentation === "table" ? null : (
    <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-xs text-muted-foreground">
      {getColumnIcon(CATEGORY_ICON[item.stateCategory] ?? "to-do", false, null)}
      <span className="truncate">{item.stateName}</span>
    </span>
  );

  const priorityTrigger = (
    <Button
      variant="ghost"
      size={presentation === "table" ? "sm" : "icon"}
      className={
        presentation === "table"
          ? "h-7 max-w-40 justify-start gap-1.5 px-1.5 text-xs"
          : "h-6 w-6 shrink-0"
      }
      aria-label={`${t("workItems:list.columnPriority")}: ${getPriorityLabel(currentPriority)}`}
      data-testid="work-item-inline-priority"
    >
      {getPriorityIcon(currentPriority)}
      {presentation === "table" ? (
        <span className="truncate">{getPriorityLabel(currentPriority)}</span>
      ) : null}
    </Button>
  );
  const priorityControl = canEditPriority ? (
    <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
      <PopoverTrigger asChild>{priorityTrigger}</PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        {error ? (
          <p className="px-2 py-1.5 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {PRIORITY_OPTIONS.map((value) => (
          <Button
            key={value}
            data-testid={`work-item-inline-priority-option-${value}`}
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 rounded-none px-2 first:rounded-t-md last:rounded-b-md"
            disabled={mutation.isPending || disabled}
            onClick={() => {
              if (value !== currentPriority)
                run({
                  kind: "priority",
                  value: value === "no-priority" ? null : value,
                });
              setPriorityOpen(false);
            }}
          >
            {getPriorityIcon(value)}
            <span className="text-sm">{getPriorityLabel(value)}</span>
            {value === currentPriority ? (
              <Check className="ml-auto h-4 w-4" />
            ) : null}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  ) : presentation === "table" ? null : (
    <span
      role="img"
      aria-label={`${t("workItems:list.columnPriority")}: ${getPriorityLabel(currentPriority)}`}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center"
    >
      {item.unavailableFields.includes("priority")
        ? "–"
        : getPriorityIcon(currentPriority)}
    </span>
  );

  const assigneeTrigger = (
    <Button
      variant="ghost"
      size={presentation === "table" ? "sm" : "icon"}
      className={
        presentation === "table"
          ? "h-7 max-w-40 justify-start gap-1.5 px-1.5 text-xs"
          : "h-7 w-7 shrink-0 rounded-full"
      }
      aria-label={`${t("workItems:list.columnAssignee")}: ${assigneeName}`}
      data-testid="work-item-inline-assignee"
    >
      {presentation === "table" ? (
        <span className="max-w-40 truncate text-xs">{assigneeName}</span>
      ) : display.kind === "person" ? (
        <Avatar className="h-5 w-5">
          <AvatarFallback className="text-[9px]">
            {getInitials(display.name)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <span className="text-[10px] text-muted-foreground">?</span>
      )}
    </Button>
  );
  const assigneeControl = canAssign ? (
    <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
      <PopoverTrigger asChild>{assigneeTrigger}</PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="end">
        {error ? (
          <p className="px-2 py-1.5 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {item.assigneeId !== null && canUnassign ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            disabled={mutation.isPending || disabled}
            onClick={() => selectAssignee(null)}
          >
            <span className="w-5 text-center text-muted-foreground">?</span>
            <span>{t("workItems:detail.unassigned")}</span>
            <Check className="ml-auto h-4 w-4" />
          </Button>
        ) : null}
        {people.isLoading ? (
          <p className="p-3 text-sm text-muted-foreground" role="status">
            {t("common:empty.loading")}
          </p>
        ) : people.isError ? (
          <p className="p-3 text-sm text-destructive" role="alert">
            {t("workItems:journey.peopleError")}
          </p>
        ) : (people.data ?? []).length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {t("workItems:journey.noPeople")}
          </p>
        ) : (
          (people.data ?? []).map((person) => (
            <Button
              key={person.personId}
              data-testid={`work-item-inline-assignee-option-${person.personId}`}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              disabled={
                mutation.isPending || item.assigneeId === person.personId
              }
              onClick={() =>
                selectAssignee({ personId: person.personId, name: person.name })
              }
            >
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-[9px]">
                  {getInitials(person.name ?? "")}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">
                {person.name ?? t("workItems:journey.unnamedPerson")}
              </span>
              {item.assigneeId === person.personId ? (
                <Check className="ml-auto h-4 w-4" />
              ) : null}
            </Button>
          ))
        )}
      </PopoverContent>
    </Popover>
  ) : presentation === "table" ? null : (
    <span
      role="img"
      aria-label={`${t("workItems:list.columnAssignee")}: ${assigneeName}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
    >
      {display.kind === "person" ? (
        <Avatar className="h-5 w-5">
          <AvatarFallback className="text-[9px]">
            {getInitials(display.name)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <span className="text-[10px] text-muted-foreground">?</span>
      )}
    </span>
  );

  return (
    <>
      {children({
        stateControl,
        priorityControl,
        assigneeControl,
        titleControl,
        titleEditor,
        dueDateControl,
        customFieldControls,
      })}
      {childrenGuard.dialog}
      <AlertDialog
        open={Boolean(confirmation && confirmation.holder === item.assigneeId)}
        onOpenChange={(open) => {
          if (!open) setConfirmation(undefined);
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
              disabled={mutation.isPending || !canAssign || disabled}
              onClick={() => {
                if (confirmation && confirmation.holder === item.assigneeId)
                  run({
                    kind: "assign",
                    person: confirmation.person,
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
