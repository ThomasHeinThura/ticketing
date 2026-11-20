import { PgDialect, QueryBuilder } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  identity: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../../../apps/api/src/auth", () => ({
  portalForHost: (host?: string) =>
    host?.startsWith("portal.") ? "customer" : "agent",
}));
vi.mock("../../../apps/api/src/database", async (original) => ({
  ...(await original<typeof import("../../../apps/api/src/database")>()),
  default: { select: mocks.select },
}));
vi.mock("../../../apps/api/src/permissions/resolve-identity", () => ({
  resolveIdentity: mocks.identity,
}));
vi.mock("../../../apps/api/src/audit/controllers/audit-read-common", () => ({
  writeAuditRead: mocks.read,
}));

import {
  personalSettingsHistory,
  personalSettingsHistoryResponseSchema,
  safePersonalHistoryFields,
} from "../../../apps/api/src/audit/personal-history";
import { settingsHistoryQuery } from "../../../apps/api/src/audit/schema";
import { apiRouter, type BaseVariables } from "../../../apps/api/src/openapi";

function app(session: Record<string, unknown> | null, apiKey: unknown = null) {
  return apiRouter<BaseVariables>()
    .use("*", async (c, next) => {
      c.set("userId", "user-1");
      c.set(
        "session",
        session ? ({ id: "session-1", ...session } as never) : null,
      );
      c.set("apiKey", apiKey as never);
      await next();
    })
    .route("/api", personalSettingsHistory);
}

function mockHistorySelect(builder: object) {
  mocks.select.mockImplementation(
    (selection: Parameters<QueryBuilder["select"]>[0]) =>
      "one" in selection ? new QueryBuilder().select(selection) : builder,
  );
}

function expectDeclaredSelfAliases(
  predicate: unknown,
  portal: "agent" | "customer",
) {
  const query = new PgDialect().sqlToQuery(predicate as never);
  expect(query.sql).toContain('from "session" "history_self_session"');
  expect(query.sql).toContain('join "user" "history_self_user"');
  expect(query.sql).toContain('join "person" "history_self_person"');
  expect(query.sql).not.toContain('from "history_self_session"');
  expect(query.sql).not.toContain('join "history_self_user"');
  expect(query.sql).not.toContain('join "history_self_person"');
  expect(query.sql).toContain(
    '"history_self_session"."impersonated_by" is null',
  );
  expect(query.sql).toContain('"history_self_session"."expires_at" >');
  expect(query.sql).toContain('"history_self_user"."banned" is not true');
  expect(query.sql).toContain('"history_self_person"."active" =');
  expect(query.params).toEqual(
    expect.arrayContaining([
      "session-1",
      "user-1",
      portal,
      "person-1",
      portal === "agent" ? "staff" : "customer",
      true,
    ]),
  );
}

describe("closed personal settings history", () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.identity
      .mockReset()
      .mockResolvedValue({ side: "staff", personId: "person-1" });
    mocks.read.mockReset().mockResolvedValue(undefined);
    const builder = {
      from: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: async () => [],
    };
    mockHistorySelect(builder);
  });

  it("declares live self tables for every admitted staff and portal section", async () => {
    let predicate: unknown;
    const builder = {
      from: () => builder,
      where: (value: unknown) => {
        predicate = value;
        return builder;
      },
      orderBy: () => builder,
      limit: async () => [],
    };
    mockHistorySelect(builder);
    for (const section of [
      "profile",
      "preferences",
      "notifications",
      "security",
      "apiKeys",
    ]) {
      const response = await app({ portal: "agent" }).request(
        `http://agent.localhost/api/me/settings/history?section=${section}`,
      );
      expect(response.status).toBe(200);
      expectDeclaredSelfAliases(predicate, "agent");
    }
    mocks.identity.mockResolvedValue({
      side: "customer",
      personId: "person-1",
    });
    for (const section of ["profile", "notifications", "security"]) {
      const response = await app({ portal: "customer" }).request(
        `http://portal.localhost/api/portal/account/settings-history?section=${section}`,
        { headers: { host: "portal.localhost" } },
      );
      expect(response.status).toBe(200);
      expectDeclaredSelfAliases(predicate, "customer");
    }
  });

  it("rejects a generic self selector and removes raw values from closed fields", () => {
    expect(
      settingsHistoryQuery.safeParse({
        entity_type: "user_preference",
        entity_id: "self",
      }).success,
    ).toBe(false);
    expect(
      safePersonalHistoryFields("user.profile_updated", {
        changedFields: ["name", "email", "image"],
        secret: "hidden",
      }),
    ).toEqual({ changedFields: ["name", "image"] });
    expect(
      safePersonalHistoryFields("notification.settings_updated", {
        changedCategories: ["delivery", "eventKind", "workspaceRule"],
        address: "hidden",
      }),
    ).toEqual({ changedCategories: ["delivery", "workspaceRule"] });
    expect(
      safePersonalHistoryFields("auth.password_changed", {
        password: "hidden",
      }),
    ).toEqual({
      changedCategories: ["password"],
    });
    expect(
      safePersonalHistoryFields("auth.mfa_enrolled", { method: "totp" }),
    ).toEqual({
      changedCategories: ["mfa"],
    });
    expect(
      safePersonalHistoryFields("api_key.revoked", {
        kind: "personal",
        name: "hidden",
      }),
    ).toEqual({
      changedCategories: ["personalKey"],
    });
    expect(
      personalSettingsHistoryResponseSchema.safeParse({
        section: "profile",
        lastChanged: null,
        rows: [
          { at: "now", actor: "you", changedFields: ["name"], auditId: "raw" },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires the exact host, section, side and session credential", async () => {
    const staff = app({ portal: "agent" });
    expect(
      (
        await staff.request(
          "http://agent.localhost/api/me/settings/history?section=profile",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await staff.request(
          "http://agent.localhost/api/me/settings/history?section=other",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await staff.request(
          "http://agent.localhost/api/me/settings/history?section=security",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await staff.request(
          "http://agent.localhost/api/me/settings/history?section=apiKeys",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await staff.request(
          "http://agent.localhost/api/me/settings/history?section=profile&personId=person-2",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await staff.request(
          "http://portal.localhost/api/me/settings/history?section=profile",
          { headers: { host: "portal.localhost" } },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app({ portal: "agent" }, { id: "key" }).request(
          "http://agent.localhost/api/me/settings/history?section=profile",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app({ portal: "agent", impersonatedBy: "admin" }).request(
          "http://agent.localhost/api/me/settings/history?section=profile",
        )
      ).status,
    ).toBe(403);
    mocks.identity.mockResolvedValue({
      side: "customer",
      personId: "person-1",
    });
    expect(
      (
        await staff.request(
          "http://agent.localhost/api/me/settings/history?section=profile",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app({ portal: "customer" }).request(
          "http://portal.localhost/api/portal/account/settings-history?section=preferences",
          { headers: { host: "portal.localhost" } },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app({ portal: "customer" }).request(
          "http://portal.localhost/api/portal/account/settings-history?section=notifications",
          { headers: { host: "portal.localhost" } },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app({ portal: "customer" }).request(
          "http://portal.localhost/api/portal/account/settings-history?section=apiKeys",
          { headers: { host: "portal.localhost" } },
        )
      ).status,
    ).toBe(400);
  });

  it("filters source rows by the authenticated user, person, action and null workspace", async () => {
    let predicate: unknown;
    const builder = {
      from: () => builder,
      where: (value: unknown) => {
        predicate = value;
        return builder;
      },
      orderBy: () => builder,
      limit: async () => [
        {
          createdAt: new Date("2026-11-16T00:00:00Z"),
          action: "notification.settings_updated",
          after: { changedCategories: ["delivery", "address"] },
        },
      ],
    };
    mockHistorySelect(builder);
    const result = await app({ portal: "agent" }).request(
      "http://agent.localhost/api/me/settings/history?section=notifications",
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({
      section: "notifications",
      lastChanged: { at: "2026-11-16T00:00:00.000Z", actor: "you" },
      rows: [
        {
          at: "2026-11-16T00:00:00.000Z",
          actor: "you",
          changedCategories: ["delivery"],
        },
      ],
    });
    const query = new PgDialect().sqlToQuery(predicate as never);
    expect(query.params).toEqual(
      expect.arrayContaining([
        "user-1",
        "person",
        "notification_preference",
        "person-1",
        "notification.settings_updated",
      ]),
    );
    expect(query.sql).toContain('"audit_log"."workspace_id" is null');
    expect(mocks.read).toHaveBeenCalledOnce();
  });

  it("binds security rows to the authenticated user and current live session on each side", async () => {
    let predicate: unknown;
    const builder = {
      from: () => builder,
      where: (value: unknown) => {
        predicate = value;
        return builder;
      },
      orderBy: () => builder,
      limit: async () => [
        {
          createdAt: new Date("2026-11-16T00:00:00Z"),
          action: "auth.password_changed",
          after: { password: "must-not-return" },
        },
      ],
    };
    mockHistorySelect(builder);
    const staff = await app({ portal: "agent" }).request(
      "http://agent.localhost/api/me/settings/history?section=security",
    );
    expect(staff.status).toBe(200);
    expect(await staff.json()).toEqual({
      section: "security",
      lastChanged: { at: "2026-11-16T00:00:00.000Z", actor: "you" },
      rows: [
        {
          at: "2026-11-16T00:00:00.000Z",
          actor: "you",
          changedCategories: ["password"],
        },
      ],
    });
    let query = new PgDialect().sqlToQuery(predicate as never);
    expect(query.params).toEqual(
      expect.arrayContaining([
        "user-1",
        "person",
        "auth.password_changed",
        "auth.mfa_enrolled",
        "session-1",
        "agent",
      ]),
    );
    expect(query.sql).toContain('"audit_log"."entity_id" =');
    expect(query.sql).toContain('"audit_log"."impersonator_id" is null');
    expect(query.sql).toContain('"history_self_person"."active" =');
    expect(query.params).toContain(true);
    expect(query.sql).toContain('"history_self_session"."expires_at" >');
    mocks.identity.mockResolvedValue({
      side: "customer",
      personId: "person-1",
    });
    const portal = await app({ portal: "customer" }).request(
      "http://portal.localhost/api/portal/account/settings-history?section=security",
      { headers: { host: "portal.localhost" } },
    );
    expect(portal.status).toBe(200);
    query = new PgDialect().sqlToQuery(predicate as never);
    expect(query.params).toContain("auth.password_changed");
    expect(query.params).not.toContain("auth.mfa_enrolled");
    expect(query.params).toContain("customer");
  });

  it("keeps deleted personal-key history by author and kind without a live key join", async () => {
    let predicate: unknown;
    const builder = {
      from: () => builder,
      where: (value: unknown) => {
        predicate = value;
        return builder;
      },
      orderBy: () => builder,
      limit: async () => [
        {
          createdAt: new Date("2026-11-16T00:00:00Z"),
          action: "api_key.revoked",
          after: { kind: "personal", name: "must-not-return" },
        },
      ],
    };
    mockHistorySelect(builder);
    const response = await app({ portal: "agent" }).request(
      "http://agent.localhost/api/me/settings/history?section=apiKeys",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      section: "apiKeys",
      lastChanged: { at: "2026-11-16T00:00:00.000Z", actor: "you" },
      rows: [
        {
          at: "2026-11-16T00:00:00.000Z",
          actor: "you",
          changedCategories: ["personalKey"],
        },
      ],
    });
    const query = new PgDialect().sqlToQuery(predicate as never);
    expect(query.params).toEqual(
      expect.arrayContaining(["user-1", "session-1"]),
    );
    expect(query.sql).toContain(`"audit_log"."actor_type" = 'person'`);
    expect(query.sql).toContain(`"audit_log"."entity_type" = 'api_key'`);
    expect(query.sql).toContain(
      `"audit_log"."action" IN ('api_key.created', 'api_key.revoked')`,
    );
    expect(query.sql).toContain(`"audit_log"."after" ->> 'kind' = 'personal'`);
    expect(query.sql).not.toContain('"audit_log"."entity_id" =');
    expect(query.sql).not.toContain('from "apikey"');
    expect(query.sql).toContain('"audit_log"."workspace_id" is null');
    expect(query.sql).toContain('"audit_log"."project_id" is null');
    expect(query.sql).toContain('"audit_log"."impersonator_id" is null');
  });
});
