import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  signNotificationPreferenceLink,
  verifyNotificationPreferenceLink,
} from "../../../apps/api/src/notification/preference-link";

const now = Date.parse("2026-10-22T10:00:00Z");
const input = {
  audience: "agent" as const,
  recipientPersonId: "synthetic-person",
  selector: {
    eventKind: "work_item.mentioned",
    channel: "notify.email",
    scope: "global" as const,
    scopeId: null,
  },
};
afterEach(() => vi.unstubAllEnvs());
describe("single-purpose notification preference links", () => {
  it("binds recipient, exact selector, audience and thirty-day expiration", () => {
    vi.stubEnv(
      "TASKDESK_AUTH_SECRET",
      "synthetic-signing-secret-at-least-32-bytes",
    );
    const token = signNotificationPreferenceLink(input, now);
    expect(
      verifyNotificationPreferenceLink(token, "agent", now + 1),
    ).toMatchObject({ ...input, purpose: "notification_pref" });
    expect(
      verifyNotificationPreferenceLink(token, "customer", now + 1),
    ).toBeNull();
    expect(
      verifyNotificationPreferenceLink(token, "agent", now - 1),
    ).toBeNull();
    expect(
      verifyNotificationPreferenceLink(token, "agent", now + 30 * 86400000),
    ).toBeNull();
    const [payload, signature] = token.split(".");
    const altered = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload ?? "", "base64url").toString()),
        recipientPersonId: "someone-else",
      }),
    ).toString("base64url");
    expect(
      verifyNotificationPreferenceLink(`${altered}.${signature}`, "agent", now),
    ).toBeNull();
    expect(
      verifyNotificationPreferenceLink(`${payload}.invalid`, "agent", now),
    ).toBeNull();
    vi.stubEnv(
      "TASKDESK_AUTH_SECRET",
      "different-synthetic-signing-secret-32-bytes",
    );
    expect(verifyNotificationPreferenceLink(token, "agent", now)).toBeNull();
  });
  it("rejects correctly signed tokens with another purpose or an overlong lifetime", () => {
    const secret = "synthetic-signing-secret-at-least-32-bytes"; // gitleaks:allow test fixture, not a secret
    vi.stubEnv("TASKDESK_AUTH_SECRET", secret);
    const token = signNotificationPreferenceLink(input, now);
    const payload = token.split(".")[0] ?? "";
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    for (const changes of [
      { purpose: "password_reset" },
      { expiresAt: now + 31 * 86400000 },
    ]) {
      const altered = Buffer.from(
        JSON.stringify({ ...claims, ...changes }),
      ).toString("base64url");
      const mac = createHmac("sha256", secret)
        .update("taskdesk:notification-pref:v1\0")
        .update(altered)
        .digest("base64url");
      expect(
        verifyNotificationPreferenceLink(`${altered}.${mac}`, "agent", now),
      ).toBeNull();
    }
  });
  it("refuses malformed tokens, invalid scope binding and missing signing key", () => {
    vi.stubEnv("TASKDESK_AUTH_SECRET", "");
    expect(() => signNotificationPreferenceLink(input, now)).toThrow(
      "signing unavailable",
    );
    expect(
      verifyNotificationPreferenceLink("malformed", "agent", now),
    ).toBeNull();
    vi.stubEnv(
      "TASKDESK_AUTH_SECRET",
      "synthetic-signing-secret-at-least-32-bytes",
    );
    expect(() =>
      signNotificationPreferenceLink(
        {
          ...input,
          selector: { ...input.selector, scope: "project", scopeId: null },
        },
        now,
      ),
    ).toThrow();
  });
});
