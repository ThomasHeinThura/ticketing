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
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";
import { formatDateTime } from "@/lib/format";
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
  // A click anywhere on a row opens its submission, like the reference does. The reference
  // stays the keyboard target; clicks on the row's own links and buttons, and a click that
  // ends a text selection, keep their own meaning.
  const openFromRow = (event: MouseEvent<HTMLTableRowElement>, ref: string) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    const target = event.target;
    if (target instanceof Element && target.closest("a, button")) return;
    if (window.getSelection?.()?.toString()) return;
    onOpenSubmission(ref);
  };
  return (
    <Table aria-label={t("title")}>
      <TableHeader>
        <TableRow>
          <TableHead>{t("reference")}</TableHead>
          <TableHead className="min-w-48">{t("summary")}</TableHead>
          <TableHead>{t("requestType")}</TableHead>
          <TableHead>{t("customer")}</TableHead>
          <TableHead>{t("organisation")}</TableHead>
          <TableHead>{t("submittedAt")}</TableHead>
          <TableHead>{t("age")}</TableHead>
          {/* The long header wraps over two lines; its cells hold short keys. */}
          <TableHead className="w-28 whitespace-normal">
            {t("queueSuggestedDuplicates")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            interactive
            key={row.ref}
            data-state={selectedRef === row.ref ? "selected" : undefined}
            data-testid={`triage-row-${row.ref}`}
            onClick={(event) => openFromRow(event, row.ref)}
          >
            <TableCell>
              <Button
                variant="link"
                size="sm"
                aria-current={selectedRef === row.ref ? "true" : undefined}
                // The submission sheet returns focus here when it closes.
                data-submission-ref={row.ref}
                onClick={() => onOpenSubmission(row.ref)}
                className="h-auto p-0 font-mono"
              >
                {row.ref}
              </Button>
            </TableCell>
            <TableCell className="min-w-48 whitespace-normal">
              {row.summary}
            </TableCell>
            <TableCell
              className="max-w-40 truncate"
              title={row.requestType.name}
            >
              {row.requestType.name}
            </TableCell>
            <TableCell
              className="max-w-36 truncate"
              title={row.requester.displayName ?? undefined}
            >
              {row.requester.displayName ?? t("customer")}
            </TableCell>
            <TableCell
              className="max-w-36 truncate"
              title={row.organisation.name}
            >
              {row.organisation.name}
            </TableCell>
            {/* The app's own date format (date and short time), in the app's language. */}
            <TableCell data-testid="triage-row-submitted">
              {formatDateTime(row.submission.createdAt)}
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
