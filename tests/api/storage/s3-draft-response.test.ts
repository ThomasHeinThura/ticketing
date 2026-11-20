import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentRow: null as Record<string, unknown> | null,
  read: vi.fn(),
  lock: vi.fn(),
  persist: vi.fn(),
  audit: vi.fn(),
  spend: vi.fn(),
  tx: {},
}));

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    transaction: (callback: (tx: typeof mocks.tx) => unknown) =>
      callback(mocks.tx),
  },
}));
vi.mock("../../../apps/api/src/storage/s3-draft-repository", () => ({
  S3_DRAFT_PLUGIN_ID: "storage.s3",
  S3_DRAFT_INSTANCE_KEY: "draft",
  readS3Draft: (...args: unknown[]) => mocks.read(...args),
  lockS3Draft: (...args: unknown[]) => mocks.lock(...args),
  persistS3Draft: (...args: unknown[]) => mocks.persist(...args),
}));
vi.mock("../../../apps/api/src/audit/audit-writer", () => ({
  appendAuditLog: (...args: unknown[]) => mocks.audit(...args),
}));
vi.mock("../../../apps/api/src/identity/client-secret", () => ({
  decryptIdentityClientSecret: vi.fn(),
  encryptIdentityClientSecret: vi.fn(),
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
  getS3Draft,
  saveS3Draft,
} from "../../../apps/api/src/storage/s3-draft-service";

const config = {
  connector: "external" as const,
  endpoint: "https://storage.example.test",
  publicBaseUrl: "https://files.example.test",
  region: "us-east-1",
  bucket: "synthetic-bucket",
  keyPrefix: "draft-test/",
  forcePathStyle: true,
  maxImageUploadBytes: 10 * 1024 * 1024,
  presignTtlSeconds: 300,
};
const actor = { userId: "admin-user", personId: "admin-person" };

beforeEach(() => {
  mocks.currentRow = null;
  mocks.read.mockReset().mockImplementation(async () => mocks.currentRow);
  mocks.lock.mockReset().mockImplementation(async () => mocks.currentRow);
  mocks.persist
    .mockReset()
    .mockImplementation(
      async (_tx: unknown, input: Record<string, unknown>) => {
        mocks.currentRow = input;
        return input;
      },
    );
  mocks.audit.mockReset().mockResolvedValue(undefined);
  mocks.spend.mockReset().mockResolvedValue(undefined);
});

describe("inactive S3 draft response row ID", () => {
  it("returns null before persistence, then the same actual row ID on GET and both saves", async () => {
    expect(await getS3Draft()).toMatchObject({
      id: null,
      version: 0,
      config: null,
    });
    const created = await saveS3Draft(
      { version: 0, config },
      actor,
      mocks.spend,
    );
    expect(created.id).toBe(mocks.currentRow?.id);
    expect(created.id).not.toBeNull();
    expect((await getS3Draft()).id).toBe(created.id);
    const updated = await saveS3Draft(
      { version: 1, config },
      actor,
      mocks.spend,
    );
    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({
      credentialConfigured: false,
      accessKeyIdConfigured: false,
      secretAccessKeyConfigured: false,
    });
    expect(JSON.stringify(updated)).not.toContain("secrets");
    expect(mocks.persist).toHaveBeenCalledTimes(2);
    expect(mocks.spend).toHaveBeenCalledTimes(2);
  });
});
