import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { webhookTable } from "../../apps/api/src/database/schema";
import { encryptSecret } from "../../apps/api/src/notification-preferences/secrets";
import {
  rotateAllWebhookSecrets,
  WebhookRotationSetConflictError,
  webhookSigningSecrets,
} from "../../apps/api/src/webhook/repository";
import {
  buildWebhookHeaders,
  signWebhookBody,
} from "../../apps/api/src/webhook/signature";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

process.env.TASKDESK_ENCRYPTION_KEY ??= "e3".repeat(32);

function encrypted(secret: string): string {
  const value = encryptSecret(secret);
  if (!value) throw new Error("test webhook secret could not be encrypted");
  return value;
}

describe("WH-13 rotate all webhook secrets", () => {
  beforeEach(async () => resetTestDatabase());

  it("rotates the exact current set atomically, keeps two signatures for 24 hours, and redacts audits", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const person = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, owner.user.id))
        .limit(1),
      "webhook owner person",
    );
    const rows = await db
      .insert(webhookTable)
      .values([
        {
          workspaceId: owner.workspace.id,
          name: "Delivery A",
          url: "https://hooks.example.test/a",
          secret: encrypted("old-secret-for-webhook-a-00000001"),
          events: ["work_item.updated"],
          createdBy: person.id,
        },
        {
          workspaceId: owner.workspace.id,
          name: "Delivery B",
          url: "https://hooks.example.test/b",
          secret: encrypted("old-secret-for-webhook-b-00000001"),
          events: ["work_item.updated"],
          createdBy: person.id,
        },
      ])
      .returning();
    if (rows.length !== 2)
      throw new Error("webhook fixtures were not inserted");
    const replacements = {
      webhooks: rows.map((row, index) => ({
        webhookId: row.id,
        expectedVersion: row.version,
        secret:
          index === 0
            ? "new-secret-for-webhook-a-00000001"
            : "new-secret-for-webhook-b-00000001",
      })),
    };
    const spend = vi.fn(async () => {});
    const actor = {
      userId: owner.user.id,
      personId: person.id,
      actorType: "person" as const,
      apiKeyId: null,
    };

    const result = await rotateAllWebhookSecrets({
      replacements,
      actor,
      spend,
    });
    expect(result.rotatedCount).toBe(2);
    expect(result.rotatedAt).toBeInstanceOf(Date);
    expect(spend).toHaveBeenCalledOnce();

    const stored = await db
      .select()
      .from(webhookTable)
      .where(eq(webhookTable.workspaceId, owner.workspace.id))
      .orderBy(webhookTable.id);
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      const replacement = replacements.webhooks.find(
        (entry) => entry.webhookId === row.id,
      );
      const previous = rows.find((entry) => entry.id === row.id);
      expect(replacement).toBeDefined();
      expect(previous).toBeDefined();
      expect(row.version).toBe((previous?.version ?? 0) + 1);
      expect(row.secret).not.toContain(replacement?.secret ?? "");
      expect(row.secretPrevious).toBe(previous?.secret);
      expect(webhookSigningSecrets(row)).toEqual({
        secret: replacement?.secret,
        secretPrevious:
          "old-secret-for-webhook-" +
          (row.name.endsWith("A") ? "a" : "b") +
          "-00000001",
      });
      expect(row.secretRotatedAt).toEqual(result.rotatedAt);
    }

    const rawBody = '{"type":"work_item.updated"}';
    const firstRow = stored[0];
    if (!firstRow?.secretRotatedAt)
      throw new Error("rotation timestamp missing");
    const withinGrace = buildWebhookHeaders({
      rawBody,
      secret: webhookSigningSecrets(firstRow).secret,
      secretPrevious: webhookSigningSecrets(firstRow).secretPrevious,
      secretRotatedAt: firstRow.secretRotatedAt,
      eventKind: "work_item.updated",
      deliveryId: "delivery-1",
      now: new Date(firstRow.secretRotatedAt.getTime() + 86_400_000 - 1),
    });
    expect(withinGrace["X-TaskDesk-Signature"]).toBe(
      signWebhookBody(webhookSigningSecrets(firstRow).secret, rawBody),
    );
    expect(withinGrace["X-TaskDesk-Signature-Previous"]).toBe(
      signWebhookBody(
        "old-secret-for-webhook-" +
          (firstRow.name.endsWith("A") ? "a" : "b") +
          "-00000001",
        rawBody,
      ),
    );
    const afterGrace = buildWebhookHeaders({
      rawBody,
      secret: webhookSigningSecrets(firstRow).secret,
      secretPrevious: webhookSigningSecrets(firstRow).secretPrevious,
      secretRotatedAt: firstRow.secretRotatedAt,
      eventKind: "work_item.updated",
      deliveryId: "delivery-2",
      now: new Date(firstRow.secretRotatedAt.getTime() + 86_400_000),
    });
    expect(afterGrace["X-TaskDesk-Signature-Previous"]).toBeUndefined();

    const audits = await db
      .select({
        action: schema.auditLogTable.action,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "webhook.secret_rotated"),
          eq(schema.auditLogTable.workspaceId, owner.workspace.id),
        ),
      );
    expect(audits).toHaveLength(2);
    const serialized = JSON.stringify(audits);
    for (const entry of replacements.webhooks) {
      expect(serialized).not.toContain(entry.secret);
    }
    expect(serialized).not.toContain("old-secret-for-webhook-");
  });

  it("rejects omissions and stale versions before proof spend or any rotation", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const person = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, owner.user.id))
        .limit(1),
      "webhook owner person",
    );
    const rows = await db
      .insert(webhookTable)
      .values([
        {
          workspaceId: owner.workspace.id,
          name: "Delivery A",
          url: "https://hooks.example.test/a",
          secret: encrypted("old-secret-for-webhook-a-00000001"),
          events: ["work_item.updated"],
          createdBy: person.id,
        },
        {
          workspaceId: owner.workspace.id,
          name: "Delivery B",
          url: "https://hooks.example.test/b",
          secret: encrypted("old-secret-for-webhook-b-00000001"),
          events: ["work_item.updated"],
          createdBy: person.id,
        },
      ])
      .returning();
    const spend = vi.fn(async () => {});
    const replacements = {
      webhooks: [
        {
          webhookId: rows[0]!.id,
          expectedVersion: rows[0]!.version,
          secret: "new-secret-for-webhook-a-00000001",
        },
      ],
    };

    await expect(
      rotateAllWebhookSecrets({
        replacements,
        actor: {
          userId: owner.user.id,
          personId: person.id,
          actorType: "person",
          apiKeyId: null,
        },
        spend,
      }),
    ).rejects.toBeInstanceOf(WebhookRotationSetConflictError);
    expect(spend).not.toHaveBeenCalled();
    const after = await db
      .select()
      .from(webhookTable)
      .where(eq(webhookTable.workspaceId, owner.workspace.id));
    const beforeById = new Map(rows.map((row) => [row.id, row]));
    expect(
      after
        .map((row) => [row.id, row.secret, row.version])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual(
      rows
        .map((row) => {
          const original = beforeById.get(row.id);
          return [row.id, original?.secret, original?.version];
        })
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    );
  });
});
