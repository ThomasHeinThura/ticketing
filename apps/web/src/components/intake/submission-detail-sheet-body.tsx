import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Label,
  Textarea,
} from "@taskdesk/ui";
import { X } from "lucide-react";
import { type ComponentProps, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PdfPreviewDialog, {
  type PdfPreviewAttachment,
} from "@/components/attachments/pdf-preview-dialog";
import { PickerPopover } from "@/components/common/picker-popover";
import { KbTriageSuggestions } from "@/components/kb/agent/kb-triage-suggestions";
import {
  acceptSubmission,
  askSubmissionClarification,
  claimSubmission,
  declineSubmission,
  downloadSubmissionAttachment,
  getDuplicateSuggestions,
  getSubmission,
  getSubmissionAttachments,
  markSubmissionDuplicate,
  staffSubmissionAttachmentDownloadPath,
  staffSubmissionAttachmentPreviewPath,
} from "@/fetchers/intake";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import { parseTriageError, type TriageError } from "@/lib/intake-queue";
import { submissionAnswerRows } from "@/lib/intake-validation";

type SubmissionDetail = {
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
    formSchema?: {
      fields?: Array<{
        key: string;
        label: string;
        mapsTo?: { field?: string } | null;
      }>;
    };
  };
  messages?: Array<{
    id: string;
    actorType: string;
    body: string;
    reasonCode?: string | null;
    reasonParams?: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

const STATE_BADGE: Record<string, ComponentProps<typeof Badge>["variant"]> = {
  new: "info",
  clarifying: "warning",
  accepted: "success",
  declined: "error",
  duplicate: "secondary",
  withdrawn: "outline",
};

/** The same summary the queue derives: the answer to the field mapped to the title. */
function detailSummary(detail: SubmissionDetail | undefined) {
  const field = detail?.version?.formSchema?.fields?.find(
    (candidate) => candidate.mapsTo?.field === "title",
  );
  const value = field ? detail?.submission?.formData?.[field.key] : undefined;
  return value === undefined || value === null ? "" : String(value);
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-semibold text-base/4.5 text-foreground sm:text-sm/4">
      {children}
    </h3>
  );
}

/**
 * A failed triage action (claim, accept, clarify, decline, duplicate) and, for a lost race, a
 * link to the winner's work item. It renders in the sticky footer so it stays next to the
 * buttons however far the body is scrolled.
 */
function TriageActionAlert({
  error,
  onOpenWorkItem,
}: {
  error: TriageError;
  onOpenWorkItem: (key: string) => void;
}) {
  const { t } = useTranslation("intake");
  const winnerKey = error.workItem?.key;
  return (
    <Alert variant="error" role="alert">
      <AlertDescription>
        {error.code ? t(`errors.${error.code}`) : t("actionError")}
      </AlertDescription>
      {winnerKey ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 font-mono"
          onClick={() => onOpenWorkItem(winnerKey)}
        >
          {t("errors.openWinner", { key: winnerKey })}
        </Button>
      ) : null}
    </Alert>
  );
}

/**
 * The selected submission inside Kaneo's task sheet: a header with the reference, request type
 * and state; a scrolling body with the answers, conversation, attachments and replies; and, while
 * the submission is open, a sticky footer that converts it into a work item.
 */
export default function SubmissionDetailSheetBody({
  submissionRef: ref,
  workspaceId,
  rowSummary,
  onClose,
  onOpenWorkItem,
}: {
  submissionRef: string;
  workspaceId: string | undefined;
  rowSummary?: string;
  onClose: () => void;
  onOpenWorkItem: (key: string) => void;
}) {
  const { t } = useTranslation("intake");
  const { t: tCommon } = useTranslation();
  const fieldId = useId();
  const projectPickerId = `${fieldId}-project`;
  const typePickerId = `${fieldId}-type`;
  const convertHeadingId = `${fieldId}-convert`;
  const clarificationId = `${fieldId}-clarification`;
  const declineId = `${fieldId}-decline`;
  const cache = useQueryClient();
  const workItemTypes = useGetWorkItemTypes({ workspaceId });
  const projects = useGetProjects({ workspaceId: workspaceId ?? "" });
  const [projectId, setProjectId] = useState("");
  const [workItemTypeId, setWorkItemTypeId] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [message, setMessage] = useState("");
  const [previewAttachment, setPreviewAttachment] =
    useState<PdfPreviewAttachment>();
  // Claim, Accept, Clarify and Decline disable or unmount the focused control; hand focus to
  // the status block, whose live region also announces the submission's new state.
  const statusRef = useRef<HTMLDivElement>(null);
  const [acceptedItem, setAcceptedItem] = useState<{
    ref: string;
    label: string;
  } | null>(null);
  const detail = useQuery({
    queryKey: ["intake", "submission", ref],
    queryFn: () => getSubmission(ref),
  });
  const current = detail.data as unknown as SubmissionDetail | undefined;
  const attachments = useQuery({
    queryKey: ["intake", "submission", ref, "attachments"],
    queryFn: () => getSubmissionAttachments(ref),
  });
  const isOpen =
    current?.submission?.state === "new" ||
    current?.submission?.state === "clarifying";
  const duplicateSuggestions = useQuery({
    queryKey: ["intake", "submission", ref, "duplicates"],
    queryFn: () => getDuplicateSuggestions(ref),
    enabled: isOpen,
  });
  const invalidate = async () => {
    await cache.invalidateQueries({ queryKey: ["intake"] });
  };
  const claim = useMutation({
    mutationFn: () => claimSubmission(ref),
    onSuccess: async () => {
      await invalidate();
      statusRef.current?.focus();
    },
  });
  const accept = useMutation({
    mutationFn: () => {
      const version = current?.version;
      const project = projectId.trim() || version?.defaultProjectId || "";
      const type = workItemTypeId || version?.workItemTypeId || "";
      // Shown through `errors.destination_required` (translated), never as raw text.
      if (!project || !type) throw new Error("destination_required");
      return acceptSubmission({
        ref,
        projectId: project,
        workItemTypeId: type,
      });
    },
    onSuccess: async (data) => {
      const item = (data as { workItem?: { key?: string; title?: string } })
        .workItem;
      const label = [item?.key, item?.title].filter(Boolean).join(" · ");
      if (label) setAcceptedItem({ ref, label });
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
        ref,
        id: file.id,
        filename: file.filename,
      }),
  });
  const decline = useMutation({
    mutationFn: () => declineSubmission({ ref, reason: declineReason.trim() }),
    onSuccess: async () => {
      setDeclineReason("");
      await invalidate();
      // The Decline button and its field unmount once the submission closes.
      statusRef.current?.focus();
    },
  });
  const clarify = useMutation({
    mutationFn: () => askSubmissionClarification({ ref, body: message.trim() }),
    onSuccess: async () => {
      setMessage("");
      await invalidate();
      statusRef.current?.focus();
    },
  });
  const duplicate = useMutation({
    mutationFn: (workItemId: string) =>
      markSubmissionDuplicate({ ref, workItemId }),
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
    setPreviewAttachment(undefined);
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
  useEffect(() => {
    setWorkItemTypeId(current?.version?.workItemTypeId ?? "");
    setProjectId(current?.version?.defaultProjectId ?? "");
  }, [current?.version?.workItemTypeId, current?.version?.defaultProjectId]);
  const actionError = [claim, accept, decline, clarify, duplicate]
    .map((mutation) => (mutation.isError ? mutation.error : null))
    .find(Boolean);
  const triageError = actionError ? parseTriageError(actionError) : null;
  const state = current?.submission?.state;
  const defaultProject = (projects.data ?? []).find(
    (project) => project.id === current?.version?.defaultProjectId,
  );
  const defaultType = workItemTypes.data?.find(
    (type) => type.id === current?.version?.workItemTypeId,
  );
  const summary = detailSummary(current) || rowSummary || "";

  return (
    <div
      data-testid="submission-detail-sheet"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-border border-b bg-background px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-medium font-mono text-muted-foreground text-sm">
            {ref}
          </span>
          <h2 className="truncate font-medium text-foreground text-sm">
            {current?.requestType?.name ?? t("submissionFallback")}
          </h2>
          {state ? (
            <Badge
              variant={STATE_BADGE[state] ?? "outline"}
              className="shrink-0"
            >
              {t(`states.${state}`, { defaultValue: state })}
            </Badge>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="shrink-0 text-foreground"
          aria-label={tCommon("common:actions.close")}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-w-0 flex-col gap-6 px-4 py-4">
          {/* Load and download failures belong to the body; triage action errors sit next to
              the action buttons in the footer (see `TriageActionAlert`). */}
          {detail.isError || attachments.isError || download.isError ? (
            <Alert variant="error" role="alert">
              <AlertDescription>{t("actionError")}</AlertDescription>
            </Alert>
          ) : null}
          {detail.isLoading ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("loadingDetails")}
            </p>
          ) : current ? (
            <>
              <div
                ref={statusRef}
                role="status"
                tabIndex={-1}
                className="flex flex-col gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* The visible state is the header badge, outside this live region; this line
                    lets assistive technology hear the change after every triage action. */}
                {state ? (
                  <span className="sr-only">
                    {`${t("status")}: ${t(`states.${state}`, { defaultValue: state })}`}
                  </span>
                ) : null}
                {summary ? (
                  <p className="wrap-anywhere font-semibold text-foreground text-lg">
                    {summary}
                  </p>
                ) : null}
                {current.submission?.claimedAt ? (
                  <p className="text-muted-foreground text-sm">
                    {t("claimedAt", {
                      date: new Date(
                        current.submission.claimedAt,
                      ).toLocaleString(),
                    })}
                  </p>
                ) : null}
                {!isOpen && current.submission?.workItemId ? (
                  <p className="text-sm">
                    {t("convertedWorkItem", {
                      label:
                        acceptedItem && acceptedItem.ref === ref
                          ? acceptedItem.label
                          : current.submission.workItemId,
                    })}
                  </p>
                ) : null}
              </div>
              <section className="flex flex-col gap-2">
                <SectionHeading>{t("submittedAnswers")}</SectionHeading>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {submissionAnswerRows(
                    current.version?.formSchema?.fields,
                    current.submission?.formData,
                  ).map((answer) => (
                    <div key={answer.key} className="min-w-0">
                      <dt className="text-muted-foreground text-xs">
                        {answer.label}
                      </dt>
                      <dd className="wrap-anywhere text-sm">{answer.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              {current.messages?.length ? (
                <section className="flex flex-col gap-2">
                  <SectionHeading>{t("conversation")}</SectionHeading>
                  <ol className="flex flex-col gap-2">
                    {(current.messages ?? []).map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-md border border-border p-3"
                      >
                        <p className="text-muted-foreground text-xs">
                          {t(`actorTypes.${entry.actorType}`, {
                            defaultValue: entry.actorType,
                          })}{" "}
                          · {new Date(entry.createdAt).toLocaleString()}
                        </p>
                        <p className="wrap-anywhere text-sm">
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
                </section>
              ) : null}
              {attachments.data?.length ? (
                <section className="flex flex-col gap-2">
                  <SectionHeading>{t("attachments")}</SectionHeading>
                  {(attachments.data ?? []).map((file) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
                      key={file.id}
                    >
                      <span className="min-w-0 wrap-anywhere text-sm">
                        {file.filename} ·{" "}
                        {t(`attachmentStates.${file.state}`, {
                          defaultValue: file.state,
                        })}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {file.state === "ready" &&
                        file.mimeType?.trim().toLowerCase() ===
                          "application/pdf" ? (
                          <Button
                            variant="outline"
                            size="sm"
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
                                    ref,
                                    file.id,
                                  ),
                                downloadPath:
                                  staffSubmissionAttachmentDownloadPath(
                                    ref,
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
                          size="sm"
                          onClick={() => download.mutate(file)}
                          disabled={file.state !== "ready"}
                        >
                          {t("download")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </section>
              ) : null}
              {isOpen ? (
                <>
                  {duplicateSuggestions.data?.suggestions?.length ? (
                    <section className="flex flex-col gap-2">
                      <SectionHeading>{t("possibleDuplicates")}</SectionHeading>
                      {duplicateSuggestions.data.suggestions.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
                        >
                          <span className="min-w-0 wrap-anywhere text-sm">
                            {item.key} · {item.title} (
                            {Math.round(item.score * 100)}%)
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
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
                  {workspaceId ? (
                    <KbTriageSuggestions
                      workspaceId={workspaceId}
                      text={summary}
                      onInsert={(line) =>
                        setMessage((old) => (old ? `${old}\n${line}` : line))
                      }
                    />
                  ) : null}
                  <section className="flex flex-col gap-2">
                    <Label htmlFor={clarificationId}>
                      {t("clarificationMessage")}
                    </Label>
                    <Textarea
                      id={clarificationId}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-end"
                      onClick={() => clarify.mutate()}
                      disabled={!message.trim() || clarify.isPending}
                    >
                      {t("clarify")}
                    </Button>
                  </section>
                  <section className="flex flex-col gap-2">
                    <Label htmlFor={declineId}>{t("declineReason")}</Label>
                    <Textarea
                      id={declineId}
                      value={declineReason}
                      onChange={(event) => setDeclineReason(event.target.value)}
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      className="self-end"
                      onClick={() => decline.mutate()}
                      disabled={!declineReason.trim() || decline.isPending}
                    >
                      {t("decline")}
                    </Button>
                  </section>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {current && isOpen ? (
        <section
          aria-labelledby={convertHeadingId}
          data-testid="submission-convert-footer"
          className="flex shrink-0 flex-col gap-3 border-border border-t bg-sidebar px-4 py-3"
        >
          {triageError ? (
            <TriageActionAlert
              error={triageError}
              onOpenWorkItem={onOpenWorkItem}
            />
          ) : null}
          <h3
            id={convertHeadingId}
            className="font-semibold text-base/4.5 text-foreground sm:text-sm/4"
          >
            {t("convertHeading")}
          </h3>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 max-w-full flex-col gap-1.5">
              <Label htmlFor={projectPickerId}>{t("destinationProject")}</Label>
              <PickerPopover
                id={projectPickerId}
                value={
                  projectId || current.version?.defaultProjectId || undefined
                }
                onChange={setProjectId}
                ariaLabel={t("destinationProject")}
                placeholder={t("chooseProject")}
                className="w-full"
                options={(projects.data ?? []).map((project) => ({
                  value: project.id,
                  label: `${project.name} (${project.slug})`,
                }))}
              />
              {defaultProject ? (
                <p className="text-muted-foreground text-xs">
                  {t("defaultFromRequestType", { name: defaultProject.name })}
                </p>
              ) : null}
            </div>
            <div className="flex min-w-0 max-w-full flex-col gap-1.5">
              <Label htmlFor={typePickerId}>{t("workItemType")}</Label>
              <PickerPopover
                id={typePickerId}
                value={
                  workItemTypeId || current.version?.workItemTypeId || undefined
                }
                onChange={setWorkItemTypeId}
                ariaLabel={t("workItemType")}
                placeholder={t("chooseWorkItemType")}
                className="w-full"
                options={(workItemTypes.data ?? []).map((type) => ({
                  value: type.id,
                  label: type.name,
                }))}
              />
              {defaultType ? (
                <p className="text-muted-foreground text-xs">
                  {t("defaultFromRequestType", { name: defaultType.name })}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => claim.mutate()}
              disabled={claim.isPending}
            >
              {t("claim")}
            </Button>
            <Button
              size="sm"
              onClick={() => accept.mutate()}
              disabled={accept.isPending}
            >
              {t("accept")}
            </Button>
          </div>
        </section>
      ) : current && triageError ? (
        // A lost race refreshes the detail into a closed state, which removes the convert
        // controls; the error and the winner's link stay in the same footer position.
        <div
          data-testid="submission-action-footer"
          className="flex shrink-0 flex-col border-border border-t bg-sidebar px-4 py-3"
        >
          <TriageActionAlert
            error={triageError}
            onOpenWorkItem={onOpenWorkItem}
          />
        </div>
      ) : null}
      <PdfPreviewDialog
        attachment={previewAttachment}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(undefined);
        }}
      />
    </div>
  );
}
