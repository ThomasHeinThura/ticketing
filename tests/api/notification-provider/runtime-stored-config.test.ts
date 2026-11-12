import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
}));

vi.mock("../../../apps/api/src/notification-provider/repository", () => ({
  EMAIL_PLUGIN_ID: "notify.email",
  readEmailProvider: async () => mocks.row,
}));
vi.mock("../../../apps/api/src/identity/client-secret", () => ({
  decryptIdentityClientSecret: vi.fn(() => "placeholder-secret"),
}));

import { resolveRuntimeSmtp } from "../../../apps/api/src/notification-provider/runtime";

const ses = {
  provider: "ses",
  region: "eu-west-1",
  host: "email-smtp.eu-west-1.amazonaws.com",
  port: 587,
  secure: false,
  requireTLS: true,
  username: "synthetic-ses-user",
  fromAddress: "noreply@example.test",
  replyTo: null,
};
const lastTest = {
  state: "failed",
  testedAt: "2026-11-12T10:00:00.000Z",
  smtpCode: 535,
  category: "authentication",
};
function row(config: Record<string, unknown>) {
  return {
    id: "email-provider",
    enabled: true,
    config,
    secrets: Buffer.from("ciphertext"),
    scope: "instance",
    workspaceId: null,
    portalScope: null,
  };
}

beforeEach(() => {
  mocks.row = null;
});

describe("runtime resolution of the stored email configuration", () => {
  it("keeps delivering mail when the row also carries a saved test result", async () => {
    // The strict settings schema rejects an unknown key; a saved test status must never switch
    // off every password-reset and invitation email.
    for (const config of [ses, { ...ses, lastTest }]) {
      mocks.row = row(config);
      const resolved = await resolveRuntimeSmtp();
      expect(resolved?.options).toMatchObject({
        host: "email-smtp.eu-west-1.amazonaws.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "synthetic-ses-user", pass: "placeholder-secret" },
      });
      expect(resolved?.from).toBe("noreply@example.test");
    }
  });

  it("resolves settings saved before Amazon SES existed", async () => {
    mocks.row = row({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      requireTLS: true,
      username: "mailer",
      fromAddress: "noreply@example.test",
      replyTo: null,
    });
    expect((await resolveRuntimeSmtp())?.options).toMatchObject({
      host: "smtp.example.test",
    });
  });

  it("fails closed for a stored SES row whose host is not the region's endpoint", async () => {
    mocks.row = row({ ...ses, host: "smtp.example.test" });
    await expect(resolveRuntimeSmtp()).rejects.toThrow(
      "SMTP configuration unavailable",
    );
    mocks.row = row({ ...ses, lastTest: { ...lastTest, state: "unknown" } });
    await expect(resolveRuntimeSmtp()).rejects.toThrow(
      "SMTP configuration unavailable",
    );
  });

  it("resolves nothing for a disabled provider", async () => {
    mocks.row = { ...row(ses), enabled: false };
    expect(await resolveRuntimeSmtp()).toBeNull();
  });
});
