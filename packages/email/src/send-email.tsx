import { render } from "@react-email/components";
import { config } from "dotenv-mono";
import { getSmtpTransportOptions, isSmtpConfigured } from "./smtp-config";
import {
  executeSmtp,
  resolveSmtpConfiguration,
  SmtpAttemptError,
  setBootstrapSmtpConfigurationResolver,
} from "./smtp-execution";
import type { MagicLinkEmailProps } from "./templates/magic-link";
import MagicLinkEmail from "./templates/magic-link";
import NotificationEmail, {
  type NotificationEmailProps,
} from "./templates/notification";
import type { OtpEmailProps } from "./templates/otp";
import OtpEmail from "./templates/otp";
import PasswordResetEmail, {
  type PasswordResetEmailProps,
} from "./templates/password-reset";
import TrialReminderEmail, {
  type TrialReminderEmailProps,
} from "./templates/trial-reminder";
import WorkspaceInvitationEmail, {
  type WorkspaceInvitationEmailProps,
} from "./templates/workspace-invitation";

config();
setBootstrapSmtpConfigurationResolver(() => {
  if (!isSmtpConfigured()) return null;
  return {
    options: getSmtpTransportOptions(),
    from: process.env.SMTP_FROM ?? "",
  };
});

async function sendRendered(
  to: string,
  subject: string,
  html: string,
  options: {
    signal?: AbortSignal;
    deadlineMs?: number;
    idempotencyKey?: string;
  } = {},
) {
  const smtp = await resolveSmtpConfiguration();
  if (!smtp) return false;
  await executeSmtp(
    smtp,
    { to, subject, html, idempotencyKey: options.idempotencyKey },
    options,
  );
  return true;
}

export const sendMagicLinkEmail = async (
  to: string,
  subject: string,
  data: MagicLinkEmailProps,
) => {
  const emailTemplate = await render(MagicLinkEmail(data));
  if (!(await sendRendered(to, subject, emailTemplate)))
    throw new SmtpAttemptError("unavailable");
};

export const sendOtpEmail = async (
  to: string,
  subject: string,
  data: OtpEmailProps,
) => {
  const emailTemplate = await render(OtpEmail(data));
  if (!(await sendRendered(to, subject, emailTemplate)))
    throw new SmtpAttemptError("unavailable");
};

export const sendPasswordResetEmail = async (
  to: string,
  subject: string,
  data: PasswordResetEmailProps,
) => {
  const emailTemplate = await render(PasswordResetEmail(data));
  if (!(await sendRendered(to, subject, emailTemplate)))
    throw new SmtpAttemptError("unavailable");
};

export type EmailResult = {
  success: boolean;
  reason?: "SMTP_NOT_CONFIGURED" | "NOT_AUTHORIZED";
};

export type WorkspaceInvitationSendOptions = {
  /** Bounded worker deadline; omitted callers retain the established 25 second default. */
  deadlineMs?: number;
  /** Stable transport Message-ID key for retry deduplication where the provider supports it. */
  idempotencyKey?: string;
  /** A final worker-owned delivery check after rendering and SMTP configuration resolution. */
  beforeSend?: () => Promise<boolean>;
};

export type NotificationEmailSendOptions = {
  /** Rechecked after rendering and immediately before handing the message to SMTP. */
  authorize?: () => Promise<boolean>;
  signal?: AbortSignal;
  deadlineMs?: number;
  idempotencyKey?: string;
};

export const sendWorkspaceInvitationEmail = async (
  to: string,
  subject: string,
  data: WorkspaceInvitationEmailProps,
  options: WorkspaceInvitationSendOptions = {},
): Promise<EmailResult> => {
  const emailTemplate = await render(WorkspaceInvitationEmail({ ...data, to }));
  const smtp = await resolveSmtpConfiguration();
  if (!smtp) return { success: false, reason: "SMTP_NOT_CONFIGURED" };
  if (options.beforeSend && !(await options.beforeSend()))
    return { success: false, reason: "NOT_AUTHORIZED" };
  await executeSmtp(
    smtp,
    {
      to,
      subject,
      html: emailTemplate,
      idempotencyKey: options.idempotencyKey,
    },
    options,
  );
  return { success: true };
};

export const sendNotificationEmail = async (
  to: string,
  subject: string,
  data: NotificationEmailProps,
  options: NotificationEmailSendOptions = {},
): Promise<EmailResult> => {
  const emailTemplate = await render(NotificationEmail(data));
  const smtp = await resolveSmtpConfiguration();
  if (!smtp) return { success: false, reason: "SMTP_NOT_CONFIGURED" };
  if (options.authorize && !(await options.authorize()))
    return { success: false, reason: "NOT_AUTHORIZED" };
  await executeSmtp(
    smtp,
    {
      to,
      subject,
      html: emailTemplate,
      idempotencyKey: options.idempotencyKey,
    },
    options,
  );
  return { success: true };
};

export const sendTrialReminderEmail = async (
  to: string,
  subject: string,
  data: TrialReminderEmailProps,
) => {
  const emailTemplate = await render(TrialReminderEmail(data));
  if (!(await sendRendered(to, subject, emailTemplate)))
    throw new SmtpAttemptError("unavailable");
};
