import { resolveSmtpConfiguration as realResolveSmtpConfiguration } from "../../../packages/email/dist/smtp-runtime";
import type {
  EmailResult,
  WorkspaceInvitationSendOptions,
} from "../../../packages/email/src/send-email";

export async function sendMagicLinkEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<void> {
  return undefined;
}

export async function sendOtpEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<void> {
  return undefined;
}

/** Every invitation email handed to the mailer, so a test can read the link a recipient would. */
export const sentWorkspaceInvitationEmails: {
  to: string;
  subject: string;
  data: Record<string, unknown>;
  options: WorkspaceInvitationSendOptions;
}[] = [];
export const workspaceInvitationPreflightResults: boolean[] = [];

/** Test switches: whether an email provider exists, and whether a send throws at the transport. */
export const emailMock: {
  /** null keeps the real resolver (no provider unless a test installs one). */
  configured: boolean | null;
  failTransport: boolean;
} = { configured: null, failTransport: false };

export async function resolveSmtpConfiguration() {
  if (emailMock.configured === null) return realResolveSmtpConfiguration();
  return emailMock.configured
    ? ({ from: "noreply@example.test" } as never)
    : null;
}

export async function sendWorkspaceInvitationEmail(
  to: string,
  subject: string,
  data: unknown,
  options: WorkspaceInvitationSendOptions = {},
): Promise<EmailResult> {
  if (emailMock.configured === false)
    return { success: false, reason: "SMTP_NOT_CONFIGURED" };
  if (options.beforeSend) {
    const allowed = await options.beforeSend();
    workspaceInvitationPreflightResults.push(allowed);
    if (!allowed) return { success: false, reason: "NOT_AUTHORIZED" };
  }
  if (emailMock.failTransport) throw new Error("transport failure");
  sentWorkspaceInvitationEmails.push({
    to,
    subject,
    data: (data ?? {}) as Record<string, unknown>,
    options,
  });
  return { success: true };
}

export function isSmtpConfigured(): boolean {
  return false;
}

export type {
  RuntimeSmtpResolver,
  SmtpConfiguration,
  SmtpSocket,
} from "../../../packages/email/dist/smtp-runtime";
export {
  bootstrapSmtpConfiguration,
  executeSmtp,
  openSmtpSocket,
  SmtpAttemptError,
  setRuntimeSmtpResolver,
} from "../../../packages/email/dist/smtp-runtime";
