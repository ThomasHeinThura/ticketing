import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
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
import useDecideApproval from "@/hooks/mutations/approval/use-decide-approval";
import useGetMyApprovals from "@/hooks/queries/approval/use-get-my-approvals";
import { formatDateTime } from "@/lib/format";
import { parseMyWorkSearch, routes } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/agent/my-work")({
  validateSearch: parseMyWorkSearch,
  component: MyApprovalsRoute,
});

export function MyApprovalsRoute() {
  const { data, isLoading, isError, refetch } = useGetMyApprovals();
  const decide = useDecideApproval();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const approvals = data?.approvals ?? [];

  return (
    <main className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <PageTitle title="Waiting on my approval" />
      <header>
        <h1 className="font-semibold text-2xl">Waiting on my approval</h1>
        <p className="text-muted-foreground text-sm">
          Review requests addressed to you and record a decision.
        </p>
      </header>
      {isError && (
        <Alert variant="error">
          <AlertDescription>
            Could not load approvals.{" "}
            <Button onClick={() => void refetch()}>Retry</Button>
          </AlertDescription>
        </Alert>
      )}
      {decide.isError && (
        <Alert variant="error" role="alert">
          <AlertDescription>
            The decision could not be recorded. The approval may have changed;
            reload and try again.
          </AlertDescription>
        </Alert>
      )}
      {isLoading ? (
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
                  <h2 className="font-medium">
                    <Link
                      to={routes.workItemDetail.path}
                      params={{ key: approval.workItemKey }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {approval.workItemTitle}
                    </Link>
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    {approval.workItemKey} · Requested by{" "}
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
                Expires {formatDateTime(approval.expiresAt)}
              </p>
              {approval.state === "pending" &&
                (approval.approverReachLost ? (
                  <Alert variant="warning" className="mt-3">
                    <AlertDescription>
                      You no longer have reach on this work item. Ask the
                      requester to withdraw and re-request it.
                    </AlertDescription>
                  </Alert>
                ) : (
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
                ))}
              {approval.decisionNote && (
                <p className="mt-3 text-sm">
                  Decision note: {approval.decisionNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
