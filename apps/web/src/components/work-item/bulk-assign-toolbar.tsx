import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import bulkAssignWorkItems from "@/fetchers/work-item/bulk-assign-work-items";
import getAssignablePeople from "@/fetchers/work-item/get-assignable-people";

export default function BulkAssignToolbar({
  projectId,
  workspaceId,
  selectedKeys,
  onAssigned,
}: {
  projectId: string;
  workspaceId: string;
  selectedKeys: string[];
  onAssigned: (succeeded: string[]) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [assigneeId, setAssigneeId] = useState("");
  const [result, setResult] = useState<{
    succeeded: number;
    failed: string[];
  }>();
  const people = useQuery({
    queryKey: ["projects", projectId, "assignable"],
    queryFn: () => getAssignablePeople(projectId),
  });
  const mutation = useMutation({
    mutationFn: () =>
      bulkAssignWorkItems({
        workspaceId,
        workItemKeys: selectedKeys,
        assigneeId,
      }),
    onSuccess: async (response) => {
      setResult({
        succeeded: response.succeeded.length,
        failed: response.failed.map(
          (failure) => `${failure.id}: ${failure.reason}`,
        ),
      });
      onAssigned(response.succeeded);
      await queryClient.invalidateQueries({
        queryKey: ["work-items", projectId],
      });
    },
  });

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      data-testid="bulk-assign-toolbar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          {t("workItems:bulk.selected", {
            count: selectedKeys.length,
            defaultValue: `${selectedKeys.length} selected`,
          })}
        </span>
        <Select
          value={assigneeId}
          onValueChange={(value) => setAssigneeId(value ?? "")}
        >
          <SelectTrigger
            aria-label={t("workItems:bulk.assignee", {
              defaultValue: "Assign to",
            })}
            className="w-64"
          >
            <SelectValue
              placeholder={
                people.isLoading
                  ? t("workItems:journey.loadingPeople")
                  : t("workItems:bulk.assignee", {
                      defaultValue: "Choose a project member",
                    })
              }
            />
          </SelectTrigger>
          <SelectContent>
            {people.data?.map((person) => (
              <SelectItem key={person.personId} value={person.personId}>
                {person.name ?? t("workItems:journey.unnamedPerson")}
                {person.roleName ? ` · ${person.roleName}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={
            !assigneeId ||
            selectedKeys.length === 0 ||
            mutation.isPending ||
            people.isError
          }
          onClick={() => {
            setResult(undefined);
            mutation.mutate();
          }}
        >
          {mutation.isPending
            ? t("workItems:journey.saving")
            : t("workItems:bulk.assign", { defaultValue: "Assign selected" })}
        </Button>
      </div>
      {people.isError && (
        <p role="alert">{t("workItems:journey.peopleError")}</p>
      )}
      {mutation.isError && (
        <p role="alert">{t("workItems:journey.assignmentError")}</p>
      )}
      {result && (
        <Alert
          variant={result.failed.length ? "warning" : "success"}
          role="status"
        >
          <AlertDescription>
            {t("workItems:bulk.result", {
              succeeded: result.succeeded,
              failed: result.failed.length,
              defaultValue: `${result.succeeded} assigned; ${result.failed.length} failed.`,
            })}
            {result.failed.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {result.failed.map((failure) => (
                  <li key={failure}>{failure}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
