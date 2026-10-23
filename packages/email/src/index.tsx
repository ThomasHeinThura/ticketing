export type { NotificationEmailSendOptions } from "./send-email";
export {
  sendMagicLinkEmail,
  sendNotificationEmail,
  sendOtpEmail,
  sendPasswordResetEmail,
  sendTrialReminderEmail,
  sendWorkspaceInvitationEmail,
} from "./send-email";
export { isSmtpConfigured } from "./smtp-config";
export type {
  RuntimeSmtpResolver,
  SmtpConfiguration,
  SmtpSocket,
} from "./smtp-runtime";
export {
  bootstrapSmtpConfiguration,
  executeSmtp,
  openSmtpSocket,
  resolveSmtpConfiguration,
  SmtpAttemptError,
  setRuntimeSmtpResolver,
} from "./smtp-runtime";
