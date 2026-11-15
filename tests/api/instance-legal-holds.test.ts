import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_ACTIONS_NOT_YET_WIRED,
  AUDIT_ONLY_ACTIONS,
} from "../../apps/api/src/audit/actions";

type StoredHold = {
  id: string;
  scope: "organisation" | "person";
  scopeId: string;
  reason: string;
  placedBy: string;
  placedAt: Date;
  liftedBy: string | null;
  liftedAt: Date | null;
};

const { state, mockExecutor } = vi.hoisted(() => {
  const s = {
    executedSql: [] as string[],
    auditCalls: [] as Array<Record<string, unknown>>,
    organisations: new Map<string, { id: string; name: string; key: string }>(),
    people: new Map<
      string,
      { id: string; userId: string | null; displayName: string }
    >(),
    users: new Map<string, { id: string; name: string; email: string }>(),
    holds: [] as StoredHold[],
    isAdmin: true,
  };

  function flattenSql(chunk: unknown): string {
    if (typeof chunk === "string") return chunk;
    if (!chunk || typeof chunk !== "object") return String(chunk ?? "");
    if (
      "name" in chunk &&
      typeof (chunk as { name: unknown }).name === "string"
    ) {
      return (chunk as { name: string }).name;
    }
    if ("value" in chunk) {
      const val = (chunk as { value: unknown }).value;
      if (Array.isArray(val)) return val.map(flattenSql).join("");
      if (typeof val === "string") return val;
    }
    if ("queryChunks" in chunk) {
      const chunks = (chunk as { queryChunks: unknown[] }).queryChunks;
      return chunks.map(flattenSql).join("");
    }
    return "";
  }

  function collectSqlParams(chunk: unknown, out: unknown[] = []): unknown[] {
    if (!chunk || typeof chunk !== "object") return out;
    if ("queryChunks" in chunk) {
      for (const part of (chunk as { queryChunks: unknown[] }).queryChunks) {
        if (
          part &&
          typeof part === "object" &&
          "value" in part &&
          !("encoder" in part)
        ) {
          continue;
        }
        if (part && typeof part === "object" && "queryChunks" in part) {
          collectSqlParams(part, out);
        } else if (
          part &&
          typeof part === "object" &&
          "encoder" in part &&
          "value" in part
        ) {
          out.push((part as { value: unknown }).value);
        } else if (typeof part === "string" || typeof part === "number") {
          out.push(part);
        }
      }
    }
    return out;
  }

  const executor = {
    async execute(query: unknown) {
      const sqlText = flattenSql(query).replace(/\s+/gu, " ").trim();
      const params = collectSqlParams(query);
      s.executedSql.push(sqlText);

      if (
        sqlText.includes("LOCK TABLE legal_hold IN SHARE ROW EXCLUSIVE MODE")
      ) {
        return { rows: [] };
      }
      if (
        sqlText.includes(
          'SELECT count(*)::int AS "activeCount" FROM "legal_hold"',
        )
      ) {
        const activeCount = s.holds.filter((h) => h.liftedAt === null).length;
        return { rows: [{ activeCount }] };
      }
      if (
        sqlText.includes(
          'SELECT "id" FROM "legal_hold" WHERE "lifted_at" IS NULL',
        )
      ) {
        const [scope, canonicalScopeId, rawScopeId] = params as [
          string,
          string,
          string,
        ];
        const match = s.holds.find(
          (h) =>
            h.liftedAt === null &&
            h.scope === scope &&
            (h.scopeId === canonicalScopeId || h.scopeId === rawScopeId),
        );
        return { rows: match ? [{ id: match.id }] : [] };
      }
      if (sqlText.includes('FROM "legal_hold" lh')) {
        let filtered = [...s.holds];
        if (sqlText.includes('lh."id" =')) {
          const targetId = params[0] as string;
          filtered = filtered.filter((h) => h.id === targetId);
        } else {
          const wherePart =
            sqlText.split("WHERE")[1]?.split("ORDER BY")[0] ?? "";
          if (wherePart.includes('lh."lifted_at" IS NULL')) {
            filtered = filtered.filter((h) => h.liftedAt === null);
          } else if (wherePart.includes('lh."lifted_at" IS NOT NULL')) {
            filtered = filtered.filter((h) => h.liftedAt !== null);
          }
        }

        filtered.sort((a, b) => {
          const aOpen = a.liftedAt === null ? 1 : 0;
          const bOpen = b.liftedAt === null ? 1 : 0;
          if (aOpen !== bOpen) return bOpen - aOpen;
          return b.placedAt.getTime() - a.placedAt.getTime();
        });

        const rows = filtered.map((h) => {
          const org =
            h.scope === "organisation"
              ? s.organisations.get(h.scopeId)
              : undefined;
          const person =
            h.scope === "person" ? s.people.get(h.scopeId) : undefined;
          const targetUser =
            h.scope === "person"
              ? s.users.get(person?.userId ?? h.scopeId)
              : undefined;
          const placer = s.users.get(h.placedBy);
          const lifter = h.liftedBy ? s.users.get(h.liftedBy) : undefined;
          return {
            id: h.id,
            scope: h.scope,
            scopeId: h.scopeId,
            reason: h.reason,
            placedBy: h.placedBy,
            placedAt: h.placedAt,
            liftedBy: h.liftedBy,
            liftedAt: h.liftedAt,
            organisationName: org?.name ?? null,
            organisationKey: org?.key ?? null,
            personDisplayName: person?.displayName ?? null,
            targetUserName: targetUser?.name ?? null,
            targetUserEmail: targetUser?.email ?? null,
            placedByName: placer?.name ?? null,
            placedByEmail: placer?.email ?? null,
            liftedByName: lifter?.name ?? null,
            liftedByEmail: lifter?.email ?? null,
          };
        });
        return { rows };
      }
      if (sqlText === "SELECT 1") {
        return { rows: [{ "?column?": 1 }] };
      }
      if (sqlText.includes("FROM outbox WHERE state = 'dead'")) {
        return {
          rows: [
            {
              outboxDead: 0,
              outboxPending: 0,
              deliveriesDead: 0,
              deliveriesPending: 0,
            },
          ],
        };
      }
      return { rows: [] };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where(condition: unknown) {
              const sqlText = flattenSql(condition);
              const params = collectSqlParams(condition);
              const needle = params[0] as string;
              const resolveRows = () => {
                const tableName =
                  (table as Record<symbol, string>)[
                    Symbol.for("drizzle:Name")
                  ] ?? "";
                if (tableName === "organisation") {
                  const found = s.organisations.get(needle);
                  return found ? [found] : [];
                }
                if (tableName === "person") {
                  if (sqlText.includes("user_id")) {
                    const found = [...s.people.values()].find(
                      (p) => p.userId === needle,
                    );
                    return found ? [found] : [];
                  }
                  const found = s.people.get(needle);
                  return found ? [found] : [];
                }
                if (tableName === "user") {
                  const found = s.users.get(needle);
                  return found ? [found] : [];
                }
                if (tableName === "legal_hold") {
                  const found = s.holds.find((h) => h.id === needle);
                  return found ? [found] : [];
                }
                return [];
              };
              return {
                limit: async () => resolveRows(),
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        values(input: {
          scope: "organisation" | "person";
          scopeId: string;
          placedBy: string;
          reason: string;
        }) {
          return {
            async returning() {
              const created: StoredHold = {
                id: `hold-${s.holds.length + 1}`,
                scope: input.scope,
                scopeId: input.scopeId,
                placedBy: input.placedBy,
                placedAt: new Date("2026-11-15T10:00:00.000Z"),
                reason: input.reason,
                liftedBy: null,
                liftedAt: null,
              };
              s.holds.push(created);
              return [created];
            },
          };
        },
      };
    },
    update() {
      return {
        set(patch: { liftedBy: string; liftedAt: Date }) {
          return {
            where(condition: unknown) {
              const [holdId] = collectSqlParams(condition) as [string];
              return {
                async returning() {
                  const target = s.holds.find((h) => h.id === holdId);
                  if (!target) return [];
                  target.liftedBy = patch.liftedBy;
                  target.liftedAt = patch.liftedAt;
                  return [target];
                },
              };
            },
          };
        },
      };
    },
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(executor);
    },
  };

  return { state: s, mockExecutor: executor };
});

vi.mock("../../apps/api/src/database", async () => {
  const schema = await vi.importActual<
    typeof import("../../apps/api/src/database/schema")
  >("../../apps/api/src/database/schema");
  return {
    default: mockExecutor,
    schema,
  };
});

vi.mock("../../apps/api/src/audit/audit-writer", () => ({
  appendAuditLog: async (_tx: unknown, entry: Record<string, unknown>) => {
    state.auditCalls.push(entry);
    return {
      id: `audit-${state.auditCalls.length}`,
      createdAt: "2026-11-15T10:00:00.000000Z",
      prevHash: "0".repeat(64),
      rowHash: "a".repeat(64),
      seq: BigInt(state.auditCalls.length),
    };
  },
}));

vi.mock("../../apps/api/src/auth", () => ({
  portalForHost: (host?: string | null) =>
    host === "portal.localhost" ? "customer" : "agent",
}));

vi.mock(
  "../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({
    isCurrentInstanceAdmin: async () => state.isAdmin,
  }),
);

vi.mock("../../apps/api/src/permissions/resolve-identity", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/permissions/resolve-identity")
  >("../../apps/api/src/permissions/resolve-identity");
  return {
    ...actual,
    resolveIdentity: async ({
      userId,
      credential,
      apiKey,
    }: {
      userId: string;
      credential: "session" | "api_key" | "mcp_key";
      apiKey?: {
        enabled: boolean;
        ownerUserId: string;
        capabilities: Set<string>;
      };
    }) =>
      actual.resolveIdentityFromFacts({
        userId,
        person: {
          personId: `person-${userId}`,
          side: "staff",
          active: true,
          organisationId: "org-internal",
          organisationActive: true,
          organisationPortalAccess: false,
          organisationDeleted: false,
        },
        banned: false,
        isInstanceAdmin: state.isAdmin,
        workspaceMemberships: [],
        teamMemberships: [],
        credential,
        apiKey: apiKey as never,
      }),
  };
});

vi.mock("../../apps/api/src/secrets/rekey", () => ({
  getSecretsRekeyProgress: async () => ({
    keyConfigured: true,
    previousKeyConfigured: false,
    complete: true,
    safeToRemovePreviousKey: true,
    totals: { plugins: 0, identityConnections: 0, textSecrets: 0 },
    pending: { plugins: 0, identityConnections: 0, textSecrets: 0 },
  }),
}));

import instanceHealth from "../../apps/api/src/instance/health";
import instanceLegalHolds from "../../apps/api/src/instance/legal-holds";

function buildTestApp(options?: {
  userId?: string;
  impersonatedBy?: string | null;
  apiKey?: { id: string; userId: string; enabled: boolean } | undefined;
}) {
  const app = new Hono<{
    Variables: {
      userId: string | undefined;
      session: { id: string; impersonatedBy?: string | null } | null;
      apiKey: { id: string; userId: string; enabled: boolean } | undefined;
    };
  }>();

  app.use("*", async (c, next) => {
    c.set("userId", options?.userId ?? "admin-user-1");
    c.set(
      "session",
      options?.apiKey
        ? null
        : {
            id: "sess-1",
            impersonatedBy: options?.impersonatedBy ?? null,
          },
    );
    if (options?.apiKey) {
      c.set("apiKey", options.apiKey);
    }
    await next();
  });

  app.route("/api/instance", instanceLegalHolds);
  app.route("/api/instance", instanceHealth);
  return app;
}

beforeEach(() => {
  state.executedSql.length = 0;
  state.auditCalls.length = 0;
  state.holds.length = 0;
  state.isAdmin = true;
  state.organisations.clear();
  state.people.clear();
  state.users.clear();

  state.organisations.set("org-acme", {
    id: "org-acme",
    name: "Acme Holdings",
    key: "acme",
  });
  state.users.set("admin-user-1", {
    id: "admin-user-1",
    name: "Ada Admin",
    email: "ada@example.test",
  });
  state.users.set("user-jane", {
    id: "user-jane",
    name: "Jane Subject",
    email: "jane@example.test",
  });
  state.people.set("person-jane", {
    id: "person-jane",
    userId: "user-jane",
    displayName: "Jane Subject",
  });
});

describe("Legal Hold audit catalogue wiring", () => {
  it("wires legal_hold.placed and legal_hold.lifted in AUDIT_ONLY_ACTIONS", () => {
    expect(AUDIT_ONLY_ACTIONS.has("legal_hold.placed")).toBe(true);
    expect(AUDIT_ONLY_ACTIONS.has("legal_hold.lifted")).toBe(true);
    expect(AUDIT_ACTIONS_NOT_YET_WIRED.has("legal_hold.placed")).toBe(false);
    expect(AUDIT_ACTIONS_NOT_YET_WIRED.has("legal_hold.lifted")).toBe(false);
  });
});

describe("Instance Legal Holds HTTP router & Health integration", () => {
  it("enforces agent host, session-only, non-impersonated instance:admin access", async () => {
    const portalResp = await buildTestApp().request(
      "http://portal.localhost/api/instance/legal-holds",
      { headers: { host: "portal.localhost" } },
    );
    expect(portalResp.status).toBe(403);

    const impersonatedResp = await buildTestApp({
      impersonatedBy: "other-admin",
    }).request("http://ticketing.localhost/api/instance/legal-holds");
    expect(impersonatedResp.status).toBe(403);

    const apiKeyResp = await buildTestApp({
      apiKey: { id: "key-1", userId: "admin-user-1", enabled: true },
    }).request("http://ticketing.localhost/api/instance/legal-holds");
    expect(apiKeyResp.status).toBe(403);

    state.isAdmin = false;
    const nonAdminResp = await buildTestApp().request(
      "http://ticketing.localhost/api/instance/legal-holds",
    );
    expect(nonAdminResp.status).toBe(403);
  });

  it("places an organisation hold under SHARE ROW EXCLUSIVE lock, rejects duplicates (409) and missing targets (404), and writes legal_hold.placed audit", async () => {
    const app = buildTestApp();

    const missingResp = await app.request(
      "http://ticketing.localhost/api/instance/legal-holds",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "organisation",
          scopeId: "org-missing",
          reason: "Subpoena #404",
        }),
      },
    );
    expect(missingResp.status).toBe(404);
    expect(state.auditCalls).toHaveLength(0);

    state.executedSql.length = 0;
    const createResp = await app.request(
      "http://ticketing.localhost/api/instance/legal-holds",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "organisation",
          scopeId: "org-acme",
          reason: "Regulatory preservation order #2026-11",
        }),
      },
    );
    expect(createResp.status).toBe(201);
    expect(state.executedSql[0]).toBe(
      "LOCK TABLE legal_hold IN SHARE ROW EXCLUSIVE MODE",
    );

    const created = (await createResp.json()) as Record<string, unknown>;
    expect(created).toMatchObject({
      id: "hold-1",
      scope: "organisation",
      scopeId: "org-acme",
      status: "active",
      targetLabel: "Acme Holdings",
      targetSecondaryLabel: "acme",
      reason: "Regulatory preservation order #2026-11",
      placedBy: {
        id: "admin-user-1",
        name: "Ada Admin",
        email: "ada@example.test",
      },
      liftedAt: null,
      liftedBy: null,
    });

    expect(state.auditCalls).toEqual([
      expect.objectContaining({
        organisationId: "org-acme",
        actorId: "admin-user-1",
        actorType: "person",
        action: "legal_hold.placed",
        entityType: "legal_hold",
        entityId: "hold-1",
        before: null,
        after: {
          scope: "organisation",
          scopeId: "org-acme",
          reason: "Regulatory preservation order #2026-11",
        },
      }),
    ]);

    const duplicateResp = await app.request(
      "http://ticketing.localhost/api/instance/legal-holds",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "organisation",
          scopeId: "org-acme",
          reason: "Duplicate attempt",
        }),
      },
    );
    expect(duplicateResp.status).toBe(409);
  });

  it("canonicalises person holds placed by user.id to person.id, surfaces activeCount in health, and lifts holds with legal_hold.lifted audit", async () => {
    const app = buildTestApp();

    const placePersonResp = await app.request(
      "http://ticketing.localhost/api/instance/legal-holds",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "person",
          scopeId: "user-jane",
          reason: "Employment dispute hold",
        }),
      },
    );
    expect(placePersonResp.status).toBe(201);
    const placedPerson = (await placePersonResp.json()) as {
      id: string;
      scopeId: string;
      targetLabel: string;
      targetSecondaryLabel: string | null;
    };
    expect(placedPerson.scopeId).toBe("person-jane");
    expect(placedPerson.targetLabel).toBe("Jane Subject");
    expect(placedPerson.targetSecondaryLabel).toBe("jane@example.test");

    const healthBeforeLift = await app.request(
      "http://ticketing.localhost/api/instance/health",
    );
    expect(healthBeforeLift.status).toBe(200);
    expect(await healthBeforeLift.json()).toMatchObject({
      legalHolds: { activeCount: 1 },
    });

    state.executedSql.length = 0;
    const liftResp = await app.request(
      `http://ticketing.localhost/api/instance/legal-holds/${placedPerson.id}/lift`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Dispute settled" }),
      },
    );
    expect(liftResp.status).toBe(200);
    expect(state.executedSql[0]).toBe(
      "LOCK TABLE legal_hold IN SHARE ROW EXCLUSIVE MODE",
    );
    const lifted = (await liftResp.json()) as Record<string, unknown>;
    expect(lifted).toMatchObject({
      id: placedPerson.id,
      status: "lifted",
      liftedBy: {
        id: "admin-user-1",
        name: "Ada Admin",
        email: "ada@example.test",
      },
    });
    expect(lifted.liftedAt).toEqual(expect.any(String));

    expect(state.auditCalls[1]).toMatchObject({
      organisationId: null,
      actorId: "admin-user-1",
      actorType: "person",
      action: "legal_hold.lifted",
      entityType: "legal_hold",
      entityId: placedPerson.id,
      before: { liftedAt: null },
      after: {
        scope: "person",
        scopeId: "person-jane",
        liftedBy: "admin-user-1",
        reason: "Dispute settled",
      },
    });

    const liftAgainResp = await app.request(
      `http://ticketing.localhost/api/instance/legal-holds/${placedPerson.id}/lift`,
      { method: "POST" },
    );
    expect(liftAgainResp.status).toBe(409);

    const missingLiftResp = await app.request(
      "http://ticketing.localhost/api/instance/legal-holds/hold-does-not-exist/lift",
      { method: "POST" },
    );
    expect(missingLiftResp.status).toBe(404);

    const listResp = await app.request(
      "http://ticketing.localhost/api/instance/legal-holds",
    );
    expect(listResp.status).toBe(200);
    expect(await listResp.json()).toMatchObject({
      activeCount: 0,
      holds: [
        expect.objectContaining({ id: placedPerson.id, status: "lifted" }),
      ],
    });
  });
});
