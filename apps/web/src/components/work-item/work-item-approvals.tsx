import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Skeleton,
  Textarea,
} from "@taskdesk/ui";
import { TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import type { WorkItemApproval } from "@/fetchers/approval/get-work-item-approvals";
import useDecideApproval from "@/hooks/mutations/approval/use-decide-approval";
import useWithdrawApproval from "@/hooks/mutations/approval/use-withdraw-approval";
import useGetMyApprovals from "@/hooks/queries/approval/use-get-my-approvals";
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
  // The approvals addressed to the viewer (`GET /me/approvals`) are the ones they may decide.
  const myApprovals = useGetMyApprovals();
  const decidable = new Set(
    (myApprovals.data?.approvals ?? []).map((approval) => approval.id),
  );
  const decide = useDecideApproval();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
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

      {decide.isError && (
        <Alert variant="error" role="alert" data-testid="approval-decide-error">
          <TriangleAlert />
          <AlertTitle>
            {t("workItems:detail.approvals.decideErrorTitle")}
          </AlertTitle>
          <AlertDescription>
            <p>
              {decide.error instanceof HttpError && decide.error.status === 409
                ? t("workItems:detail.approvals.decideConflict")
                : decide.error instanceof Error && decide.error.message
                  ? decide.error.message
                  : t("workItems:detail.approvals.decideFailed")}
            </p>
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
              {approval.state === "pending" && decidable.has(approval.id) ? (
                rejectingId === approval.id ? (
                  <div className="flex w-full flex-col gap-2">
                    <Textarea
                      aria-label={t("workItems:detail.approvals.rejectNote")}
                      placeholder={t("workItems:detail.approvals.rejectNote")}
                      value={rejectNote}
                      onChange={(event) => setRejectNote(event.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={decide.isPending || !rejectNote.trim()}
                        onClick={() =>
                          decide.mutate(
                            {
                              id: approval.id,
                              action: "reject",
                              note: rejectNote.trim(),
                            },
                            {
                              onSuccess: () => {
                                setRejectingId(null);
                                setRejectNote("");
                              },
                              onSettled: () => headingRef.current?.focus(),
                            },
                          )
                        }
                      >
                        {t("workItems:detail.approvals.confirmReject")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRejectingId(null);
                          headingRef.current?.focus();
                        }}
                      >
                        {t("common:actions.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <span className="inline-flex gap-2">
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate(
                          { id: approval.id, action: "approve" },
                          { onSettled: () => headingRef.current?.focus() },
                        )
                      }
                    >
                      {t("workItems:detail.approvals.approve")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => {
                        setRejectingId(approval.id);
                        setRejectNote("");
                      }}
                    >
                      {t("workItems:detail.approvals.reject")}
                    </Button>
                  </span>
                )
              ) : null}
              {approval.decisionNote && approval.state !== "pending" ? (
                <p className="w-full text-muted-foreground">
                  {approval.decisionNote}
                </p>
              ) : null}
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
