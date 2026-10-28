import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "../openapi";
import { resolveAuthSecret } from "../utils/require-auth-secret";

export const preferenceSelectorSchema = z
  .object({
    eventKind: z.string().min(1).max(128),
    channel: z
      .string()
      .regex(/^notify\.[a-z][a-z0-9._-]*$/u)
      .max(128),
    scope: z.enum(["global", "workspace", "project"]),
    scopeId: z.string().min(1).max(128).nullable(),
  })
  .strict()
  .refine((v) => (v.scope === "global") === (v.scopeId === null));
export type PreferenceSelector = z.infer<typeof preferenceSelectorSchema>;
const claimsSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal("notification_pref"),
    audience: z.enum(["agent", "customer"]),
    recipientPersonId: z.string().min(1).max(128),
    selector: preferenceSelectorSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();
export type PreferenceLinkClaims = z.infer<typeof claimsSchema>;
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
function signature(payload: string): Buffer {
  const secret = resolveAuthSecret(process.env.TASKDESK_AUTH_SECRET);
  if (!secret.ok)
    throw new Error("Notification preference signing unavailable");
  return createHmac("sha256", secret.secret)
    .update("taskdesk:notification-pref:v1\0")
    .update(payload)
    .digest();
}
export function signNotificationPreferenceLink(
  input: {
    audience: "agent" | "customer";
    recipientPersonId: string;
    selector: PreferenceSelector;
  },
  now = Date.now(),
): string {
  const claims = claimsSchema.parse({
    ...input,
    version: 1,
    purpose: "notification_pref",
    issuedAt: now,
    expiresAt: now + LIFETIME_MS,
  });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function verifyNotificationPreferenceLink(
  token: string,
  audience: "agent" | "customer",
  now = Date.now(),
): PreferenceLinkClaims | null {
  try {
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token))
      return null;
    const [payload, supplied] = token.split(".");
    if (!payload || !supplied) return null;
    const decoded = Buffer.from(supplied, "base64url");
    const expected = signature(payload);
    if (
      decoded.length !== expected.length ||
      !timingSafeEqual(decoded, expected)
    )
      return null;
    const parsed = claimsSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    const claims = parsed.data;
    if (
      claims.audience !== audience ||
      claims.issuedAt > now ||
      claims.expiresAt <= now ||
      claims.expiresAt <= claims.issuedAt ||
      claims.expiresAt - claims.issuedAt > LIFETIME_MS
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}
