import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentRow: null as Record<string, unknown> | null,
  lock: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
  writeStatus: vi.fn(),
  spend: vi.fn(),
  executeSmtp: vi.fn(),
  tx: {
    execute: vi.fn(
      async (): Promise<{ rows: { count: number }[] }> => ({ rows: [] }),
    ),
  },
}));

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    transaction: (callback: (tx: typeof mocks.tx) => unknown) =>
      callback(mocks.tx),
  },
}));
vi.mock("../../../apps/api/src/notification-provider/repository", () => ({
  EMAIL_PLUGIN_ID: "notify.email",
  lockEmailProvider: (...args: unknown[]) => mocks.lock(...args),
  readEmailProvider: (...args: unknown[]) => mocks.read(...args),
  saveEmailProvider: (...args: unknown[]) => mocks.save(...args),
  writeEmailTestStatus: (...args: unknown[]) => mocks.writeStatus(...args),
}));
// The real module, except the one function that would open a network connection.
vi.mock(
  "../../../packages/email/dist/smtp-runtime",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../packages/email/dist/smtp-runtime")
    >()),
    executeSmtp: (...args: unknown[]) => mocks.executeSmtp(...args),
  }),
);
vi.mock("../../../apps/api/src/audit/audit-writer", () => ({
  appendAuditLog: (...args: unknown[]) => mocks.audit(...args),
}));
vi.mock("../../../apps/api/src/identity/client-secret", () => ({
  decryptIdentityClientSecret: vi.fn(() => "placeholder-secret"),
  encryptIdentityClientSecret: vi.fn(() => Buffer.from("ciphertext")),
}));
vi.mock(
  "../../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({
    notifyCurrentInstanceAdminsOfAuditFailure: vi.fn(),
  }),
);
vi.mock("../../../apps/api/src/instance/observability/runtime", () => ({
  recordAuditWriteFailure: vi.fn(),
}));

import {
  getEmailProvider,
  testEmailProvider,
  updateEmailProvider,
} from "../../../apps/api/src/notification-provider/service";
import { TEST_EMAIL_SUBJECT } from "../../../apps/api/src/notification-provider/test-result";
import { SmtpAttemptError } from "../../../packages/email/dist/smtp-runtime";

const actor = { userId: "admin-user", personId: "admin-person" };
const captureConfig = {
  captureToMailpit: true,
  host: "mailpit",
  port: 1025,
  secure: false,
  requireTLS: false,
  username: null,
  fromAddress: "taskdesk@example.test",
  replyTo: null,
};

function row(secrets: Buffer | null) {
  return {
    id: "email-provider",
    pluginId: "notify.email",
    instanceKey: "default",
    displayName: "Email",
    enabled: false,
    config: captureConfig,
    secrets,
    scope: "instance",
    workspaceId: null,
    portalScope: null,
    configVersion: 4,
    updatedBy: actor.personId,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.stubEnv("TASKDESK_LOCAL_MAILPIT_CAPTURE", "true");
  vi.stubEnv("TASKDESK_AGENT_URL", "https://ticketing.localhost");
  vi.stubEnv("TASKDESK_PORTAL_URL", "https://portal.localhost");
  mocks.currentRow = row(null);
  mocks.lock.mockClear();
  mocks.read.mockClear();
  mocks.save.mockClear();
  mocks.audit.mockClear();
  mocks.writeStatus.mockReset();
  mocks.writeStatus.mockResolvedValue(true);
  mocks.spend.mockReset();
  mocks.spend.mockResolvedValue(undefined);
  mocks.executeSmtp.mockReset();
  mocks.executeSmtp.mockResolvedValue(undefined);
  mocks.lock.mockImplementation(async () => mocks.currentRow);
  mocks.read.mockImplementation(async () => mocks.currentRow);
  mocks.save.mockImplementation(
    async (_tx: unknown, input: Record<string, unknown>) => {
      mocks.currentRow = input;
      return input;
    },
  );
  mocks.audit.mockResolvedValue(undefined);
  mocks.tx.execute.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Mailpit provider persistence guards", () => {
  it("requires clearing an existing encrypted SMTP password before capture can be saved", async () => {
    mocks.currentRow = row(Buffer.from("encrypted-placeholder"));
    await expect(
      updateEmailProvider(
        { version: 4, enabled: true, config: captureConfig },
        actor,
        mocks.spend,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.spend).not.toHaveBeenCalled();
  });

  it("persists capture only after the encrypted password is explicitly cleared", async () => {
    mocks.currentRow = row(Buffer.from("encrypted-placeholder"));
    const result = await updateEmailProvider(
      {
        version: 4,
        enabled: true,
        config: captureConfig,
        password: null,
      },
      actor,
      mocks.spend,
    );
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.currentRow).toMatchObject({
      config: captureConfig,
      secrets: null,
      enabled: true,
    });
    expect(result).toMatchObject({
      config: captureConfig,
      passwordConfigured: false,
    });
  });

  it("refuses saving capture if the local capability is enabled on nonlocal origins", async () => {
    vi.stubEnv("TASKDESK_AGENT_URL", "https://ticketing.example.test");
    await expect(
      updateEmailProvider(
        {
          version: 4,
          enabled: true,
          config: captureConfig,
          password: null,
        },
        actor,
        mocks.spend,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("still lets an administrator disable an unchanged capture provider if local capability is removed", async () => {
    vi.stubEnv("TASKDESK_LOCAL_MAILPIT_CAPTURE", "false");
    const result = await updateEmailProvider(
      { version: 4, enabled: false },
      actor,
      mocks.spend,
    );
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.currentRow).toMatchObject({
      config: captureConfig,
      enabled: false,
    });
    expect(result.localMailpitCaptureAvailable).toBe(false);
  });
});

const sesConfig = {
  provider: "ses" as const,
  region: "eu-west-1" as const,
  host: "email-smtp.eu-west-1.amazonaws.com",
  port: 587,
  secure: false,
  requireTLS: true,
  username: "synthetic-ses-user",
  fromAddress: "noreply@example.test",
  replyTo: null,
};
const verified = {
  state: "verified" as const,
  testedAt: "2026-11-12T10:00:00.000Z",
  smtpCode: null,
  category: null,
};
function sesRow(lastTest?: typeof verified | Record<string, unknown>) {
  return {
    ...row(Buffer.from("encrypted-placeholder")),
    enabled: true,
    config: lastTest ? { ...sesConfig, lastTest } : { ...sesConfig },
  };
}

describe("saving the email provider spends the step-up proof", () => {
  it("spends exactly one proof, after the checks and before the write", async () => {
    mocks.currentRow = sesRow();
    await updateEmailProvider(
      { version: 4, enabled: true, config: sesConfig },
      actor,
      mocks.spend,
    );
    expect(mocks.spend).toHaveBeenCalledOnce();
    expect(mocks.spend).toHaveBeenCalledWith(mocks.tx);
    expect(mocks.spend.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.save.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it("does not spend it for a stale version or a refused save", async () => {
    mocks.currentRow = sesRow();
    await expect(
      updateEmailProvider(
        { version: 3, enabled: true, config: sesConfig },
        actor,
        mocks.spend,
      ),
    ).rejects.toMatchObject({ status: 409 });
    mocks.currentRow = { ...sesRow(), secrets: null };
    await expect(
      updateEmailProvider(
        { version: 4, enabled: true, config: sesConfig },
        actor,
        mocks.spend,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.spend).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rolls the save back with the proof: a refused spend writes nothing", async () => {
    mocks.currentRow = sesRow();
    mocks.spend.mockRejectedValue(
      Object.assign(new Error("step_up_unavailable"), { status: 403 }),
    );
    await expect(
      updateEmailProvider(
        { version: 4, enabled: true, config: sesConfig },
        actor,
        mocks.spend,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("saved test status", () => {
  const savedConfig = () => mocks.currentRow?.config as Record<string, unknown>;

  it("is reported from the stored row and is never part of the settings", async () => {
    mocks.currentRow = sesRow(verified);
    const result = await getEmailProvider();
    expect(result.testStatus).toEqual(verified);
    expect(result.config).toMatchObject({
      provider: "ses",
      region: "eu-west-1",
    });
    expect(result.config).not.toHaveProperty("lastTest");
    expect(result.sesRegions.length).toBeGreaterThan(10);
    mocks.currentRow = sesRow();
    expect((await getEmailProvider()).testStatus.state).toBe("never");
  });

  it.each([
    [
      "a changed setting",
      { config: { ...sesConfig, fromAddress: "other@example.test" } },
    ],
    ["a replaced password", { password: "replacement-secret-value" }],
    ["a cleared password (delivery off)", { enabled: false, password: null }],
    [
      "a switch to custom SMTP",
      {
        config: {
          host: "smtp.example.test",
          port: 587,
          secure: false,
          requireTLS: true,
          username: "mailer",
          fromAddress: "noreply@example.test",
          replyTo: null,
        },
      },
    ],
  ])("resets to not-tested-since-change after %s", async (_name, change) => {
    mocks.currentRow = sesRow(verified);
    const result = await updateEmailProvider(
      { version: 4, enabled: true, ...change },
      actor,
      mocks.spend,
    );
    expect(savedConfig().lastTest).toEqual({
      state: "stale",
      testedAt: null,
      smtpCode: null,
      category: null,
    });
    expect(result.testStatus.state).toBe("stale");
  });

  it("keeps the result when the same settings are saved again or only delivery is toggled", async () => {
    mocks.currentRow = sesRow(verified);
    await updateEmailProvider(
      { version: 4, enabled: true, config: { ...sesConfig, replyTo: null } },
      actor,
      mocks.spend,
    );
    expect(savedConfig().lastTest).toEqual(verified);
    await updateEmailProvider(
      { version: 5, enabled: false },
      actor,
      mocks.spend,
    );
    expect(savedConfig().lastTest).toEqual(verified);
    expect(mocks.currentRow).toMatchObject({
      enabled: false,
      configVersion: 6,
    });
  });

  it("starts as not-tested-since-change when a first configuration is created", async () => {
    mocks.currentRow = null;
    await updateEmailProvider(
      {
        version: 0,
        enabled: true,
        config: sesConfig,
        password: "first-secret-value",
      },
      actor,
      mocks.spend,
    );
    expect(savedConfig().lastTest).toMatchObject({ state: "stale" });
  });
});

const recipient = "admin@example.test";
describe("test send", () => {
  it("sends one real fixed message to the typed recipient and stores the verified status", async () => {
    mocks.currentRow = sesRow();
    const result = await testEmailProvider({ version: 4, recipient }, actor);
    expect(result).toMatchObject({
      ok: true,
      recipientDomain: "example.test",
      persisted: true,
    });
    expect(mocks.executeSmtp).toHaveBeenCalledOnce();
    const [smtp, message, options] = mocks.executeSmtp.mock.calls[0] as [
      { options: { host: string; auth: { user: string; pass: string } } },
      { to: string; subject: string; text: string },
      { includeReply: boolean; deadlineMs: number },
    ];
    expect(smtp.options.host).toBe("email-smtp.eu-west-1.amazonaws.com");
    expect(smtp.options.auth).toEqual({
      user: "synthetic-ses-user",
      pass: "placeholder-secret",
    });
    expect(message).toMatchObject({
      to: recipient,
      subject: TEST_EMAIL_SUBJECT,
    });
    expect(message.text.length).toBeGreaterThan(0);
    expect(options).toMatchObject({ includeReply: true });
    expect(options.deadlineMs).toBeLessThan(30_000);
    expect(mocks.writeStatus).toHaveBeenCalledOnce();
    const written = mocks.writeStatus.mock.calls[0]?.[1] as {
      id: string;
      expectedVersion: number;
      config: { lastTest: { state: string; testedAt: string } };
    };
    expect(written).toMatchObject({ id: "email-provider", expectedVersion: 4 });
    expect(written.config.lastTest.state).toBe("verified");
    expect(written.config).toMatchObject(sesConfig);
  });

  it("audits the attempt with the recipient's domain only, never the address or a secret", async () => {
    mocks.currentRow = sesRow();
    await testEmailProvider(
      {
        version: 4,
        recipient,
        config: sesConfig,
        password: "typed-secret-value",
      },
      actor,
    );
    expect(mocks.audit).toHaveBeenCalledOnce();
    const entry = mocks.audit.mock.calls[0]?.[1] as {
      action: string;
      after: Record<string, unknown>;
    };
    expect(entry.action).toBe("plugin.tested");
    expect(entry.after).toMatchObject({
      provider: "ses",
      recipientDomain: "example.test",
      changedKeys: ["config", "password"],
    });
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain(recipient);
    expect(serialised).not.toContain("admin@");
    expect(serialised).not.toContain("typed-secret-value");
    expect(serialised).not.toContain("placeholder-secret");
  });

  it("reports a failure as a result with its code and sanitised text, and stores it", async () => {
    mocks.currentRow = sesRow();
    mocks.executeSmtp.mockRejectedValue(
      new SmtpAttemptError("failed", false, "authentication", {
        code: 535,
        command: "AUTH PLAIN",
        text: "5.7.8 Authentication Credentials Invalid",
      }),
    );
    const result = await testEmailProvider({ version: 4, recipient }, actor);
    expect(result).toEqual({
      ok: false,
      testedAt: expect.any(String),
      category: "authentication",
      smtpCode: 535,
      providerText: "5.7.8 Authentication Credentials Invalid",
      persisted: true,
    });
    const written = mocks.writeStatus.mock.calls[0]?.[1] as {
      config: { lastTest: Record<string, unknown> };
    };
    expect(written.config.lastTest).toMatchObject({
      state: "failed",
      smtpCode: 535,
      category: "authentication",
    });
    expect(JSON.stringify(written)).not.toContain("AUTH PLAIN");
  });

  it("shows but never stores a result produced by settings that are not the saved ones", async () => {
    mocks.currentRow = sesRow(verified);
    const changed = { ...sesConfig, fromAddress: "other@example.test" };
    const result = await testEmailProvider(
      { version: 4, recipient, config: changed },
      actor,
    );
    expect(result).toMatchObject({ ok: true, persisted: false });
    const typed = await testEmailProvider(
      { version: 4, recipient, password: "typed-secret-value" },
      actor,
    );
    expect(typed).toMatchObject({ ok: true, persisted: false });
    expect(mocks.writeStatus).not.toHaveBeenCalled();
    // Identical unsaved values are the saved settings, so that result is stored.
    expect(
      await testEmailProvider(
        { version: 4, recipient, config: sesConfig },
        actor,
      ),
    ).toMatchObject({ ok: true, persisted: true });
  });

  it("drops the result when the settings changed while the test was running", async () => {
    mocks.currentRow = sesRow();
    mocks.executeSmtp.mockImplementation(async () => {
      mocks.currentRow = {
        ...sesRow(),
        configVersion: 5,
        config: { ...sesConfig, fromAddress: "other@example.test" },
      };
    });
    expect(
      await testEmailProvider({ version: 4, recipient }, actor),
    ).toMatchObject({ ok: true, persisted: false });
    expect(mocks.writeStatus).not.toHaveBeenCalled();
  });

  it("does not turn a failed status write into a failed test", async () => {
    mocks.currentRow = sesRow();
    mocks.writeStatus.mockRejectedValue(new Error("database unavailable"));
    expect(
      await testEmailProvider({ version: 4, recipient }, actor),
    ).toMatchObject({ ok: true, persisted: false });
  });

  it("never creates a row: a test with nothing saved is shown, not stored", async () => {
    mocks.currentRow = null;
    expect(
      await testEmailProvider(
        {
          version: 0,
          recipient,
          config: sesConfig,
          password: "typed-secret-value",
        },
        actor,
      ),
    ).toMatchObject({ ok: true, persisted: false });
    expect(mocks.writeStatus).not.toHaveBeenCalled();
  });

  it("keeps the rate limit: the sixth test in a minute is refused before any mail is sent", async () => {
    mocks.currentRow = sesRow();
    mocks.tx.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 5 }] });
    await expect(
      testEmailProvider({ version: 4, recipient }, actor),
    ).rejects.toMatchObject({ status: 429 });
    expect(mocks.executeSmtp).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refuses with the audit unavailable before any mail is sent", async () => {
    mocks.currentRow = sesRow();
    mocks.audit.mockRejectedValue(new Error("audit down"));
    await expect(
      testEmailProvider({ version: 4, recipient }, actor),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.executeSmtp).not.toHaveBeenCalled();
  });

  it("refuses a stale version and a missing password before any audit or mail", async () => {
    mocks.currentRow = sesRow();
    await expect(
      testEmailProvider({ version: 3, recipient }, actor),
    ).rejects.toMatchObject({ status: 409 });
    mocks.currentRow = { ...sesRow(), secrets: null };
    await expect(
      testEmailProvider({ version: 4, recipient }, actor),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.executeSmtp).not.toHaveBeenCalled();
  });
});
