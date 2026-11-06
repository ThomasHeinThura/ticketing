import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auditWriter from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import { decryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { getStorageDriver } from "../../apps/api/src/storage";
import { s3DraftWriteSchema } from "../../apps/api/src/storage/s3-draft-schema";
import {
  getS3Draft,
  saveS3Draft as saveDraft,
  selectS3DraftForProbe as selectDraft,
} from "../../apps/api/src/storage/s3-draft-service";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

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
const credentials = {
  accessKeyId: "synthetic-access-id",
  secretAccessKey: "synthetic-access-secret",
};

const spend = async () => {};
const saveS3Draft = (
  input: Parameters<typeof saveDraft>[0],
  actor: Parameters<typeof saveDraft>[1],
  spender = spend,
) => saveDraft(input, actor, spender);
async function selectS3DraftForProbe(
  input: number | Parameters<typeof selectDraft>[0],
  actor: Parameters<typeof selectDraft>[1],
) {
  const candidate =
    typeof input === "number"
      ? { version: input, config: (await getS3Draft()).config ?? config }
      : input;
  return selectDraft(candidate, actor, spend);
}

async function actor() {
  const fixture = await createWorkspaceMember({ role: "admin" });
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, fixture.user.id)),
    "person",
  );
  return { userId: fixture.user.id, personId: person.id };
}

async function draftRow() {
  return requireRow(
    await db
      .select()
      .from(schema.instancePluginConfigTable)
      .where(eq(schema.instancePluginConfigTable.pluginId, "storage.s3")),
    "S3 draft",
  );
}

beforeEach(async () => {
  vi.stubEnv("TASKDESK_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("TASKDESK_ENCRYPTION_KEY_PREVIOUS", "");
  await resetTestDatabase();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("inactive S3 draft configuration", () => {
  it("permits an uncredentialed draft but will not select it for a probe", async () => {
    const a = await actor();
    expect(await saveS3Draft({ version: 0, config }, a)).toEqual({
      version: 1,
      config,
      credentialConfigured: false,
      accessKeyIdConfigured: false,
      secretAccessKeyConfigured: false,
    });
    await expect(selectS3DraftForProbe(1, a)).rejects.toMatchObject({
      status: 400,
    });
  });

  it.each([
    { name: "missing", key: undefined },
    { name: "invalid", key: "invalid-fixture-key" },
  ])("fails safely when the encryption key is $name", async ({ key }) => {
    const a = await actor();
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY", key);
    const spender = vi.fn(async () => {});
    await expect(
      saveDraft({ version: 0, config, credentials }, a, spender),
    ).rejects.toMatchObject({
      status: 503,
      message: "S3 credential storage unavailable",
    });
    expect(spender).not.toHaveBeenCalled();
    const rows = await db
      .select()
      .from(schema.instancePluginConfigTable)
      .where(eq(schema.instancePluginConfigTable.pluginId, "storage.s3"));
    expect(rows).toHaveLength(0);
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "plugin.changed"));
    expect(audits).toHaveLength(0);
    expect(await saveDraft({ version: 0, config }, a, spender)).toMatchObject({
      version: 1,
      credentialConfigured: false,
    });
    expect(spender).toHaveBeenCalledTimes(1);
  });

  it("spends only after domain validation and before persistence or probe audit", async () => {
    const a = await actor();
    const spender = vi.fn(async () => {});
    await expect(
      saveDraft({ version: 1, config, credentials }, a, spender),
    ).rejects.toMatchObject({ status: 409 });
    expect(spender).not.toHaveBeenCalled();
    await saveDraft({ version: 0, config, credentials }, a, spender);
    expect(spender).toHaveBeenCalledTimes(1);
    await expect(
      selectDraft({ version: 0, config, credentials }, a, spender),
    ).rejects.toMatchObject({ status: 409 });
    expect(spender).toHaveBeenCalledTimes(1);
    await selectDraft({ version: 1, config }, a, spender);
    expect(spender).toHaveBeenCalledTimes(2);
  });

  it("stores row-bound encrypted credentials, preserves omitted values, replaces and clears", async () => {
    const a = await actor();
    expect(await getS3Draft()).toEqual({
      version: 0,
      config: null,
      credentialConfigured: false,
      accessKeyIdConfigured: false,
      secretAccessKeyConfigured: false,
    });
    const created = await saveS3Draft({ version: 0, config, credentials }, a);
    expect(created).toEqual({
      version: 1,
      config,
      credentialConfigured: true,
      accessKeyIdConfigured: true,
      secretAccessKeyConfigured: true,
    });
    const row = await draftRow();
    expect(row.enabled).toBe(false);
    expect(row.instanceKey).toBe("draft");
    expect(row.secrets).not.toBeNull();
    if (!row.secrets) throw new Error("Missing ciphertext");
    expect(row.secrets.toString()).not.toContain(credentials.secretAccessKey);
    expect(
      JSON.parse(decryptIdentityClientSecret(row.id, row.secrets)),
    ).toEqual(credentials);
    expect(() =>
      decryptIdentityClientSecret(`wrong-${row.id}`, row.secrets as Buffer),
    ).toThrow();

    await saveS3Draft(
      { version: 1, config: { ...config, region: "eu-west-1" } },
      a,
    );
    expect((await draftRow()).secrets).toEqual(row.secrets);
    const replacement = {
      accessKeyId: "synthetic-replacement-id",
      secretAccessKey: "synthetic-replacement-secret",
    };
    await saveS3Draft({ version: 2, config, credentials: replacement }, a);
    const replaced = await draftRow();
    if (!replaced.secrets) throw new Error("Missing replacement ciphertext");
    expect(
      JSON.parse(decryptIdentityClientSecret(replaced.id, replaced.secrets)),
    ).toEqual(replacement);
    expect(
      await saveS3Draft({ version: 3, config, credentials: null }, a),
    ).toEqual({
      version: 4,
      config,
      credentialConfigured: false,
      accessKeyIdConfigured: false,
      secretAccessKeyConfigured: false,
    });
    expect((await draftRow()).secrets).toBeNull();
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "plugin.changed"));
    expect(audit).toHaveLength(4);
    const auditPayloads = JSON.stringify(
      audit.map(({ before, after }) => ({ before, after })),
    );
    for (const forbidden of [
      config.endpoint,
      config.publicBaseUrl,
      config.bucket,
      credentials.accessKeyId,
      credentials.secretAccessKey,
      replacement.secretAccessKey,
    ])
      expect(auditPayloads).not.toContain(forbidden);
  });

  it("serializes competing creates and updates without losing the winning secret", async () => {
    const a = await actor();
    const choices = [
      credentials,
      { accessKeyId: "choice-two", secretAccessKey: "choice-two-secret" },
    ];
    const create = await Promise.allSettled(
      choices.map((choice) =>
        saveS3Draft({ version: 0, config, credentials: choice }, a),
      ),
    );
    expect(
      create.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      create.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const update = await Promise.allSettled(
      choices.map((choice) =>
        saveS3Draft({ version: 1, config, credentials: choice }, a),
      ),
    );
    expect(
      update.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      update.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const row = await draftRow();
    expect(row.configVersion).toBe(2);
    if (!row.secrets) throw new Error("Missing winning ciphertext");
    expect(choices).toContainEqual(
      JSON.parse(decryptIdentityClientSecret(row.id, row.secrets)),
    );
  });

  it("reserves an audited, frozen saved version, enforces rate limits and rejects stale versions", async () => {
    const a = await actor();
    await saveS3Draft({ version: 0, config, credentials }, a);
    const selection = await selectS3DraftForProbe(1, a);
    expect(selection).toEqual({ version: 1, config, credentials });
    expect(Object.isFrozen(selection.config)).toBe(true);
    expect(Object.isFrozen(selection.credentials)).toBe(true);
    await saveS3Draft(
      { version: 1, config: { ...config, region: "eu-west-1" } },
      a,
    );
    expect(selection.config.region).toBe("us-east-1");
    await expect(selectS3DraftForProbe(1, a)).rejects.toMatchObject({
      status: 409,
    });
    for (let i = 0; i < 4; i++) await selectS3DraftForProbe(2, a);
    await expect(selectS3DraftForProbe(2, a)).rejects.toMatchObject({
      status: 429,
    });
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "plugin.tested"));
    expect(audit).toHaveLength(5);
    const auditPayloads = JSON.stringify(
      audit.map(({ before, after }) => ({ before, after })),
    );
    expect(auditPayloads).not.toContain(credentials.secretAccessKey);
  });

  it("preserves and clears credential fields independently", async () => {
    const a = await actor();
    await saveS3Draft({ version: 0, config, credentials }, a);
    const updated = await saveS3Draft(
      { version: 1, config, credentials: { accessKeyId: "replacement-id" } },
      a,
    );
    expect(updated).toMatchObject({
      credentialConfigured: true,
      accessKeyIdConfigured: true,
      secretAccessKeyConfigured: true,
    });
    const selected = await selectS3DraftForProbe(2, a);
    expect(selected.credentials).toEqual({
      accessKeyId: "replacement-id",
      secretAccessKey: credentials.secretAccessKey,
    });
    const cleared = await saveS3Draft(
      { version: 2, config, credentials: { secretAccessKey: null } },
      a,
    );
    expect(cleared).toMatchObject({
      credentialConfigured: false,
      accessKeyIdConfigured: true,
      secretAccessKeyConfigured: false,
    });
    await expect(selectS3DraftForProbe(3, a)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("reserves unsaved candidate tests without writing the draft and rejects stale versions", async () => {
    const a = await actor();
    const selected = await selectS3DraftForProbe(
      { version: 0, config, credentials },
      a,
    );
    expect(selected).toEqual({ version: 0, config, credentials });
    expect((await getS3Draft()).version).toBe(0);
    await saveS3Draft({ version: 0, config, credentials }, a);
    await expect(
      selectS3DraftForProbe({ version: 0, config, credentials }, a),
    ).rejects.toMatchObject({ status: 409 });
    const modified = { ...config, keyPrefix: "unsaved/" };
    const candidate = await selectS3DraftForProbe(
      {
        version: 1,
        config: modified,
        credentials: { accessKeyId: "candidate-id" },
      },
      a,
    );
    expect(candidate.credentials).toEqual({
      accessKeyId: "candidate-id",
      secretAccessKey: credentials.secretAccessKey,
    });
    expect((await getS3Draft()).config).toEqual(config);
    for (let i = 0; i < 3; i++) await selectS3DraftForProbe(1, a);
    await expect(selectS3DraftForProbe(1, a)).rejects.toMatchObject({
      status: 429,
    });
  });

  it("serializes concurrent candidate reservations through the shared rate limit", async () => {
    const a = await actor();
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        selectS3DraftForProbe({ version: 0, config, credentials }, a),
      ),
    );
    expect(
      attempts.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(5);
    const failed = attempts.filter((entry) => entry.status === "rejected");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ reason: { status: 429 } });
    expect((await getS3Draft()).version).toBe(0);
  });

  it("requires an explicit credential pair when a saved endpoint changes", async () => {
    const a = await actor();
    await saveS3Draft({ version: 0, config, credentials }, a);
    const changed = { ...config, endpoint: "https://other.example.test" };
    for (const changes of [
      undefined,
      { accessKeyId: "new-id" },
      { secretAccessKey: "new-secret" },
    ]) {
      await expect(
        selectS3DraftForProbe(
          { version: 1, config: changed, credentials: changes },
          a,
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        saveS3Draft({ version: 1, config: changed, credentials: changes }, a),
      ).rejects.toMatchObject({ status: 400 });
    }
    const replacement = {
      accessKeyId: "new-id",
      secretAccessKey: "new-secret",
    };
    expect(
      (
        await selectS3DraftForProbe(
          { version: 1, config: changed, credentials },
          a,
        )
      ).credentials,
    ).toEqual(credentials);
    expect(
      (
        await selectS3DraftForProbe(
          { version: 1, config: changed, credentials: replacement },
          a,
        )
      ).credentials,
    ).toEqual(replacement);
    expect((await getS3Draft()).config).toEqual(config);
    await expect(
      saveS3Draft({ version: 1, config: changed, credentials: null }, a),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("requires a fresh credential pair when the bucket, path style or endpoint changes, not when unchanged", async () => {
    const a = await actor();
    await saveS3Draft({ version: 0, config, credentials }, a);
    const changes = [
      { ...config, bucket: "other-bucket" },
      { ...config, forcePathStyle: false },
      { ...config, endpoint: "https://other.example.test" },
    ];
    for (const changed of changes) {
      for (const partial of [
        undefined,
        { accessKeyId: "new-id" },
        { secretAccessKey: "new-secret" },
      ]) {
        await expect(
          selectS3DraftForProbe(
            { version: 1, config: changed, credentials: partial },
            a,
          ),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
          saveS3Draft({ version: 1, config: changed, credentials: partial }, a),
        ).rejects.toMatchObject({ status: 400 });
      }
    }
    // Same destination: stored credentials are reused; other fields may change.
    const unchanged = { ...config, region: "eu-west-1", keyPrefix: "other/" };
    expect(
      (
        await selectS3DraftForProbe(
          { version: 1, config: unchanged, credentials: undefined },
          a,
        )
      ).credentials,
    ).toEqual(credentials);
    expect(
      (await saveS3Draft({ version: 1, config: unchanged }, a)).version,
    ).toBe(2);
  });

  it("audits the tested destination and credential provenance without secrets", async () => {
    const a = await actor();
    await saveS3Draft({ version: 0, config, credentials }, a);
    await selectS3DraftForProbe(1, a);
    await selectS3DraftForProbe(
      {
        version: 1,
        config,
        credentials: { accessKeyId: "fresh-id-marker" },
      },
      a,
    );
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "plugin.tested"))
      .orderBy(schema.auditLogTable.createdAt);
    expect(audit).toHaveLength(2);
    const base = {
      connector: "external",
      endpointOrigin: "https://storage.example.test",
      bucket: config.bucket,
      forcePathStyle: true,
      region: "us-east-1",
      draftVersion: 1,
    };
    expect(audit[0]?.after).toEqual({
      ...base,
      freshFields: [],
      storedFields: ["accessKeyId", "secretAccessKey"],
    });
    expect(audit[1]?.after).toEqual({
      ...base,
      freshFields: ["accessKeyId"],
      storedFields: ["secretAccessKey"],
    });
    const serialized = JSON.stringify(audit.map(({ after }) => after));
    for (const secret of [
      credentials.accessKeyId,
      credentials.secretAccessKey,
      "fresh-id-marker",
    ])
      expect(serialized).not.toContain(secret);
  });

  it("rejects unsaved candidates on audit failure before exposing a selection", async () => {
    const a = await actor();
    vi.spyOn(auditWriter, "appendAuditLog").mockRejectedValueOnce(
      new Error("synthetic"),
    );
    await expect(
      selectS3DraftForProbe({ version: 0, config, credentials }, a),
    ).rejects.toMatchObject({ status: 503 });
    expect((await getS3Draft()).version).toBe(0);
  });

  it("never changes the active bootstrap driver", async () => {
    const a = await actor();
    vi.stubEnv("TASKDESK_STORAGE_DRIVER", "filesystem");
    await saveS3Draft({ version: 0, config, credentials }, a);
    await selectS3DraftForProbe(1, a);
    expect(getStorageDriver()).toBe("filesystem");
    vi.stubEnv("TASKDESK_STORAGE_DRIVER", "s3");
    await saveS3Draft({ version: 1, config }, a);
    expect(getStorageDriver()).toBe("s3");
  });

  it("does not return a probe selection when the audit reservation fails", async () => {
    const a = await actor();
    await saveS3Draft({ version: 0, config, credentials }, a);
    vi.spyOn(auditWriter, "appendAuditLog").mockRejectedValueOnce(
      new Error("synthetic audit failure"),
    );
    await expect(selectS3DraftForProbe(1, a)).rejects.toMatchObject({
      status: 503,
    });
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "plugin.tested"));
    expect(audit).toHaveLength(0);
    expect((await getS3Draft()).version).toBe(1);
  });

  it("rejects malformed or non-public-origin syntax and unknown fields", () => {
    for (const endpoint of [
      "http://storage.example.test",
      "https://127.0.0.1",
      "https://[::1]",
      "https://storage.example.test/path",
      "https://storage.example.test/path/..",
      "https://storage.example.test?",
      "https://storage.example.test#",
      "https://user:pass@storage.example.test",
      "https://service.localhost",
      "https://service.local",
      "https://localhost",
    ])
      expect(
        s3DraftWriteSchema.safeParse({
          version: 0,
          config: { ...config, endpoint },
        }).success,
      ).toBe(false);
    expect(
      s3DraftWriteSchema.safeParse({
        version: 0,
        config,
        credentials: { accessKeyId: "one" },
      }).success,
    ).toBe(true);
    expect(
      s3DraftWriteSchema.safeParse({
        version: 0,
        config: { ...config, enabled: true },
      }).success,
    ).toBe(false);
    for (const invalid of [0, -1, 1.5]) {
      expect(
        s3DraftWriteSchema.safeParse({
          version: 0,
          config: { ...config, maxImageUploadBytes: invalid },
        }).success,
      ).toBe(false);
      expect(
        s3DraftWriteSchema.safeParse({
          version: 0,
          config: { ...config, presignTtlSeconds: invalid },
        }).success,
      ).toBe(false);
    }
    const {
      maxImageUploadBytes: _bytes,
      presignTtlSeconds: _ttl,
      ...withoutTuning
    } = config;
    expect(
      s3DraftWriteSchema.parse({ version: 0, config: withoutTuning }).config,
    ).toEqual(config);
    expect(
      s3DraftWriteSchema.safeParse({
        version: 0,
        config: { ...config, publicBaseUrl: "http://files.example.test" },
      }).success,
    ).toBe(false);
  });
});
