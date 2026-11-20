import { randomUUID } from "node:crypto";
import type { JsonValue } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
  type SettingsHistoryInput,
} from "../../apps/api/src/audit/repository";
import { entityHistoryRow } from "../../apps/api/src/audit/settings-history";
import db, { schema } from "../../apps/api/src/database";
import { importSourceConnectionTable } from "../../apps/api/src/database/schema-imports";
import { instanceJobConfigurationTable } from "../../apps/api/src/database/schema-instance-jobs";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { registeredJobCatalog } from "../../apps/api/src/scheduler";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

describe("P3 current instance history on a fresh test database", () => {
  beforeEach(async () => resetTestDatabase());

  it("binds each approved action to a live target, current session and exact scope", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, user.id));
    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Missing staff identity");
    const sessionId = `p3-session-${randomUUID()}`;
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `p3-token-${randomUUID()}`,
      userId: user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const providerId = `p3-provider-${randomUUID()}`;
    const storageId = `p3-storage-${randomUUID()}`;
    await db.insert(schema.instancePluginConfigTable).values([
      {
        id: providerId,
        pluginId: "notify.email",
        instanceKey: "default",
        displayName: "Synthetic provider",
        enabled: true,
        config: {},
        scope: "instance",
        configVersion: 1,
      },
      {
        id: storageId,
        pluginId: "storage.s3",
        instanceKey: "draft",
        displayName: "Synthetic draft",
        enabled: false,
        config: {},
        scope: "instance",
        configVersion: 1,
      },
    ]);
    const jobName = registeredJobCatalog()[0]?.name;
    if (!jobName) throw new Error("Missing registered job");
    await db.insert(instanceJobConfigurationTable).values({ name: jobName });
    const connection = requireRow(
      await db
        .insert(schema.identityConnectionTable)
        .values({
          providerType: "entra",
          portalScope: "agent",
          displayName: "Synthetic connection",
          issuer: "https://example.test/issuer",
          clientId: "synthetic-client",
          clientSecret: Buffer.from([1]),
          redirectUri: "https://example.test/callback",
          scopes: ["openid"],
          claimMapping: {},
          jitPolicy: { enabled: false },
          maxRoleRank: 10,
        })
        .returning(),
      "identity connection",
    );
    const source = requireRow(
      await db
        .insert(importSourceConnectionTable)
        .values({
          workspaceId: workspace.id,
          pluginId: "import.jira",
          name: "Synthetic import",
        })
        .returning(),
      "import source",
    );

    const cases: Array<{
      entityType: SettingsHistoryInput["entityType"];
      entityId: string;
      action: string;
      auditType: string;
      workspaceId: string | null;
      before?: JsonValue;
      after: JsonValue;
      fields: string[];
    }> = [
      {
        entityType: "instance_notification_provider",
        entityId: providerId,
        action: "plugin.changed",
        auditType: "instance_plugin_config",
        workspaceId: null,
        after: {
          pluginId: "notify.email",
          changedKeys: ["enabled", "config", "password"],
        },
        fields: ["configuration", "credential"],
      },
      {
        entityType: "instance_storage_draft",
        entityId: storageId,
        action: "plugin.changed",
        auditType: "instance_plugin_config",
        workspaceId: null,
        after: { changedKeys: ["bucket"] },
        fields: [],
      },
      {
        entityType: "instance_auth_methods",
        entityId: "auth.local-methods",
        action: "plugin.changed",
        auditType: "instance_plugin_config",
        workspaceId: null,
        after: { changedKeys: ["agent.password", "unknown", "agent.password"] },
        fields: ["agent.password"],
      },
      {
        entityType: "staff_self_registration",
        entityId: "staff_self_registration_enabled",
        action: "plugin.changed",
        auditType: "instance_setting",
        workspaceId: null,
        before: { enabled: false },
        after: { enabled: true },
        fields: ["enabled"],
      },
      {
        entityType: "instance_job",
        entityId: jobName,
        action: "job.configuration_changed",
        auditType: "job",
        workspaceId: null,
        before: { pattern: "before", enabled: true },
        after: { pattern: "after", enabled: true },
        fields: ["pattern"],
      },
      {
        entityType: "identity_connection",
        entityId: connection.id,
        action: "identity_connection.changed",
        auditType: "identity_connection",
        workspaceId: null,
        after: { changes: ["enabled"], configVersion: 1 },
        fields: [],
      },
      {
        entityType: "import_source_connection",
        entityId: source.id,
        action: "plugin.changed",
        auditType: "import_source_connection",
        workspaceId: workspace.id,
        after: {
          operation: "source_created",
          section: "imports",
          sourceId: source.id,
          pluginId: source.pluginId,
          name: source.name,
          changedKeys: ["pluginId", "name"],
        },
        fields: [],
      },
    ];
    for (const entry of cases) {
      await appendAuditLog(db, {
        actorId: user.id,
        actorType: "person",
        workspaceId: entry.workspaceId,
        action: entry.action,
        entityType: entry.auditType,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
      });
      const input: SettingsHistoryInput = {
        identity,
        entityType: entry.entityType,
        entityId: entry.entityId,
        workspaceId: entry.workspaceId,
        projectId: null,
        sessionId,
      };
      const rows = await listSettingsHistoryRows(input);
      expect(rows).toHaveLength(1);
      const names = await listSettingsHistoryActorNames(input, [user.id]);
      expect(names.get(user.id)).toBe(user.name);
      const projected = entityHistoryRow(
        requireRow(rows, "P3 history"),
        names.get(user.id) ?? null,
        entry.entityType,
      );
      expect(projected.changedFields).toEqual(entry.fields);
      expect(projected).not.toHaveProperty("after");
      expect(projected).not.toHaveProperty("entityId");
    }

    const provider: SettingsHistoryInput = {
      identity,
      entityType: "instance_notification_provider",
      entityId: providerId,
      workspaceId: null,
      sessionId,
    };
    await db
      .delete(schema.instancePluginConfigTable)
      .where(eq(schema.instancePluginConfigTable.id, providerId));
    expect(await listSettingsHistoryRows(provider)).toEqual([]);
    expect(await listSettingsHistoryActorNames(provider, [user.id])).toEqual(
      new Map(),
    );
    const importInput: SettingsHistoryInput = {
      identity,
      entityType: "import_source_connection",
      entityId: source.id,
      workspaceId: workspace.id,
      sessionId,
    };
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, user.id),
        ),
      );
    expect(await listSettingsHistoryRows(importInput)).toEqual([]);
    expect(await listSettingsHistoryActorNames(importInput, [user.id])).toEqual(
      new Map(),
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: user.id,
      role: "owner",
      joinedAt: new Date(),
    });
    expect(await listSettingsHistoryRows(importInput)).toHaveLength(1);
    const other = await createWorkspaceMember({ role: "owner" });
    await db
      .update(importSourceConnectionTable)
      .set({ workspaceId: other.workspace.id })
      .where(eq(importSourceConnectionTable.id, source.id));
    expect(await listSettingsHistoryRows(importInput)).toEqual([]);
    expect(await listSettingsHistoryActorNames(importInput, [user.id])).toEqual(
      new Map(),
    );
    const connectionInput: SettingsHistoryInput = {
      identity,
      entityType: "identity_connection",
      entityId: connection.id,
      workspaceId: null,
      sessionId,
    };
    await db
      .update(schema.identityConnectionTable)
      .set({ deletedAt: new Date(), enabled: false })
      .where(eq(schema.identityConnectionTable.id, connection.id));
    expect(await listSettingsHistoryRows(connectionInput)).toEqual([]);
    expect(
      await listSettingsHistoryActorNames(connectionInput, [user.id]),
    ).toEqual(new Map());
    await db
      .delete(schema.sessionTable)
      .where(eq(schema.sessionTable.id, sessionId));
    expect(
      await listSettingsHistoryRows({
        ...provider,
        entityType: "instance_job",
        entityId: jobName,
      }),
    ).toEqual([]);
    expect(
      await listSettingsHistoryActorNames(
        { ...provider, entityType: "instance_job", entityId: jobName },
        [user.id],
      ),
    ).toEqual(new Map());
  });

  it("rechecks effective workspace read authority after scope resolution", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "member" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, user.id));
    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Missing staff identity");
    const sessionId = `p3-session-${randomUUID()}`;
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `p3-token-${randomUUID()}`,
      userId: user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const source = requireRow(
      await db
        .insert(importSourceConnectionTable)
        .values({
          workspaceId: workspace.id,
          pluginId: "import.jira",
          name: "Read authority fixture",
        })
        .returning(),
      "import source",
    );
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: workspace.id,
      action: "plugin.changed",
      entityType: "import_source_connection",
      entityId: source.id,
      after: {
        operation: "source_created",
        section: "imports",
        sourceId: source.id,
        pluginId: source.pluginId,
        name: source.name,
        changedKeys: ["pluginId", "name"],
      },
    });
    const input: SettingsHistoryInput = {
      identity,
      entityType: "import_source_connection",
      entityId: source.id,
      workspaceId: workspace.id,
      sessionId,
    };
    const visible = async (target: SettingsHistoryInput = input) => {
      const rows = await listSettingsHistoryRows(target);
      const names = await listSettingsHistoryActorNames(target, [user.id]);
      expect(rows).toHaveLength(1);
      expect(names.get(user.id)).toBe(user.name);
    };
    const hidden = async (target: SettingsHistoryInput = input) => {
      expect(await listSettingsHistoryRows(target)).toEqual([]);
      expect(await listSettingsHistoryActorNames(target, [user.id])).toEqual(
        new Map(),
      );
    };
    await visible();
    const memberRole = requireRow(
      await db
        .select()
        .from(schema.roleTable)
        .where(
          and(
            eq(schema.roleTable.scope, "workspace"),
            eq(schema.roleTable.workspaceId, workspace.id),
            eq(schema.roleTable.key, "member"),
          ),
        )
        .limit(1),
      "member role",
    );
    await db
      .update(schema.roleTable)
      .set({ capabilities: [] })
      .where(eq(schema.roleTable.id, memberRole.id));
    await hidden();
    await db
      .update(schema.roleTable)
      .set({ capabilities: { malformed: true } })
      .where(eq(schema.roleTable.id, memberRole.id));
    await hidden();
    await db
      .update(schema.roleTable)
      .set({ capabilities: memberRole.capabilities })
      .where(eq(schema.roleTable.id, memberRole.id));
    await visible();
    const duplicate = requireRow(
      await db
        .insert(schema.workspaceUserTable)
        .values({
          workspaceId: workspace.id,
          userId: user.id,
          role: "member",
          joinedAt: new Date(),
        })
        .returning(),
      "duplicate member",
    );
    await hidden();
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.id, duplicate.id));
    await visible();
    await db
      .delete(schema.roleTable)
      .where(eq(schema.roleTable.id, memberRole.id));
    await visible();
    await db
      .update(schema.workspaceRoleTable)
      .set({ isSystem: false })
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspace.id),
          eq(schema.workspaceRoleTable.role, "member"),
        ),
      );
    await hidden();
    await db
      .update(schema.workspaceRoleTable)
      .set({ isSystem: true })
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspace.id),
          eq(schema.workspaceRoleTable.role, "member"),
        ),
      );
    await visible();

    const custom = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: workspace.id,
          key: `history-${randomUUID()}`,
          name: "History reader",
          rank: 25,
          capabilities: ["work_item:read"],
          isSystem: false,
        })
        .returning(),
      "custom role",
    );
    await db
      .update(schema.workspaceUserTable)
      .set({ role: custom.key })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, user.id),
        ),
      );
    const customIdentity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!customIdentity) throw new Error("Missing custom-role identity");
    await visible({ ...input, identity: customIdentity });
    await db
      .update(schema.roleTable)
      .set({ capabilities: [] })
      .where(eq(schema.roleTable.id, custom.id));
    await hidden({ ...input, identity: customIdentity });

    const scopedRole = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: workspace.id,
          key: `scoped-${randomUUID()}`,
          name: "Scoped reader",
          rank: 25,
          capabilities: ["work_item:read"],
          isSystem: false,
        })
        .returning(),
      "scoped role",
    );
    await db.insert(schema.membershipTable).values({
      personId: identity.personId,
      scope: "workspace",
      scopeId: workspace.id,
      roleId: scopedRole.id,
    });
    await visible({ ...input, identity: customIdentity });
    const foreignWorkspace = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.roleTable)
      .set({ workspaceId: foreignWorkspace.workspace.id })
      .where(eq(schema.roleTable.id, scopedRole.id));
    await hidden({ ...input, identity: customIdentity });
    await db
      .update(schema.roleTable)
      .set({ workspaceId: workspace.id })
      .where(eq(schema.roleTable.id, scopedRole.id));
    await visible({ ...input, identity: customIdentity });
    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, user.id));
    await hidden({ ...input, identity: customIdentity });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, user.id));
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, identity.personId));
    await hidden({ ...input, identity: customIdentity });
  });
});
