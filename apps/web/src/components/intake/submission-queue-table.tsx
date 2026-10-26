import { Link } from "@tanstack/react-router";
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { formatSubmissionAge } from "@/lib/intake-queue";
import { routes } from "@/lib/routes";

export type StaffSubmissionQueueRow = {
  ref: string;
  summary: string;
  submission: { state: string; createdAt: string; claimedBy: string | null };
  requestType: { id: string; name: string };
  requester: { displayName?: string | null };
  organisation: { name: string };
  suggestedDuplicates?: Array<{
    id: string;
    key: string;
    title: string;
    score?: number;
  }>;
};

/** The same persisted staff rows in the ordinary intake list and paired saved queues. */
export function SubmissionQueueTable({
  rows,
  selectedRef,
  onOpenSubmission,
}: {
  rows: readonly StaffSubmissionQueueRow[];
  selectedRef?: string;
  onOpenSubmission: (ref: string) => void;
}) {
  const { t } = useTranslation("intake");
  return (
    <Table aria-label={t("title")}>
      <TableHeader>
        <TableRow>
          <TableHead>{t("reference", { defaultValue: "Reference" })}</TableHead>
          <TableHead className="min-w-64">
            {t("summary", { defaultValue: "Summary" })}
          </TableHead>
          <TableHead>
            {t("requestType", { defaultValue: "Request type" })}
          </TableHead>
          <TableHead>{t("customer")}</TableHead>
          <TableHead>
            {t("organisation", { defaultValue: "Organisation" })}
          </TableHead>
          <TableHead>
            {t("submittedAt", { defaultValue: "Submitted" })}
          </TableHead>
          <TableHead>{t("age", { defaultValue: "Age" })}</TableHead>
          <TableHead>{t("queueSuggestedDuplicates")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.ref}
            data-state={selectedRef === row.ref ? "selected" : undefined}
          >
            <TableCell>
              <Button
                variant="link"
                size="sm"
                aria-current={selectedRef === row.ref ? "true" : undefined}
                onClick={() => onOpenSubmission(row.ref)}
                className="h-auto p-0 font-mono"
              >
                {row.ref}
              </Button>
            </TableCell>
            <TableCell className="min-w-64 whitespace-normal">
              {row.summary}
            </TableCell>
            <TableCell>{row.requestType.name}</TableCell>
            <TableCell>{row.requester.displayName ?? t("customer")}</TableCell>
            <TableCell>{row.organisation.name}</TableCell>
            <TableCell>
              {new Date(row.submission.createdAt).toLocaleString()}
            </TableCell>
            <TableCell data-testid="triage-row-age">
              {formatSubmissionAge(row.submission.createdAt)}
            </TableCell>
            <TableCell className="whitespace-normal">
              <div className="flex flex-wrap gap-2">
                {(row.suggestedDuplicates ?? []).length ? (
                  (row.suggestedDuplicates ?? []).map((item) => (
                    <Button
                      key={item.id}
                      variant="link"
                      size="sm"
                      className="h-auto p-0 font-mono"
                      render={
                        <Link
                          to={routes.workItemDetail.path}
                          params={{ key: item.key }}
                        />
                      }
                      title={item.title}
                    >
                      {item.key}
                    </Button>
                  ))
                ) : (
                  <span className="text-muted-foreground">
                    {t("queueNoDuplicates")}
                  </span>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
