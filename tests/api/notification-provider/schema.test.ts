import { describe, expect, it } from "vitest";
import {
  emailProviderKind,
  emailTestStatus,
  normaliseSmtpConfig,
  parseStoredEmailConfig,
  sameSmtpConfig,
  smtpConfigurationSchema,
  smtpSettingsFormManifest,
  storedEmailConfig,
  testProviderSchema,
  writeProviderSchema,
} from "../../../apps/api/src/notification-provider/schema";
import {
  SES_SMTP_REGIONS,
  sesSmtpHost,
  sesSmtpRegionOptions,
  sesSmtpSettings,
} from "../../../apps/api/src/notification-provider/ses";

const customSmtp = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  requireTLS: true,
  username: "mailer",
  fromAddress: "noreply@example.test",
  replyTo: null,
};
const ses = {
  ...customSmtp,
  provider: "ses" as const,
  region: "eu-west-1" as const,
  host: "email-smtp.eu-west-1.amazonaws.com",
  username: "synthetic-ses-user",
};

describe("Amazon SES settings derivation", () => {
  it("derives the SMTP endpoint, port 587 and STARTTLS from the region", () => {
    expect(sesSmtpHost("eu-west-1")).toBe("email-smtp.eu-west-1.amazonaws.com");
    expect(sesSmtpSettings("us-east-2")).toEqual({
      host: "email-smtp.us-east-2.amazonaws.com",
      port: 587,
      secure: false,
      requireTLS: true,
    });
    expect(sesSmtpRegionOptions()).toHaveLength(SES_SMTP_REGIONS.length);
    expect(sesSmtpRegionOptions()[0]).toEqual({
      region: "us-east-1",
      host: "email-smtp.us-east-1.amazonaws.com",
    });
  });

  it("offers only regions that publish an SMTP endpoint", () => {
    expect(new Set(SES_SMTP_REGIONS).size).toBe(SES_SMTP_REGIONS.length);
    // The SES API exists in these regions but AWS publishes no SMTP endpoint for them.
    for (const absent of [
      "af-south-1",
      "ap-south-2",
      "ap-southeast-3",
      "eu-south-1",
      "eu-central-2",
      "il-central-1",
      "me-south-1",
      "me-central-1",
      "ca-west-1",
      "ap-southeast-5",
    ])
      expect(SES_SMTP_REGIONS).not.toContain(absent);
  });
});

describe("email provider settings schema", () => {
  it("keeps accepting settings saved before Amazon SES existed", () => {
    const parsed = smtpConfigurationSchema.parse(customSmtp);
    expect(emailProviderKind(parsed)).toBe("smtp");
    expect(
      smtpConfigurationSchema.safeParse({
        ...customSmtp,
        provider: "smtp",
        region: null,
      }).success,
    ).toBe(true);
  });

  it("accepts an SES configuration only when the connection is exactly what its region derives", () => {
    expect(smtpConfigurationSchema.safeParse(ses).success).toBe(true);
    const refused = (override: Record<string, unknown>) =>
      smtpConfigurationSchema.safeParse({ ...ses, ...override }).success;
    expect(refused({ host: "smtp.example.test" })).toBe(false);
    expect(
      refused({ host: "email-smtp.eu-west-1.amazonaws.com.evil.test" }),
    ).toBe(false);
    expect(refused({ host: "email-smtp.us-east-1.amazonaws.com" })).toBe(false);
    expect(refused({ port: 465 })).toBe(false);
    expect(refused({ port: 25 })).toBe(false);
    expect(refused({ secure: true })).toBe(false);
    expect(refused({ requireTLS: false })).toBe(false);
    expect(refused({ username: null })).toBe(false);
    expect(refused({ region: null })).toBe(false);
    expect(refused({ region: undefined })).toBe(false);
    expect(refused({ region: "af-south-1" })).toBe(false);
    expect(refused({ region: "eu-west-1.evil.test" })).toBe(false);
    expect(refused({ captureToMailpit: true })).toBe(false);
  });

  it("refuses a region on a custom SMTP configuration and an unknown provider", () => {
    expect(
      smtpConfigurationSchema.safeParse({ ...customSmtp, region: "eu-west-1" })
        .success,
    ).toBe(false);
    expect(
      smtpConfigurationSchema.safeParse({ ...customSmtp, provider: "sendgrid" })
        .success,
    ).toBe(false);
  });

  it("never lets a client write the server-owned test status", () => {
    const lastTest = {
      state: "verified",
      testedAt: "2026-11-12T10:00:00.000Z",
      smtpCode: null,
      category: null,
    };
    expect(
      smtpConfigurationSchema.safeParse({ ...customSmtp, lastTest }).success,
    ).toBe(false);
    expect(
      writeProviderSchema.safeParse({
        version: 1,
        enabled: true,
        config: { ...customSmtp, lastTest },
      }).success,
    ).toBe(false);
  });

  it("requires a well-formed recipient for the test send", () => {
    const base = { version: 0, config: customSmtp };
    expect(
      testProviderSchema.safeParse({ ...base, recipient: "admin@example.test" })
        .success,
    ).toBe(true);
    for (const recipient of [
      undefined,
      "",
      "not-an-address",
      "a@example.test\r\nBcc: other@example.test",
      `${"a".repeat(320)}@example.test`,
    ])
      expect(testProviderSchema.safeParse({ ...base, recipient }).success).toBe(
        false,
      );
  });

  it("publishes provider and region in the settings form manifest", () => {
    const manifest = smtpSettingsFormManifest();
    if (!manifest.available) throw new Error("manifest unavailable");
    const fields = Object.fromEntries(
      manifest.fields.map((field) => [field.key, field]),
    );
    expect(fields["config.provider"]).toMatchObject({
      control: "text",
      group: "config",
      required: false,
    });
    expect(fields["config.region"]).toMatchObject({
      control: "text",
      group: "config",
      required: false,
      nullable: true,
    });
  });
});

describe("stored email configuration", () => {
  const lastTest = {
    state: "verified" as const,
    testedAt: "2026-11-12T10:00:00.000Z",
    smtpCode: null,
    category: null,
  };

  it("separates the settings from the server-written test status", () => {
    const stored = storedEmailConfig(
      smtpConfigurationSchema.parse(ses),
      lastTest,
    );
    expect(stored.lastTest).toEqual(lastTest);
    const parsed = parseStoredEmailConfig(stored);
    expect(parsed?.lastTest).toEqual(lastTest);
    expect(parsed?.config).toEqual(ses);
    expect(parsed?.config).not.toHaveProperty("lastTest");
    expect(parseStoredEmailConfig(customSmtp)?.lastTest).toBeNull();
  });

  it("rejects a stored document that is not valid settings", () => {
    expect(parseStoredEmailConfig({})).toBeNull();
    expect(parseStoredEmailConfig({ ...customSmtp, extra: true })).toBeNull();
    expect(
      parseStoredEmailConfig({ ...ses, host: "smtp.example.test" }),
    ).toBeNull();
    expect(
      parseStoredEmailConfig({
        ...customSmtp,
        lastTest: { ...lastTest, state: "unknown" },
      }),
    ).toBeNull();
  });

  it("reports never-tested when there is no stored result", () => {
    expect(emailTestStatus(null)).toEqual({
      state: "never",
      testedAt: null,
      smtpCode: null,
      category: null,
    });
    expect(emailTestStatus(lastTest)).toEqual(lastTest);
  });

  it("compares settings with their defaults filled in", () => {
    const base = smtpConfigurationSchema.parse(customSmtp);
    expect(
      sameSmtpConfig(
        base,
        smtpConfigurationSchema.parse({
          ...customSmtp,
          provider: "smtp",
          region: null,
          captureToMailpit: false,
        }),
      ),
    ).toBe(true);
    expect(
      sameSmtpConfig(
        base,
        smtpConfigurationSchema.parse({ ...customSmtp, port: 2525 }),
      ),
    ).toBe(false);
    expect(sameSmtpConfig(base, smtpConfigurationSchema.parse(ses))).toBe(
      false,
    );
    expect(normaliseSmtpConfig(base)).toMatchObject({
      provider: "smtp",
      region: null,
      captureToMailpit: false,
    });
  });
});
