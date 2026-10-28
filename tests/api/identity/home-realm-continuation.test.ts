import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openHomeRealmContinuation,
  sealHomeRealmContinuation,
} from "../../../apps/api/src/identity/home-realm-continuation";
import {
  consumeHomeRealmRateLimit,
  rateLimitClientAddress,
} from "../../../apps/api/src/identity/home-realm-rate-limit";

const key = "a".repeat(64);
let previousKey: string | undefined;

async function hitLimit(
  options: Parameters<typeof consumeHomeRealmRateLimit>[1],
): Promise<boolean> {
  const app = new Hono();
  app.get("/", async (c) =>
    c.json({ allowed: await consumeHomeRealmRateLimit(c, options) }),
  );
  const response = await app.request("/");
  const result = (await response.json()) as { allowed: boolean };
  return result.allowed;
}

describe("home-realm continuation cookie envelope", () => {
  beforeEach(() => {
    previousKey = process.env.TASKDESK_ENCRYPTION_KEY;
    process.env.TASKDESK_ENCRYPTION_KEY = key;
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env.TASKDESK_ENCRYPTION_KEY;
    else process.env.TASKDESK_ENCRYPTION_KEY = previousKey;
  });

  it("authenticates a short-lived server-selected connection and domain", () => {
    const now = 1_800_000_000_000;
    const token = sealHomeRealmContinuation(
      { connectionId: "conn-customer-1", domain: "example.test" },
      now,
    );

    expect(token).not.toContain("conn-customer-1");
    expect(token).not.toContain("example.test");
    expect(openHomeRealmContinuation(token, now + 1)).toEqual({
      connectionId: "conn-customer-1",
      domain: "example.test",
      expiresAt: now + 120_000,
    });
  });

  it("preserves only the validated public invitation id in the encrypted continuation", () => {
    const now = 1_800_000_000_000;
    const token = sealHomeRealmContinuation(
      {
        connectionId: "conn-customer-1",
        domain: "example.test",
        invitationId: "invite_123",
      },
      now,
    );

    expect(token).not.toContain("invite_123");
    expect(openHomeRealmContinuation(token, now + 1)).toEqual({
      connectionId: "conn-customer-1",
      domain: "example.test",
      invitationId: "invite_123",
      expiresAt: now + 120_000,
    });
    expect(() =>
      sealHomeRealmContinuation({
        connectionId: "conn-customer-1",
        domain: "example.test",
        invitationId: "../other",
      }),
    ).toThrow();
  });

  it("rejects tampering, malformed tokens, and expired continuations", () => {
    const now = 1_800_000_000_000;
    const token = sealHomeRealmContinuation(
      { connectionId: "conn-customer-1", domain: "example.test" },
      now,
    );

    const tampered = Buffer.from(token, "base64url");
    tampered[12] = (tampered[12] ?? 0) ^ 1;
    expect(
      openHomeRealmContinuation(tampered.toString("base64url"), now),
    ).toBeNull();
    expect(openHomeRealmContinuation("not-a-token", now)).toBeNull();
    expect(openHomeRealmContinuation(token, now + 120_000)).toBeNull();
  });

  it("rejects alternate encodings of the same authenticated bytes", () => {
    const now = 1_800_000_000_000;
    let token = sealHomeRealmContinuation(
      { connectionId: "connection", domain: "example.test" },
      now,
    );
    if (Buffer.from(token, "base64url").length % 3 === 0)
      token = sealHomeRealmContinuation(
        { connectionId: "connection-a", domain: "example.test" },
        now,
      );
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(token.at(-1) ?? "");
    const alternate = token.slice(0, -1) + alphabet[last ^ 1];
    expect(Buffer.from(alternate, "base64url")).toEqual(
      Buffer.from(token, "base64url"),
    );
    expect(openHomeRealmContinuation(alternate, now)).toBeNull();
  });
});

describe("home-realm anonymous rate limit", () => {
  it("enforces the instance count per trusted client key and fails closed on Valkey errors", async () => {
    const clientIp = `home-realm-rate-test-${randomUUID()}`;
    const config = async () => ({ windowMs: 60_000, max: 1 });
    const localDependencies = {
      readConfig: config,
      clientIp: () => clientIp,
      distributedConfigured: () => false,
      now: () => 1_800_000_000_000,
    };
    expect(await hitLimit(localDependencies)).toBe(true);
    expect(await hitLimit(localDependencies)).toBe(false);

    expect(
      await hitLimit({
        readConfig: config,
        clientIp: () => `${clientIp}-valkey`,
        distributedConfigured: () => true,
        consumeDistributed: async () => {
          throw new Error("private backend failure");
        },
      }),
    ).toBe(false);
  });

  it("refuses invalid instance configuration", async () => {
    expect(
      await hitLimit({
        readConfig: async () => ({ windowMs: 1, max: 0 }),
        clientIp: () => "home-realm-invalid-config-test",
        distributedConfigured: () => false,
      }),
    ).toBe(false);
  });

  it("keys an IPv6 client on its /64 so rotating inside the prefix shares one bucket (P3-R1-09)", async () => {
    const prefix = randomUUID()
      .slice(0, 4)
      .replace(/[^0-9a-f]/g, "a");
    const config = async () => ({ windowMs: 60_000, max: 1 });
    const make = (address: string) => ({
      readConfig: config,
      clientIp: () => address,
      distributedConfigured: () => false,
      now: () => 1_800_000_000_000,
    });
    expect(await hitLimit(make(`2001:db8:${prefix}:1::1`))).toBe(true);
    // Same /64, different interface identifier and spelling: same bucket.
    expect(
      await hitLimit(make(`2001:db8:${prefix}:1:abcd:ef01:2345:6789`)),
    ).toBe(false);
    expect(await hitLimit(make(`2001:0db8:${prefix}:0001:0:0:0:ffff`))).toBe(
      false,
    );
    // A different /64 is a different client.
    expect(await hitLimit(make(`2001:db8:${prefix}:2::1`))).toBe(true);
    // IPv4 is unchanged.
    expect(rateLimitClientAddress("203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitClientAddress("2001:db8:1:2:3:4:5:6")).toBe(
      "2001:db8:1:2::/64",
    );
    expect(rateLimitClientAddress("::1")).toBe("0:0:0:0::/64");
    // IPv4-mapped clients keep their own IPv4 bucket in both spellings.
    expect(rateLimitClientAddress("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitClientAddress("::ffff:cb00:7109")).toBe("203.0.113.9");
    expect(rateLimitClientAddress("::ffff:198.51.100.7")).not.toBe(
      rateLimitClientAddress("::ffff:203.0.113.9"),
    );
  });
});
