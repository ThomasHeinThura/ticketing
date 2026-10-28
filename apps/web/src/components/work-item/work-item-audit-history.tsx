import {
  Alert,
  AlertDescription,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { ChevronDown, History } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useGetProjectStates from "@/hooks/queries/project/use-get-project-states";
import {
  useGetWorkItemAuditHistory,
  useGetWorkItemReconstruction,
} from "@/hooks/queries/work-item/use-get-work-item-audit-history";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import {
  auditActionLabel,
  auditFieldLabel,
  auditStateChange,
  auditValueLabel,
} from "@/lib/audit-history-format";
import { formatDateTime } from "@/lib/format";

/**
 * AU-8/AU-9: the work item's audit rows, with a "state then" reconstruction replayed from the
 * activity journal as of any row's instant. Loaded only once the disclosure is opened.
 */
export default function WorkItemAuditHistory({
  workItemKey,
  workspaceId,
  projectId,
}: {
  workItemKey: string;
  /** Names for the recorded person ids; without it people show as unavailable. */
  workspaceId?: string;
  /** Names for the recorded state ids (the project's canonical states). */
  projectId?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const history = useGetWorkItemAuditHistory(workItemKey, open);
  const snapshot = useGetWorkItemReconstruction(workItemKey, at);
  const fields = Object.entries(snapshot.data?.snapshot?.fields ?? {});
  const states = useGetProjectStates(projectId, open);
  const people = useGetActiveWorkspaceUsers(workspaceId ?? "", open && !!at);
  const lookups = useMemo(
    () => ({
      states: new Map(
        (states.data ?? []).map((state) => [state.id, state.name] as const),
      ),
      people: new Map(
        (people.data?.members ?? []).map(
          (member) =>
            [
              member.userId,
              member.user.name || member.user.email || member.userId,
            ] as const,
        ),
      ),
      unknown: t("workItems:detail.unavailable"),
      empty: t("workItems:auditHistory.emptyValue", {
        defaultValue: "(empty)",
      }),
      none: t("workItems:auditHistory.noValue", { defaultValue: "None" }),
      unassigned: t("workItems:auditHistory.unassigned", {
        defaultValue: "Unassigned",
      }),
      priority: (value: string) =>
        t(`tasks:priority.${value}`, { defaultValue: value }),
    }),
    [states.data, people.data, t],
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-2">
            <History className="size-4" />
            {t("workItems:auditHistory.title", {
              defaultValue: "Audit history",
            })}
            <ChevronDown className="size-4" />
          </Button>
        }
      />
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-3">
          {history.isLoading && <Skeleton className="h-16 w-full" />}
          {history.isError && (
            <Alert variant="error">
              <AlertDescription>
                {t("workItems:auditHistory.error", {
                  defaultValue: "The audit history could not be loaded.",
                })}
              </AlertDescription>
            </Alert>
          )}
          {history.data && history.data.rows.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {t("workItems:auditHistory.empty", {
                defaultValue: "No audited changes for this work item.",
              })}
            </p>
          )}
          {history.data && history.data.rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("workItems:auditHistory.when", { defaultValue: "When" })}
                  </TableHead>
                  <TableHead>
                    {t("workItems:auditHistory.action", {
                      defaultValue: "Action",
                    })}
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                    <TableCell>
                      {auditActionLabel(row.action, t)}
                      {auditStateChange(row.before, row.after, lookups) && (
                        <span className="block text-muted-foreground text-xs">
                          {auditStateChange(row.before, row.after, lookups)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAt(row.createdAt)}
                      >
                        {t("workItems:auditHistory.stateThen", {
                          defaultValue: "State then",
                        })}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {at && (
            <div className="flex flex-col gap-2">
              <p className="font-medium text-sm">
                {t("workItems:auditHistory.stateAt", {
                  defaultValue: "Recorded values as of {{when}}",
                  when: formatDateTime(at),
                })}
              </p>
              {snapshot.isLoading && <Skeleton className="h-12 w-full" />}
              {snapshot.isError && (
                <Alert variant="error">
                  <AlertDescription>
                    {t("workItems:auditHistory.reconstructError", {
                      defaultValue: "This state could not be reconstructed.",
                    })}
                  </AlertDescription>
                </Alert>
              )}
              {snapshot.data && fields.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  {t("workItems:auditHistory.noFields", {
                    defaultValue: "No field values were recorded by then.",
                  })}
                </p>
              )}
              {fields.length > 0 && (
                <Table>
                  <TableBody>
                    {fields.map(([field, value]) => (
                      <TableRow key={field}>
                        <TableCell className="font-medium">
                          {auditFieldLabel(field, t)}
                        </TableCell>
                        <TableCell>
                          {auditValueLabel(field, value, lookups)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
