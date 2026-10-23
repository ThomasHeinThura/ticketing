// Both public package entries initialize the inherited bootstrap reader before use.
// send-email imports only smtp-execution, keeping this module graph acyclic.
import "./send-email";

export type {
  RuntimeSmtpResolver,
  SmtpConfiguration,
  SmtpSocket,
} from "./smtp-execution";
export {
  bootstrapSmtpConfiguration,
  executeSmtp,
  openSmtpSocket,
  resolveSmtpConfiguration,
  SmtpAttemptError,
  setRuntimeSmtpResolver,
} from "./smtp-execution";
