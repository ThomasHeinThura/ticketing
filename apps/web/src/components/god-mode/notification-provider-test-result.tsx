import { Alert, AlertDescription, AlertTitle, Badge } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type {
  EmailProviderKind,
  EmailTestResult,
  EmailTestStatus,
} from "@/fetchers/god-mode/notification-provider";

type FailureCategory = Extract<EmailTestResult, { ok: false }>["category"];
/** Categories Amazon SES has its own, more specific wording for. */
const SES_CATEGORIES: ReadonlySet<FailureCategory> = new Set([
  "authentication",
  "message_rejected",
  "throttled",
  "starttls_required",
]);

/** The sentence that explains one failure category; Amazon SES gets its own where it helps. */
function useFailureMessage() {
  const { t } = useTranslation("notificationProvider");
  return (category: FailureCategory, provider: EmailProviderKind) =>
    provider === "ses" && SES_CATEGORIES.has(category)
      ? t(`failureSes.${category}`)
      : t(`failure.${category}`);
}

function useTimeLabel() {
  const { i18n } = useTranslation();
  return (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? iso
      : new Intl.DateTimeFormat(i18n.language, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
  };
}

/** Verified / Failed / Never tested / Not tested since change, with when and what happened. */
export function TestStatusLine({ status }: { status: EmailTestStatus }) {
  const { t } = useTranslation("notificationProvider");
  const timeLabel = useTimeLabel();
  const variant =
    status.state === "verified"
      ? "success"
      : status.state === "failed"
        ? "error"
        : status.state === "stale"
          ? "warning"
          : "outline";
  const result =
    status.state === "verified"
      ? t("status.resultVerified")
      : status.category
        ? status.smtpCode === null
          ? t("status.resultFailed", {
              reason: t(`failureShort.${status.category}`),
            })
          : t("status.resultFailedCode", {
              reason: t(`failureShort.${status.category}`),
              code: status.smtpCode,
            })
        : null;
  return (
    <p
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      data-testid="email-test-status"
    >
      <Badge variant={variant}>{t(`status.${status.state}`)}</Badge>
      {status.testedAt && result ? (
        <span className="text-muted-foreground">
          {t("status.lastTested", {
            time: timeLabel(status.testedAt),
            result,
          })}
        </span>
      ) : null}
    </p>
  );
}

/** What the last test send did, with the SMTP reply code and the server's sanitised text. */
export function TestResultAlert({
  result,
  provider,
}: {
  result: EmailTestResult;
  provider: EmailProviderKind;
}) {
  const { t } = useTranslation("notificationProvider");
  const failureMessage = useFailureMessage();
  if (result.ok)
    return (
      <Alert variant="success" role="status">
        <AlertTitle>{t("status.verified")}</AlertTitle>
        <AlertDescription>
          <p>{t("testSend.sent")}</p>
          {result.persisted ? null : <p>{t("testSend.notSaved")}</p>}
        </AlertDescription>
      </Alert>
    );
  const reply =
    result.smtpCode !== null && result.providerText
      ? t("testSend.replyWithCode", {
          code: result.smtpCode,
          text: result.providerText,
        })
      : result.smtpCode !== null
        ? t("testSend.replyCodeOnly", { code: result.smtpCode })
        : result.providerText
          ? t("testSend.replyTextOnly", { text: result.providerText })
          : null;
  return (
    <Alert variant="error">
      <AlertTitle>{t("testSend.failedTitle")}</AlertTitle>
      <AlertDescription>
        <p>{failureMessage(result.category, provider)}</p>
        {reply ? <p data-testid="email-test-reply">{reply}</p> : null}
        {result.persisted ? null : <p>{t("testSend.notSaved")}</p>}
      </AlertDescription>
    </Alert>
  );
}
