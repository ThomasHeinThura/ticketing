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

  it("keys IPv6 clients on their /64 and IPv4-mapped clients on the embedded IPv4", async () => {
    await db
      .update(schema.instanceSettingTable)
      .set({ anonymousRateLimitWindowMs: 60_000, anonymousRateLimitMax: 1 })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const consume = async (ip: string) =>
      (await consumeAnonymousInvitationRateLimit(ip)).allowed;

    // Rotating the interface identifier inside one /64 does not mint a fresh bucket.
    expect(await consume("2001:db8:1:2::1")).toBe(true);
    expect(await consume("2001:db8:1:2:abcd:ef01:2345:6789")).toBe(false);
    expect(await consume("2001:0db8:0001:0002:ffff::99")).toBe(false);
    // A neighbouring /64 is a different client.
    expect(await consume("2001:db8:1:3::1")).toBe(true);

    // IPv4-mapped and plain IPv4 spellings of one client share a bucket...
    expect(await consume("203.0.113.7")).toBe(true);
    expect(await consume("::ffff:203.0.113.7")).toBe(false);
    expect(await consume("::ffff:cb00:7107")).toBe(false);
    // ...while distinct mapped IPv4 clients never collapse into one ::/64 bucket.
    expect(await consume("::ffff:203.0.113.8")).toBe(true);

    const rows = await db
      .select()
      .from(schema.requestRateLimitCounterTable)
      .where(
        eq(schema.requestRateLimitCounterTable.bucket, "anonymous_invitation"),
      );
    expect(rows).toHaveLength(4);
  });
});
