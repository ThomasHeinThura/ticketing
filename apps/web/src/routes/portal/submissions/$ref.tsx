import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  Input,
  PageContainer,
  Skeleton,
  useDelayedPending,
} from "@taskdesk/ui";
import { ArrowLeft, Download, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PdfPreviewDialog, {
  type PdfPreviewAttachment,
} from "@/components/attachments/pdf-preview-dialog";
import {
  PortalCaseSeverity,
  PortalCaseStatus,
} from "@/components/portal/cases/portal-case-table";
import {
  formatPortalDateTime,
  formatPortalFileSize,
} from "@/components/portal/portal-format";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import {
  PortalActionAlert,
  PortalRaisePriority,
  PortalReopenButton,
  PortalSatisfaction,
} from "@/components/portal/portal-request-actions";
import { PortalSlaStatus } from "@/components/portal/portal-sla-status";
import {
  type PortalReplyFileFailure,
  PortalReplyForm,
} from "@/components/portal/requests/portal-reply-form";
import { getPortalSubmissionDetail } from "@/components/portal/requests/portal-submission-fetch";
import {
  completePortalSubmissionAttachment,
  downloadPortalSubmissionAttachment,
  getPortalSubmissionAttachments,
  portalSubmissionAttachmentDownloadPath,
  portalSubmissionAttachmentPreviewPath,
  presignPortalSubmissionAttachment,
  replyPortalSubmission,
  withdrawPortalSubmission,
} from "@/fetchers/intake";
import type { PortalCase } from "@/fetchers/portal/cases";
import { usePortalRequestActions } from "@/hooks/mutations/portal/use-portal-request-actions";
import { invalidatePortalCaseViews } from "@/hooks/queries/portal/use-portal-cases";
import { HttpError } from "@/lib/http-error";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { TerminologyProvider } from "@/lib/i18n/terminology-provider";
import { submissionAnswerRows } from "@/lib/intake-validation";
import {
  customerStatusKey,
  messageAuthor,
  PortalActionError,
  readPortalSla,
} from "@/lib/portal-request";
import { routes } from "@/lib/portal-route-builders";
import {
  parsePortalProjectSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

/** The priorities the case list shows as a severity; anything else reads "Not set". */
const PORTAL_SEVERITIES: readonly string[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const Route = createFileRoute("/submissions/$ref")({
  validateSearch: parsePortalProjectSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalSubmissionPage,
});

function PortalSubmissionPage() {
  const { i18n } = useTranslation();
  const { ref } = Route.useParams();
  return (
    <TerminologyProvider
      audience="customer"
      locale={i18n.resolvedLanguage ?? i18n.language}
      portalSelector={{ submissionRef: ref }}
    >
      <PortalSubmissionContent />
    </TerminologyProvider>
  );
}

function PortalSubmissionContent() {
  const { t, i18n } = usePortalTranslation();
  const locale = i18n?.resolvedLanguage || i18n?.language || undefined;
  const { portalUserId } = Route.useRouteContext();
  const { ref } = Route.useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [previewAttachment, setPreviewAttachment] =
    useState<PdfPreviewAttachment>();
  const page = useQuery({
    queryKey: ["portal", portalUserId, "submission", ref],
    queryFn: () => getPortalSubmissionDetail(ref),
    // A missing or foreign ref is "not found" at once, never retried.
    retry: (count, error) =>
      !(error instanceof HttpError && error.status === 404) && count < 2,
  });
  // A-08: post the reply, then attach each staged file to it on the request the team works on.
  const sendReply = async (input: {
    body: string;
    files: File[];
  }): Promise<PortalReplyFileFailure[]> => {
    const posted = await replyPortalSubmission({ ref, body: input.body });
    postedReply.current = posted.message.id;
    const failed: PortalReplyFileFailure[] = [];
    for (const file of input.files) {
      try {
        const signed = await presignPortalSubmissionAttachment({
          ref,
          commentId: posted.message.id,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        });
        const put = await fetch(signed.uploadUrl, {
          method: "PUT",
          headers: signed.uploadHeaders as Record<string, string>,
          body: file,
        });
        if (!put.ok) throw new Error("The file could not be stored.");
        await completePortalSubmissionAttachment({
          ref,
          id: signed.attachmentId,
        });
      } catch {
        failed.push({ name: file.name, reason: null });
      }
    }
    return failed;
  };
  // IQ-13: replying to a "need more information" request returns it to the team, which closes
  // the reply box. Focus then goes to the reply just sent, and the page announces it.
  const postedReply = useRef<string | null>(null);
  const [sentReplyId, setSentReplyId] = useState<string | null>(null);
  const [pageAnnouncement, setPageAnnouncement] = useState("");
  const refreshAfterReply = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["portal", portalUserId, "submission", ref],
      }),
      invalidatePortalCaseViews(queryClient, portalUserId),
    ]);
    setSentReplyId(postedReply.current);
  };
  // A withdrawn request cannot be reopened by the customer, so withdrawing asks first.
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const withdrawnRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const withdraw = useMutation({
    mutationFn: () => withdrawPortalSubmission(ref),
    onSuccess: async () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["portal", portalUserId, "submission", ref],
        }),
        invalidatePortalCaseViews(queryClient, portalUserId),
      ]),
  });
  const upload = useMutation({
    mutationFn: async (input: { fieldKey?: string; file: File }) => {
      const signed = await presignPortalSubmissionAttachment({
        ref,
        ...(input.fieldKey ? { fieldKey: input.fieldKey } : {}),
        filename: input.file.name,
        contentType: input.file.type || "application/octet-stream",
        size: input.file.size,
      });
      const uploaded = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: signed.uploadHeaders as Record<string, string>,
        body: input.file,
      });
      if (!uploaded.ok)
        throw new Error("The file could not be uploaded to storage.");
      return completePortalSubmissionAttachment({
        ref,
        id: signed.attachmentId,
      });
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: ["portal", portalUserId, "submission", ref, "attachments"],
      }),
  });
  const download = useMutation({
    mutationFn: (file: { id: string; filename: string }) =>
      downloadPortalSubmissionAttachment({
        ref,
        id: file.id,
        filename: file.filename,
      }),
  });
  const finishUpload = useMutation({
    mutationFn: (id: string) => completePortalSubmissionAttachment({ ref, id }),
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: ["portal", portalUserId, "submission", ref, "attachments"],
      }),
  });
  const record = page.data as unknown as
    | {
        submission?: {
          state?: string;
          formData?: Record<string, unknown>;
          workItemId?: string | null;
          createdAt?: string;
        };
        canWithdraw?: boolean;
        /** Customer-language status decided by the server (CP-5); absent: mapped from the submission state. */
        customerStatus?: string;
        /** Attachment access for this viewer; absent: the requester only. */
        canViewAttachments?: boolean;
        canUpload?: boolean;
        sla?: unknown;
        /** Server-decided eligibility for the P3 customer actions (absent: not offered). */
        isRequester?: boolean;
        createdBy?: { name: string | null; isYou: boolean };
        raisedBySupport?: boolean;
        canEscalate?: boolean;
        canReopen?: boolean;
        canRate?: boolean;
        satisfaction?: {
          rating: number;
          comment?: string | null;
          ratedAt?: string;
        } | null;
        workItem?: {
          title: string;
          description: string;
          state: string;
          priority: string | null;
          sla?: unknown;
        } | null;
        /** CF-11: customer-visible custom fields that hold a value (label and value only). */
        customFields?: Array<{
          key: string;
          label: string;
          format: string;
          value: unknown;
        }>;
        requestType?: { name?: string };
        version?: {
          formSchema?: {
            fields?: Array<{
              key: string;
              label: string;
              type: string;
              multiple?: boolean;
            }>;
          };
        };
        messages?: Array<{
          id: string;
          actorType: string;
          authorName?: string | null;
          mine?: boolean;
          body: string;
          reasonCode?: string | null;
          reasonParams?: Record<string, unknown> | null;
          createdAt: string;
        }>;
      }
    | undefined;
  const state = record?.submission?.state;
  useEffect(() => {
    const rawHash = location.hash || window.location.hash;
    const hash = rawHash.startsWith("#") ? rawHash : `#${rawHash}`;
    const match = /^#comment-([A-Za-z0-9_-]{1,128})$/u.exec(hash);
    if (!match || !record?.messages?.some((message) => message.id === match[1]))
      return;
    const target = document.getElementById(`comment-${match[1]}`);
    if (!target) return;
    target.scrollIntoView?.({ block: "center" });
    target.focus({ preventScroll: true });
  }, [location.hash, record?.messages]);
  // CP-16: a colleague who can view the request cannot act on it.
  const requester = record?.isRequester !== false;
  const canWithdraw = requester && record?.canWithdraw === true;
  // CP-16: a colleague never fetches or sees the attachment list and cannot upload.
  const canViewAttachments =
    !!record && (record.canViewAttachments ?? requester);
  const openForFiles = state === "new" || state === "clarifying";
  // A-08: an accepted request takes files too; they attach to the request the team works on.
  const acceptedForFiles = state === "accepted" && !!record?.workItem;
  const canUpload =
    (record?.canUpload ?? requester) && (openForFiles || acceptedForFiles);
  const formFileFields = (record?.version?.formSchema?.fields ?? []).filter(
    (field) => field.type === "file",
  );
  // The form's own file fields are the upload controls while it is open; without any, one
  // general control takes files for the request. Once accepted, files go with a reply (A-08).
  const generalUpload =
    canUpload && openForFiles && formFileFields.length === 0;
  const replyUpload = canUpload && acceptedForFiles;
  const attachments = useQuery({
    queryKey: ["portal", portalUserId, "submission", ref, "attachments"],
    queryFn: () => getPortalSubmissionAttachments(ref),
    enabled: canViewAttachments,
  });
  const placeholderVisible = useDelayedPending(page.isLoading, {
    releaseNow:
      page.isSuccess &&
      canViewAttachments &&
      (attachments.isError ||
        (attachments.isSuccess && attachments.data.length === 0)),
  });
  const actions = usePortalRequestActions(portalUserId, ref);
  const canRaisePriority =
    requester &&
    state === "accepted" &&
    !!record?.workItem &&
    record.canEscalate === true;
  // CP-8: once the team has been asked to review, the button stays hidden for this visit.
  const reopenPending =
    actions.reopen.error instanceof PortalActionError &&
    actions.reopen.error.code === "reopen_pending_review";
  const canReopen = requester && record?.canReopen === true && !reopenPending;
  const statusKey = customerStatusKey(record?.customerStatus, state);
  // CP-5: the customer status the case list shows; mapped from the state when the API omits it.
  const caseStatus = (
    statusKey?.startsWith("request.status.")
      ? statusKey.slice("request.status.".length)
      : undefined
  ) as PortalCase["customerStatus"] | undefined;
  const sla = readPortalSla(record?.sla ?? record?.workItem?.sla);
  const priority = record?.workItem?.priority;
  const severity = (
    priority && PORTAL_SEVERITIES.includes(priority) ? priority : null
  ) as PortalCase["priority"];
  const answers = record
    ? submissionAnswerRows(
        record.version?.formSchema?.fields,
        record.submission?.formData,
      )
    : [];
  // The same title the case list shows: the team's title, else the request type's name.
  const title = record?.workItem?.title || record?.requestType?.name || ref;
  const authorLabel = (message: {
    actorType: string;
    authorName?: string | null;
    mine?: boolean;
  }) => {
    const author = messageAuthor(message);
    return "name" in author ? author.name : t(`portal:${author.key}`);
  };
  const notFound = page.error instanceof HttpError && page.error.status === 404;
  const replyOpen =
    requester && (state === "clarifying" || state === "accepted");
  useEffect(() => {
    if (!sentReplyId) return;
    // The reply box is still here: it keeps focus and says "Reply sent" itself.
    if (replyOpen) {
      setSentReplyId(null);
      return;
    }
    const target = document.getElementById(`comment-${sentReplyId}`);
    if (!target) return;
    target.focus();
    setPageAnnouncement(t("portal:requestPage.replySent"));
    setSentReplyId(null);
  }, [sentReplyId, replyOpen, t]);
  return (
    <PageContainer scroll={false} gutter="responsive" width="4xl">
      <p role="status" className="sr-only">
        {pageAnnouncement}
      </p>
      <PortalPageTitle
        title={
          notFound
            ? t("portal:requestPage.notFound.title")
            : record
              ? `${title} · ${ref}`
              : ref
        }
      />
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to={routes.portalRequests.path} />}
        >
          <ArrowLeft aria-hidden="true" />
          {t("portal:requestPage.back")}
        </Button>
      </div>
      {notFound ? (
        <section className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl">
            {t("portal:requestPage.notFound.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("portal:requestPage.notFound.description")}
          </p>
        </section>
      ) : page.isError ? (
        <Alert variant="error">
          <AlertDescription>
            {t("portal:intake.pageError", {
              defaultValue: "This request could not be loaded or updated.",
            })}
          </AlertDescription>
          <Button variant="outline" onClick={() => void page.refetch()}>
            {t("common:actions.retry", { defaultValue: "Retry" })}
          </Button>
        </Alert>
      ) : !record || placeholderVisible ? (
        <div
          className="flex flex-col gap-4"
          role="status"
          style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
        >
          <span className="sr-only">
            {t("common:empty.loading", { defaultValue: "Loading…" })}
          </span>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  ref={headingRef}
                  tabIndex={-1}
                  className="break-words rounded-md font-semibold text-2xl focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {title}
                </h1>
                <Badge variant="outline" className="font-mono">
                  {ref}
                </Badge>
              </div>
              {record.requestType?.name && record.requestType.name !== title ? (
                <p className="text-muted-foreground text-sm">
                  {record.requestType.name}
                </p>
              ) : null}
            </div>
            {canRaisePriority || canReopen || canWithdraw ? (
              <div className="flex flex-wrap items-center gap-2">
                {canRaisePriority ? (
                  <PortalRaisePriority
                    current={record.workItem?.priority ?? null}
                    escalate={actions.escalate}
                  />
                ) : null}
                {canReopen ? (
                  <PortalReopenButton reopen={actions.reopen} />
                ) : null}
                {canWithdraw ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // The page instance is reused across requests: a withdrawal on an earlier
                      // request must not send focus to the heading when this dialog is cancelled.
                      withdrawnRef.current = false;
                      setWithdrawConfirmOpen(true);
                    }}
                    disabled={withdraw.isPending}
                  >
                    {t("portal:intake.withdraw", {
                      defaultValue: "Withdraw request",
                    })}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </header>
          <AlertDialog
            open={withdrawConfirmOpen}
            onOpenChange={(open) => {
              // The dialog stays open while the withdrawal is being sent.
              if (!open && withdraw.isPending) return;
              setWithdrawConfirmOpen(open);
            }}
          >
            <AlertDialogContent
              // After a withdrawal the Withdraw button is gone, so focus moves to the heading.
              finalFocus={() =>
                withdrawnRef.current ? headingRef.current : true
              }
            >
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("portal:intake.withdrawConfirm.title", {
                    defaultValue: "Withdraw this request?",
                  })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("portal:intake.withdrawConfirm.description", {
                    ref,
                    defaultValue:
                      "{{ref}} will be closed and the team will not work on it. You cannot undo this; to continue later, submit a new request.",
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setWithdrawConfirmOpen(false)}
                  disabled={withdraw.isPending}
                >
                  {t("common:actions.cancel", { defaultValue: "Cancel" })}
                </Button>
                <Button
                  variant="destructive"
                  disabled={withdraw.isPending}
                  onClick={() =>
                    withdraw.mutate(undefined, {
                      onSuccess: () => {
                        withdrawnRef.current = true;
                        setWithdrawConfirmOpen(false);
                        setPageAnnouncement(
                          t("portal:intake.withdrawConfirm.done", {
                            ref,
                            defaultValue: "{{ref}} was withdrawn.",
                          }),
                        );
                      },
                      onError: () => setWithdrawConfirmOpen(false),
                    })
                  }
                >
                  {withdraw.isPending
                    ? t("portal:intake.withdrawConfirm.pending", {
                        defaultValue: "Withdrawing…",
                      })
                    : t("portal:intake.withdraw", {
                        defaultValue: "Withdraw request",
                      })}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {withdraw.isError ? (
            <Alert variant="error">
              <AlertDescription>
                {t("portal:intake.pageError", {
                  defaultValue: "This request could not be loaded or updated.",
                })}
              </AlertDescription>
            </Alert>
          ) : null}
          {requester ? null : (
            <Alert variant="info">
              <AlertDescription>
                {t("portal:request.readOnly")}
              </AlertDescription>
            </Alert>
          )}
          <PortalActionAlert error={actions.escalate.error} />
          <PortalActionAlert error={actions.reopen.error} />
          <Card aria-label={t("portal:request.details")}>
            <CardHeader>
              <CardTitle render={(props) => <h2 {...props} />}>
                {t("portal:request.details")}
              </CardTitle>
            </CardHeader>
            <CardPanel>
              <div className="flex flex-col gap-4">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <dt>
                      <CardDescription>
                        {t("portal:cases.columns.requester")}
                      </CardDescription>
                    </dt>
                    <dd className="text-sm">
                      {record.createdBy?.isYou
                        ? t("portal:request.author.you")
                        : (record.createdBy?.name ??
                          t("portal:request.author.colleague"))}
                    </dd>
                  </div>
                  {record.raisedBySupport ? (
                    <div className="flex flex-col gap-1">
                      <dt>
                        <CardDescription>
                          {t("portal:cases.raisedBy")}
                        </CardDescription>
                      </dt>
                      <dd className="text-sm">
                        {t("portal:cases.supportTeam")}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <dt>
                      <CardDescription>
                        {t("portal:cases.columns.status")}
                      </CardDescription>
                    </dt>
                    <dd className="flex flex-col items-start gap-1.5">
                      {caseStatus ? (
                        <PortalCaseStatus status={caseStatus} />
                      ) : statusKey ? (
                        <Badge variant="outline">
                          {t(`portal:${statusKey}`, { defaultValue: state })}
                        </Badge>
                      ) : null}
                      {sla ? <PortalSlaStatus sla={sla} /> : null}
                    </dd>
                  </div>
                  {/* The team's severity exists once it accepts the request; before that the
                      customer's own answer (if the form asks) is under "Your answers". */}
                  {record.workItem ? (
                    <div className="flex flex-col gap-1">
                      <dt>
                        <CardDescription>
                          {t("portal:cases.columns.severity")}
                        </CardDescription>
                      </dt>
                      <dd>
                        <PortalCaseSeverity priority={severity} />
                      </dd>
                    </div>
                  ) : null}
                  {record.submission?.createdAt ? (
                    <div className="flex flex-col gap-1">
                      <dt>
                        <CardDescription>
                          {t("portal:cases.columns.created")}
                        </CardDescription>
                      </dt>
                      <dd className="text-sm tabular-nums">
                        <time dateTime={record.submission.createdAt}>
                          {formatPortalDateTime(
                            record.submission.createdAt,
                            locale,
                          )}
                        </time>
                      </dd>
                    </div>
                  ) : null}
                  {(record.customFields ?? []).map((field) => (
                    <div className="flex flex-col gap-1" key={field.key}>
                      <dt>
                        <CardDescription>{field.label}</CardDescription>
                      </dt>
                      <dd className="break-words text-sm">
                        {field.value === true
                          ? t("workItems:customFieldValue.yes", {
                              defaultValue: "Yes",
                            })
                          : field.value === false
                            ? t("workItems:customFieldValue.no", {
                                defaultValue: "No",
                              })
                            : Array.isArray(field.value)
                              ? field.value.join(", ")
                              : typeof field.value === "object" &&
                                  field.value !== null
                                ? Object.values(field.value).join(" ")
                                : String(field.value ?? "")}
                      </dd>
                    </div>
                  ))}
                </dl>
                {record.workItem?.description ? (
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {record.workItem.description}
                  </p>
                ) : null}
              </div>
            </CardPanel>
          </Card>
          {state === "accepted" && record.workItem ? null : (
            <Card>
              <CardHeader>
                <CardTitle render={(props) => <h2 {...props} />}>
                  {t("portal:intake.answers", { defaultValue: "Your answers" })}
                </CardTitle>
              </CardHeader>
              <CardPanel>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {answers.map((answer) => (
                    <div className="flex flex-col gap-1" key={answer.key}>
                      <dt>
                        <CardDescription>{answer.label}</CardDescription>
                      </dt>
                      <dd className="whitespace-pre-wrap break-words text-sm">
                        {answer.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardPanel>
            </Card>
          )}
          {state === "declined" && (
            <Alert variant="warning">
              <AlertDescription>
                {
                  record.messages
                    ?.filter((message) => message.actorType === "triager")
                    .at(-1)?.body
                }
              </AlertDescription>
            </Alert>
          )}
          {requester && record.canRate === true ? (
            <PortalSatisfaction
              key={record.satisfaction?.rating ?? "new"}
              rate={actions.rate}
              existing={record.satisfaction ?? null}
            />
          ) : null}
          <section
            className="flex flex-col gap-3"
            aria-labelledby="submission-thread"
          >
            <h2 id="submission-thread" className="font-medium">
              {t("portal:intake.conversation", {
                defaultValue: "Conversation",
              })}
            </h2>
            {record.messages?.length ? (
              <ol className="flex flex-col gap-3">
                {record.messages.map((message) => (
                  <li
                    key={message.id}
                    id={`comment-${message.id}`}
                    tabIndex={-1}
                    className="scroll-m-4 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Card>
                      <CardHeader>
                        <CardDescription>
                          {authorLabel(message)} ·{" "}
                          <time dateTime={message.createdAt}>
                            {formatPortalDateTime(message.createdAt, locale)}
                          </time>
                        </CardDescription>
                      </CardHeader>
                      <CardPanel>
                        <p className="whitespace-pre-wrap break-words">
                          {message.reasonCode
                            ? t(
                                `portal:intake.systemReasons.${message.reasonCode}`,
                                {
                                  ...message.reasonParams,
                                  defaultValue: message.body,
                                },
                              )
                            : message.body}
                        </p>
                      </CardPanel>
                    </Card>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>
                    {t("portal:request.conversationEmpty", {
                      defaultValue: "No messages yet",
                    })}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </section>
          {canViewAttachments || canUpload ? (
            <section
              className="flex flex-col gap-3"
              aria-labelledby="submission-files"
            >
              <h2 id="submission-files" className="font-medium">
                {t("portal:intake.attachments", {
                  defaultValue: "Attachments",
                })}
              </h2>
              {attachments.isLoading && (
                <p role="status" className="text-muted-foreground text-sm">
                  {t("common:empty.loading", { defaultValue: "Loading…" })}
                </p>
              )}
              {attachments.isError && (
                <Alert variant="error">
                  <AlertDescription>
                    {t("portal:intake.attachmentListError", {
                      defaultValue: "Could not load attachments.",
                    })}
                  </AlertDescription>
                  <Button
                    variant="outline"
                    onClick={() => void attachments.refetch()}
                  >
                    {t("common:actions.retry", { defaultValue: "Retry" })}
                  </Button>
                </Alert>
              )}
              {download.isError && (
                <Alert variant="error">
                  <AlertDescription>
                    {t("portal:intake.downloadError", {
                      defaultValue:
                        "The file could not be downloaded. Try again.",
                    })}
                  </AlertDescription>
                </Alert>
              )}
              {finishUpload.isError && (
                <Alert variant="error">
                  <AlertDescription>
                    {t("portal:intake.completeUploadError", {
                      defaultValue: "Could not finish this upload.",
                    })}
                  </AlertDescription>
                  {finishUpload.variables && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        finishUpload.mutate(finishUpload.variables)
                      }
                      disabled={finishUpload.isPending}
                    >
                      {t("common:actions.retry", { defaultValue: "Retry" })}
                    </Button>
                  )}
                </Alert>
              )}
              {canViewAttachments &&
              attachments.isSuccess &&
              attachments.data.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyDescription>
                      {t("portal:request.attachmentsEmpty", {
                        defaultValue: "No attachments",
                      })}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
              {canViewAttachments && attachments.data?.length ? (
                <ul className="flex flex-col gap-2">
                  {attachments.data.map((file) => (
                    <li
                      className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                      key={file.id}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-medium text-sm">
                          {file.filename}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {[
                            formatPortalFileSize(file.size),
                            // Only a file that is not ready says so; "ready" is never shown.
                            file.state === "pending"
                              ? t("portal:requestPage.fileUploadPending")
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {/* Say why a ready file has no Download (the API cannot serve its key), never leave it unexplained. */}
                        {file.state === "ready" && !file.downloadable ? (
                          <span className="text-muted-foreground text-xs">
                            {t("portal:requestPage.fileNotDownloadable")}
                          </span>
                        ) : null}
                      </span>
                      {file.state === "pending" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => finishUpload.mutate(file.id)}
                          disabled={finishUpload.isPending}
                        >
                          {t("portal:intake.completeUpload", {
                            defaultValue: "Finish upload",
                          })}
                        </Button>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {file.state === "ready" &&
                          file.mimeType?.trim().toLowerCase() ===
                            "application/pdf" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={t(
                                "workItemExtras:detail.attachments.pdfPreviewOpen",
                                { name: file.filename },
                              )}
                              onClick={() =>
                                setPreviewAttachment({
                                  id: file.id,
                                  filename: file.filename,
                                  previewPath:
                                    portalSubmissionAttachmentPreviewPath(
                                      ref,
                                      file.id,
                                    ),
                                  ...(file.downloadable
                                    ? {
                                        downloadPath:
                                          portalSubmissionAttachmentDownloadPath(
                                            ref,
                                            file.id,
                                          ),
                                      }
                                    : {}),
                                })
                              }
                            >
                              {t(
                                "workItemExtras:detail.attachments.pdfPreviewOpen",
                                {
                                  name: file.filename,
                                },
                              )}
                            </Button>
                          ) : null}
                          {/* A file the API marks not downloadable is listed without a download. */}
                          {file.downloadable ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={download.isPending}
                              onClick={() =>
                                download.mutate({
                                  id: file.id,
                                  filename: file.filename,
                                })
                              }
                            >
                              <Download aria-hidden="true" />
                              {t("portal:intake.download", {
                                defaultValue: "Download",
                              })}
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {generalUpload ? (
                <SubmissionFileField
                  fieldKey="request"
                  label={t("portal:requestPage.attach")}
                  multiple
                  uploading={upload.isPending}
                  onFiles={(files) => {
                    for (const file of files) upload.mutate({ file });
                  }}
                />
              ) : null}
              {formFileFields
                .filter(() => canUpload && openForFiles)
                .map((field) => (
                  <SubmissionFileField
                    key={field.key}
                    fieldKey={field.key}
                    label={`${field.label}${field.multiple ? "" : " (one file)"}`}
                    multiple={Boolean(field.multiple)}
                    uploading={upload.isPending}
                    onFiles={(files) => {
                      for (const file of files)
                        upload.mutate({ fieldKey: field.key, file });
                    }}
                  />
                ))}
              {upload.isError && (
                <Alert variant="error">
                  <AlertDescription>
                    {t("portal:intake.uploadError", {
                      defaultValue:
                        "The attachment could not be uploaded. Try again.",
                    })}
                  </AlertDescription>
                </Alert>
              )}
            </section>
          ) : null}
          {replyOpen ? (
            <PortalReplyForm
              canUpload={replyUpload}
              send={sendReply}
              onSent={refreshAfterReply}
            />
          ) : null}
        </>
      )}
      <PdfPreviewDialog
        attachment={previewAttachment}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(undefined);
        }}
      />
    </PageContainer>
  );
}

/**
 * A request form's file field on the tracking page: the agent attachment uploader's pattern, a
 * Kaneo `Button` that opens the library `Input` file picker kept out of sight and tab order.
 */
function SubmissionFileField({
  fieldKey,
  label,
  multiple,
  uploading,
  onFiles,
}: {
  fieldKey: string;
  label: string;
  multiple: boolean;
  uploading: boolean;
  onFiles: (files: File[]) => void;
}) {
  const { t } = usePortalTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = `submission-file-${fieldKey}-label`;
  return (
    <div className="flex flex-col items-start gap-2">
      <span id={labelId}>{label}</span>
      <Button
        variant="outline"
        size="sm"
        aria-describedby={labelId}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-4" aria-hidden="true" />
        {uploading
          ? t("workItemExtras:detail.attachments.uploading")
          : t("workItemExtras:detail.attachments.add")}
      </Button>
      <Input
        ref={inputRef}
        id={`submission-file-${fieldKey}`}
        type="file"
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          onFiles(multiple ? files : files.slice(0, 1));
          event.target.value = "";
        }}
      />
    </div>
  );
}
