import { createFileRoute } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import PageTitle from "@/components/page-title";
import useDecidePortalApproval from "@/hooks/mutations/approval/use-decide-portal-approval";
import useGetPortalApprovals from "@/hooks/queries/approval/use-get-portal-approvals";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

export const Route = createFileRoute("/approvals")({
  component: PortalApprovalsPage,
});

export function PortalApprovalsPage() {
  const query = useGetPortalApprovals();
  const decide = useDecidePortalApproval();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const approvals = query.data?.approvals ?? [];
  const portalSessionRequired =
    query.error instanceof HttpError && query.error.status === 401;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 bg-background p-6">
      <PageTitle title="Approvals" />
      <header>
        <h1 className="font-semibold text-2xl">Approvals</h1>
        <p className="text-muted-foreground text-sm">
          Review decisions requested from you.
        </p>
      </header>
      {query.isError && (
        <Alert variant="error" role="alert">
          <AlertTitle>
            {portalSessionRequired
              ? "Customer portal sign-in required"
              : "Approvals could not be loaded"}
          </AlertTitle>
          <AlertDescription>
            {portalSessionRequired ? (
              <p>
                Sign in through your customer portal to view approvals. The
                portal sign-in screen is not available in this build.
              </p>
            ) : (
              <>
                <p>
                  Try again. If the problem continues, contact your service
                  desk.
                </p>
                <Button variant="outline" onClick={() => void query.refetch()}>
                  Retry
                </Button>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
      {decide.isError && (
        <Alert variant="error" role="alert">
          <AlertTitle>Your decision was not recorded</AlertTitle>
          <AlertDescription>
            The request may have changed. Reload the approvals list and try
            again.
          </AlertDescription>
        </Alert>
      )}
      {query.isLoading ? (
        <p role="status">Loading approvals…</p>
      ) : approvals.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No approvals waiting</EmptyTitle>
            <EmptyDescription>
              Requests addressed to you will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-4">
          {approvals.map((approval) => (
            <li key={approval.id} className="rounded-md border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="font-medium">{approval.workItemTitle}</h2>
                  <p className="text-muted-foreground text-sm">
                    {approval.kind === "cab"
                      ? "Change advisory approval"
                      : "Customer approval"}
                  </p>
                  <p className="text-sm">
                    Requested by{" "}
                    {approval.requester.displayName ?? "Inactive person"}
                  </p>
                </div>
                <Badge
                  variant={
                    approval.state === "pending" ? "outline" : "secondary"
                  }
                >
                  {approval.state}
                </Badge>
              </div>
              <p className="mt-2 text-sm">
                Please review this request before{" "}
                {formatDateTime(approval.expiresAt)}.
              </p>
              {approval.state === "pending" && (
                <div className="mt-4 flex flex-col gap-3">
                  {rejecting === approval.id && (
                    <Textarea
                      aria-label="Rejection note"
                      value={notes[approval.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [approval.id]: event.target.value,
                        }))
                      }
                      placeholder="Explain why you are rejecting this request"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: approval.id, action: "approve" })
                      }
                    >
                      Approve
                    </Button>
                    {rejecting === approval.id ? (
                      <>
                        <Button
                          variant="destructive"
                          disabled={
                            decide.isPending ||
                            !(notes[approval.id] ?? "").trim()
                          }
                          onClick={() =>
                            decide.mutate({
                              id: approval.id,
                              action: "reject",
                              note: notes[approval.id]?.trim(),
                            })
                          }
                        >
                          Submit rejection
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setRejecting(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => setRejecting(approval.id)}
                      >
                        Reject
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
