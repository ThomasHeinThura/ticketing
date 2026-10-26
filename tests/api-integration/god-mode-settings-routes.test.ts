import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { createSeesAllWorkspaceMember } from "./helpers/project-reach-world";

function request(
  app: ReturnType<typeof createApp>["app"],
  path: string,
  init?: RequestInit,
) {
  const r = withConfiguredAgentAuthority(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  return app.request(r.input, r.init);
}

async function seedAdmin() {
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing();
  const [admin] = await db
    .insert(schema.userTable)
    .values({
      id: "god-mode-settings-admin",
      name: "Admin",
      email: "god-mode-settings-admin@example.test",
      role: "admin",
    })
    .returning();
  if (!admin) throw new Error("admin fixture missing");
  await ensureStaffPersonForUser(admin.id);
  return admin;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("God Mode settings, features and health routes", () => {
  it("require instance:admin: a workspace owner is refused", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(user);
    const { app } = createApp();
    for (const [method, path] of [
      ["GET", "/api/instance/health"],
      ["GET", "/api/instance/settings"],
      ["PATCH", "/api/instance/settings"],
      ["GET", "/api/instance/features"],
      ["PATCH", "/api/instance/features"],
    ] as const) {
      const response = await request(app, path, {
        method,
        ...(method === "PATCH" ? { body: JSON.stringify({}) } : {}),
      });
      expect([403, 400]).toContain(response.status);
      expect(response.status).not.toBe(200);
    }
  });

  it("health lists database, secrets and outbox checks with counts only", async () => {
    const admin = await seedAdmin();
    mockAuthenticatedSession(admin);
    const { app } = createApp();
    const response = await request(app, "/api/instance/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      state: string;
      checks: Array<{ key: string; state: string }>;
    };
    expect(body.checks.map((c) => c.key)).toEqual([
      "database",
      "secrets_encryption",
      "outbox",
    ]);
    expect(body.checks[0]?.state).toBe("ok");
    expect(JSON.stringify(body)).not.toMatch(/secret.*[a-f0-9]{16}/);
  });

  it("settings round-trip with optimistic concurrency and validation", async () => {
    const admin = await seedAdmin();
    mockAuthenticatedSession(admin);
    const { app } = createApp();
    const read = await request(app, "/api/instance/settings");
    expect(read.status).toBe(200);
    const first = (await read.json()) as {
      updatedAt: string;
      settings: {
        notificationRetentionDays: number;
        invitationLifetimeHours: number;
        customerInvitationCreateWindowMinutes: number;
        customerInvitationPerInviterLimit: number;
        customerInvitationPerOrganisationLimit: number;
        customerInvitationResendCooldownSeconds: number;
        cspMode: "report_only" | "enforce";
        timezone: string;
        mcpWriteCeilingPerMinute: number;
        apiKeyBurstThreshold: number;
      };
    };
    expect(first.settings).toMatchObject({
      notificationRetentionDays: 90,
      invitationLifetimeHours: 48,
      customerInvitationCreateWindowMinutes: 60,
      customerInvitationPerInviterLimit: 20,
      customerInvitationPerOrganisationLimit: 50,
      customerInvitationResendCooldownSeconds: 60,
      cspMode: "report_only",
      timezone: "UTC",
      mcpWriteCeilingPerMinute: 30,
      apiKeyBurstThreshold: 300,
    });

    const bad = await request(app, "/api/instance/settings", {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: first.updatedAt,
        changes: { timezone: "Mars/Olympus" },
      }),
    });
    expect(bad.status).toBe(400);
    for (const cspMode of ["disabled", "report-only"]) {
      const invalidCspMode = await request(app, "/api/instance/settings", {
        method: "PATCH",
        body: JSON.stringify({
          expectedUpdatedAt: first.updatedAt,
          changes: { cspMode },
        }),
      });
      expect(invalidCspMode.status).toBe(400);
    }
    const invalidMcpCeiling = await request(app, "/api/instance/settings", {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: first.updatedAt,
        changes: { mcpWriteCeilingPerMinute: 101 },
      }),
    });
    expect(invalidMcpCeiling.status).toBe(400);
    for (const apiKeyBurstThreshold of [0, 100_001]) {
      const invalidBurst = await request(app, "/api/instance/settings", {
        method: "PATCH",
        body: JSON.stringify({
          expectedUpdatedAt: first.updatedAt,
          changes: { apiKeyBurstThreshold },
        }),
      });
      expect(invalidBurst.status).toBe(400);
    }
    const invitationLimitCases = [
      { invitationLifetimeHours: 0 },
      { invitationLifetimeHours: 721 },
      { customerInvitationCreateWindowMinutes: 0 },
      { customerInvitationCreateWindowMinutes: 1441 },
      { customerInvitationPerInviterLimit: 0 },
      { customerInvitationPerInviterLimit: 10_001 },
      { customerInvitationPerOrganisationLimit: 0 },
      { customerInvitationPerOrganisationLimit: 10_001 },
      { customerInvitationResendCooldownSeconds: 0 },
      { customerInvitationResendCooldownSeconds: 86_401 },
    ];
    for (const changes of invitationLimitCases) {
      const invalid = await request(app, "/api/instance/settings", {
        method: "PATCH",
        body: JSON.stringify({ expectedUpdatedAt: first.updatedAt, changes }),
      });
      expect(invalid.status).toBe(400);
    }

    const saved = await request(app, "/api/instance/settings", {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: first.updatedAt,
        changes: {
          notificationRetentionDays: 30,
          invitationLifetimeHours: 72,
          customerInvitationCreateWindowMinutes: 90,
          customerInvitationPerInviterLimit: 25,
          customerInvitationPerOrganisationLimit: 55,
          customerInvitationResendCooldownSeconds: 120,
          timezone: "Asia/Yangon",
          mcpWriteCeilingPerMinute: 25,
          apiKeyBurstThreshold: 450,
          cspMode: "enforce",
        },
      }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      settings: {
        notificationRetentionDays: 30,
        invitationLifetimeHours: 72,
        customerInvitationCreateWindowMinutes: 90,
        customerInvitationPerInviterLimit: 25,
        customerInvitationPerOrganisationLimit: 55,
        customerInvitationResendCooldownSeconds: 120,
        timezone: "Asia/Yangon",
        mcpWriteCeilingPerMinute: 25,
        apiKeyBurstThreshold: 450,
        cspMode: "enforce",
      },
    });

    const stale = await request(app, "/api/instance/settings", {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: first.updatedAt,
        changes: { notificationRetentionDays: 60 },
      }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ message: "version_conflict" });
    const [row] = await db
      .select({ days: schema.instanceSettingTable.notificationRetentionDays })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    expect(row?.days).toBe(30);
    const [rateSetting] = await db
      .select({
        ceiling: schema.instanceSettingTable.mcpWriteCeilingPerMinute,
        burst: schema.instanceSettingTable.apiKeyBurstThreshold,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    expect(rateSetting?.ceiling).toBe(25);
    expect(rateSetting?.burst).toBe(450);
    const [invitationSettings] = await db
      .select({
        lifetime: schema.instanceSettingTable.invitationLifetimeHours,
        window:
          schema.instanceSettingTable.customerInvitationCreateWindowMinutes,
        inviter: schema.instanceSettingTable.customerInvitationPerInviterLimit,
        organisation:
          schema.instanceSettingTable.customerInvitationPerOrganisationLimit,
        cooldown:
          schema.instanceSettingTable.customerInvitationResendCooldownSeconds,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    expect(invitationSettings).toEqual({
      lifetime: 72,
      window: 90,
      inviter: 25,
      organisation: 55,
      cooldown: 120,
    });
  });

  it("a locked instance flag answers 409 feature_locked to a workspace administrator", async () => {
    const admin = await seedAdmin();
    mockAuthenticatedSession(admin);
    const { app } = createApp();
    const lock = await request(app, "/api/instance/features", {
      method: "PATCH",
      body: JSON.stringify({
        changes: [{ key: "feature.sla", enabled: true, locked: true }],
      }),
    });
    expect(lock.status).toBe(200);

    // Reach is explicit (rbac.md Reach): the resolved-flags route needs project reach, so
    // this workspace owner also holds the workspace `sees_all` grant.
    const { user, workspace } = await createSeesAllWorkspaceMember({
      role: "owner",
    });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    mockAuthenticatedSession(user);
    const workspaceWrite = await request(
      app,
      `/api/workspaces/${workspace.id}/features`,
      {
        method: "PATCH",
        body: JSON.stringify({
          changes: [{ key: "feature.sla", enabled: false }],
        }),
      },
    );
    expect(workspaceWrite.status).toBe(409);
    expect(await workspaceWrite.json()).toMatchObject({
      message: "feature_locked",
      key: "feature.sla",
    });

    const allowed = await request(
      app,
      `/api/workspaces/${workspace.id}/features`,
      {
        method: "PATCH",
        body: JSON.stringify({
          changes: [{ key: "feature.cycles", enabled: true }],
        }),
      },
    );
    expect(allowed.status).toBe(200);

    const resolved = await request(
      app,
      `/api/features/resolved?project=${project.id}`,
    );
    expect(resolved.status).toBe(200);
    const { features } = (await resolved.json()) as {
      features: Array<{ key: string; enabled: boolean; source: string }>;
    };
    expect(features.find((f) => f.key === "feature.sla")).toMatchObject({
      enabled: true,
      source: "instance",
    });
    expect(features.find((f) => f.key === "feature.cycles")).toMatchObject({
      enabled: true,
      source: "workspace",
    });
  });
});
