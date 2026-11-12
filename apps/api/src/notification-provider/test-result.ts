import { SmtpAttemptError } from "@taskdesk/email/smtp-runtime";
import type { SmtpTestFailureCategory } from "./schema";

/** The fixed content of the test message: the administrator only chooses the recipient. */
export const TEST_EMAIL_SUBJECT = "TaskDesk test email";
export const TEST_EMAIL_TEXT =
  "This is a test message from TaskDesk. Your email settings can send mail; no action is needed.";

export type SmtpTestFailure = {
  category: SmtpTestFailureCategory;
  smtpCode: number | null;
  /** The provider's reply with addresses, hosts, IPs and credentials already removed. */
  providerText: string | null;
};

/** Only the part after the last `@`; the address itself is never recorded or echoed. */
export function recipientDomain(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * Turns a failed attempt into one bounded category plus the SMTP reply code and the sanitised
 * provider text. The category, not the text, decides what the administrator is told; the text is
 * shown as an aside. Anything unrecognised is `failed` with no detail rather than a guess.
 */
export function classifySmtpTestFailure(error: unknown): SmtpTestFailure {
  if (!(error instanceof SmtpAttemptError))
    return { category: "failed", smtpCode: null, providerText: null };
  const code = error.reply?.code ?? null;
  const providerText = error.reply?.text ?? null;
  const command = error.reply?.command ?? null;
  const done = (category: SmtpTestFailureCategory): SmtpTestFailure => ({
    category,
    smtpCode: code,
    providerText,
  });
  if (error.kind === "deadline") return done("timeout");
  if (code !== null) {
    if (code === 530 || command === "STARTTLS")
      return done("starttls_required");
    if (command?.startsWith("AUTH"))
      return done(code >= 500 ? "authentication" : "temporary");
    if (code === 535) return done("authentication");
    if (code === 454) return done("throttled");
    if (code === 554) return done("message_rejected");
    return done(code >= 500 ? "rejected" : "temporary");
  }
  if (error.diagnostic === "authentication") return done("authentication");
  if (error.diagnostic === "connection") return done("connection");
  if (error.diagnostic === "tls") return done("tls");
  if (error.kind === "rejected") return done("rejected");
  return done("failed");
}
