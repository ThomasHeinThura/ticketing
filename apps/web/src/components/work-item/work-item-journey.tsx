import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@taskdesk/ui";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import assignWorkItem from "@/fetchers/work-item/assign-work-item";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";
import unassignWorkItem from "@/fetchers/work-item/unassign-work-item";
import updateWorkItem from "@/fetchers/work-item/update-work-item";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";
import useGetWorkItemTransitions from "@/hooks/queries/work-item/use-get-work-item-transitions";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import {
  isWorkItemAccessLost,
  WorkItemVersionConflictError,
} from "@/lib/work-item-errors";
import { extractDescription, type WorkItemDetailRow } from "@/types/work-item";

/**
 * The API's `startDate`/`dueDate` are UTC instants (`work-items.md` does not define them
 * as bare calendar dates; the schema is an ISO date-time). The form edits only the
 * calendar day, so a CHANGED day keeps the stored time of day (UTC) and only moves the
 * date; a date set where none existed lands on UTC midnight. An unchanged date is never
 * sent at all, so an item due at 17:00Z is not silently rewritten to 00:00Z.
 */
function dateInputToIso(value: string, original: string | null) {
  if (!value) return null;
  const timeOfDay = original?.slice(10) || "T00:00:00.000Z";
  return `${value}${timeOfDay}`;
}

type SectionProps = WorkItemJourneyProps & {
  /** Polite, visually hidden announcement of a successful change (WCAG 4.1.3). */
  announce: (message: string) => void;
};

export type WorkItemJourneyProps = {
  item: WorkItemDetailRow;
  /** Called when any request for this item answers 404: the item is gone or no longer
   * reachable (reach loss and absence are indistinguishable, so one not-found state). */
  onAccessLost: () => void;
};

/** Fields the edit form round-trips. If the fetcher marked any of them unavailable the
 * form cannot know their real value, so editing is not offered rather than risking a
 * write of a placeholder. */
const EDITABLE_FIELDS = ["title", "description", "startDate", "dueDate"];

/**
 * Edit, state change and assignment for the work-item detail page
 * (`docs/03-features/work-items.md` `WI-7`..`WI-9`, `assignment.md` `AS-1`..`AS-3`,
 * `workflows.md` "The state select"). Every control is gated on the strict capability the
 * server reports for the item's workspace, and every list of options (transitions,
 * assignable people) is the server's, never computed here.
 *
 * Keyed by item key, so drafts and confirmations never leak from one work item to the
 * next when the route's `{key}` changes under a mounted page.
 */
export default function WorkItemJourney(props: WorkItemJourneyProps) {
  return <WorkItemJourneyForItem key={props.item.key} {...props} />;
}

function WorkItemJourneyForItem({ item, onAccessLost }: WorkItemJourneyProps) {
  // One live region for the whole journey, mounted before any change so the message is
  // announced; sections remount between loading/ready/empty, this does not.
  const [announcement, setAnnouncement] = useState("");
  const {
    canUpdateTasks,
    canAssignTasks,
    canTransitionTasks,
    isCheckingPermissions,
  } = useWorkspacePermission(item.workspaceId);
  const mayEdit = !isCheckingPermissions && canUpdateTasks();
  const mayAssign =
    !isCheckingPermissions && (canUpdateTasks() || canAssignTasks());
  const mayTransition = !isCheckingPermissions && canTransitionTasks();

  if (!mayEdit && !mayAssign && !mayTransition) return null;

  return (
    <div className="flex flex-col gap-6" data-testid="work-item-journey">
      <p
        role="status"
        className="sr-only"
        data-testid="work-item-journey-status"
      >
        {announcement}
      </p>
      {mayEdit && (
        <EditSection
          item={item}
          onAccessLost={onAccessLost}
          announce={setAnnouncement}
        />
      )}
      {mayTransition && (
        <TransitionSection
          item={item}
          onAccessLost={onAccessLost}
          announce={setAnnouncement}
        />
      )}
      {mayAssign && (
        <AssignmentSection
          item={item}
          onAccessLost={onAccessLost}
          announce={setAnnouncement}
        />
      )}
    </div>
  );
}

/** Server reason codes (`workflows.md`: `guard.<type>`, `note.required`, approval/CAB
 * gates) as readable text. An unrecognised code never shows raw. */
const REASON_KEYS: Record<string, string> = {
  "note.required": "reasonNoteRequired",
  "guard.assignee_present": "reasonAssigneePresent",
  "guard.children_closed": "reasonChildrenClosed",
  "guard.no_open_blockers": "reasonNoOpenBlockers",
  "guard.field_required": "reasonFieldRequired",
  "guard.change_risk_at_most": "reasonChangeRisk",
  "guard.unrecognized": "reasonUnknown",
  "approval.pending": "reasonApprovalPending",
  "cab.pending": "reasonCabPending",
};

function reasonKey(code: string) {
  return `workItems:journey.${REASON_KEYS[code] ?? "reasonUnknown"}`;
}

const BUILT_IN_ROLES = ["owner", "admin", "member", "viewer"];

/** `roleName` is the role's display name (custom roles are free text). The four built-in
 * names are localised; anything else is shown as the workspace named it. */
function roleLabel(
  roleName: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const key = roleName.trim().toLowerCase();
  return BUILT_IN_ROLES.includes(key) ? t(`team:roles.${key}`) : roleName;
}

function useInvalidateWorkItem(item: WorkItemDetailRow) {
  const queryClient = useQueryClient();
  const invalidateDetail = () =>
    queryClient.invalidateQueries({
      queryKey: ["work-items", "detail", item.key],
    });
  const invalidateAll = async () => {
    await Promise.all([
      invalidateDetail(),
      queryClient.invalidateQueries({
        queryKey: ["work-items", "activity", item.key],
      }),
      queryClient.invalidateQueries({
        queryKey: ["work-items", "transitions", item.key],
      }),
      queryClient.invalidateQueries({
        queryKey: ["work-items", item.projectId],
      }),
    ]);
  };
  return { invalidateDetail, invalidateAll };
}

function EditSection({ item, onAccessLost, announce }: SectionProps) {
  const { t } = useTranslation();
  const { invalidateDetail, invalidateAll } = useInvalidateWorkItem(item);
  const ids = useId();
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  // The version the draft was seeded from. A 409 deliberately does NOT move it: the user
  // sees their draft against the newer server value and decides; nothing is retried
  // behind their back with a version they have not seen (`WI-7`).
  const [editVersion, setEditVersion] = useState(item.version);
  const [title, setTitle] = useState(item.title);
  const description = extractDescription(item.description);
  const [descriptionText, setDescriptionText] = useState(
    description.kind === "text" ? description.text : "",
  );
  // The item values the draft was seeded from, so only real changes are sent.
  const [baseline, setBaseline] = useState({
    title: item.title,
    description: description.kind === "text" ? description.text : "",
    startDate: item.startDate,
    dueDate: item.dueDate,
  });
  const [startDate, setStartDate] = useState(
    item.startDate?.slice(0, 10) ?? "",
  );
  const [dueDate, setDueDate] = useState(item.dueDate?.slice(0, 10) ?? "");
  const [editError, setEditError] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const canEditFields = !item.unavailableFields.some((field) =>
    EDITABLE_FIELDS.includes(field),
  );

  const seedDraft = () => {
    setEditVersion(item.version);
    setBaseline({
      title: item.title,
      description: description.kind === "text" ? description.text : "",
      startDate: item.startDate,
      dueDate: item.dueDate,
    });
    setTitle(item.title);
    setDescriptionText(description.kind === "text" ? description.text : "");
    setStartDate(item.startDate?.slice(0, 10) ?? "");
    setDueDate(item.dueDate?.slice(0, 10) ?? "");
    setEditError("");
    setConflicted(false);
  };
  const startEditing = () => {
    seedDraft();
    setEditing(true);
  };
  const stopEditing = () => {
    setEditing(false);
    setEditError("");
    setConflicted(false);
  };

  // Keyboard users land in the form when it opens and back on its trigger when it closes.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) titleInputRef.current?.focus();
    else if (wasEditing.current) editButtonRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const titleChanged = title !== baseline.title;
  // Reverting the text to what it was is not a change.
  const descriptionChanged = descriptionText !== baseline.description;
  const startChanged = startDate !== (baseline.startDate?.slice(0, 10) ?? "");
  const dueChanged = dueDate !== (baseline.dueDate?.slice(0, 10) ?? "");
  const hasChanges =
    titleChanged || descriptionChanged || startChanged || dueChanged;

  const editMutation = useMutation({
    mutationFn: () =>
      updateWorkItem({
        key: item.key,
        version: editVersion,
        ...(titleChanged ? { title } : {}),
        ...(descriptionChanged ? { description: descriptionText || null } : {}),
        ...(startChanged
          ? { startDate: dateInputToIso(startDate, baseline.startDate) }
          : {}),
        ...(dueChanged
          ? { dueDate: dateInputToIso(dueDate, baseline.dueDate) }
          : {}),
      }),
    onSuccess: async () => {
      stopEditing();
      announce(t("workItems:journey.editSaved"));
      await invalidateAll();
    },
    onError: async (error) => {
      if (isWorkItemAccessLost(error)) {
        stopEditing();
        onAccessLost();
        return;
      }
      if (error instanceof WorkItemVersionConflictError) {
        setConflicted(true);
        setEditError(
          t("workItems:journey.editConflict", {
            asserted: error.assertedVersion,
            current: error.currentVersion,
          }),
        );
        await invalidateDetail();
        return;
      }
      setEditError(t("workItems:journey.saveError"));
    },
  });

  return (
    <section
      aria-labelledby={`${ids}-heading`}
      className="flex flex-col gap-3"
      data-testid="work-item-edit"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${ids}-heading`} className="font-medium text-lg">
          {t("workItems:journey.editHeading")}
        </h2>
        {!editing && canEditFields && (
          <Button
            ref={editButtonRef}
            variant="outline"
            size="sm"
            onClick={startEditing}
          >
            {t("workItems:journey.edit")}
          </Button>
        )}
      </div>
      {!canEditFields && (
        <p className="text-muted-foreground text-sm">
          {t("workItems:journey.editUnavailable")}
        </p>
      )}
      {editing && canEditFields && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            editMutation.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-title`}>
              {t("workItems:journey.title")}
            </Label>
            <Input
              id={`${ids}-title`}
              ref={titleInputRef}
              value={title}
              maxLength={500}
              required
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          {description.kind !== "unsupported" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-description`}>
                {t("workItems:journey.description")}
              </Label>
              <Textarea
                id={`${ids}-description`}
                value={descriptionText}
                onChange={(event) => {
                  setDescriptionText(event.target.value);
                }}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-start`}>
              {t("workItems:journey.startDate")}
            </Label>
            <Input
              id={`${ids}-start`}
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-due`}>
              {t("workItems:journey.dueDate")}
            </Label>
            <Input
              id={`${ids}-due`}
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          {editError && (
            <Alert variant="warning" role="alert">
              <AlertTitle>{t("workItems:journey.saveAttention")}</AlertTitle>
              <AlertDescription>
                <p>{editError}</p>
                {conflicted && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={seedDraft}
                  >
                    {t("workItems:journey.reloadLatest")}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={
                editMutation.isPending ||
                title.trim().length === 0 ||
                !hasChanges
              }
            >
              {editMutation.isPending
                ? t("workItems:journey.saving")
                : t("workItems:journey.save")}
            </Button>
            <Button type="button" variant="outline" onClick={stopEditing}>
              {t("workItems:journey.cancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function TransitionSection({ item, onAccessLost, announce }: SectionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { t } = useTranslation();
  const { invalidateAll, invalidateDetail } = useInvalidateWorkItem(item);
  const ids = useId();
  const transitions = useGetWorkItemTransitions({
    key: item.key,
    enabled: true,
  });
  const [selectedId, setSelectedId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const transitionsError = transitions.error;
  useEffect(() => {
    if (isWorkItemAccessLost(transitionsError)) onAccessLost();
  }, [transitionsError, onAccessLost]);

  const selected = transitions.data?.find(
    (entry) => entry.transitionId === selectedId,
  );
  // An offer blocked ONLY for want of a note is runnable once the note is supplied.
  const onlyNeedsNote = (offer: NonNullable<typeof selected>) =>
    offer.blockedBy.length === 1 &&
    offer.blockedBy[0]?.reasonCode === "note.required";
  const canRun = Boolean(
    selected &&
      (selected.available || onlyNeedsNote(selected)) &&
      (selected.notePolicy !== "required" || note.trim()),
  );

  const mutation = useMutation({
    mutationFn: (input: { toStateTemplateId: string; note?: string }) =>
      transitionWorkItem({ key: item.key, ...input }),
    onSuccess: async (_result, input) => {
      const moved = transitions.data?.find(
        (entry) => entry.toStateTemplateId === input.toStateTemplateId,
      );
      setSelectedId("");
      setNote("");
      setError("");
      announce(
        t("workItems:journey.transitionDone", { state: moved?.toStateName }),
      );
      await invalidateAll();
    },
    // The submit button disables once the offers refetch; focus would drop to <body>
    // (WCAG 2.4.3), so it moves to the section heading, a stable target.
    onSettled: () => headingRef.current?.focus(),
    onError: async (mutationError) => {
      if (isWorkItemAccessLost(mutationError)) {
        onAccessLost();
        return;
      }
      setError(
        mutationError instanceof HttpError && mutationError.status === 409
          ? t("workItems:journey.transitionConflict")
          : mutationError instanceof HttpError && mutationError.status === 422
            ? t("workItems:journey.transitionUnavailable")
            : t("workItems:journey.saveError"),
      );
      // The offers may have changed under us; show the server's current ones.
      await Promise.all([invalidateDetail(), transitions.refetch()]);
    },
  });

  const heading = (
    <h2
      id={`${ids}-heading`}
      ref={headingRef}
      tabIndex={-1}
      className="font-medium text-lg"
    >
      {t("workItems:detail.stateLabel")}
    </h2>
  );

  if (isWorkItemAccessLost(transitionsError)) return null;

  if (transitions.isLoading) {
    return (
      <section
        aria-labelledby={`${ids}-heading`}
        className="flex flex-col gap-3"
      >
        {heading}
        <p role="status" className="text-muted-foreground text-sm">
          {t("workItems:journey.loadingTransitions")}
        </p>
      </section>
    );
  }

  if (transitions.isError) {
    return (
      <section
        aria-labelledby={`${ids}-heading`}
        className="flex flex-col gap-3"
      >
        {heading}
        <Alert variant="error" role="alert">
          <AlertDescription>
            <p>{t("workItems:journey.transitionsError")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void transitions.refetch()}
            >
              {t("workItems:detail.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  if (!transitions.data?.length) {
    return (
      <section
        aria-labelledby={`${ids}-heading`}
        className="flex flex-col gap-3"
      >
        {heading}
        <p className="text-muted-foreground text-sm">
          {t("workItems:journey.transitionsEmpty")}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-3">
      {heading}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selected || !canRun) return;
          mutation.mutate({
            toStateTemplateId: selected.toStateTemplateId,
            ...(selected.notePolicy !== "none" && note.trim()
              ? { note: note.trim() }
              : {}),
          });
        }}
      >
        <Label htmlFor={`${ids}-select`}>
          {t("workItems:detail.stateLabel")}
        </Label>
        <Select
          value={selectedId}
          onValueChange={(value) => {
            setSelectedId(value ?? "");
            setNote("");
            setError("");
          }}
        >
          <SelectTrigger id={`${ids}-select`}>
            <SelectValue
              placeholder={t("workItems:journey.transitionPlaceholder")}
            >
              {selected?.toStateName}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {transitions.data.map((offer) => {
              const blocked = !offer.available && !onlyNeedsNote(offer);
              const reasons = offer.blockedBy
                .map((reason) => t(reasonKey(reason.reasonCode)))
                .join(", ");
              return (
                <SelectItem
                  key={offer.transitionId}
                  value={offer.transitionId}
                  disabled={blocked}
                >
                  {offer.toStateName}
                  {blocked
                    ? ` — ${t("workItems:journey.transitionBlocked", { reasons })}`
                    : offer.notePolicy === "required"
                      ? ` — ${t("workItems:journey.transitionNoteRequired")}`
                      : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {selected && selected.notePolicy !== "none" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-note`}>
              {t("workItems:journey.transitionNote")}
            </Label>
            <Textarea
              id={`${ids}-note`}
              value={note}
              maxLength={10_000}
              required={selected.notePolicy === "required"}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        )}
        {error && (
          <Alert variant="warning" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={!canRun || mutation.isPending}
          >
            {mutation.isPending
              ? t("workItems:journey.transitionMoving")
              : t("workItems:journey.transitionSubmit")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function AssignmentSection({ item, onAccessLost, announce }: SectionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { t } = useTranslation();
  const { invalidateAll, invalidateDetail } = useInvalidateWorkItem(item);
  const ids = useId();
  const { canUpdateTasks, canAssignTasks } = useWorkspacePermission(
    item.workspaceId,
  );
  // `AS-2`: without `work_item:assign`, `work_item:update` permits assigning or
  // unassigning oneself only. The server's roster for such a caller is just themselves.
  const selfAssignmentOnly = canUpdateTasks() && !canAssignTasks();
  const assignees = useGetAssignablePeople({
    projectId: item.projectId,
    enabled: true,
  });
  const [selectedAssignee, setSelectedAssignee] = useState(
    item.assigneeId ?? "",
  );
  const [confirmReassign, setConfirmReassign] = useState(false);
  const [error, setError] = useState("");
  // The holder this section last saw. When a refetch (or a concurrent change) moves it:
  // a pending take-over confirmation was for the OLD holder and must not carry over
  // (AS-3 -- the second click would otherwise assert the new holder blind), and the
  // picker follows the item unless the user has already picked someone else.
  const [seenHolder, setSeenHolder] = useState(item.assigneeId);
  if (seenHolder !== item.assigneeId) {
    setSeenHolder(item.assigneeId);
    setConfirmReassign(false);
    if (selectedAssignee === (seenHolder ?? "")) {
      setSelectedAssignee(item.assigneeId ?? "");
    }
  }

  const assigneesError = assignees.error;
  useEffect(() => {
    if (isWorkItemAccessLost(assigneesError)) onAccessLost();
  }, [assigneesError, onAccessLost]);

  const handleFailure = async (mutationError: unknown, fallbackKey: string) => {
    setConfirmReassign(false);
    if (isWorkItemAccessLost(mutationError)) {
      onAccessLost();
      return;
    }
    if (mutationError instanceof HttpError && mutationError.status === 409) {
      await invalidateDetail();
      setError(t("workItems:journey.assignmentConflict"));
    } else {
      setError(t(fallbackKey));
    }
  };

  const assignMutation = useMutation({
    mutationFn: (assigneeId: string) =>
      assignWorkItem({
        key: item.key,
        assigneeId,
        expectedCurrentAssigneeId: item.assigneeId,
      }),
    onSuccess: async (_result, assigneeId) => {
      const person = assignees.data?.find(
        (entry) => entry.personId === assigneeId,
      );
      setError("");
      setConfirmReassign(false);
      announce(
        t("workItems:journey.assignDone", {
          name: person?.name ?? t("workItems:journey.unnamedPerson"),
        }),
      );
      await invalidateAll();
    },
    // The buttons disable or unmount as the item refetches; keep focus on a stable target.
    onSettled: () => headingRef.current?.focus(),
    onError: (mutationError) =>
      handleFailure(mutationError, "workItems:journey.assignmentError"),
  });
  const unassignMutation = useMutation({
    mutationFn: () => unassignWorkItem(item.key),
    onSuccess: async () => {
      setError("");
      announce(t("workItems:journey.unassignDone"));
      await invalidateAll();
    },
    onSettled: () => headingRef.current?.focus(),
    onError: (mutationError) =>
      handleFailure(mutationError, "workItems:journey.unassignmentError"),
  });

  // `AS-3`: taking work already held by someone else needs an explicit second step.
  const submitAssignment = (assigneeId: string) => {
    if (!assigneeId || assigneeId === item.assigneeId) return;
    if (item.assigneeId && !confirmReassign) {
      setConfirmReassign(true);
      return;
    }
    assignMutation.mutate(assigneeId);
  };

  const canUnassign = Boolean(
    item.assigneeId &&
      (canAssignTasks() ||
        (selfAssignmentOnly &&
          assignees.data?.some(
            (person) => person.personId === item.assigneeId,
          ))),
  );
  const self = assignees.data?.[0];
  const heading = (
    <h2
      id={`${ids}-heading`}
      ref={headingRef}
      tabIndex={-1}
      className="font-medium text-lg"
    >
      {t("workItems:journey.assignmentHeading")}
    </h2>
  );

  if (isWorkItemAccessLost(assigneesError)) return null;

  if (assignees.isLoading) {
    return (
      <section
        aria-labelledby={`${ids}-heading`}
        className="flex flex-col gap-3"
      >
        {heading}
        <p role="status" className="text-muted-foreground text-sm">
          {t("workItems:journey.loadingPeople")}
        </p>
      </section>
    );
  }

  if (assignees.isError) {
    return (
      <section
        aria-labelledby={`${ids}-heading`}
        className="flex flex-col gap-3"
      >
        {heading}
        <Alert variant="error" role="alert">
          <AlertDescription>
            <p>{t("workItems:journey.peopleError")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void assignees.refetch()}
            >
              {t("workItems:detail.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const confirmNotice = confirmReassign && (
    <Alert variant="warning" role="alert">
      <AlertTitle>{t("workItems:journey.confirmReassign")}</AlertTitle>
      <AlertDescription>
        {t("workItems:journey.confirmReassignDescription")}
      </AlertDescription>
    </Alert>
  );
  const errorNotice = error && (
    <Alert variant="warning" role="alert">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
  const unassignButton = canUnassign && (
    <Button
      variant="outline"
      size="sm"
      disabled={unassignMutation.isPending}
      onClick={() => unassignMutation.mutate()}
    >
      {t("workItems:journey.unassign")}
    </Button>
  );
  const cancelButton = confirmReassign && (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setConfirmReassign(false)}
    >
      {t("workItems:journey.cancel")}
    </Button>
  );

  if (selfAssignmentOnly) {
    return (
      <section
        aria-labelledby={`${ids}-heading`}
        className="flex flex-col gap-3"
      >
        {heading}
        {errorNotice}
        {confirmNotice}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={
              !self ||
              self.personId === item.assigneeId ||
              assignMutation.isPending
            }
            onClick={() => {
              if (self) submitAssignment(self.personId);
            }}
          >
            {confirmReassign
              ? t("workItems:journey.confirmAssignment")
              : t("workItems:journey.assignToMe")}
          </Button>
          {unassignButton}
          {cancelButton}
        </div>
      </section>
    );
  }

  const people = assignees.data ?? [];
  const selectedPerson = people.find(
    (person) => person.personId === selectedAssignee,
  );
  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-3">
      {heading}
      {people.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            {t("workItems:journey.noPeople")}
          </p>
          {errorNotice}
          {unassignButton && <div className="flex gap-2">{unassignButton}</div>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${ids}-assignee`}>
            {t("workItems:journey.assignee")}
          </Label>
          <Select
            value={selectedAssignee}
            onValueChange={(value) => {
              setSelectedAssignee(value ?? "");
              setConfirmReassign(false);
            }}
          >
            <SelectTrigger id={`${ids}-assignee`}>
              <SelectValue
                placeholder={t("workItems:journey.assigneePlaceholder")}
              >
                {selectedPerson
                  ? (selectedPerson.name ??
                    t("workItems:journey.unnamedPerson"))
                  : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {people.map((person) => (
                <SelectItem key={person.personId} value={person.personId}>
                  {person.name ?? t("workItems:journey.unnamedPerson")} ·{" "}
                  {roleLabel(person.roleName, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {confirmNotice}
          {errorNotice}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={
                !selectedAssignee ||
                selectedAssignee === item.assigneeId ||
                assignMutation.isPending
              }
              onClick={() => submitAssignment(selectedAssignee)}
            >
              {confirmReassign
                ? t("workItems:journey.confirmAssignment")
                : t("workItems:journey.assign")}
            </Button>
            {unassignButton}
            {cancelButton}
          </div>
        </div>
      )}
    </section>
  );
}
