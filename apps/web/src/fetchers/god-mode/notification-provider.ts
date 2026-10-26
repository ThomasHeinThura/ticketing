import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError, readErrorDetail } from "@/lib/http-error";

const provider = client.instance["notification-providers"].email;
const SMTP_DIAGNOSTIC_CODES = [
  "smtp_authentication_failed",
  "smtp_connection_failed",
  "smtp_tls_failed",
  "smtp_timeout",
] as const;
type SmtpDiagnosticCode = (typeof SMTP_DIAGNOSTIC_CODES)[number];

export function safeSmtpDiagnosticCode(
  detail: string,
): SmtpDiagnosticCode | "smtp_verification_failed" {
  return SMTP_DIAGNOSTIC_CODES.some((code) => code === detail)
    ? (detail as SmtpDiagnosticCode)
    : "smtp_verification_failed";
}

export function smtpDiagnosticTranslationKey(detail: string): string {
  const code = safeSmtpDiagnosticCode(detail);
  return code === "smtp_verification_failed"
    ? "operationFailed"
    : `diagnostics.${code}`;
}

export type EmailProvider = InferResponseType<typeof provider.$get, 200>;
export type EmailProviderConfig = NonNullable<EmailProvider["config"]>;
export type EmailProviderInput = {
  version: number;
  enabled: boolean;
  config?: EmailProviderConfig;
  password?: string | null;
};
async function requireOk(response: Response) {
  if (!response.ok)
    throw new HttpError(response.status, "Email provider request failed");
}
export async function getEmailProvider(): Promise<EmailProvider> {
  const response = await provider.$get();
  await requireOk(response);
  return response.json();
}
export async function saveEmailProvider(
  input: EmailProviderInput,
): Promise<EmailProvider> {
  const response = await provider.$patch({ json: input });
  await requireOk(response);
  return response.json();
}
export async function verifyEmailProvider(
  input: Omit<EmailProviderInput, "enabled">,
) {
  const response = await provider.test.$post({ json: input });
  await requireVerificationOk(response);
  return response.json();
}

async function requireVerificationOk(response: Response) {
  if (response.status === 502) {
    const detail = await readErrorDetail(response);
    throw new HttpError(502, safeSmtpDiagnosticCode(detail));
  }
  await requireOk(response);
}
