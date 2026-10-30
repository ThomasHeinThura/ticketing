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
import { ActionTooltip } from "@/components/common/action-tooltip";
import { submissionAge } from "@/lib/intake-queue";
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
  now,
}: {
  rows: readonly StaffSubmissionQueueRow[];
  selectedRef?: string;
  onOpenSubmission: (ref: string) => void;
  /** The instant ages are measured against; the caller passes the server's clock when it has it. */
  now?: number;
}) {
  const { t } = useTranslation("intake");
  return (
    <Table aria-label={t("title")}>
      <TableHeader>
        <TableRow>
          <TableHead>{t("reference")}</TableHead>
          <TableHead className="min-w-64">{t("summary")}</TableHead>
          <TableHead>{t("requestType")}</TableHead>
          <TableHead>{t("customer")}</TableHead>
          <TableHead>{t("organisation")}</TableHead>
          <TableHead>{t("submittedAt")}</TableHead>
          <TableHead>{t("age")}</TableHead>
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
              {(() => {
                const age = submissionAge(row.submission.createdAt, now);
                return t(`ageSuffix.${age.unit}`, { value: age.count });
              })()}
            </TableCell>
            <TableCell className="whitespace-normal">
              <div className="flex flex-wrap gap-2">
                {(row.suggestedDuplicates ?? []).length ? (
                  (row.suggestedDuplicates ?? []).map((item) => (
                    <ActionTooltip key={item.id} label={item.title}>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 font-mono"
                        render={
                          <Link
                            to={routes.workItemDetail.path}
                            params={{ key: item.key }}
                          />
                        }
                      >
                        {item.key}
                      </Button>
                    </ActionTooltip>
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
