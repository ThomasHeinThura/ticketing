import { describe, expect, it } from "vitest";
import { projectSupportedPlugins } from "../../../apps/api/src/instance/plugins/catalog";

type Provider = Parameters<typeof projectSupportedPlugins>[0];

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    version: 0,
    source: "unconfigured",
    enabled: false,
    config: null,
    localMailpitCaptureAvailable: false,
    passwordConfigured: false,
    passwordPreview: null,
    ...overrides,
  };
}

describe("supported plugin catalog", () => {
  it("reports an unconfigured email plugin without inventing health metadata", () => {
    const [email] = projectSupportedPlugins(provider());
    expect(email).toMatchObject({
      id: "notify.email",
      kind: "notification",
      state: "unconfigured",
      source: "unconfigured",
      configVersion: 0,
      credentialConfigured: false,
    });
    expect(email).not.toHaveProperty("lastHealthCheckAt");
  });

  it("projects saved configuration state and never returns config or secret previews", () => {
    const [email] = projectSupportedPlugins(
      provider({
        version: 4,
        source: "runtime",
        enabled: true,
        config: {
          host: "smtp.example.test",
          port: 587,
          secure: false,
          requireTLS: true,
          username: "mailer",
          fromAddress: "noreply@example.test",
          replyTo: null,
        },
        passwordConfigured: true,
        passwordPreview: "••••••••",
      }),
    );

    expect(email).toMatchObject({
      state: "enabled",
      source: "runtime",
      configVersion: 4,
      credentialConfigured: true,
    });
    expect(email).not.toHaveProperty("config");
    expect(email).not.toHaveProperty("passwordPreview");
  });

  it("reports malformed stored configuration as invalid even if disabled", () => {
    const [email] = projectSupportedPlugins(
      provider({ source: "runtime", enabled: false }),
    );
    expect(email?.state).toBe("invalid");
  });

  it("generates only bounded controls and constraints from the Zod settings schema", () => {
    const [email] = projectSupportedPlugins(provider());
    expect(email?.settingsForm).toMatchObject({
      version: 1,
      available: true,
    });
    if (!email?.settingsForm.available)
      throw new Error("Form schema unavailable");
    const fields = email.settingsForm.fields;
    expect(fields.map(({ key, control }) => ({ key, control }))).toEqual([
      { key: "enabled", control: "switch" },
      { key: "config.captureToMailpit", control: "checkbox" },
      { key: "config.host", control: "text" },
      { key: "config.port", control: "number" },
      { key: "config.secure", control: "checkbox" },
      { key: "config.requireTLS", control: "checkbox" },
      { key: "config.username", control: "text" },
      { key: "config.fromAddress", control: "email" },
      { key: "config.replyTo", control: "email" },
      { key: "password", control: "password" },
    ]);
    expect(fields.find(({ key }) => key === "config.port")).toMatchObject({
      required: true,
      minimum: 1,
      maximum: 65535,
    });
    expect(fields.find(({ key }) => key === "config.host")).toMatchObject({
      required: true,
      minLength: 1,
      maxLength: 253,
    });
    expect(fields.find(({ key }) => key === "password")).toMatchObject({
      group: "secret",
      secret: true,
      required: false,
      maxLength: 16_384,
    });
    expect(JSON.stringify(email.settingsForm)).not.toMatch(
      /default|smtp\.example|passwordPreview|••••/iu,
    );
  });
});
