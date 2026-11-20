import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { webhookTable } from "../../apps/api/src/database/schema";
import { createWebhook } from "../../apps/api/src/webhook/repository";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

beforeEach(async () => resetTestDatabase());

it("serializes creates against the organisation webhook quota", async () => {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id)),
    "person",
  );
  const organisationId = workspace.organisationId;
  if (!organisationId) throw new Error("missing organisation");
  await db
    .insert(schema.organisationQuotaTable)
    .values({ organisationId, maxWebhooks: 1 })
    .onConflictDoUpdate({
      target: schema.organisationQuotaTable.organisationId,
      set: { maxWebhooks: 1 },
    });
  let release!: () => void;
  let entered!: () => void;
  const holding = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const input = {
    workspaceId: workspace.id,
    actor: {
      userId: user.id,
      personId: person.id,
      actorType: "person" as const,
      apiKeyId: null,
    },
    name: "Webhook",
    url: "https://example.test/hook",
    secret: "secret",
    events: ["work_item.created"],
  };
  const first = createWebhook({
    ...input,
    spend: async () => {
      entered();
      await holding;
    },
  });
  await inside;
  const second = createWebhook({ ...input, spend: async () => {} });
  const settled = Promise.allSettled([first, second]);
  let waiting = false;
  try {
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const locks = await db.execute<{ waiting: boolean }>(
        sql`select exists (select 1 from pg_locks where locktype = 'advisory' and not granted) as waiting`,
      );
      waiting = locks.rows[0]?.waiting === true;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    release();
  }
  const results = await settled;
  expect(waiting).toBe(true);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason.status).toBe(429);
  expect(await db.select().from(webhookTable)).toHaveLength(1);
});
