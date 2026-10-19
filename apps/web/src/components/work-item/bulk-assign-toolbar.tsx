import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import bulkAssignWorkItems, {
  type BulkWorkItemsOperationInput,
  bulkWorkItemsOperation,
} from "@/fetchers/work-item/bulk-assign-work-items";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";
import {
  classifyWorkItemWriteError,
  type WorkItemWriteFailure,
} from "@/lib/work-item-board";

type BulkResult = {
  succeeded: number;
  failed: { key: string; reason: string }[];
};

type PriorityOption = "urgent" | "high" | "medium" | "low" | "none";

const PRIORITY_OPTIONS: { value: PriorityOption; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
];

/** The server words a per-item failure; "not found" is its single reason for both a
 * deleted item and one the caller can no longer reach (`WI-25`). */
const NOT_FOUND_REASON = /not found/i;

/**
 * The bulk action bar for a multi-selection (`VW-3`, `WI-24`). Supports assign, set priority,
 * archive, and delete over selected work items. The server checks capability and reach for
 * every item and answers per item (`WI-25`), so a partial result is a normal outcome.
 *
 * `onAssigned` receives only the keys the server confirmed, so a failed item stays selected for
 * a retry. A whole-request refusal (403/404/409/422/400) keeps the entire selection.
 */
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
  const [assigneeId, setAssigneeId] = useState("");
  const [priorityChoice, setPriorityChoice] = useState<PriorityOption | "">("");
  const [result, setResult] = useState<BulkResult>();
  const people = useGetAssignablePeople({ projectId, enabled: true });
  const chosenPerson = people.data?.find(
    (person) => person.personId === assigneeId,
  );
  const chosenPriority = PRIORITY_OPTIONS.find(
    (opt) => opt.value === priorityChoice,
  );

  const handleBulkResponse = (response: {
    succeeded: string[];
    failed: { id: string; reason: string }[];
  }) => {
    setResult({
      succeeded: response.succeeded.length,
      failed: response.failed.map((failure) => ({
        key: failure.id,
        reason: NOT_FOUND_REASON.test(failure.reason)
          ? t("workItems:bulk.reasonGone")
          : failure.reason,
      })),
    });
    onAssigned(response.succeeded);
  };

  const mutation = useMutation({
    mutationFn: () =>
      bulkAssignWorkItems({
        workspaceId,
        workItemKeys: selectedKeys,
        assigneeId,
      }),
    onSuccess: handleBulkResponse,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["work-items", projectId] }),
  });

  const actionMutation = useMutation({
    mutationFn: (input: BulkWorkItemsOperationInput) =>
      bulkWorkItemsOperation(input),
    onSuccess: handleBulkResponse,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["work-items", projectId] }),
  });

  const isBusy = mutation.isPending || actionMutation.isPending;
  const activeError = mutation.error ?? actionMutation.error;
  const failure: WorkItemWriteFailure | undefined = activeError
    ? classifyWorkItemWriteError(activeError)
    : undefined;

  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      aria-label={t("workItems:bulk.toolbarLabel")}
      data-testid="bulk-assign-toolbar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          {t("workItems:bulk.selected", { count: selectedKeys.length })}
        </span>
        <Select
          value={assigneeId}
          onValueChange={(value) => setAssigneeId(value ?? "")}
        >
          <SelectTrigger
            aria-label={t("workItems:bulk.assigneeLabel")}
            className="w-56"
          >
            <SelectValue
              placeholder={
                people.isLoading
                  ? t("workItems:bulk.loadingPeople")
                  : t("workItems:bulk.assigneePlaceholder")
              }
            >
              {chosenPerson
                ? (chosenPerson.name ?? t("workItems:bulk.unnamedPerson"))
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {people.data?.map((person) => (
              <SelectItem key={person.personId} value={person.personId}>
                {person.name ?? t("workItems:bulk.unnamedPerson")}
                {person.roleName ? ` · ${person.roleName}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={
            !assigneeId || selectedKeys.length === 0 || isBusy || people.isError
          }
          onClick={() => {
            setResult(undefined);
            mutation.mutate();
          }}
        >
          {mutation.isPending
            ? t("workItems:bulk.saving")
            : t("workItems:bulk.assign")}
        </Button>

        <Select
          value={priorityChoice}
          onValueChange={(value) =>
            setPriorityChoice((value as PriorityOption | null) ?? "")
          }
        >
          <SelectTrigger
            aria-label={t("workItems:bulk.priorityLabel", {
              defaultValue: "Set priority of selected work items",
            })}
            className="w-44"
          >
            <SelectValue
              placeholder={t("workItems:bulk.priorityPlaceholder", {
                defaultValue: "Choose priority",
              })}
            >
              {chosenPriority?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!priorityChoice || selectedKeys.length === 0 || isBusy}
          onClick={() => {
            if (!priorityChoice) return;
            setResult(undefined);
            actionMutation.mutate({
              workspaceId,
              workItemKeys: selectedKeys,
              operation: "set_priority",
              priority: priorityChoice === "none" ? null : priorityChoice,
            });
          }}
        >
          {t("workItems:bulk.setPriority", { defaultValue: "Set priority" })}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={selectedKeys.length === 0 || isBusy}
          onClick={() => {
            setResult(undefined);
            actionMutation.mutate({
              workspaceId,
              workItemKeys: selectedKeys,
              operation: "archive",
            });
          }}
        >
          {t("workItems:bulk.archive", { defaultValue: "Archive selected" })}
        </Button>

        <Button
          size="sm"
          variant="destructive"
          disabled={selectedKeys.length === 0 || isBusy}
          onClick={() => {
            setResult(undefined);
            actionMutation.mutate({
              workspaceId,
              workItemKeys: selectedKeys,
              operation: "delete",
            });
          }}
        >
          {t("workItems:bulk.delete", { defaultValue: "Delete selected" })}
        </Button>

        <Button variant="outline" size="sm" disabled={isBusy} onClick={onClear}>
          {t("workItems:bulk.clear")}
        </Button>
      </div>
      {people.isError && <p role="alert">{t("workItems:bulk.peopleError")}</p>}
      {failure && <p role="alert">{t(`workItems:bulk.failure.${failure}`)}</p>}
      {result && (
        <Alert
          variant={result.failed.length ? "warning" : "success"}
          role="status"
        >
          <AlertDescription>
            {t("workItems:bulk.result", {
              succeeded: result.succeeded,
              failed: result.failed.length,
            })}
            {result.failed.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {result.failed.map((entry) => (
                  <li key={entry.key}>
                    {t("workItems:bulk.failedItem", {
                      key: entry.key,
                      reason: entry.reason,
                    })}
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
