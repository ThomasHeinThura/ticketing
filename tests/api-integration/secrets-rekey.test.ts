import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { webhookTable } from "../../apps/api/src/database/schema";
import {
  currentEncryptionKeyId,
  decryptIdentityClientSecret,
  encryptIdentityClientSecret,
  envelopeKeyId,
} from "../../apps/api/src/identity/client-secret";
import { classifySecrets } from "../../apps/api/src/instance/health/classify";
import {
  decryptSecret,
  encryptSecret,
} from "../../apps/api/src/notification-preferences/secrets";
import { runSecretsRekeyJob } from "../../apps/api/src/scheduler/secrets-rekey";
import {
  getSecretsRekeyProgress,
  runSecretsRekey,
} from "../../apps/api/src/secrets/rekey";
import { webhookSigningSecrets } from "../../apps/api/src/webhook/repository";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const currentName = "TASKDESK_ENCRYPTION_KEY";
const previousName = "TASKDESK_ENCRYPTION_KEY_PREVIOUS";
const originalCurrent = process.env[currentName];
const originalPrevious = process.env[previousName];
const oldKey = "11".repeat(32);
const newKey = "22".repeat(32);

function useKeys(current: string, previous?: string) {
  process.env[currentName] = current;
  if (previous) process.env[previousName] = previous;
  else delete process.env[previousName];
}

async function insertPlugin(id: string, envelope: Buffer | null) {
  await db.insert(schema.instancePluginConfigTable).values({
    id,
    pluginId: "notify.email",
    instanceKey: id,
    displayName: id,
    enabled: false,
    config: {},
    secrets: envelope,
    scope: "instance",
    configVersion: 1,
  });
}

async function secretsOf(id: string) {
  const [row] = await db
    .select({ secrets: schema.instancePluginConfigTable.secrets })
    .from(schema.instancePluginConfigTable)
    .where(eq(schema.instancePluginConfigTable.id, id));
  return row?.secrets ?? null;
}

describe("GM-12..GM-14 secrets-rekey", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    if (originalCurrent === undefined) delete process.env[currentName];
    else process.env[currentName] = originalCurrent;
    if (originalPrevious === undefined) delete process.env[previousName];
    else process.env[previousName] = originalPrevious;
  });

  it("re-encrypts rows under the previous key and reports completion", async () => {
    useKeys(oldKey);
    await insertPlugin(
      "plugin-a",
      encryptIdentityClientSecret("plugin-a", "alpha"),
    );
    await insertPlugin(
      "plugin-b",
      encryptIdentityClientSecret("plugin-b", "bravo"),
    );
    await insertPlugin("plugin-none", null);

    useKeys(newKey, oldKey);
    expect(await getSecretsRekeyProgress()).toMatchObject({
      pending: { plugins: 2, identityConnections: 0, textSecrets: 0 },
      complete: false,
      previousKeyConfigured: true,
    });

    const outcome = await runSecretsRekey();
    expect(outcome).toMatchObject({
      rekeyed: { plugins: 2, identityConnections: 0, textSecrets: 0 },
      failed: { plugins: 0, identityConnections: 0, textSecrets: 0 },
    });
    for (const [id, value] of [
      ["plugin-a", "alpha"],
      ["plugin-b", "bravo"],
    ] as const) {
      const envelope = await secretsOf(id);
      expect(envelope && envelopeKeyId(envelope)).toBe(
        currentEncryptionKeyId(),
      );
      expect(envelope && decryptIdentityClientSecret(id, envelope)).toBe(value);
    }
    expect(await secretsOf("plugin-none")).toBeNull();
    expect(await getSecretsRekeyProgress()).toMatchObject({
      pending: { plugins: 0, identityConnections: 0, textSecrets: 0 },
      complete: true,
    });
  });

  it("is resumable and idempotent: a rerun touches nothing already rekeyed", async () => {
    useKeys(oldKey);
    await insertPlugin(
      "plugin-a",
      encryptIdentityClientSecret("plugin-a", "alpha"),
    );
    useKeys(newKey, oldKey);
    await runSecretsRekey();
    const first = await secretsOf("plugin-a");
    const second = await runSecretsRekey();
    expect(second.rekeyed).toEqual({
      plugins: 0,
      identityConnections: 0,
      textSecrets: 0,
    });
    expect((await secretsOf("plugin-a"))?.equals(first as Buffer)).toBe(true);
  });

  it("leaves an unreadable row untouched, reports it, and still rekeys the rest", async () => {
    useKeys(oldKey);
    await insertPlugin(
      "plugin-ok",
      encryptIdentityClientSecret("plugin-ok", "ok"),
    );
    useKeys("33".repeat(32));
    await insertPlugin(
      "plugin-lost",
      encryptIdentityClientSecret("plugin-lost", "lost"),
    );
    const lost = await secretsOf("plugin-lost");

    useKeys(newKey, oldKey);
    const outcome = await runSecretsRekey();
    expect(outcome.rekeyed.plugins).toBe(1);
    expect(outcome.failed.plugins).toBe(1);
    expect((await secretsOf("plugin-lost"))?.equals(lost as Buffer)).toBe(true);
    expect((await getSecretsRekeyProgress()).complete).toBe(false);
  });

  it("refuses to run with no current key", async () => {
    delete process.env[currentName];
    await expect(runSecretsRekey()).rejects.toThrow(
      "TASKDESK_ENCRYPTION_KEY is required",
    );
  });

  it("the job audits counts only, never a key id or secret", async () => {
    useKeys(oldKey);
    await insertPlugin(
      "plugin-a",
      encryptIdentityClientSecret("plugin-a", "alpha"),
    );
    useKeys(newKey, oldKey);
    const outcome = await runSecretsRekeyJob({ userId: null });
    expect(outcome.status).toBe("completed");
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "secrets.rekeyed"));
    expect(audit).toHaveLength(1);
    const text = JSON.stringify(audit[0], (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(text).not.toContain(currentEncryptionKeyId() as string);
    expect(text).toContain("pluginsRekeyed");
  });

  it("P4R1-H2: webhook signing secrets and notification tokens survive a key rotation", async () => {
    useKeys(oldKey);
    const { user, workspace } = await createWorkspaceMember();
    const person = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, user.id))
        .limit(1),
      "person",
    );
    const webhook = requireRow(
      await db
        .insert(webhookTable)
        .values({
          workspaceId: workspace.id,
          name: "Ops hook",
          url: "https://hooks.example.com/in",
          secret: encryptSecret("whsec_current") as string,
          secretPrevious: encryptSecret("whsec_outgoing") as string,
          events: ["work_item.created"],
          createdBy: person.id,
        })
        .returning(),
      "webhook",
    );
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: user.id,
      ntfyToken: encryptSecret("ntfy-token") as string,
    });

    // The documented rotation: new key current, old key previous.
    useKeys(newKey, oldKey);
    expect(webhookSigningSecrets(webhook)).toEqual({
      secret: "whsec_current",
      secretPrevious: "whsec_outgoing",
    });
    const before = await getSecretsRekeyProgress();
    expect(before.pending.textSecrets).toBe(3);
    expect(before.complete).toBe(false);

    const outcome = await runSecretsRekey();
    expect(outcome.rekeyed.textSecrets).toBe(3);
    expect(outcome.failed.textSecrets).toBe(0);
    expect(await getSecretsRekeyProgress()).toMatchObject({
      pending: { textSecrets: 0 },
      complete: true,
    });

    // The old key can now be removed and every secret is still readable.
    useKeys(newKey);
    const [after] = await db
      .select()
      .from(webhookTable)
      .where(eq(webhookTable.id, webhook.id));
    expect(webhookSigningSecrets(after as typeof webhook)).toEqual({
      secret: "whsec_current",
      secretPrevious: "whsec_outgoing",
    });
    const [pref] = await db
      .select()
      .from(schema.userNotificationPreferenceTable)
      .where(eq(schema.userNotificationPreferenceTable.userId, user.id));
    expect(decryptSecret(pref?.ntfyToken)).toBe("ntfy-token");
  });

  it("P4R1-H2: legacy enc:v1 tokens under the current key do not turn Health red, and need no previous key", async () => {
    useKeys(oldKey);
    const { user } = await createWorkspaceMember();
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      createHash("sha256").update(oldKey).digest(),
      iv,
    );
    const body = Buffer.concat([
      cipher.update("legacy-token", "utf8"),
      cipher.final(),
    ]);
    const legacy = `enc:v1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: user.id,
      ntfyToken: legacy,
    });

    // Current key only, no previous key configured: the value is readable, so nothing is pending
    // and Health is ok (it only awaits the optional format upgrade).
    const progress = await getSecretsRekeyProgress();
    expect(progress.pending.textSecrets).toBe(0);
    expect(progress.total.textSecrets).toBe(1);
    expect(classifySecrets(progress).state).toBe("ok");

    // After a rotation the same value is only readable through the previous key: pending, and
    // failing once the previous key is gone.
    useKeys(newKey, oldKey);
    expect((await getSecretsRekeyProgress()).pending.textSecrets).toBe(1);
    useKeys(newKey);
    const lost = await getSecretsRekeyProgress();
    expect(lost.pending.textSecrets).toBe(1);
    expect(classifySecrets(lost).state).toBe("failing");
  });
});
