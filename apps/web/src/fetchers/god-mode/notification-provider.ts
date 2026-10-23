import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const provider = client.instance["notification-providers"].email;
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
  await requireOk(response);
  return response.json();
}
