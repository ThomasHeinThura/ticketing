import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
import { useState } from "react";
import { useTranslation } from "react-i18next";
import WorkItemActivityComment from "@/components/work-item/work-item-activity-comment";
import assignWorkItem from "@/fetchers/work-item/assign-work-item";
import getAssignablePeople from "@/fetchers/work-item/get-assignable-people";
import getWorkItemActivity from "@/fetchers/work-item/get-work-item-activity";
import unassignWorkItem from "@/fetchers/work-item/unassign-work-item";
import updateWorkItem from "@/fetchers/work-item/update-work-item";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import { extractDescription } from "@/types/work-item";

function dateInputToIso(value: string) {
  // The API schema stores these as UTC instants and requires an ISO date-time.
  // A date input is a calendar date, so represent it at UTC midnight without
  // letting the browser's local timezone shift the selected day.
  return value ? `${value}T00:00:00.000Z` : null;
}

export default function WorkItemJourney({
  item,
  onSaved,
}: {
  item: WorkItemDetailRow;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canUpdateTasks, canAssignTasks, isCheckingPermissions } =
    useWorkspacePermission();
  const mayEdit = !isCheckingPermissions && canUpdateTasks();
  const mayAssign =
    !isCheckingPermissions && (canUpdateTasks() || canAssignTasks());
  const selfAssignmentOnly =
    !isCheckingPermissions && canUpdateTasks() && !canAssignTasks();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(() => {
    const value = extractDescription(item.description);
    return value.kind === "text" ? value.text : "";
  });
  const [descriptionChanged, setDescriptionChanged] = useState(false);
  const [startDate, setStartDate] = useState(
    item.startDate?.slice(0, 10) ?? "",
  );
  const [dueDate, setDueDate] = useState(item.dueDate?.slice(0, 10) ?? "");
  const [selectedAssignee, setSelectedAssignee] = useState(
    item.assigneeId ?? "",
  );
  const [confirmReassign, setConfirmReassign] = useState(false);
  const [editError, setEditError] = useState("");
  const [assignError, setAssignError] = useState("");
  const activity = useInfiniteQuery({
    queryKey: ["work-items", "activity", item.key],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getWorkItemActivity(item.key, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.page.hasMore
        ? (lastPage.page.nextCursor ?? undefined)
        : undefined,
  });
  const assignees = useQuery({
    queryKey: ["projects", item.projectId, "assignable"],
    queryFn: () => getAssignablePeople(item.projectId),
    enabled: mayAssign,
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["work-items", "detail", item.key],
      }),
      queryClient.invalidateQueries({
        queryKey: ["work-items", "activity", item.key],
      }),
      queryClient.invalidateQueries({
        queryKey: ["work-items", item.projectId],
      }),
    ]);
    onSaved();
  };
  const editMutation = useMutation({
    mutationFn: () =>
      updateWorkItem({
        key: item.key,
        version: item.version,
        title,
        description: descriptionChanged
          ? description || null
          : item.description,
        startDate: dateInputToIso(startDate),
        dueDate: dateInputToIso(dueDate),
      }),
    onSuccess: async () => {
      setEditing(false);
      setEditError("");
      await invalidate();
    },
    onError: async (error) => {
      if (error instanceof WorkItemVersionConflictError) {
        await queryClient.invalidateQueries({
          queryKey: ["work-items", "detail", item.key],
        });
        setEditError(
          t("workItems:journey.editConflict", {
            asserted: error.assertedVersion,
            current: error.currentVersion,
          }),
        );
      } else {
        setEditError(t("workItems:journey.saveError"));
      }
    },
  });
  const assignMutation = useMutation({
    mutationFn: (assigneeId: string) =>
      assignWorkItem({
        key: item.key,
        assigneeId,
        expectedCurrentAssigneeId: item.assigneeId,
      }),
    onSuccess: async () => {
      setAssignError("");
      setConfirmReassign(false);
      await invalidate();
    },
    onError: async (error) => {
      setConfirmReassign(false);
      if (error instanceof HttpError && error.status === 409) {
        await queryClient.invalidateQueries({
          queryKey: ["work-items", "detail", item.key],
        });
        setAssignError(t("workItems:journey.assignmentConflict"));
      } else {
        setAssignError(t("workItems:journey.assignmentError"));
      }
    },
  });
  const unassignMutation = useMutation({
    mutationFn: () => unassignWorkItem(item.key),
    onSuccess: async () => {
      setAssignError("");
      await invalidate();
    },
    onError: async (error) => {
      if (error instanceof HttpError && error.status === 409) {
        await queryClient.invalidateQueries({
          queryKey: ["work-items", "detail", item.key],
        });
        setAssignError(t("workItems:journey.assignmentConflict"));
      } else {
        setAssignError(t("workItems:journey.unassignmentError"));
      }
    },
  });
  const startEditing = () => {
    setTitle(item.title);
    const value = extractDescription(item.description);
    setDescription(value.kind === "text" ? value.text : "");
    setDescriptionChanged(false);
    setStartDate(item.startDate?.slice(0, 10) ?? "");
    setDueDate(item.dueDate?.slice(0, 10) ?? "");
    setEditing(true);
    setEditError("");
  };
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

  return (
    <div className="flex flex-col gap-6" data-testid="work-item-journey">
      <section
        aria-labelledby="work-item-edit-heading"
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="work-item-edit-heading" className="font-medium text-lg">
            {t("workItems:journey.editHeading")}
          </h2>
          {!editing && mayEdit && (
            <Button variant="outline" size="sm" onClick={startEditing}>
              {t("workItems:journey.edit")}
            </Button>
          )}
        </div>
        {editing && mayEdit && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              editMutation.mutate();
            }}
          >
            <Label>
              {t("workItems:journey.title")}
              <Input
                aria-label={t("workItems:journey.title")}
                value={title}
                maxLength={500}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </Label>
            <Label>
              {t("workItems:journey.description")}
              <Textarea
                aria-label={t("workItems:journey.description")}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setDescriptionChanged(true);
                }}
              />
            </Label>
            <Label>
              {t("workItems:journey.startDate")}
              <Input
                aria-label={t("workItems:journey.startDate")}
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Label>
            <Label>
              {t("workItems:journey.dueDate")}
              <Input
                aria-label={t("workItems:journey.dueDate")}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Label>
            {editError && (
              <Alert variant="warning" role="alert">
                <AlertTitle>{t("workItems:journey.saveAttention")}</AlertTitle>
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={editMutation.isPending || title.trim().length === 0}
              >
                {editMutation.isPending
                  ? t("workItems:journey.saving")
                  : t("workItems:journey.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(false)}
              >
                {t("workItems:journey.cancel")}
              </Button>
            </div>
          </form>
        )}
      </section>

      {mayAssign && (
        <section
          aria-labelledby="work-item-assignment-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="work-item-assignment-heading" className="font-medium text-lg">
            {t("workItems:journey.assignmentHeading")}
          </h2>
          {assignees.isLoading ? (
            <p role="status">{t("workItems:journey.loadingPeople")}</p>
          ) : assignees.isError ? (
            <p role="alert">{t("workItems:journey.peopleError")}</p>
          ) : selfAssignmentOnly ? (
            <div className="flex flex-col gap-2">
              {assignError && <p role="alert">{assignError}</p>}
              {confirmReassign && (
                <Alert variant="warning">
                  <AlertTitle>
                    {t("workItems:journey.confirmReassign")}
                  </AlertTitle>
                  <AlertDescription>
                    {t("workItems:journey.confirmReassignDescription")}
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={
                    !assignees.data?.[0] ||
                    assignees.data[0].personId === item.assigneeId ||
                    assignMutation.isPending
                  }
                  onClick={() => {
                    const self = assignees.data?.[0];
                    if (self) submitAssignment(self.personId);
                  }}
                >
                  {confirmReassign
                    ? t("workItems:journey.confirmAssignment")
                    : t("workItems:journey.assignToMe")}
                </Button>
                {canUnassign && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={unassignMutation.isPending}
                    onClick={() => unassignMutation.mutate()}
                  >
                    {t("workItems:journey.unassign")}
                  </Button>
                )}
                {confirmReassign && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmReassign(false)}
                  >
                    {t("workItems:journey.cancel")}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="work-item-assignee">
                {t("workItems:journey.assignee")}
              </Label>
              <Select
                value={selectedAssignee}
                onValueChange={(value) => {
                  setSelectedAssignee(value ?? "");
                  setConfirmReassign(false);
                }}
              >
                <SelectTrigger id="work-item-assignee">
                  <SelectValue
                    placeholder={t("workItems:journey.assigneePlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {assignees.data?.map((person) => (
                    <SelectItem key={person.personId} value={person.personId}>
                      {person.name ?? t("workItems:journey.unnamedPerson")} ·{" "}
                      {person.roleName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {confirmReassign && (
                <Alert variant="warning">
                  <AlertTitle>
                    {t("workItems:journey.confirmReassign")}
                  </AlertTitle>
                  <AlertDescription>
                    {t("workItems:journey.confirmReassignDescription")}
                  </AlertDescription>
                </Alert>
              )}
              {assignError && <p role="alert">{assignError}</p>}
              <div className="flex gap-2">
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
                {canUnassign && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={unassignMutation.isPending}
                    onClick={() => unassignMutation.mutate()}
                  >
                    {t("workItems:journey.unassign")}
                  </Button>
                )}
                {confirmReassign && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmReassign(false)}
                  >
                    {t("workItems:journey.cancel")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <section
        aria-labelledby="work-item-activity-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="work-item-activity-heading" className="font-medium text-lg">
          {t("workItems:journey.activityHeading")}
        </h2>
        {activity.isLoading ? (
          <p role="status">{t("workItems:journey.loadingActivity")}</p>
        ) : activity.isError ? (
          <p role="alert">{t("workItems:journey.activityError")}</p>
        ) : activity.data?.pages.some((page) => page.data.length) ? (
          <ol className="flex flex-col gap-3">
            {[...activity.data.pages.flatMap((page) => page.data)]
              .reverse()
              .map((row) => (
                <li
                  key={`${row.kind ?? "activity"}-${row.id}`}
                  className="rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong>
                      {row.kind === "comment"
                        ? t("workItems:journey.comment")
                        : row.verb}
                    </strong>
                    <time dateTime={row.createdAt}>
                      {new Date(row.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="text-muted-foreground">
                    {row.visibility === "internal"
                      ? t("workItems:journey.internal")
                      : row.visibility === "public"
                        ? t("workItems:journey.public")
                        : t("workItems:journey.visibilityUnavailable")}
                  </p>
                  {row.kind === "comment" ? (
                    row.body ? (
                      <WorkItemActivityComment body={row.body} />
                    ) : (
                      <p>{t("workItems:journey.commentDeleted")}</p>
                    )
                  ) : (
                    <p>
                      {row.field
                        ? `${row.field}: ${String(row.oldValue ?? "—")} → ${String(row.newValue ?? "—")}`
                        : row.verb}
                    </p>
                  )}
                </li>
              ))}
          </ol>
        ) : (
          <p className="text-muted-foreground">
            {t("workItems:journey.noActivity")}
          </p>
        )}
        {activity.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            disabled={activity.isFetchingNextPage}
            onClick={() => void activity.fetchNextPage()}
          >
            {activity.isFetchingNextPage
              ? t("workItems:journey.loadingOlderActivity")
              : t("workItems:journey.loadOlderActivity")}
          </Button>
        )}
      </section>
    </div>
  );
}
