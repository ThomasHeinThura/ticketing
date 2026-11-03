import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
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
  Skeleton,
} from "@taskdesk/ui";
import { ArrowLeft, Download } from "lucide-react";
import { useEffect } from "react";
import {
  PortalCaseSeverity,
  PortalCaseStatus,
  raisedByTeamLabel,
} from "@/components/portal/cases/portal-case-table";
import {
  formatPortalDateTime,
  formatPortalFileSize,
} from "@/components/portal/portal-format";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { PortalSlaStatus } from "@/components/portal/portal-sla-status";
import {
  type PortalReplyFileFailure,
  PortalReplyForm,
} from "@/components/portal/requests/portal-reply-form";
import {
  getPortalRequest,
  getPortalRequestFiles,
  type PortalRequestDetail,
  type PortalRequestFile,
  portalRequestFileUrl,
  replyToPortalRequest,
  uploadPortalRequestFile,
} from "@/fetchers/portal/requests";
import { invalidatePortalCaseViews } from "@/hooks/queries/portal/use-portal-cases";
import { HttpError } from "@/lib/http-error";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { messageAuthor } from "@/lib/portal-request";
import { routes } from "@/lib/routes";

function fieldValue(
  value: unknown,
  t: ReturnType<typeof usePortalTranslation>["t"],
) {
  if (value === true) return t("customFields:value.yes");
  if (value === false) return t("customFields:value.no");
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && value !== null)
    return Object.values(value).join(" ");
  return String(value ?? "");
}

/**
 * U-12 (D6): a request the team raised for the customer, opened from the case list. The same
 * Kaneo cards as the submission page: the request's facts, the public conversation, the
 * requester's files and a reply box that can carry files (A-08). Internal comments, the assignee
 * and internal fields never reach this page (CP-3, CP-4); a colleague or participant reads it
 * without replying or seeing files (CP-16).
 */
export function PortalRequestDetails({
  portalUserId,
  requestRef,
}: {
  portalUserId: string | undefined;
  requestRef: string;
}) {
  const { t, i18n } = usePortalTranslation("portal");
  const locale = i18n?.resolvedLanguage || i18n?.language || undefined;
  const queryClient = useQueryClient();
  const location = useLocation();
  const queryKey = ["portal", portalUserId, "request", requestRef] as const;
  const page = useQuery({
    queryKey,
    queryFn: () => getPortalRequest(requestRef),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status === 404) && count < 2,
  });
  const request = page.data;
  const files = useQuery({
    queryKey: [...queryKey, "files"],
    queryFn: () => getPortalRequestFiles(requestRef),
    enabled: request?.canViewAttachments === true,
  });
  const notFound = page.error instanceof HttpError && page.error.status === 404;

  // A notification link can carry `#comment-<id>`: bring that message into view.
  useEffect(() => {
    const raw = location.hash || window.location.hash;
    const hash = raw.startsWith("#") ? raw : `#${raw}`;
    const match = /^#comment-([A-Za-z0-9_-]{1,128})$/u.exec(hash);
    if (!match || !request?.messages.some((message) => message.id === match[1]))
      return;
    const target = document.getElementById(`comment-${match[1]}`);
    target?.scrollIntoView?.({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [location.hash, request?.messages]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      portalUserId
        ? invalidatePortalCaseViews(queryClient, portalUserId)
        : undefined,
    ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <PortalPageTitle
        title={
          notFound
            ? t("requestPage.notFound.title")
            : request
              ? `${request.title || request.requestTypeName} · ${request.ref}`
              : requestRef
        }
      />
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to={routes.portalRequests.path} />}
        >
          <ArrowLeft aria-hidden="true" />
          {t("requestPage.back")}
        </Button>
      </div>
      {notFound ? (
        <section className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl">
            {t("requestPage.notFound.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("requestPage.notFound.description")}
          </p>
        </section>
      ) : page.isError ? (
        <Alert variant="error">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("requestPage.loadFailed")}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void page.refetch()}
            >
              {t("common:actions.tryAgain")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !request ? (
        <div className="flex flex-col gap-4" role="status">
          <span className="sr-only">{t("common:empty.loading")}</span>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-2 border-b border-border pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words font-semibold text-2xl">
                {request.title || request.requestTypeName}
              </h1>
              <Badge variant="outline" className="font-mono">
                {request.ref}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {[request.requestTypeName, raisedByTeamLabel(request, t)].join(
                " · ",
              )}
            </p>
          </header>
          {request.canReply ? null : (
            <Alert variant="info">
              <AlertDescription>{t("request.readOnly")}</AlertDescription>
            </Alert>
          )}
          <RequestFacts request={request} locale={locale} />
          <Conversation request={request} locale={locale} />
          {request.canViewAttachments ? (
            <Files
              requestRef={request.ref}
              files={files.data}
              loading={files.isLoading}
              failed={files.isError}
              onRetry={() => void files.refetch()}
              locale={locale}
            />
          ) : null}
          {request.canReply ? (
            <PortalReplyForm
              canUpload={request.canUpload}
              send={(input) => sendRequestReply(request.ref, input)}
              onSent={refresh}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function RequestFacts({
  request,
  locale,
}: {
  request: PortalRequestDetail;
  locale: string | undefined;
}) {
  const { t } = usePortalTranslation("portal");
  return (
    <Card aria-label={t("request.details")}>
      <CardHeader>
        <CardTitle render={(props) => <h2 {...props} />}>
          {t("request.details")}
        </CardTitle>
      </CardHeader>
      <CardPanel>
        <div className="flex flex-col gap-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt>
                <CardDescription>{t("cases.columns.status")}</CardDescription>
              </dt>
              <dd className="flex flex-col items-start gap-1.5">
                <PortalCaseStatus status={request.customerStatus} />
                <PortalSlaStatus sla={request.sla} />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt>
                <CardDescription>{t("cases.columns.severity")}</CardDescription>
              </dt>
              <dd>
                <PortalCaseSeverity priority={request.priority} />
              </dd>
            </div>
            {request.project ? (
              <div className="flex flex-col gap-1">
                <dt>
                  <CardDescription>
                    {t("cases.columns.project")}
                  </CardDescription>
                </dt>
                <dd className="break-words text-sm">{request.project.name}</dd>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <dt>
                <CardDescription>{t("cases.columns.updated")}</CardDescription>
              </dt>
              <dd className="text-sm tabular-nums">
                <time dateTime={request.updatedAt}>
                  {formatPortalDateTime(request.updatedAt, locale)}
                </time>
              </dd>
            </div>
            {request.customFields.map((field) => (
              <div className="flex flex-col gap-1" key={field.key}>
                <dt>
                  <CardDescription>{field.label}</CardDescription>
                </dt>
                <dd className="break-words text-sm">
                  {fieldValue(field.value, t)}
                </dd>
              </div>
            ))}
          </dl>
          {request.description ? (
            <p className="whitespace-pre-wrap break-words text-sm">
              {request.description}
            </p>
          ) : null}
        </div>
      </CardPanel>
    </Card>
  );
}

function Conversation({
  request,
  locale,
}: {
  request: PortalRequestDetail;
  locale: string | undefined;
}) {
  const { t } = usePortalTranslation("portal");
  return (
    <section className="flex flex-col gap-3" aria-labelledby="request-thread">
      <h2 id="request-thread" className="font-medium">
        {t("intake.conversation")}
      </h2>
      {request.messages.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>
              {t("request.conversationEmpty")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col gap-3">
          {request.messages.map((message) => {
            const author = messageAuthor(message);
            return (
              <li
                key={message.id}
                id={`comment-${message.id}`}
                tabIndex={-1}
                className="scroll-m-4 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Card>
                  <CardHeader>
                    <CardDescription>
                      {"name" in author ? author.name : t(author.key)} ·{" "}
                      <time dateTime={message.createdAt}>
                        {formatPortalDateTime(message.createdAt, locale)}
                      </time>
                    </CardDescription>
                  </CardHeader>
                  <CardPanel>
                    <p className="whitespace-pre-wrap break-words">
                      {message.body}
                    </p>
                  </CardPanel>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Files({
  requestRef,
  files,
  loading,
  failed,
  onRetry,
  locale,
}: {
  requestRef: string;
  files: PortalRequestFile[] | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  locale: string | undefined;
}) {
  const { t } = usePortalTranslation("portal");
  const ready = (files ?? []).filter((file) => file.state === "ready");
  return (
    <section className="flex flex-col gap-3" aria-labelledby="request-files">
      <h2 id="request-files" className="font-medium">
        {t("intake.attachments")}
      </h2>
      {loading ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("common:empty.loading")}
        </p>
      ) : failed ? (
        <Alert variant="error">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("intake.attachmentListError")}</span>
            <Button size="sm" variant="outline" onClick={onRetry}>
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : ready.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>{t("request.attachmentsEmpty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {ready.map((file) => (
            <li
              key={file.id}
              className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium text-sm">
                  {file.filename}
                </span>
                <span className="text-muted-foreground text-xs">
                  {[
                    formatPortalFileSize(file.size),
                    file.mine
                      ? t("request.author.you")
                      : t("requestPage.sharedByTeam"),
                    formatPortalDateTime(file.createdAt, locale),
                  ].join(" · ")}
                </span>
                {file.downloadable ? null : (
                  <span className="text-muted-foreground text-xs">
                    {t("requestPage.fileNotDownloadable")}
                  </span>
                )}
              </span>
              {/* A file the portal cannot serve yet (still uploading) is listed without a download. */}
              {file.downloadable ? (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("requestPage.download", {
                    name: file.filename,
                  })}
                  render={
                    <a href={portalRequestFileUrl(requestRef, file.id)} />
                  }
                >
                  <Download aria-hidden="true" />
                  {t("intake.download")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A-08: post the reply, then attach each staged file to it; a file that fails is reported. */
async function sendRequestReply(
  ref: string,
  input: { body: string; files: File[] },
): Promise<PortalReplyFileFailure[]> {
  const posted = await replyToPortalRequest({ ref, body: input.body });
  const failures: PortalReplyFileFailure[] = [];
  for (const file of input.files) {
    try {
      await uploadPortalRequestFile({
        ref,
        commentId: posted.message.id,
        file,
      });
    } catch (error) {
      failures.push({
        name: file.name,
        reason:
          error instanceof HttpError && error.status < 500 && error.message
            ? error.message
            : null,
      });
    }
  }
  return failures;
}
