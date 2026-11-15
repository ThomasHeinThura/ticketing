import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  EmptyState,
  Frame,
  Label,
  LoadingStatus,
  PageContainer,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useDelayedPending,
} from "@taskdesk/ui";
import { CheckCircle } from "lucide-react";
import { type ComponentProps, useState } from "react";
import {
  formatPortalDate,
  formatPortalDateTime,
} from "@/components/portal/portal-format";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import {
  decidePortalApproval,
  getPortalApprovals,
} from "@/fetchers/approval/portal-approvals";
import { invalidatePortalCaseViews } from "@/hooks/queries/portal/use-portal-cases";
import { HttpError } from "@/lib/http-error";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/portal-route-builders";
import {
  parsePortalApprovalsSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

const APPROVAL_STATE_TONE: Record<
  string,
  NonNullable<ComponentProps<typeof Badge>["variant"]>
> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
  expired: "outline",
  withdrawn: "outline",
};

export const Route = createFileRoute("/approvals")({
  validateSearch: parsePortalApprovalsSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalApprovals,
});
function PortalApprovals() {
  const { t, i18n } = usePortalTranslation("portal");
  const locale = i18n?.resolvedLanguage || i18n?.language || undefined;
  const { portalUserId } = Route.useRouteContext();
  const { approval: selectedId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["portal", portalUserId, "approvals"],
    queryFn: getPortalApprovals,
  });
  const placeholderVisible = useDelayedPending(query.isPending, {
    releaseNow: query.isSuccess && query.data.approvals.length === 0,
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
    // A decision changes the dashboard's "Action required" figure as well as this list.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["portal", portalUserId, "approvals"],
        }),
        invalidatePortalCaseViews(queryClient, portalUserId),
      ]),
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
  const stateLabel = (state: string) =>
    t(`approvals.state.${state}`, { defaultValue: state });
  const stateTone = (
    state: string,
  ): NonNullable<ComponentProps<typeof Badge>["variant"]> =>
    APPROVAL_STATE_TONE[state] ?? "outline";

  return (
    <PageContainer scroll={false} gutter="responsive" width="4xl">
      <PortalPageTitle title={t("approvals.title")} />
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
      ) : query.isPending || placeholderVisible ? (
        <LoadingStatus
          visible={placeholderVisible}
          label={t("common:empty.loading")}
        >
          <Skeleton
            className="h-24 w-full"
            style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
          />
        </LoadingStatus>
      ) : !query.data.approvals.length ? (
        // UX-1a (CP-4): the shared empty look, with the way back to the customer's requests.
        <EmptyState
          icon={<CheckCircle />}
          title={t("approvals.empty")}
          description={t("approvals.emptyDescription")}
          action={
            <Button
              variant="outline"
              render={<Link to={routes.portalRequests.path} />}
            >
              {t("navigation.requests")}
            </Button>
          }
        />
      ) : (
        <Frame className="@container">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("approvals.request")}</TableHead>
                <TableHead className="hidden @2xl:table-cell">
                  {t("requests.status")}
                </TableHead>
                <TableHead className="hidden @2xl:table-cell">
                  {t("approvals.expires")}
                </TableHead>
                <TableHead className="text-end">
                  {t("approvals.decision")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.approvals.map((approval) => {
                const fullExpires = formatPortalDateTime(
                  approval.expiresAt,
                  locale,
                );
                return (
                  <TableRow key={approval.id}>
                    <TableCell className="max-w-0 whitespace-normal">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="break-words font-medium">
                          {approval.workItemKey} · {approval.workItemTitle}
                        </span>
                        {approval.requester.displayName ? (
                          <span className="break-words text-muted-foreground text-xs">
                            {t("cases.columns.requester")}:{" "}
                            {approval.requester.displayName}
                          </span>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs @2xl:hidden">
                          <Badge variant={stateTone(approval.state)}>
                            {stateLabel(approval.state)}
                          </Badge>
                          <time
                            dateTime={approval.expiresAt}
                            title={fullExpires}
                          >
                            {formatPortalDate(approval.expiresAt, locale)}
                          </time>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden @2xl:table-cell">
                      <Badge variant={stateTone(approval.state)}>
                        {stateLabel(approval.state)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground text-xs @2xl:table-cell">
                      <time dateTime={approval.expiresAt} title={fullExpires}>
                        {formatPortalDate(approval.expiresAt, locale)}
                      </time>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void navigate({ search: { approval: approval.id } })
                        }
                      >
                        {t("approvals.review")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Frame>
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
            {selected ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                {selected.requester.displayName ? (
                  <span className="w-full break-words">
                    {t("cases.columns.requester")}:{" "}
                    {selected.requester.displayName}
                  </span>
                ) : null}
                <Badge variant={stateTone(selected.state)}>
                  {stateLabel(selected.state)}
                </Badge>
                <span>
                  {t("approvals.expires")}:{" "}
                  <time dateTime={selected.expiresAt}>
                    {formatPortalDateTime(selected.expiresAt, locale)}
                  </time>
                </span>
              </div>
            ) : null}
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
    </PageContainer>
  );
}
