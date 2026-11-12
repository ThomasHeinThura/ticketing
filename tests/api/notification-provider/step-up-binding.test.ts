import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type EmailProviderWrite,
  smtpConfigurationSchema,
} from "../../../apps/api/src/notification-provider/schema";
import { canonicalEmailProviderRequest } from "../../../apps/api/src/notification-provider/step-up-binding";

const config = smtpConfigurationSchema.parse({
  provider: "ses",
  region: "eu-west-1",
  host: "email-smtp.eu-west-1.amazonaws.com",
  port: 587,
  secure: false,
  requireTLS: true,
  username: "synthetic-ses-user",
  fromAddress: "noreply@example.test",
  replyTo: null,
});
const request: EmailProviderWrite = { version: 3, enabled: true, config };

afterEach(() => vi.unstubAllEnvs());

describe("email provider save proof canonicalization", () => {
  it("binds the version, the enabled flag, the settings and the password intent", () => {
    vi.stubEnv("TASKDESK_AUTH_SECRET", "a".repeat(64));
    const keep = canonicalEmailProviderRequest(request);
    expect(keep.password).toEqual({ intent: "keep" });
    expect(keep.providerVersion).toBe(3);
    expect(keep.config).toMatchObject({ provider: "ses", region: "eu-west-1" });
    expect(
      canonicalEmailProviderRequest({ ...request, password: undefined }),
    ).toEqual(keep);
    expect(
      canonicalEmailProviderRequest({ ...request, version: 4 }),
    ).not.toEqual(keep);
    expect(
      canonicalEmailProviderRequest({ ...request, enabled: false }),
    ).not.toEqual(keep);
    expect(
      canonicalEmailProviderRequest({
        ...request,
        config: { ...config, fromAddress: "other@example.test" },
      }),
    ).not.toEqual(keep);
    expect(
      canonicalEmailProviderRequest({
        ...request,
        config: { ...config, username: "other-user" },
      }),
    ).not.toEqual(keep);
    expect(
      canonicalEmailProviderRequest({ version: 3, enabled: true }).config,
    ).toBeNull();
  });

  it("binds the password only as clear or as a keyed digest of the exact value", () => {
    vi.stubEnv("TASKDESK_AUTH_SECRET", "a".repeat(64));
    const cleared = canonicalEmailProviderRequest({
      ...request,
      password: null,
    });
    expect(cleared.password).toEqual({ intent: "clear" });
    const replaced = canonicalEmailProviderRequest({
      ...request,
      password: "synthetic-smtp-password-1",
    });
    expect(replaced.password).toMatchObject({ intent: "replace" });
    expect(JSON.stringify(replaced)).not.toContain("synthetic-smtp-password");
    expect(replaced).not.toEqual(canonicalEmailProviderRequest(request));
    expect(replaced).not.toEqual(cleared);
    expect(
      canonicalEmailProviderRequest({
        ...request,
        password: "synthetic-smtp-password-2",
      }),
    ).not.toEqual(replaced);
    // A different server secret yields a different digest: it cannot be computed elsewhere.
    vi.stubEnv("TASKDESK_AUTH_SECRET", "b".repeat(64));
    expect(
      canonicalEmailProviderRequest({
        ...request,
        password: "synthetic-smtp-password-1",
      }),
    ).not.toEqual(replaced);
  });

  it("treats omitted provider defaults and explicit ones as the same settings", () => {
    vi.stubEnv("TASKDESK_AUTH_SECRET", "a".repeat(64));
    const plain = {
      host: "smtp.example.test",
      port: 587,
      secure: false,
      requireTLS: true,
      username: null,
      fromAddress: "noreply@example.test",
      replyTo: null,
    };
    expect(
      canonicalEmailProviderRequest({
        version: 0,
        enabled: true,
        config: smtpConfigurationSchema.parse(plain),
      }),
    ).toEqual(
      canonicalEmailProviderRequest({
        version: 0,
        enabled: true,
        config: smtpConfigurationSchema.parse({
          ...plain,
          provider: "smtp",
          region: null,
          captureToMailpit: false,
        }),
      }),
    );
  });

  it("is unavailable without a usable server secret", () => {
    vi.stubEnv("TASKDESK_AUTH_SECRET", "");
    expect(() => canonicalEmailProviderRequest(request)).toThrow(
      "Email provider verification unavailable",
    );
  });

  it("nests the write under request so the SMTP password never collides with a password step-up factor", async () => {
    const { extChallengeSchemas, extProveSchemas } = await import(
      "../../../apps/api/src/auth/step-up-ext"
    );
    const challengeUnion = extChallengeSchemas;
    const proveUnion = extProveSchemas;
    for (const smtpPassword of [
      undefined,
      null,
      "synthetic-smtp-secret",
    ] as const) {
      const write =
        smtpPassword === undefined
          ? { version: 3, enabled: true, config }
          : { version: 3, enabled: true, config, password: smtpPassword };
      const challengePayload = {
        kind: "operation" as const,
        operation: "notification_provider_save" as const,
        request: write,
      };
      const matchedChallenges = challengeUnion.filter(
        (schema) => schema.safeParse(challengePayload).success,
      );
      expect(matchedChallenges).toHaveLength(1);

      const provePayload = {
        ...challengePayload,
        challengeId: "challenge-1",
        nonce: "n".repeat(43),
        method: "password" as const,
        password: "synthetic-admin-password",
      };
      const matchedProofs = proveUnion
        .map((schema) => schema.safeParse(provePayload))
        .filter((parsed) => parsed.success);
      expect(matchedProofs).toHaveLength(1);
      expect(matchedProofs[0]?.data).toMatchObject({
        password: "synthetic-admin-password",
        request:
          smtpPassword === undefined
            ? { version: 3, enabled: true }
            : { version: 3, enabled: true, password: smtpPassword },
      });
    }
  });
});
