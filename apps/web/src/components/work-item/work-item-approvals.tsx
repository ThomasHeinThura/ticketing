import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Skeleton,
} from "@taskdesk/ui";
import { TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import type { WorkItemApproval } from "@/fetchers/approval/get-work-item-approvals";
import useWithdrawApproval from "@/hooks/mutations/approval/use-withdraw-approval";
import useGetWorkItemApprovals from "@/hooks/queries/approval/use-get-work-item-approvals";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

const STATE_BADGE_VARIANT = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
  expired: "secondary",
  withdrawn: "outline",
} as const satisfies Record<
  WorkItemApproval["state"],
  "warning" | "success" | "destructive" | "secondary" | "outline"
>;

/** Maps a failed withdrawal to the message the person can act on. */
function withdrawErrorKey(error: unknown) {
  const status = error instanceof HttpError ? error.status : undefined;
  if (status === 409) return "workItems:detail.approvals.withdrawConflict";
  if (status === 403 || status === 404) {
    return "workItems:detail.approvals.withdrawForbidden";
  }
  return "workItems:detail.approvals.withdrawFailed";
}

/**
 * The approvals section of the work-item detail (`docs/03-features/approvals.md` AP-20).
 * It renders for every work item rather than only when an approval exists: whether an
 * approval "may be requested" depends on workflow gates the read API does not expose, so
 * hiding the section on an empty list would break AP-20's second condition. The empty
 * state says there are none.
 *
 * Withdrawal (AP-6/AP-7): offered only while the approval is pending and the server says
 * `canWithdraw`. An instance-admin session uses the admin route, everyone else the
 * requester route; `canWithdraw` is an affordance only and each route rechecks. A failed
 * withdrawal (409 already terminal, 403/404 authority or reach changed) shows a message
 * and the approvals refetch, so the stale button disappears.
 *
 * Four states: loading (skeleton), error (retryable alert), empty, ready.
 */
function WorkItemApprovals({ workItemKey }: { workItemKey: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isInstanceAdmin =
    (user as { role?: string | null } | null | undefined)?.role === "admin";
  const approvalsQuery = useGetWorkItemApprovals({ key: workItemKey });
  const withdraw = useWithdrawApproval();
  // The Withdraw button unmounts once the refetch lands, which would drop focus to <body>.
  // After any settled withdrawal focus moves to the section heading, a stable target.
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Polite status for a successful withdrawal; failure is announced by role="alert".
  const [announcement, setAnnouncement] = useState("");
  const startWithdraw = (id: string) => {
    setAnnouncement("");
    withdraw.mutate(
      { id, asInstanceAdmin: isInstanceAdmin },
      {
        onSuccess: () =>
          setAnnouncement(t("workItems:detail.approvals.withdrawn")),
        onSettled: () => headingRef.current?.focus(),
      },
    );
  };

  const approvals = approvalsQuery.data?.approvals ?? [];

  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="work-item-approvals-heading"
      data-testid="work-item-approvals"
    >
      <h2
        id="work-item-approvals-heading"
        ref={headingRef}
        tabIndex={-1}
        className="font-medium text-lg"
      >
        {t("workItems:detail.approvals.heading")}
      </h2>
      <p
        role="status"
        className="sr-only"
        data-testid="approval-withdraw-status"
      >
        {announcement}
      </p>

      {withdraw.isError && (
        <Alert
          variant="error"
          role="alert"
          data-testid="approval-withdraw-error"
        >
          <TriangleAlert />
          <AlertTitle>
            {t("workItems:detail.approvals.withdrawErrorTitle")}
          </AlertTitle>
          <AlertDescription>
            <p>{t(withdrawErrorKey(withdraw.error))}</p>
          </AlertDescription>
        </Alert>
      )}

      {approvalsQuery.isError ? (
        <Alert variant="error" data-testid="work-item-approvals-error">
          <TriangleAlert />
          <AlertTitle>{t("workItems:detail.approvals.errorTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("workItems:detail.approvals.errorDescription")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void approvalsQuery.refetch()}
            >
              {t("workItems:detail.approvals.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : approvalsQuery.isLoading ? (
        <div
          className="flex flex-col gap-2"
          data-testid="work-item-approvals-loading"
          aria-busy="true"
          aria-live="polite"
        >
          <span className="sr-only">
            {t("workItems:detail.approvals.loading")}
          </span>
          <Skeleton className="h-12 w-full" />
        </div>
      ) : approvals.length === 0 ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="work-item-approvals-empty"
        >
          {t("workItems:detail.approvals.empty")}
        </p>
      ) : (
        <ul
          className="flex flex-col gap-2"
          data-testid="work-item-approvals-list"
        >
          {approvals.map((approval) => (
            <li
              key={approval.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border p-3 text-sm"
              data-testid={`approval-${approval.id}`}
            >
              <span className="font-medium">
                {t(`workItems:detail.approvals.kind.${approval.kind}`)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-muted-foreground">
                  {t("workItems:detail.approvals.approverLabel")}
                </span>
                {approval.approver.displayName ??
                  t("workItems:detail.approvals.unknownPerson")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-muted-foreground">
                  {t("workItems:detail.approvals.requesterLabel")}
                </span>
                {approval.requester.displayName ??
                  t("workItems:detail.approvals.unknownPerson")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-muted-foreground">
                  {approval.state === "pending"
                    ? t("workItems:detail.approvals.expiresLabel")
                    : t("workItems:detail.approvals.decidedLabel")}
                </span>
                {formatDateTime(
                  approval.state === "pending" || !approval.decidedAt
                    ? approval.expiresAt
                    : approval.decidedAt,
                )}
              </span>
              <Badge variant={STATE_BADGE_VARIANT[approval.state]}>
                {t(`workItems:detail.approvals.state.${approval.state}`)}
              </Badge>
              {approval.approverReachLost && approval.state === "pending" && (
                <span className="text-muted-foreground">
                  {t("workItems:detail.approvals.reachLost")}
                </span>
              )}
              {approval.canWithdraw && approval.state === "pending" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={withdraw.isPending}
                  aria-label={
                    withdraw.isPending && withdraw.variables?.id === approval.id
                      ? undefined
                      : t("workItems:detail.approvals.withdrawFor", {
                          label: `${t(`workItems:detail.approvals.kind.${approval.kind}`)}, ${approval.approver.displayName ?? t("workItems:detail.approvals.unknownPerson")}`,
                        })
                  }
                  onClick={() => startWithdraw(approval.id)}
                >
                  {withdraw.isPending && withdraw.variables?.id === approval.id
                    ? t("workItems:detail.approvals.withdrawing")
                    : t("workItems:detail.approvals.withdraw")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default WorkItemApprovals;
