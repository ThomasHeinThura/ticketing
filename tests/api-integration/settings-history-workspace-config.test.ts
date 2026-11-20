import { randomUUID } from "node:crypto";
import { can } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import {
  customFieldSectionTable,
  customFieldTable,
} from "../../apps/api/src/database/migration-schema";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  assignProjectLimitedRole,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

const cases = [
  ["team", "workspace:read"],
  ["service_calendar", "sla_policy:read"],
  ["sla_policy", "sla_policy:read"],
  ["request_type", "request_type:read"],
  ["custom_field", "workspace:read"],
  ["custom_field_section", "workspace:read"],
  ["state_template", "workspace:manage_settings"],
] as const;

describe("workspace configuration history HTTP authorization", () => {
  beforeEach(async () => resetTestDatabase());

  it.each(cases)(
    "authorizes %s history by current workspace and capability",
    async (entityType, capability) => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const foreign = await createWorkspaceMember({ role: "owner" });
      const workspaceId = owner.workspace.id;
      const now = new Date();
      await db.insert(schema.sessionTable).values(
        [owner, foreign].map(({ user }) => ({
          id: `session-${user.id}`,
          token: `token-${user.id}`,
          userId: user.id,
          portal: "agent" as const,
          expiresAt: new Date(Date.now() + 3_600_000),
        })),
      );
      const team = requireRow(
        await db
          .insert(schema.teamTable)
          .values({
            id: randomUUID(),
            workspaceId,
            name: "Team",
            createdAt: now,
            updatedAt: now,
          })
          .returning(),
        "team",
      );
      const calendar = requireRow(
        await db
          .insert(schema.serviceCalendarTable)
          .values({
            workspaceId,
            name: "Calendar",
            timezone: "UTC",
            windows: {},
            holidays: [],
          })
          .returning(),
        "calendar",
      );
      const policy = requireRow(
        await db
          .insert(schema.slaPolicyTable)
          .values({ workspaceId, name: "Policy" })
          .returning(),
        "policy",
      );
      const workType = requireRow(
        await db
          .insert(schema.workItemTypeTable)
          .values({
            workspaceId,
            key: randomUUID(),
            name: "Request",
            category: "service",
          })
          .returning(),
        "work type",
      );
      const request = requireRow(
        await db
          .insert(schema.requestTypeTable)
          .values({
            workspaceId,
            key: randomUUID(),
            name: "Request",
            group: "Support",
            workItemTypeId: workType.id,
            formSchema: { fields: [] },
          })
          .returning(),
        "request",
      );
      const section = requireRow(
        await db
          .insert(customFieldSectionTable)
          .values({ id: randomUUID(), workspaceId, name: "Section" })
          .returning(),
        "section",
      );
      const field = requireRow(
        await db
          .insert(customFieldTable)
          .values({
            id: randomUUID(),
            workspaceId,
            sectionId: section.id,
            key: `cf-${randomUUID()}`,
            name: "Field",
            format: "text",
          })
          .returning(),
        "field",
      );
      const template = requireRow(
        await db
          .insert(schema.stateTemplateTable)
          .values({
            workspaceId,
            key: randomUUID(),
            name: "Backlog",
            group: "backlog",
          })
          .returning(),
        "template",
      );
      const id = {
        team: team.id,
        service_calendar: calendar.id,
        sla_policy: policy.id,
        request_type: request.id,
        custom_field: field.id,
        custom_field_section: section.id,
        state_template: template.id,
      }[entityType];
      const action = `${entityType}.created`;
      await appendAuditLog(db, {
        actorId: owner.user.id,
        actorType: "person",
        workspaceId,
        action,
        entityType,
        entityId: id,
        after: { name: "Private history" },
      });
      mockAuthenticatedSession(owner.user);
      const { app } = createApp();
      const path = `/api/audit?entity_type=${entityType}&entity_id=${encodeURIComponent(id)}`;
      const headers = {
        cookie: `__Host-tdk_agent_session=token-${owner.user.id}`,
      };
      const visible = await app.request(path, { headers });
      expect(visible.status).toBe(200);
      const body = await visible.json();
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].action).toBe(action);

      const role = await assignProjectLimitedRole(
        owner.user.id,
        workspaceId,
        "admin",
      );
      await db
        .update(schema.roleTable)
        .set({ capabilities: [] })
        .where(
          and(
            eq(schema.roleTable.workspaceId, workspaceId),
            eq(schema.roleTable.key, role),
          ),
        );
      const identity = await resolveIdentity({
        userId: owner.user.id,
        credential: "session",
      });
      expect(
        identity?.memberships.some(
          (member) =>
            member.scope === "workspace" && member.scopeId === workspaceId,
        ),
      ).toBe(true);
      if (!identity) throw new Error("Missing identity");
      expect(can(identity, capability, "workspace", { workspaceId })).toBe(
        false,
      );
      const denied = await app.request(path, { headers });
      expect([403, 404]).toContain(denied.status);
      const deniedBody = await denied.text();
      expect(deniedBody).not.toContain(action);
      expect(deniedBody).not.toContain('"rows"');

      mockAuthenticatedSession(foreign.user);
      const foreignResponse = await app.request(path, {
        headers: {
          cookie: `__Host-tdk_agent_session=token-${foreign.user.id}`,
        },
      });
      expect([403, 404]).toContain(foreignResponse.status);
      const foreignBody = await foreignResponse.text();
      expect(foreignBody).not.toContain(action);
      expect(foreignBody).not.toContain('"rows"');
    },
  );
});
