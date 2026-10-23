import type { EmailResult } from "../../../packages/email/src/send-email";

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

export async function sendWorkspaceInvitationEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<EmailResult> {
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
  resolveSmtpConfiguration,
  SmtpAttemptError,
  setRuntimeSmtpResolver,
} from "../../../packages/email/dist/smtp-runtime";
