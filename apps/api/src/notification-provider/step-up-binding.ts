import { createHmac } from "node:crypto";
import { resolveAuthSecret } from "../utils/require-auth-secret";
import {
  type EmailProviderWrite,
  normaliseSmtpConfig,
  writeProviderSchema,
} from "./schema";

export const NOTIFICATION_PROVIDER_SAVE_OPERATION =
  "notification_provider_save" as const;
export const NOTIFICATION_PROVIDER_SAVE_ROUTE =
  "PATCH /api/instance/notification-providers/email" as const;

/**
 * The request the proof is bound to, derived on the server from the same body the route
 * validates; never retyped field by field in the client. The SMTP password is bound as a keyed
 * digest of the exact value (or as "keep" / "clear"), so a proof minted for one password cannot
 * be spent on another and the value itself never enters the binding, the audit log or the proof
 * tables. Defaults are filled in, so two spellings of the same settings bind identically.
 */
export function canonicalEmailProviderRequest(input: EmailProviderWrite) {
  const request = writeProviderSchema.parse({
    version: input.version,
    enabled: input.enabled,
    config: input.config,
    password: input.password,
  });
  const secret = resolveAuthSecret(process.env.TASKDESK_AUTH_SECRET);
  if (!secret.ok) throw new Error("Email provider verification unavailable");
  const password =
    request.password === undefined
      ? { intent: "keep" as const }
      : request.password === null
        ? { intent: "clear" as const }
        : {
            intent: "replace" as const,
            digest: createHmac("sha256", secret.secret)
              .update("taskdesk:notification-provider:password:v1\0")
              .update(request.password)
              .digest("hex"),
          };
  return {
    providerVersion: request.version,
    enabled: request.enabled,
    config: request.config ? normaliseSmtpConfig(request.config) : null,
    password,
  };
}
