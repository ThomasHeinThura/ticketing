/**
 * IP-14 / IP-24 over the real SCIM router.
 *
 * Run only on the dedicated disposable identity-ledger integration database.
 *
 * The anonymous failure counter is database-shared and keyed by an HMAC of the trusted client
 * address. The disposable test database is reset between cases.
 */
import { eq, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import * as scimRateStore from "../../../apps/api/src/identity/scim-rate-limit-store";
import {
  consumeScimRateLimit,
  hitScimRateLimit,
  scimRateLimitKeyHash,
} from "../../../apps/api/src/identity/scim-rate-limit-store";
import { createApp } from "../../../apps/api/src/index";
import * as observability from "../../../apps/api/src/instance/observability/runtime";
import { ensureInternalOrganisation } from "../../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "../helpers/database";

const KEY = "ab".repeat(32);

async function fixture(
  connectionId: string,
  token: string,
  flags: { connectionEnabled?: boolean; scimEnabled?: boolean } = {},
) {
  await ensureInternalOrganisation();
  await db.insert(schema.identityConnectionTable).values({
    id: connectionId,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    displayName: "SCIM limits fixture",
    issuer: "https://login.microsoftonline.com/tenant/v2.0",
    tenantId: "tenant",
    clientId: "client",
    clientSecret: encryptIdentityClientSecret(connectionId, "fixture"),
    redirectUri: "http://localhost:1337/api/identity/callback",
    scopes: ["openid"],
    claimMapping: {},
    domainBindings: [],
    jitPolicy: { enabled: false, requiredEntraAppRole: "staff" },
    maxRoleRank: 10,
    enabled: flags.connectionEnabled ?? true,
  });
  await db.insert(schema.scimConnectionTable).values({
    identityConnectionId: connectionId,
    tokenHash: sha256(token),
    tokenPrefix: token.slice(0, 8),
    tokenCreatedAt: new Date(),
    allowedResources: ["users", "groups"],
    enabled: flags.scimEnabled ?? true,
  });
  return createApp().app;
}

const scimRequest = (
  app: Awaited<ReturnType<typeof fixture>>,
  token: string,
  init: { method?: string; body?: string; authorization?: string } = {},
) =>
  app.request("/scim/v2/Users", {
    method: init.method ?? "GET",
    headers: {
      authorization: init.authorization ?? `Bearer ${token}`,
      "content-type": "application/scim+json",
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });

describe("IP-14 / IP-24 SCIM limits and authentication-failure events", () => {
  beforeEach(async () => {
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY", KEY);
    vi.stubEnv("TASKDESK_AUTH_SECRET", KEY);
    await resetTestDatabase();
  });

  it("rejects an oversized body with a SCIM 413 tooLarge before the handler runs", async () => {
    const token = "A".repeat(43);
    const app = await fixture("scim-limit-413", token);
    const response = await scimRequest(app, token, {
      method: "POST",
      body: JSON.stringify({ blob: "x".repeat(2 * 1024 * 1024 + 10) }),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain(
      "application/scim+json",
    );
    expect(await response.json()).toMatchObject({
      status: "413",
      scimType: "tooLarge",
    });
    expect(await db.select().from(schema.externalIdentityTable)).toHaveLength(
      0,
    );
    const [denied] = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(eq(schema.provisioningEventTable.kind, "request.denied"));
    expect(denied).toMatchObject({
      identityConnectionId: "scim-limit-413",
      outcome: "denied",
      detail: { reason: "request_too_large" },
    });
  });

  it("writes an auth.failed provisioning event, without any secret, when a disabled connection's token is used", async () => {
    const token = "B".repeat(43);
    const app = await fixture("scim-auth-failed", token, {
      connectionEnabled: false,
    });
    const response = await scimRequest(app, token);
    expect(response.status).toBe(401);
    const events = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(
        eq(
          schema.provisioningEventTable.identityConnectionId,
          "scim-auth-failed",
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "auth.failed",
      outcome: "failed",
      actorType: "scim",
      detail: { reason: "connection_disabled" },
    });
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(token.slice(0, 8));
    expect(serialised).not.toContain(sha256(token).toString("hex"));
  });

  it("records unknown and rotated tokens without inventing a connection", async () => {
    const original = "C".repeat(43);
    const rotated = "E".repeat(43);
    const unknown = "D".repeat(43);
    const app = await fixture("scim-unknown-token", original);
    expect((await scimRequest(app, unknown)).status).toBe(401);
    await db
      .update(schema.scimConnectionTable)
      .set({ tokenHash: sha256(rotated), tokenPrefix: rotated.slice(0, 8) })
      .where(
        eq(
          schema.scimConnectionTable.identityConnectionId,
          "scim-unknown-token",
        ),
      );
    expect((await scimRequest(app, original)).status).toBe(401);

    const events = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(isNull(schema.provisioningEventTable.identityConnectionId));
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.detail)).toEqual(
      expect.arrayContaining([
        { reason: "credential_unrecognized" },
        { reason: "credential_unrecognized" },
      ]),
    );
    expect(events.every((event) => event.kind === "auth.failed")).toBe(true);
    expect(events.every((event) => event.actorType === "scim")).toBe(true);
    const serialised = JSON.stringify(events);
    for (const secret of [original, rotated, unknown]) {
      expect(serialised).not.toContain(secret);
      expect(serialised).not.toContain(sha256(secret).toString("hex"));
    }
  });

  it("records one attributed auth failure when a token rotates after initial resolution", async () => {
    const original = "L".repeat(43);
    const rotated = "M".repeat(43);
    const connectionId = "scim-token-rotation-race";
    const app = await fixture(connectionId, original);
    let markLocked = () => {};
    let releaseLock = () => {};
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockHolder = db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM ${schema.identityConnectionTable}
        WHERE id = ${connectionId}
        FOR UPDATE
      `);
      markLocked();
      await released;
      await tx
        .update(schema.scimConnectionTable)
        .set({ tokenHash: sha256(rotated), tokenPrefix: rotated.slice(0, 8) })
        .where(
          eq(schema.scimConnectionTable.identityConnectionId, connectionId),
        );
    });
    await locked;

    const request = scimRequest(app, original, {
      method: "POST",
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "rotation-race-user",
        userName: "rotation-race@example.test",
        displayName: "Rotation Race",
        emails: [{ value: "rotation-race@example.test", primary: true }],
      }),
    });
    try {
      await vi.waitFor(
        async () => {
          const waiting = await db.execute<{ count: number }>(sql`
            SELECT count(*)::int AS count
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query ILIKE '%identity_connection%'
              AND query ILIKE '%for update%'
          `);
          expect(Number(waiting.rows[0]?.count ?? 0)).toBeGreaterThan(0);
        },
        { timeout: 5_000, interval: 20 },
      );
    } finally {
      releaseLock();
      await lockHolder;
    }

    const response = await request;
    expect(response.status).toBe(401);
    const events = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(
        eq(schema.provisioningEventTable.identityConnectionId, connectionId),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "auth.failed",
      outcome: "failed",
      actorType: "scim",
      detail: { reason: "credential_rotated" },
    });
    expect(events[0]?.detail).not.toHaveProperty("token");
    expect(events[0]?.detail).not.toHaveProperty("tokenHash");
    expect(
      await db
        .select()
        .from(schema.externalIdentityTable)
        .where(
          eq(schema.externalIdentityTable.identityConnectionId, connectionId),
        ),
    ).toHaveLength(0);
  });

  it("records malformed authorization without attributing a connection", async () => {
    const app = await fixture("scim-malformed-auth", "G".repeat(43));
    expect(
      (
        await scimRequest(app, "G".repeat(43), {
          authorization: "Bearer malformed",
        })
      ).status,
    ).toBe(401);
    const [event] = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(isNull(schema.provisioningEventTable.identityConnectionId));
    expect(event).toMatchObject({
      kind: "auth.failed",
      outcome: "failed",
      actorType: "scim",
      detail: { reason: "authorization_invalid" },
    });
  });

  it("writes more than ten unknown-token failure events before the ingress limit applies", async () => {
    const app = await fixture("scim-failure-ledger-budget", "H".repeat(43));
    const failures = await Promise.all(
      Array.from({ length: 12 }, () => scimRequest(app, "I".repeat(43))),
    );
    expect(failures.every((response) => response.status === 401)).toBe(true);
    const events = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(isNull(schema.provisioningEventTable.identityConnectionId));
    expect(events).toHaveLength(12);
    const [counter] = await db
      .select()
      .from(schema.requestRateLimitCounterTable)
      .where(
        eq(
          schema.requestRateLimitCounterTable.keyHash,
          scimRateLimitKeyHash("anonymous_scim_failure", "no-trusted-ip"),
        ),
      );
    expect(counter).toMatchObject({
      bucket: "anonymous_scim_failure",
      count: 12,
    });
    expect(counter?.keyHash).not.toContain("no-trusted-ip");
  });

  it("shares atomic counters across requests and caps bursts without fallback state", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        hitScimRateLimit({
          bucket: "scim_connection",
          key: "scim-shared-counter-fixture",
          limit: 20,
          windowMs: 60_000,
        }),
      ),
    );
    const [counter] = await db
      .select()
      .from(schema.requestRateLimitCounterTable)
      .where(
        eq(
          schema.requestRateLimitCounterTable.keyHash,
          scimRateLimitKeyHash(
            "scim_connection",
            "scim-shared-counter-fixture",
          ),
        ),
      );
    expect(results.filter(({ allowed }) => allowed)).toHaveLength(20);
    expect(results.filter(({ allowed }) => !allowed)).toHaveLength(5);
    expect(counter).toMatchObject({ bucket: "scim_connection", count: 21 });
  });

  it("enforces the authenticated 600-per-minute ceiling with the shared consume path", async () => {
    const results = await Promise.all(
      Array.from({ length: 601 }, () =>
        consumeScimRateLimit({
          bucket: "scim_connection",
          key: "scim-600-request-fixture",
          limit: 600,
          windowMs: 60_000,
        }),
      ),
    );
    expect(results.filter(({ allowed }) => allowed)).toHaveLength(600);
    expect(results.filter(({ allowed }) => !allowed)).toHaveLength(1);
    const [counter] = await db
      .select()
      .from(schema.requestRateLimitCounterTable)
      .where(
        eq(
          schema.requestRateLimitCounterTable.keyHash,
          scimRateLimitKeyHash("scim_connection", "scim-600-request-fixture"),
        ),
      );
    expect(counter).toMatchObject({
      bucket: "scim_connection",
      count: 601,
    });
  });

  it("resets an expired window using one server timestamp for start and expiry", async () => {
    const key = "scim-window-reset-fixture";
    const oldStart = new Date(Date.now() - 120_000);
    await db.insert(schema.requestRateLimitCounterTable).values({
      bucket: "scim_connection",
      keyHash: scimRateLimitKeyHash("scim_connection", key),
      windowStartedAt: oldStart,
      count: 600,
      expiresAt: new Date(oldStart.getTime() + 60_000),
    });

    const result = await consumeScimRateLimit({
      bucket: "scim_connection",
      key,
      limit: 600,
      windowMs: 60_000,
    });
    const [counter] = await db
      .select()
      .from(schema.requestRateLimitCounterTable)
      .where(
        eq(
          schema.requestRateLimitCounterTable.keyHash,
          scimRateLimitKeyHash("scim_connection", key),
        ),
      );
    expect(result.allowed).toBe(true);
    expect(counter?.count).toBe(1);
    expect(counter?.windowStartedAt.getTime()).toBeGreaterThan(
      oldStart.getTime(),
    );
    if (!counter) throw new Error("SCIM counter row was not written");
    expect(
      counter.expiresAt.getTime() - counter.windowStartedAt.getTime(),
    ).toBe(60_000);
  });

  it("rejects unattributed ledger rows outside failure kinds and fields at the database boundary", async () => {
    const token = "J".repeat(43);
    const connectionId = "scim-failure-ledger-constraint";
    await fixture(connectionId, token);
    const internal = await ensureInternalOrganisation();
    const personId = "scim-failure-ledger-person";
    const externalIdentityId = "scim-failure-ledger-external";
    await db.insert(schema.personTable).values({
      id: personId,
      organisationId: internal.id,
      side: "staff",
      displayName: "Ledger constraint fixture",
    });
    await db.insert(schema.externalIdentityTable).values({
      id: externalIdentityId,
      identityConnectionId: connectionId,
      personId,
      issuer: "https://issuer.example.test",
      subject: "ledger-constraint-subject",
      provisionedVia: "scim",
    });

    const unattributed = {
      identityConnectionId: null,
      detail: { reason: "credential_unrecognized" },
      actorType: "scim",
    } as const;
    await expect(
      db.insert(schema.provisioningEventTable).values({
        ...unattributed,
        kind: "user.created",
        outcome: "success",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.provisioningEventTable).values({
        ...unattributed,
        kind: "auth.failed",
        outcome: "success",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.provisioningEventTable).values({
        ...unattributed,
        scimConnectionId: connectionId,
        kind: "auth.failed",
        outcome: "failed",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.provisioningEventTable).values({
        ...unattributed,
        externalIdentityId,
        kind: "request.denied",
        outcome: "denied",
      }),
    ).rejects.toThrow();
  });

  it("limits failed authentication per client with a SCIM 429, then refuses before any lookup", async () => {
    const app = await fixture("scim-failure-429", "E".repeat(43));
    let limited: Response | undefined;
    for (let attempt = 0; attempt < 30 && !limited; attempt += 1) {
      const response = await scimRequest(app, "F".repeat(43));
      if (response.status === 429) limited = response;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBeTruthy();
    expect(await limited?.json()).toMatchObject({ status: "429" });
    const [counter] = await db
      .select()
      .from(schema.requestRateLimitCounterTable)
      .where(
        eq(
          schema.requestRateLimitCounterTable.keyHash,
          scimRateLimitKeyHash("anonymous_scim_failure", "no-trusted-ip"),
        ),
      );
    expect(counter?.count).toBe(20);
    const failures = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(eq(schema.provisioningEventTable.kind, "auth.failed"));
    expect(failures).toHaveLength(20);
    const denied = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(eq(schema.provisioningEventTable.kind, "request.denied"));
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      identityConnectionId: null,
      outcome: "denied",
      detail: { reason: "rate_limited" },
    });
  });

  it("records a matched connection rate-limit denial against its resolved authority", async () => {
    const token = "K".repeat(43);
    const connectionId = "scim-connection-rate-denial";
    const app = await fixture(connectionId, token);
    const started = new Date();
    await db.insert(schema.requestRateLimitCounterTable).values({
      bucket: "scim_connection",
      keyHash: scimRateLimitKeyHash("scim_connection", connectionId),
      windowStartedAt: started,
      count: 600,
      expiresAt: new Date(started.getTime() + 60_000),
    });
    const response = await scimRequest(app, token);
    expect(response.status).toBe(429);
    const [denied] = await db
      .select()
      .from(schema.provisioningEventTable)
      .where(eq(schema.provisioningEventTable.kind, "request.denied"));
    expect(denied).toMatchObject({
      identityConnectionId: connectionId,
      outcome: "denied",
      detail: { reason: "rate_limited" },
    });
  });

  it("fails closed with bounded operational logging when the rate-limit store is unavailable", async () => {
    const token = "N".repeat(43);
    const app = await fixture("scim-rate-store-unavailable", token);
    const check = vi
      .spyOn(scimRateStore, "checkScimRateLimit")
      .mockRejectedValue(new Error("database detail must not be logged"));
    const log = vi
      .spyOn(observability, "logTaskDesk")
      .mockImplementation(() => {});

    const response = await scimRequest(app, token);
    check.mockRestore();

    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledWith({
      module: "database",
      message: "database.failure",
      level: "error",
      result: "failed",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "database detail must not be logged",
    );
    log.mockRestore();
  });
});
