import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Textarea,
} from "@taskdesk/ui";
import { Filter } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PdfPreviewDialog, {
  type PdfPreviewAttachment,
} from "@/components/attachments/pdf-preview-dialog";
import Layout from "@/components/common/layout";
import { PickerPopover } from "@/components/common/picker-popover";
import { IntakeQueuePanel } from "@/components/intake/queue-panel";
import { IntakeQueuePicker } from "@/components/intake/queue-picker";
import {
  type StaffSubmissionQueueRow,
  SubmissionQueueTable,
} from "@/components/intake/submission-queue-table";
import {
  TriageFilterChips,
  TriageFilterMenu,
} from "@/components/intake/triage-filter-menu";
import { KbTriageSuggestions } from "@/components/kb/agent/kb-triage-suggestions";
import PageTitle from "@/components/page-title";
import {
  acceptSubmission,
  askSubmissionClarification,
  claimSubmission,
  declineSubmission,
  downloadSubmissionAttachment,
  getDuplicateSuggestions,
  getRequestTypes,
  getSubmission,
  getSubmissionAttachments,
  getSubmissions,
  markSubmissionDuplicate,
  staffSubmissionAttachmentDownloadPath,
  staffSubmissionAttachmentPreviewPath,
} from "@/fetchers/intake";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  matchesIntakeFilters,
  parseTriageError,
  serverClockNow,
  splitIntakeFilters,
} from "@/lib/intake-queue";
import { submissionAnswerRows } from "@/lib/intake-validation";
import {
  type IntakeQueueSearch,
  parseIntakeSearch,
  routes,
} from "@/lib/routes";
import { savedViewQueryDocument } from "@/lib/saved-view-query";

export const Route = createFileRoute("/_layout/_authenticated/agent/triage")({
  validateSearch: parseIntakeSearch,
  component: IntakeRoute,
});

function IntakeRoute() {
  const { t } = useTranslation("intake");
  const workspace = useActiveWorkspace();
  const permissions = useWorkspacePermission(workspace.data?.id);
  const workItemTypes = useGetWorkItemTypes({
    workspaceId: workspace.data?.id,
  });
  const projects = useGetProjects({ workspaceId: workspace.data?.id ?? "" });
  const {
    state,
    ref,
    cursor,
    requestType,
    assignee,
    age,
    queue: queuePair,
    workItemFilter,
    workItemSorts,
    workItemColumns,
    workItemFilterMode,
  } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const filters = { requestType, assignee, age };
  // Filters and the selected submission live in the URL; a change keeps the rest.
  const searchWith = (patch: Partial<IntakeQueueSearch>) => ({
    state,
    queue: queuePair,
    workItemFilter,
    workItemSorts,
    workItemColumns,
    workItemFilterMode,
    ref,
    cursor,
    ...filters,
    ...patch,
  });
  const workItemDefinition = useMemo(() => {
    if (
      workItemFilter === undefined &&
      workItemSorts === undefined &&
      workItemColumns === undefined
    )
      return { query: undefined, invalid: false };
    try {
      return {
        query: savedViewQueryDocument({
          filter: workItemFilter,
          sorts: workItemSorts,
          columns: workItemColumns,
        }),
        invalid: false,
      };
    } catch {
      return { query: undefined, invalid: true };
    }
  }, [workItemFilter, workItemSorts, workItemColumns]);
  const cache = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [workItemTypeId, setWorkItemTypeId] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [message, setMessage] = useState("");
  const [previewAttachment, setPreviewAttachment] =
    useState<PdfPreviewAttachment>();
  // Claim/Accept disable or unmount the focused button; hand focus to the status block.
  const statusRef = useRef<HTMLDivElement>(null);
  const [acceptedItem, setAcceptedItem] = useState<{
    ref: string;
    label: string;
  } | null>(null);
  // The filter's request type options: every published type, not only those on this page.
  const requestTypeList = useQuery({
    queryKey: ["request-types", workspace.data?.id],
    queryFn: () => getRequestTypes(workspace.data?.id ?? ""),
    enabled: Boolean(workspace.data?.id),
  });
  const requestTypeRefs = (
    requestTypeList.data as unknown as
      | { requestTypes?: Array<{ id: string; key?: string; name: string }> }
      | undefined
  )?.requestTypes;
  // `IQ-21`: the server filters by request type key, assignee and age, so a shared URL shows
  // the same queue on any page. Only a filter with no server parameter narrows client-side.
  const { server, residual, pending } = splitIntakeFilters(
    filters,
    requestTypeList.isLoading ? undefined : (requestTypeRefs ?? []),
  );
  // Ages advance between refetches on the server's clock (see `serverClockNow`).
  const [browserTick, setBrowserTick] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setBrowserTick(Date.now()), 60_000);
    return () => window.clearInterval(handle);
  }, []);
  const queue = useQuery({
    queryKey: ["intake", workspace.data?.id, state, cursor, server],
    queryFn: () =>
      getSubmissions(workspace.data?.id ?? "", state, cursor, server),
    enabled: Boolean(workspace.data?.id) && !pending && !queuePair,
  });
  const detail = useQuery({
    queryKey: ["intake", "submission", ref],
    queryFn: () => getSubmission(ref ?? ""),
    enabled: Boolean(ref),
  });
  const attachments = useQuery({
    queryKey: ["intake", "submission", ref, "attachments"],
    queryFn: () => getSubmissionAttachments(ref ?? ""),
    enabled: Boolean(ref),
  });
  const duplicateSuggestions = useQuery({
    queryKey: ["intake", "submission", ref, "duplicates"],
    queryFn: () => getDuplicateSuggestions(ref ?? ""),
    enabled: Boolean(
      ref &&
        ["new", "clarifying"].includes(
          detail.data?.submission.state ?? state ?? "",
        ),
    ),
  });
  const invalidate = async () => {
    await cache.invalidateQueries({ queryKey: ["intake"] });
  };
  const claim = useMutation({
    mutationFn: () => claimSubmission(ref ?? ""),
    onSuccess: async () => {
      await invalidate();
      statusRef.current?.focus();
    },
  });
  const accept = useMutation({
    mutationFn: () => {
      const data = detail.data as unknown as {
        version?: { workItemTypeId?: string; defaultProjectId?: string | null };
      };
      const version = data?.version;
      const project = projectId.trim() || version?.defaultProjectId || "";
      const type = workItemTypeId || version?.workItemTypeId || "";
      // Shown through `errors.destination_required` (translated), never as raw text.
      if (!project || !type) throw new Error("destination_required");
      return acceptSubmission({
        ref: ref ?? "",
        projectId: project,
        workItemTypeId: type,
      });
    },
    onSuccess: async (data) => {
      const item = (data as { workItem?: { key?: string; title?: string } })
        .workItem;
      const label = [item?.key, item?.title].filter(Boolean).join(" · ");
      if (label) setAcceptedItem({ ref: ref ?? "", label });
      await invalidate();
      statusRef.current?.focus();
    },
    // `P2R1-12`: a lost race or a changed submission refreshes the queue and the detail, so
    // the screen shows the submission's current state next to the specific message.
    onError: async (error) => {
      if (parseTriageError(error).status === "conflict") await invalidate();
    },
  });
  const download = useMutation({
    mutationFn: (file: { id: string; filename: string }) =>
      downloadSubmissionAttachment({
        ref: ref ?? "",
        id: file.id,
        filename: file.filename,
      }),
  });
  const decline = useMutation({
    mutationFn: () =>
      declineSubmission({ ref: ref ?? "", reason: declineReason.trim() }),
    onSuccess: async () => {
      setDeclineReason("");
      await invalidate();
    },
  });
  const clarify = useMutation({
    mutationFn: () =>
      askSubmissionClarification({ ref: ref ?? "", body: message.trim() }),
    onSuccess: async () => {
      setMessage("");
      await invalidate();
    },
  });
  const duplicate = useMutation({
    mutationFn: (workItemId: string) =>
      markSubmissionDuplicate({ ref: ref ?? "", workItemId }),
    onSuccess: invalidate,
  });
  // `P2R1-02`: everything typed or reported for one submission belongs to it. Opening another
  // submission (`?ref=`) clears the drafts, the chosen destination and every action's error.
  const resetClaim = claim.reset;
  const resetAccept = accept.reset;
  const resetDecline = decline.reset;
  const resetClarify = clarify.reset;
  const resetDuplicate = duplicate.reset;
  const resetDownload = download.reset;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selected reference is the trigger
  useEffect(() => {
    setDeclineReason("");
    setMessage("");
    setProjectId("");
    setWorkItemTypeId("");
    resetClaim();
    resetAccept();
    resetDecline();
    resetClarify();
    resetDuplicate();
    resetDownload();
  }, [
    ref,
    resetClaim,
    resetAccept,
    resetDecline,
    resetClarify,
    resetDuplicate,
    resetDownload,
  ]);
  const actionError = [claim, accept, decline, clarify, duplicate]
    .map((mutation) => (mutation.isError ? mutation.error : null))
    .find(Boolean);
  const triageError = actionError ? parseTriageError(actionError) : null;
  const current = detail.data as unknown as
    | {
        submission?: {
          state?: string;
          formData?: Record<string, unknown>;
          requesterId?: string;
          organisationId?: string;
          claimedAt?: string | null;
          workItemId?: string;
        };
        requestType?: { name?: string };
        version?: {
          defaultProjectId?: string | null;
          workItemTypeId?: string;
          formSchema?: { fields?: Array<{ key: string; label: string }> };
        };
        messages?: Array<{
          id: string;
          actorType: string;
          body: string;
          reasonCode?: string | null;
          reasonParams?: Record<string, unknown> | null;
          createdAt: string;
        }>;
      }
    | undefined;
  const selectedWorkItemTypeId =
    workItemTypeId || current?.version?.workItemTypeId;
  const selectedWorkItemType = workItemTypes.data?.find(
    (type) => type.id === selectedWorkItemTypeId,
  );
  useEffect(() => {
    setWorkItemTypeId(current?.version?.workItemTypeId ?? "");
    setProjectId(current?.version?.defaultProjectId ?? "");
  }, [current?.version?.workItemTypeId, current?.version?.defaultProjectId]);
  const rows = (queue.data?.submissions ?? []) as StaffSubmissionQueueRow[];
  const requestTypeOptions = (
    requestTypeRefs ??
    Array.from(
      new Map(
        rows.map((row) => [row.requestType.id, row.requestType]),
      ).values(),
    )
  ).map((type) => ({ id: type.id, name: type.name }));
  const queueNow = serverClockNow(
    queue.data?.serverNow,
    queue.dataUpdatedAt,
    browserTick,
  );
  const visibleRows = rows.filter((row) =>
    matchesIntakeFilters(row, residual, queueNow),
  );
  const hasFilters = Boolean(requestType || assignee || age);
  const changeFilters = (patch: Record<string, string | undefined>) =>
    void navigate({ search: searchWith({ ...patch, cursor: undefined }) });
  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <PageTitle title={t("title")} />
      <Layout.Header className="items-center justify-between">
        <h1 className="px-2 font-medium text-sm">{t("title")}</h1>
        <div className="flex items-center gap-1">
          <TriageFilterMenu
            filters={filters}
            requestTypes={requestTypeOptions}
            onChange={changeFilters}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" aria-label={t("statusFilter")}>
                <Filter className="size-3" />
                {t("status", { defaultValue: "Status" })}
                {state
                  ? `: ${t(`states.${state}`, { defaultValue: state })}`
                  : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {[
                "new",
                "clarifying",
                "accepted",
                "declined",
                "duplicate",
                "withdrawn",
              ].map((value) => (
                <DropdownMenuCheckboxItem
                  key={value}
                  checked={state === value}
                  onCheckedChange={() =>
                    void navigate({
                      search: searchWith({
                        state: value as typeof state,
                        cursor: undefined,
                      }),
                    })
                  }
                >
                  {t(`states.${value}`, { defaultValue: value })}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Layout.Header>
      <Layout.Content className="overflow-y-auto">
        <p className="sr-only">{t("description")}</p>
        <TriageFilterChips
          filters={filters}
          requestTypes={requestTypeOptions}
          onChange={changeFilters}
        />
        {workspace.data?.id && (
          <IntakeQueuePicker
            workspaceId={workspace.data.id}
            queueId={queuePair}
            canCreate={
              permissions.canTriageIntake() &&
              !workItemDefinition.invalid &&
              !pending &&
              !residual.requestType
            }
            canShare={permissions.canShareSavedViews()}
            currentSubmissionQuery={
              state || requestType || assignee || age
                ? {
                    entity: "submission",
                    filter: { ...(state ? { state } : {}), ...server },
                  }
                : undefined
            }
            currentWorkItemQuery={workItemDefinition.query}
            onSelect={(id) =>
              void navigate({
                search: { queue: id, ...(id ? {} : { state: "new" as const }) },
              })
            }
          />
        )}
        {!workspace.data?.id && <p role="status">{t("selectWorkspace")}</p>}
        {(detail.isError ||
          attachments.isError ||
          download.isError ||
          triageError) && (
          <Alert variant="error" role="alert">
            <AlertDescription>
              {triageError?.code
                ? t(`errors.${triageError.code}`)
                : t("actionError")}
            </AlertDescription>
            {triageError?.workItem ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 font-mono"
                onClick={() =>
                  void navigate({
                    to: routes.workItemDetail.path,
                    params: { key: triageError.workItem?.key ?? "" },
                  })
                }
              >
                {t("errors.openWinner", { key: triageError.workItem.key })}
              </Button>
            ) : null}
          </Alert>
        )}
        {queuePair && pending ? (
          <p role="status">{t("loading")}</p>
        ) : queuePair && residual.requestType ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("filters.noMatch")}</EmptyTitle>
              <EmptyDescription>{t("filters.noMatchHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : queuePair && workspace.data?.id ? (
          <IntakeQueuePanel
            workspaceId={workspace.data.id}
            queueId={queuePair}
            state={state}
            requestTypeKey={server.requestTypeKey}
            assignee={assignee}
            olderThanDays={server.olderThanDays}
            workItemQuery={{
              filter: workItemFilter,
              sorts: workItemSorts,
              columns: workItemColumns,
              filterMode: workItemFilterMode,
            }}
            onWorkItemQueryChange={(change) =>
              void navigate({
                search: searchWith({
                  ...("filter" in change
                    ? { workItemFilter: change.filter }
                    : {}),
                  ...("sorts" in change ? { workItemSorts: change.sorts } : {}),
                  ...("columns" in change
                    ? { workItemColumns: change.columns }
                    : {}),
                  ...("filterMode" in change
                    ? { workItemFilterMode: change.filterMode }
                    : {}),
                }),
              })
            }
            selectedRef={ref}
            onOpenSubmission={(nextRef) =>
              void navigate({ search: searchWith({ ref: nextRef }) })
            }
            onOpenWorkItem={(key) =>
              void navigate({ to: routes.workItemDetail.path, params: { key } })
            }
          />
        ) : queue.isError ? (
          <Alert variant="error" role="alert">
            <AlertDescription>{t("actionError")}</AlertDescription>
            <Button variant="outline" onClick={() => void queue.refetch()}>
              {t("retry", { defaultValue: "Retry" })}
            </Button>
          </Alert>
        ) : queue.isLoading || pending ? (
          <p role="status">{t("loading")}</p>
        ) : visibleRows.length === 0 && hasFilters ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {t("filters.noMatch", {
                  defaultValue: "No submissions match the filters",
                })}
              </EmptyTitle>
              <EmptyDescription>
                {t("filters.noMatchHint", {
                  defaultValue:
                    "No submission in this state matches every filter. Remove one to see more.",
                })}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("noState", { state })}</EmptyTitle>
              <EmptyDescription>{t("newRequests")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SubmissionQueueTable
            rows={visibleRows}
            now={queueNow}
            selectedRef={ref}
            onOpenSubmission={(nextRef) =>
              void navigate({ search: searchWith({ ref: nextRef }) })
            }
          />
        )}
        {!queuePair && queue.data?.page?.hasMore && (
          <Button
            variant="outline"
            onClick={() =>
              void navigate({
                search: searchWith({
                  cursor: queue.data?.page.nextCursor ?? undefined,
                }),
              })
            }
          >
            {t("nextPage", { defaultValue: "Next page" })}
          </Button>
        )}
        {ref && (
          <section
            className="flex min-w-0 flex-col gap-4 border-t p-4"
            aria-label={t("submissionRegion", { ref })}
          >
            <h2 className="font-semibold text-xl">
              {ref} · {current?.requestType?.name ?? t("submissionFallback")}
            </h2>
            {detail.isLoading ? (
              <p role="status">{t("loadingDetails")}</p>
            ) : (
              current && (
                <>
                  <div
                    ref={statusRef}
                    role="status"
                    tabIndex={-1}
                    className="outline-none"
                  >
                    <p>
                      {t("status", { defaultValue: "Status" })}:{" "}
                      <strong>
                        {current.submission?.state
                          ? t(`states.${current.submission.state}`, {
                              defaultValue: current.submission.state,
                            })
                          : null}
                      </strong>
                    </p>
                    {current.submission?.claimedAt ? (
                      <p className="text-muted-foreground text-sm">
                        {t("claimedAt", {
                          defaultValue: "Claimed {{date}}",
                          date: new Date(
                            current.submission.claimedAt,
                          ).toLocaleString(),
                        })}
                      </p>
                    ) : null}
                  </div>
                  <h3 className="font-medium">{t("submittedAnswers")}</h3>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    {submissionAnswerRows(
                      current.version?.formSchema?.fields,
                      current.submission?.formData,
                    ).map((answer) => (
                      <div key={answer.key} className="min-w-0">
                        <dt className="text-muted-foreground text-sm">
                          {answer.label}
                        </dt>
                        <dd className="wrap-anywhere">{answer.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <h3 className="font-medium">{t("conversation")}</h3>
                  <ol className="flex flex-col gap-2">
                    {(current.messages ?? []).map((entry) => (
                      <li key={entry.id} className="rounded border p-3">
                        <p className="text-sm">
                          {t(`actorTypes.${entry.actorType}`, {
                            defaultValue: entry.actorType,
                          })}{" "}
                          · {new Date(entry.createdAt).toLocaleString()}
                        </p>
                        <p className="wrap-anywhere">
                          {entry.reasonCode
                            ? t(`systemReasons.${entry.reasonCode}`, {
                                ...entry.reasonParams,
                                defaultValue: entry.body,
                              })
                            : entry.body}
                        </p>
                      </li>
                    ))}
                  </ol>
                  <h3 className="font-medium">{t("attachments")}</h3>
                  {(attachments.data ?? []).map((file) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded border p-3"
                      key={file.id}
                    >
                      <span className="min-w-0 wrap-anywhere">
                        {file.filename} ·{" "}
                        {t(`attachmentStates.${file.state}`, {
                          defaultValue: file.state,
                        })}
                      </span>
                      <div className="flex items-center gap-2">
                        {file.state === "ready" &&
                        file.mimeType?.trim().toLowerCase() ===
                          "application/pdf" ? (
                          <Button
                            variant="outline"
                            aria-label={t(
                              "workItems:detail.attachments.pdfPreviewOpen",
                              { name: file.filename },
                            )}
                            onClick={() =>
                              setPreviewAttachment({
                                id: file.id,
                                filename: file.filename,
                                previewPath:
                                  staffSubmissionAttachmentPreviewPath(
                                    ref ?? "",
                                    file.id,
                                  ),
                                downloadPath:
                                  staffSubmissionAttachmentDownloadPath(
                                    ref ?? "",
                                    file.id,
                                  ),
                              })
                            }
                          >
                            {t("workItems:detail.attachments.pdfPreviewOpen", {
                              name: file.filename,
                            })}
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          onClick={() => download.mutate(file)}
                          disabled={file.state !== "ready"}
                        >
                          {t("download")}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {current.submission?.state === "new" ||
                  current.submission?.state === "clarifying" ? (
                    <>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="flex min-w-0 max-w-full flex-col gap-1 text-sm">
                          {t("destinationProject")}
                          <PickerPopover
                            value={
                              projectId ||
                              current.version?.defaultProjectId ||
                              undefined
                            }
                            onChange={setProjectId}
                            ariaLabel={t("destinationProject")}
                            placeholder={t("chooseProject")}
                            className="w-56"
                            options={(projects.data ?? []).map((project) => ({
                              value: project.id,
                              label: `${project.name} (${project.slug})`,
                            }))}
                          />
                        </div>
                        <div className="flex min-w-0 max-w-full flex-col gap-1 text-sm">
                          {t("workItemType")}
                          <PickerPopover
                            value={
                              workItemTypeId ||
                              current.version?.workItemTypeId ||
                              undefined
                            }
                            onChange={setWorkItemTypeId}
                            ariaLabel={t("workItemType")}
                            placeholder={t("chooseWorkItemType")}
                            className="w-56"
                            options={(workItemTypes.data ?? []).map((type) => ({
                              value: type.id,
                              label: type.name,
                            }))}
                          />
                        </div>
                        {selectedWorkItemType?.name ? (
                          <p className="text-sm">
                            {t("prefilledFromType", {
                              defaultValue:
                                "Prefilled from request type: {{name}}",
                              name: selectedWorkItemType.name,
                            })}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => claim.mutate()}
                          disabled={claim.isPending}
                        >
                          {t("claim")}
                        </Button>
                        <Button
                          onClick={() => accept.mutate()}
                          disabled={accept.isPending}
                        >
                          {t("accept")}
                        </Button>
                      </div>
                      {duplicateSuggestions.data?.suggestions?.length ? (
                        <section className="flex flex-col gap-2">
                          <h3 className="font-medium">
                            {t("possibleDuplicates")}
                          </h3>
                          {duplicateSuggestions.data.suggestions.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-3 rounded border p-3"
                            >
                              <span>
                                {item.key} · {item.title} (
                                {Math.round(item.score * 100)}%)
                              </span>
                              <Button
                                variant="outline"
                                onClick={() => duplicate.mutate(item.id)}
                                disabled={duplicate.isPending}
                              >
                                {t("linkDuplicate")}
                              </Button>
                            </div>
                          ))}
                        </section>
                      ) : null}
                      {/* KB-12: the same article suggestions the customer was offered. */}
                      {workspace.data?.id ? (
                        <KbTriageSuggestions
                          workspaceId={workspace.data.id}
                          text={
                            rows.find((row) => row.ref === ref)?.summary ?? ""
                          }
                          onInsert={(line) =>
                            setMessage((old) =>
                              old ? `${old}\n${line}` : line,
                            )
                          }
                        />
                      ) : null}
                      <label
                        className="flex flex-col gap-1"
                        htmlFor="clarification-message"
                      >
                        {t("clarificationMessage")}
                        <Textarea
                          id="clarification-message"
                          value={message}
                          onChange={(event) => setMessage(event.target.value)}
                        />
                      </label>
                      <Button
                        variant="outline"
                        onClick={() => clarify.mutate()}
                        disabled={!message.trim() || clarify.isPending}
                      >
                        {t("clarify")}
                      </Button>
                      <label
                        className="flex flex-col gap-1"
                        htmlFor="decline-reason"
                      >
                        {t("declineReason")}
                        <Textarea
                          id="decline-reason"
                          value={declineReason}
                          onChange={(event) =>
                            setDeclineReason(event.target.value)
                          }
                        />
                      </label>
                      <Button
                        variant="destructive"
                        onClick={() => decline.mutate()}
                        disabled={!declineReason.trim() || decline.isPending}
                      >
                        {t("decline")}
                      </Button>
                    </>
                  ) : current.submission?.workItemId ? (
                    <p>
                      {t("convertedWorkItem", {
                        defaultValue: "Converted work item: {{label}}",
                        label:
                          acceptedItem && acceptedItem.ref === ref
                            ? acceptedItem.label
                            : current.submission.workItemId,
                      })}
                    </p>
                  ) : null}
                </>
              )
            )}
          </section>
        )}
      </Layout.Content>
      <PdfPreviewDialog
        attachment={previewAttachment}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(undefined);
        }}
      />
    </div>
  );
}
