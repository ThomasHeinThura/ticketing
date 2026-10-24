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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@taskdesk/ui";
import { Filter } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
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
} from "@/fetchers/intake";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import {
  formatSubmissionAge,
  matchesIntakeFilters,
  splitIntakeFilters,
} from "@/lib/intake-queue";
import { submissionAnswerRows } from "@/lib/intake-validation";
import { parseIntakeSearch } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/agent/triage")({
  validateSearch: parseIntakeSearch,
  component: IntakeRoute,
});

function IntakeRoute() {
  const { t } = useTranslation("intake");
  const workspace = useActiveWorkspace();
  const workItemTypes = useGetWorkItemTypes({
    workspaceId: workspace.data?.id,
  });
  const projects = useGetProjects({ workspaceId: workspace.data?.id ?? "" });
  const { state, ref, cursor, requestType, assignee, age } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const filters = { requestType, assignee, age };
  // Filters and the selected submission live in the URL; a change keeps the rest.
  const searchWith = (patch: Record<string, string | undefined>) => ({
    state,
    ref,
    cursor,
    ...filters,
    ...patch,
  });
  const cache = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [workItemTypeId, setWorkItemTypeId] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [message, setMessage] = useState("");
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
  const queue = useQuery({
    queryKey: ["intake", workspace.data?.id, state, cursor, server],
    queryFn: () =>
      getSubmissions(workspace.data?.id ?? "", state, cursor, server),
    enabled: Boolean(workspace.data?.id) && !pending,
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
    enabled: Boolean(ref && (state === "new" || state === "clarifying")),
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
      if (!project || !type)
        throw new Error(
          "Choose a destination project and confirm the pinned work item type.",
        );
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
          createdAt: string;
        }>;
      }
    | undefined;
  const selectedProjectId = projectId || current?.version?.defaultProjectId;
  const selectedProject = projects.data?.find(
    (project) => project.id === selectedProjectId,
  );
  const selectedWorkItemTypeId =
    workItemTypeId || current?.version?.workItemTypeId;
  const selectedWorkItemType = workItemTypes.data?.find(
    (type) => type.id === selectedWorkItemTypeId,
  );
  useEffect(() => {
    setWorkItemTypeId(current?.version?.workItemTypeId ?? "");
    setProjectId(current?.version?.defaultProjectId ?? "");
  }, [current?.version?.workItemTypeId, current?.version?.defaultProjectId]);
  const rows = (queue.data?.submissions ?? []) as unknown as Array<{
    ref: string;
    summary: string;
    submission: {
      state: string;
      createdAt: string;
      claimedBy: string | null;
    };
    requestType: { id: string; name: string };
    requester: { displayName?: string };
    organisation: { name: string };
  }>;
  const requestTypeOptions = (
    requestTypeRefs ??
    Array.from(
      new Map(
        rows.map((row) => [row.requestType.id, row.requestType]),
      ).values(),
    )
  ).map((type) => ({ id: type.id, name: type.name }));
  const visibleRows = rows.filter((row) => matchesIntakeFilters(row, residual));
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
              <Button
                variant="ghost"
                size="xs"
                aria-label="Submission status filter"
              >
                <Filter className="size-3" />
                {t("status", { defaultValue: "Status" })}: {state}
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
                  {value}
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
        {!workspace.data?.id && <p role="status">{t("selectWorkspace")}</p>}
        {(detail.isError ||
          attachments.isError ||
          claim.isError ||
          accept.isError ||
          decline.isError ||
          download.isError ||
          clarify.isError ||
          duplicate.isError) && (
          <Alert variant="error" role="alert">
            <AlertDescription>{t("actionError")}</AlertDescription>
          </Alert>
        )}
        {queue.isError ? (
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
          <Table aria-label={t("title")}>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("reference", { defaultValue: "Reference" })}
                </TableHead>
                <TableHead>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow
                  key={row.ref}
                  data-state={ref === row.ref ? "selected" : undefined}
                >
                  <TableCell>
                    <Button
                      variant="link"
                      size="sm"
                      aria-current={ref === row.ref ? "true" : undefined}
                      onClick={() =>
                        void navigate({
                          search: searchWith({ ref: row.ref }),
                        })
                      }
                      className="h-auto p-0 font-mono"
                    >
                      {row.ref}
                    </Button>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {row.summary}
                  </TableCell>
                  <TableCell>{row.requestType.name}</TableCell>
                  <TableCell>
                    {row.requester.displayName ?? t("customer")}
                  </TableCell>
                  <TableCell>{row.organisation.name}</TableCell>
                  <TableCell>
                    {new Date(row.submission.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell data-testid="triage-row-age">
                    {formatSubmissionAge(row.submission.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {queue.data?.page?.hasMore && (
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
            aria-label={`Submission ${ref}`}
          >
            <h2 className="font-semibold text-xl">
              {ref} · {current?.requestType?.name ?? "Submission"}
            </h2>
            {detail.isLoading ? (
              <p role="status">Loading details…</p>
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
                      <strong>{current.submission?.state}</strong>
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
                          {entry.actorType} ·{" "}
                          {new Date(entry.createdAt).toLocaleString()}
                        </p>
                        <p className="wrap-anywhere">{entry.body}</p>
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
                        {file.filename} · {file.state}
                      </span>
                      <Button
                        variant="outline"
                        onClick={() => download.mutate(file)}
                        disabled={file.state !== "ready"}
                      >
                        Download
                      </Button>
                    </div>
                  ))}
                  {current.submission?.state === "new" ||
                  current.submission?.state === "clarifying" ? (
                    <>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="flex min-w-0 max-w-full flex-col gap-1 text-sm">
                          Destination project
                          <Select
                            value={
                              projectId ||
                              current.version?.defaultProjectId ||
                              undefined
                            }
                            onValueChange={(value: string | null) => {
                              if (value !== null) setProjectId(value);
                            }}
                          >
                            <SelectTrigger aria-label="Destination project">
                              <SelectValue placeholder="Choose a project">
                                {selectedProject
                                  ? `${selectedProject.name} (${selectedProject.slug})`
                                  : undefined}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {projects.data?.map((project) => (
                                <SelectItem key={project.id} value={project.id}>
                                  {project.name} ({project.slug})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex min-w-0 max-w-full flex-col gap-1 text-sm">
                          Work item type
                          <Select
                            value={
                              workItemTypeId ||
                              current.version?.workItemTypeId ||
                              undefined
                            }
                            onValueChange={(value: string | null) => {
                              if (value !== null) setWorkItemTypeId(value);
                            }}
                          >
                            <SelectTrigger aria-label="Work item type">
                              <SelectValue placeholder="Choose a work item type">
                                {selectedWorkItemType?.name}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {workItemTypes.data?.map((type) => (
                                <SelectItem key={type.id} value={type.id}>
                                  {type.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
    </div>
  );
}
