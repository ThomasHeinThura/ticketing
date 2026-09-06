import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

/**
 * A throwaway sign-up password, assembled at runtime rather than written down.
 *
 * This used to be a hard-coded literal, which GitGuardian flagged — correctly. A
 * credential-shaped literal in a repository is one whether or not it guards anything:
 * it has to be excluded from every scanner by hand forever, and it is the first thing
 * someone copies when they need "a password for a test". Each caller signs up a fresh
 * random email, so nothing needs to reuse the value and generating it changes no
 * behaviour.
 */
const throwawayPassword = () => `Pw-${randomUUID()}`;

async function signUpWithForwardedFor(forwardedFor: string) {
  const { app } = createApp();
  const email = `ip-${randomUUID()}@example.com`;

  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwardedFor,
    },
    body: JSON.stringify({
      email,
      password: throwawayPassword(),
      name: "IP Probe",
    }),
  });

  expect(response.status).toBeLessThan(400);

  const [user] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email));

  const [session] = await db
    .select()
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.userId, user.id))
    .orderBy(desc(schema.sessionTable.createdAt))
    .limit(1);

  return session;
}

/**
 * The address recorded on a session, at the DEFAULT trust depth of one hop —
 * `TASKDESK_TRUST_PROXY=1`, meaning Traefik directly in front, which is the
 * shipped compose.
 *
 * The two tests that used to live here assumed kaneo's deployment shape: an
 * in-image nginx behind an outer proxy, i.e. TWO appending hops, so
 * "203.0.113.9, 172.19.0.5" was expected to resolve to the leftmost entry.
 * TaskDesk has no in-image web server — `apps/web/nginx.conf` and
 * `nginx.kaneo.conf` are both excluded by the copy table — so that shape does
 * not exist here, and asserting it would bake in an architecture we removed.
 *
 * The full depth matrix (0, 1, 2, short chains, forged prefixes, IPv4-mapped
 * IPv6) is covered directly in tests/api/utils/resolve-client-ip.test.ts. What
 * matters at this level is that the resolved value is what actually reaches
 * the session row, and that a caller cannot choose it.
 */
describe("the client IP recorded on a session", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("records the address the trusted proxy appended", async () => {
    const session = await signUpWithForwardedFor("203.0.113.40");

    expect(session.ipAddress).toBe("203.0.113.40");
  });

  it("IGNORES an address the caller prepended to the chain", async () => {
    // The security property. kaneo walked the chain right-to-left skipping
    // anything inside a trusted CIDR set, which on a shared cluster meant a
    // caller could prepend an address and have it selected. Counting one hop
    // from the right takes the entry the proxy appended and nothing else.
    const session = await signUpWithForwardedFor("198.51.100.7, 203.0.113.40");

    expect(session.ipAddress).toBe("203.0.113.40");
    expect(session.ipAddress).not.toBe("198.51.100.7");
  });

  it("cannot be steered by a forged cf-connecting-ip header", async () => {
    // kaneo listed cf-connecting-ip FIRST in ipAddressHeaders. It is single
    // valued, so nothing could validate it, and TaskDesk is not behind
    // Cloudflare — it simply arrived from whoever set it. It is no longer read.
    const { app } = createApp();
    const email = `ip-cf-${randomUUID()}@example.com`;

    const response = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.77",
        "cf-connecting-ip": "198.51.100.99",
      },
      body: JSON.stringify({
        email,
        password: throwawayPassword(),
        name: "CF Probe",
      }),
    });
    expect(response.status).toBeLessThan(400);

    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, email));
    const [session] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, user.id))
      .orderBy(desc(schema.sessionTable.createdAt))
      .limit(1);

    expect(session.ipAddress).toBe("203.0.113.77");
    expect(session.ipAddress).not.toBe("198.51.100.99");
  });

  it("cannot be steered by forging the internal header itself", async () => {
    // buildAuthRequest strips any inbound x-taskdesk-client-ip before setting
    // it. Without that strip this fix would just have renamed the hole.
    const { app } = createApp();
    const email = `ip-int-${randomUUID()}@example.com`;

    const response = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.88",
        "x-taskdesk-client-ip": "198.51.100.123",
      },
      body: JSON.stringify({
        email,
        password: throwawayPassword(),
        name: "Internal Header Probe",
      }),
    });
    expect(response.status).toBeLessThan(400);

    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, email));
    const [session] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, user.id))
      .orderBy(desc(schema.sessionTable.createdAt))
      .limit(1);

    expect(session.ipAddress).toBe("203.0.113.88");
    expect(session.ipAddress).not.toBe("198.51.100.123");
  });
});
