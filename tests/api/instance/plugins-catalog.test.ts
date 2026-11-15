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
    testStatus: {
      state: "never",
      testedAt: null,
      smtpCode: null,
      category: null,
    },
    sesRegions: [],
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
      { key: "config.provider", control: "text" },
      { key: "config.region", control: "text" },
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

  it("returns all four subprocessor register entries disabled by default and reflects live runtime counts without leaking endpoints", () => {
    const defaults = projectSupportedPlugins(provider());
    expect(defaults.map((item) => item.id)).toEqual([
      "notify.email",
      "storage.s3",
      "identity.sso",
      "observability.telemetry",
    ]);
    for (const item of defaults) {
      expect(item.state).toBe("unconfigured");
      expect(item.destinationSummary).toBe("Disabled");
      expect(item.dataProcessed.length).toBeGreaterThan(0);
    }

    const configured = projectSupportedPlugins(
      provider({
        version: 2,
        source: "runtime",
        enabled: true,
        config: {
          host: "smtp.secret-relay.internal",
          port: 587,
          secure: false,
          requireTLS: true,
          username: "relay-user",
          fromAddress: "ops@example.test",
          replyTo: null,
        },
        passwordConfigured: true,
      }),
      {
        storage: {
          driver: "s3",
          configuration: "configured",
          hasDraft: true,
          draftVersion: 3,
          draftCredentialConfigured: true,
        },
        identity: {
          totalCount: 2,
          enabledCount: 2,
          scimEnabledCount: 1,
          maxConfigVersion: 5,
        },
        telemetry: {
          metricsTokenConfigured: true,
          observabilityConfigVersion: 2,
          pluginRowCount: 0,
          pluginEnabledCount: 0,
          pluginMaxVersion: 0,
          pluginCredentialConfigured: false,
        },
      },
    );

    expect(configured).toEqual([
      expect.objectContaining({
        id: "notify.email",
        category: "outbound_email",
        state: "enabled",
        destinationSummary: "Configured SMTP relay",
        configPath: "/god-mode/notifications",
      }),
      expect.objectContaining({
        id: "storage.s3",
        category: "object_storage",
        state: "enabled",
        source: "bootstrap",
        destinationSummary: "Active S3-compatible object storage",
        configPath: "/god-mode/storage",
      }),
      expect.objectContaining({
        id: "identity.sso",
        category: "identity_provider",
        state: "enabled",
        source: "runtime",
        destinationSummary: "2 active OIDC connections, 1 SCIM enabled",
        configPath: "/god-mode/authentication",
      }),
      expect.objectContaining({
        id: "observability.telemetry",
        category: "telemetry",
        state: "enabled",
        source: "runtime",
        destinationSummary: "Authenticated metrics scrape endpoint enabled",
        configPath: "/god-mode/observability",
      }),
    ]);

    const serialized = JSON.stringify(configured);
    expect(serialized).not.toContain("smtp.secret-relay.internal");
    expect(serialized).not.toContain("relay-user");
    expect(serialized).not.toContain("ops@example.test");
    expect(serialized).not.toContain("secrets");
  });
});
