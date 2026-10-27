import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  Input,
  Textarea,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PdfPreviewDialog, {
  type PdfPreviewAttachment,
} from "@/components/attachments/pdf-preview-dialog";
import {
  PortalActionAlert,
  PortalRaisePriority,
  PortalReopenButton,
  PortalSatisfaction,
} from "@/components/portal/portal-request-actions";
import { PortalSlaStatus } from "@/components/portal/portal-sla-status";
import {
  completePortalSubmissionAttachment,
  downloadPortalSubmissionAttachment,
  getPortalSubmission,
  getPortalSubmissionAttachments,
  portalSubmissionAttachmentDownloadPath,
  portalSubmissionAttachmentPreviewPath,
  presignPortalSubmissionAttachment,
  replyPortalSubmission,
  withdrawPortalSubmission,
} from "@/fetchers/intake";
import { usePortalRequestActions } from "@/hooks/mutations/portal/use-portal-request-actions";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { TerminologyProvider } from "@/lib/i18n/terminology-provider";
import { submissionAnswerRows } from "@/lib/intake-validation";
import {
  customerStatusKey,
  messageAuthor,
  PortalActionError,
  readPortalSla,
} from "@/lib/portal-request";

export const Route = createFileRoute("/submissions/$ref")({
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
  const { t } = usePortalTranslation();
  const { portalUserId } = Route.useRouteContext();
  const { ref } = Route.useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [previewAttachment, setPreviewAttachment] =
    useState<PdfPreviewAttachment>();
  const page = useQuery({
    queryKey: ["portal", portalUserId, "submission", ref],
    queryFn: () => getPortalSubmission(ref),
  });
  const reply = useMutation({
    mutationFn: () => replyPortalSubmission({ ref, body: body.trim() }),
    onSuccess: async () => {
      setBody("");
      await queryClient.invalidateQueries({
        queryKey: ["portal", portalUserId, "submission", ref],
      });
    },
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawPortalSubmission(ref),
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: ["portal", portalUserId, "submission", ref],
      }),
  });
  const upload = useMutation({
    mutationFn: async (input: { fieldKey: string; file: File }) => {
      const signed = await presignPortalSubmissionAttachment({
        ref,
        fieldKey: input.fieldKey,
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
  const canUpload =
    (record?.canUpload ?? requester) &&
    (state === "new" || state === "clarifying");
  const attachments = useQuery({
    queryKey: ["portal", portalUserId, "submission", ref, "attachments"],
    queryFn: () => getPortalSubmissionAttachments(ref),
    enabled: canViewAttachments,
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
  const stateLabel = statusKey
    ? t(`portal:${statusKey}`, { defaultValue: state })
    : undefined;
  // Nothing to show until the record loads: no dangling separator while loading.
  const subtitle = [record?.requestType?.name, stateLabel]
    .filter(Boolean)
    .join(" · ");
  const sla = readPortalSla(record?.sla ?? record?.workItem?.sla);
  const authorLabel = (message: {
    actorType: string;
    authorName?: string | null;
    mine?: boolean;
  }) => {
    const author = messageAuthor(message);
    return "name" in author ? author.name : t(`portal:${author.key}`);
  };
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl">
            {t("portal:intake.submissionTitle", {
              ref,
            })}
          </h1>
          {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
        </div>
        {record && (canRaisePriority || canReopen || canWithdraw) ? (
          <div className="flex flex-wrap items-center gap-2">
            {canRaisePriority ? (
              <PortalRaisePriority
                current={record.workItem?.priority ?? null}
                escalate={actions.escalate}
              />
            ) : null}
            {canReopen ? <PortalReopenButton reopen={actions.reopen} /> : null}
            {canWithdraw ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => withdraw.mutate()}
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
      {page.isLoading && (
        <p role="status">
          {t("common:empty.loading", { defaultValue: "Loading…" })}
        </p>
      )}
      {page.isError ? (
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
      ) : null}
      {!page.isError && (reply.isError || withdraw.isError) && (
        <Alert variant="error">
          <AlertDescription>
            {t("portal:intake.pageError", {
              defaultValue: "This request could not be loaded or updated.",
            })}
          </AlertDescription>
        </Alert>
      )}
      {record && !requester ? (
        <Alert variant="info">
          <AlertDescription>{t("portal:request.readOnly")}</AlertDescription>
        </Alert>
      ) : null}
      <PortalActionAlert error={actions.escalate.error} />
      <PortalActionAlert error={actions.reopen.error} />
      {record && (
        <>
          {state === "accepted" && record.workItem ? (
            <Card aria-label={t("portal:request.details")}>
              <CardHeader>
                <CardTitle render={(props) => <h2 {...props} />}>
                  {record.workItem.title}
                </CardTitle>
                <CardAction>
                  {stateLabel ? (
                    <Badge variant="outline">{stateLabel}</Badge>
                  ) : null}
                </CardAction>
              </CardHeader>
              <CardPanel>
                <div className="flex flex-col gap-3">
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {record.workItem.priority && (
                      <div>
                        <dt>
                          <CardDescription>
                            {t("portal:request.priority.label")}
                          </CardDescription>
                        </dt>
                        <dd>
                          {t(
                            `portal:request.priority.value.${record.workItem.priority}`,
                            { defaultValue: record.workItem.priority },
                          )}
                        </dd>
                      </div>
                    )}
                    {(record.customFields ?? []).map((field) => (
                      <div key={field.key}>
                        <dt>
                          <CardDescription>{field.label}</CardDescription>
                        </dt>
                        <dd>
                          {field.value === true
                            ? t("customFields:value.yes", {
                                defaultValue: "Yes",
                              })
                            : field.value === false
                              ? t("customFields:value.no", {
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
                    {sla && (
                      <div>
                        <dt>
                          <CardDescription>
                            {t("portal:intake.sla.label", {
                              defaultValue: "Service target",
                            })}
                          </CardDescription>
                        </dt>
                        <dd>
                          <PortalSlaStatus sla={sla} />
                        </dd>
                      </div>
                    )}
                  </dl>
                  {record.workItem.description && (
                    <p className="whitespace-pre-wrap">
                      {record.workItem.description}
                    </p>
                  )}
                </div>
              </CardPanel>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle render={(props) => <h2 {...props} />}>
                  {t("portal:intake.answers", { defaultValue: "Your answers" })}
                </CardTitle>
              </CardHeader>
              <CardPanel>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {submissionAnswerRows(
                    record.version?.formSchema?.fields,
                    record.submission?.formData,
                  ).map((answer) => (
                    <div key={answer.key}>
                      <dt>
                        <CardDescription>{answer.label}</CardDescription>
                      </dt>
                      <dd>{answer.value}</dd>
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
          <section className="flex flex-col gap-3">
            <h2 className="font-medium">
              {t("portal:intake.conversation", {
                defaultValue: "Conversation",
              })}
            </h2>
            {record.messages?.length ? null : (
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
            <ol className="flex flex-col gap-3">
              {record.messages?.map((message) => (
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
                        {new Date(message.createdAt).toLocaleString()}
                      </CardDescription>
                    </CardHeader>
                    <CardPanel>
                      <p className="whitespace-pre-wrap">
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
          </section>
          {canViewAttachments || canUpload ? (
            <section className="flex flex-col gap-3">
              <h2 className="font-medium">
                {t("portal:intake.attachments", {
                  defaultValue: "Attachments",
                })}
              </h2>
              {attachments.isLoading && (
                <p role="status">
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
              {canViewAttachments &&
                attachments.data?.map((file) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded border p-3"
                    key={file.id}
                  >
                    <span>
                      {file.filename} · {Math.ceil(file.size / 1024)} KB ·{" "}
                      {file.state}
                    </span>
                    {file.state === "pending" ? (
                      <Button
                        variant="outline"
                        onClick={() => finishUpload.mutate(file.id)}
                        disabled={finishUpload.isPending}
                      >
                        {t("portal:intake.completeUpload", {
                          defaultValue: "Finish upload",
                        })}
                      </Button>
                    ) : (
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
                                  portalSubmissionAttachmentPreviewPath(
                                    ref,
                                    file.id,
                                  ),
                                downloadPath:
                                  portalSubmissionAttachmentDownloadPath(
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
                          disabled={download.isPending}
                          onClick={() =>
                            download.mutate({
                              id: file.id,
                              filename: file.filename,
                            })
                          }
                        >
                          {t("portal:intake.download", {
                            defaultValue: "Download",
                          })}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              {record.version?.formSchema?.fields
                ?.filter((field) => field.type === "file" && canUpload)
                .map((field) => (
                  <label
                    className="flex flex-col gap-2"
                    htmlFor={`submission-file-${field.key}`}
                    key={field.key}
                  >
                    <span>
                      {field.label}
                      {field.multiple ? "" : " (one file)"}
                    </span>
                    <Input
                      id={`submission-file-${field.key}`}
                      type="file"
                      multiple={field.multiple}
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        const selected = field.multiple
                          ? files
                          : files.slice(0, 1);
                        for (const file of selected)
                          upload.mutate({ fieldKey: field.key, file });
                        event.target.value = "";
                      }}
                    />
                  </label>
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
          {requester && (state === "clarifying" || state === "accepted") && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                reply.mutate();
              }}
            >
              <label htmlFor="portal-reply">
                {t("portal:intake.reply", { defaultValue: "Reply" })}
              </label>
              <Textarea
                id="portal-reply"
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
              <Button type="submit" disabled={!body.trim() || reply.isPending}>
                {t("portal:intake.sendReply", { defaultValue: "Send reply" })}
              </Button>
            </form>
          )}
        </>
      )}
      <PdfPreviewDialog
        attachment={previewAttachment}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(undefined);
        }}
      />
    </main>
  );
}
