import { apiFetch, client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";
import { ensureIdentityAdminOk } from "./identity-admin-error";

const provider = client.instance["notification-providers"].email;

export type EmailProvider = InferResponseType<typeof provider.$get, 200>;
export type EmailProviderConfig = NonNullable<EmailProvider["config"]>;
export type EmailTestStatus = EmailProvider["testStatus"];
export type EmailProviderKind = NonNullable<EmailProviderConfig["provider"]>;
export type EmailTestResult = InferResponseType<
  typeof provider.test.$post,
  200
>;
export type EmailTestFailure = Extract<EmailTestResult, { ok: false }>;
export type EmailProviderInput = {
  version: number;
  enabled: boolean;
  config?: EmailProviderConfig;
  password?: string | null;
};
/** The unsaved form values and the address the test email goes to. */
export type EmailProviderTestInput = Omit<EmailProviderInput, "enabled"> & {
  recipient: string;
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
/**
 * Elevated: the single-use `token` is bound to exactly `input` (settings, enabled flag, version
 * and the password's keep/clear/replace intent), so the same object goes to the step-up challenge,
 * the proof and this write.
 */
export async function saveEmailProvider(
  input: EmailProviderInput,
  token: string,
): Promise<EmailProvider> {
  const response = await apiFetch(
    getApiUrl("instance/notification-providers/email"),
    {
      method: "PATCH",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-taskdesk-step-up-token": token,
      },
      body: JSON.stringify(input),
    },
  );
  await ensureIdentityAdminOk(response, "Email provider request failed");
  return (await response.json()) as EmailProvider;
}
/**
 * Sends a real test email. A delivery failure is an answer (`ok: false` with its category and the
 * server's sanitised reply), not an exception; only a refused request (409, 429, 5xx) throws.
 */
export async function sendEmailProviderTest(
  input: EmailProviderTestInput,
): Promise<EmailTestResult> {
  const response = await provider.test.$post({ json: input });
  // Only 200 carries a result; 429 and others carry an error body.
  if (response.status !== 200)
    throw new HttpError(response.status, "Email provider request failed");
  return response.json();
}
