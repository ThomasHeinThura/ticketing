import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { consumeAnonymousInvitationRateLimit } from "../../apps/api/src/utils/invitation-anonymous-rate-limit";
import { resetTestDatabase } from "./helpers/database";

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton" })
    .onConflictDoNothing();
});

describe("shared anonymous invitation request limiter", () => {
  it("atomically enforces the configured ceiling and stores only an HMAC digest", async () => {
    await db
      .update(schema.instanceSettingTable)
      .set({ anonymousRateLimitWindowMs: 60_000, anonymousRateLimitMax: 2 })
      .where(eq(schema.instanceSettingTable.id, "singleton"));

    const clientIp = "198.51.100.234";
    const decisions = await Promise.all(
      Array.from({ length: 8 }, () =>
        consumeAnonymousInvitationRateLimit(clientIp),
      ),
    );
    const allowed = decisions.filter((decision) => decision.allowed);
    const denied = decisions.filter((decision) => !decision.allowed);
    expect(allowed).toHaveLength(2);
    expect(allowed.every((decision) => decision.retryAfterSeconds === 0)).toBe(
      true,
    );
    expect(denied).toHaveLength(6);
    expect(denied.every((decision) => decision.retryAfterSeconds > 0)).toBe(
      true,
    );

    const rows = await db
      .select()
      .from(schema.requestRateLimitCounterTable)
      .where(
        eq(schema.requestRateLimitCounterTable.bucket, "anonymous_invitation"),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(3);
    expect(rows[0]?.keyHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(rows[0]?.keyHash).not.toBe(clientIp);
  });

  it("uses a distinct counter identity when the configured window changes", async () => {
    await db
      .update(schema.instanceSettingTable)
      .set({ anonymousRateLimitWindowMs: 60_000, anonymousRateLimitMax: 1 })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const clientIp = "198.51.100.235";
    expect((await consumeAnonymousInvitationRateLimit(clientIp)).allowed).toBe(
      true,
    );
    expect((await consumeAnonymousInvitationRateLimit(clientIp)).allowed).toBe(
      false,
    );

    await db
      .update(schema.instanceSettingTable)
      .set({ anonymousRateLimitWindowMs: 120_000 })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    expect((await consumeAnonymousInvitationRateLimit(clientIp)).allowed).toBe(
      true,
    );

    const rows = await db
      .select()
      .from(schema.requestRateLimitCounterTable)
      .where(
        and(
          eq(
            schema.requestRateLimitCounterTable.bucket,
            "anonymous_invitation",
          ),
          eq(schema.requestRateLimitCounterTable.count, 1),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
