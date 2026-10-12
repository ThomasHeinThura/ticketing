import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@taskdesk/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  acceptSubmission,
  askSubmissionClarification,
  claimSubmission,
  declineSubmission,
  downloadSubmissionAttachment,
  getDuplicateSuggestions,
  getSubmission,
  getSubmissionAttachments,
  getSubmissions,
  markSubmissionDuplicate,
} from "@/fetchers/intake";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
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
  const { state, ref, cursor } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
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
  const queue = useQuery({
    queryKey: ["intake", workspace.data?.id, state, cursor],
    queryFn: () => getSubmissions(workspace.data?.id ?? "", state, cursor),
    enabled: Boolean(workspace.data?.id),
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
    submission: { state: string; createdAt: string };
    requestType: { name: string };
    requester: { displayName?: string };
    organisation: { name: string };
  }>;
  return (
    <main className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
      <PageTitle title={t("title")} />
      <header>
        <h1 className="font-semibold text-2xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>
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
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Submission status filter</legend>
        {[
          "new",
          "clarifying",
          "accepted",
          "declined",
          "duplicate",
          "withdrawn",
        ].map((value) => (
          <Button
            key={value}
            variant={state === value ? "default" : "outline"}
            aria-pressed={state === value}
            onClick={() =>
              void navigate({
                search: {
                  state: value as typeof state,
                  ref,
                  cursor: undefined,
                },
              })
            }
          >
            {value}
          </Button>
        ))}
      </fieldset>
      {queue.isError ? (
        <Alert variant="error" role="alert">
          <AlertDescription>{t("actionError")}</AlertDescription>
          <Button variant="outline" onClick={() => void queue.refetch()}>
            {t("retry", { defaultValue: "Retry" })}
          </Button>
        </Alert>
      ) : queue.isLoading ? (
        <p role="status">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("noState", { state })}</EmptyTitle>
            <EmptyDescription>{t("newRequests")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {rows.map((row) => (
            <li key={row.ref} className="min-w-0">
              <Button
                variant={ref === row.ref ? "secondary" : "outline"}
                aria-current={ref === row.ref ? "true" : undefined}
                className="h-auto w-full min-w-0 flex-wrap justify-start gap-x-4 gap-y-1 whitespace-normal p-3 text-left"
                onClick={() =>
                  void navigate({ search: { state, ref: row.ref } })
                }
              >
                <span className="font-mono">{row.ref}</span>
                <span className="min-w-24">{row.requestType.name}</span>
                <span>
                  {row.requester.displayName ?? t("customer")} ·{" "}
                  {row.organisation.name}
                </span>
                <span className="min-w-0 max-w-full truncate text-muted-foreground">
                  {row.summary}
                </span>
                <span className="ml-auto whitespace-nowrap">
                  {new Date(row.submission.createdAt).toLocaleString()}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {queue.data?.page?.hasMore && (
        <Button
          variant="outline"
          onClick={() =>
            void navigate({
              search: { state, ref, cursor: queue.data?.page.nextCursor },
            })
          }
        >
          {t("nextPage", { defaultValue: "Next page" })}
        </Button>
      )}
      {ref && (
        <section
          className="flex min-w-0 flex-col gap-4 rounded-md border p-4"
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
    </main>
  );
}
