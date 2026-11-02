import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import {
  decidePortalApproval,
  getPortalApprovals,
} from "@/fetchers/approval/portal-approvals";
import { HttpError } from "@/lib/http-error";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import {
  parsePortalApprovalsSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/routes";

export const Route = createFileRoute("/approvals")({
  validateSearch: parsePortalApprovalsSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalApprovals,
});
function PortalApprovals() {
  const { t } = usePortalTranslation("portal");
  const { portalUserId } = Route.useRouteContext();
  const { approval: selectedId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["portal", portalUserId, "approvals"],
    queryFn: getPortalApprovals,
  });
  const [noteDraft, setNoteDraft] = useState({ id: selectedId, value: "" });
  const note = noteDraft.id === selectedId ? noteDraft.value : "";
  const [announcement, setAnnouncement] = useState("");
  const mutation = useMutation({
    mutationFn: decidePortalApproval,
    onSuccess: async () => {
      setAnnouncement(t("approvals.recorded"));
      await navigate({ search: {} });
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["portal", portalUserId, "approvals"],
      }),
  });
  const selected = query.data?.approvals.find(
    (approval) => approval.id === selectedId,
  );
  const canDecide =
    selected?.state === "pending" && !selected.approverReachLost;
  const errorKey =
    mutation.error instanceof HttpError && mutation.error.status === 409
      ? "approvals.conflict"
      : mutation.error instanceof HttpError &&
          [403, 404].includes(mutation.error.status)
        ? "approvals.forbidden"
        : "approvals.failed";
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header>
        <h1 className="font-semibold text-lg">{t("approvals.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("approvals.description")}
        </p>
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {query.isError ? (
        <Alert variant="error">
          <AlertDescription>{t("approvals.loadFailed")}</AlertDescription>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </Alert>
      ) : query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : !query.data.approvals.length ? (
        <p className="text-sm text-muted-foreground">{t("approvals.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("approvals.request")}</TableHead>
              <TableHead>{t("requests.status")}</TableHead>
              <TableHead>{t("approvals.expires")}</TableHead>
              <TableHead>{t("approvals.decision")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.approvals.map((approval) => (
              <TableRow key={approval.id}>
                <TableCell>
                  {approval.workItemKey} · {approval.workItemTitle}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{approval.state}</Badge>
                </TableCell>
                <TableCell>
                  {new Date(approval.expiresAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void navigate({ search: { approval: approval.id } })
                    }
                  >
                    {t("approvals.review")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) void navigate({ search: {} });
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("approvals.review")}</DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.workItemKey} · ${selected.workItemTitle}`
                : t(
                    query.isPending
                      ? "approvals.loading"
                      : "approvals.unavailable",
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {mutation.isError && mutation.variables?.id === selectedId ? (
              <Alert variant="error">
                <AlertDescription>{t(errorKey)}</AlertDescription>
              </Alert>
            ) : null}
            {selected && !canDecide ? (
              <Alert variant="info">
                <AlertDescription>
                  {t("approvals.unavailable")}
                </AlertDescription>
              </Alert>
            ) : null}
            {canDecide ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="approval-note">{t("approvals.note")}</Label>
                <Textarea
                  id="approval-note"
                  value={note}
                  maxLength={4000}
                  disabled={mutation.isPending}
                  onChange={(event) =>
                    setNoteDraft({ id: selectedId, value: event.target.value })
                  }
                />
              </div>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => void navigate({ search: {} })}
            >
              {t("common:actions.close")}
            </Button>
            {canDecide && selected ? (
              <>
                <Button
                  variant="outline"
                  disabled={mutation.isPending || !note.trim()}
                  onClick={() =>
                    mutation.mutate({ id: selected.id, action: "reject", note })
                  }
                >
                  {t("approvals.reject")}
                </Button>
                <Button
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      id: selected.id,
                      action: "approve",
                      note,
                    })
                  }
                >
                  {t("approvals.approve")}
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
