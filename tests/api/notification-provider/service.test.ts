import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentRow: null as Record<string, unknown> | null,
  lock: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
  tx: { execute: vi.fn(async () => ({ rows: [] })) },
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
}));
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

import { updateEmailProvider } from "../../../apps/api/src/notification-provider/service";

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
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.save).not.toHaveBeenCalled();
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
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("still lets an administrator disable an unchanged capture provider if local capability is removed", async () => {
    vi.stubEnv("TASKDESK_LOCAL_MAILPIT_CAPTURE", "false");
    const result = await updateEmailProvider(
      { version: 4, enabled: false },
      actor,
    );
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.currentRow).toMatchObject({
      config: captureConfig,
      enabled: false,
    });
    expect(result.localMailpitCaptureAvailable).toBe(false);
  });
});
