import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createServiceApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import {
  customFieldSectionTable,
  customFieldTable,
} from "../../apps/api/src/database/migration-schema";
import { automationTable } from "../../apps/api/src/database/schema";
import {
  cycleTable,
  moduleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { kbCategoryTable } from "../../apps/api/src/database/schema-p5-kb";
import { projectPageTable } from "../../apps/api/src/database/schema-p5-pages";
import { dashboardTable } from "../../apps/api/src/database/schema-p5-reports";
import { serviceTable } from "../../apps/api/src/database/schema-p5-service";
import { createApp } from "../../apps/api/src/index";
import { registeredDeletionTargets } from "../../apps/api/src/pending-action/deletion-targets";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  requireRow,
} from "./helpers/fixtures";
import { setAgileFlags } from "./helpers/p5-agile";
import { setPagesFlag } from "./helpers/p5-pages";
import { setFeature } from "./helpers/p5-reports";
import { setServiceFlag } from "./helpers/p5-service";
import { upsertWorkspaceRoleRows } from "./helpers/workspace-role-rows";

/**
 * P0R1-08 (PA-1, PA-2): the OpenAPI check in delete-routes-never-immediate.test.ts only proves a
 * DELETE route *declares* 202. This file proves it at runtime for the registered deletion
 * targets: the real handler answers 202 with a pendingActionId, a `pending` pending_action row
 * exists for exactly that target and route, and the target row is still there. Registered
 * targets that need their own world (instance administrator, identity connection, service
 * desk, agile, time/cost, pages) are proven by the named runtime test; the coverage check below
 * fails when a registered target is in neither list.
 */

const normalise = (key: string) =>
  key.replace(/\{[^}]+\}|:[A-Za-z0-9_]+/g, "{}");

type World = Awaited<ReturnType<typeof world>>;

async function world() {
  const member = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantProjectManageAccess(member.user.id, project.id);
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id)),
    "requester",
  );
  await db.insert(schema.sessionTable).values({
    id: `session-${member.user.id}`,
    token: randomUUID(),
    userId: member.user.id,
    portal: "agent",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  // Feature-gated surfaces (agile, pages, reports, knowledge base, intake, service catalogue) are on, so
  // the request reaches the deletion handler rather than the feature gate.
  await setAgileFlags(project.id, { cycles: true, modules: true });
  await setPagesFlag([project.id], true);
  await setFeature(member.workspace.id, "feature.reports", true);
  await setFeature(member.workspace.id, "feature.knowledge_base", true);
  await setFeature(member.workspace.id, "feature.intake", true);
  await setServiceFlag(member.workspace.id, true);
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  return { member, project, columns, person, app };
}

type Case = {
  /** The registered route template the request must land on. */
  route: string;
  seed: (w: World) => Promise<{ path: string; id: string }>;
  survives: (id: string) => Promise<boolean>;
};

const present = async (rows: Promise<unknown[]>) => (await rows).length === 1;

const CASES: Case[] = [
  {
    route: "DELETE /api/column/{id}",
    seed: async (w) => ({
      path: `/api/column/${w.columns.inReview.id}`,
      id: w.columns.inReview.id,
    }),
    survives: (id) =>
      present(
        db
          .select()
          .from(schema.columnTable)
          .where(eq(schema.columnTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/canned-responses/{id}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(schema.cannedResponseTable)
          .values({
            workspaceId: w.member.workspace.id,
            name: "Greeting",
            body: { type: "doc", content: [] },
          })
          .returning(),
        "canned response",
      );
      return { path: `/api/canned-responses/${row.id}`, id: row.id };
    },
    survives: (id) =>
      present(
        db
          .select()
          .from(schema.cannedResponseTable)
          .where(eq(schema.cannedResponseTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/project/{id}/milestones/{milestoneId}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(schema.milestoneTable)
          .values({
            projectId: w.project.id,
            name: "Go-live",
            date: new Date(),
          })
          .returning(),
        "milestone",
      );
      return {
        path: `/api/project/${w.project.id}/milestones/${row.id}`,
        id: row.id,
      };
    },
    survives: (id) =>
      present(
        db
          .select()
          .from(schema.milestoneTable)
          .where(eq(schema.milestoneTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/label/{id}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(schema.labelTable)
          .values({
            workspaceId: w.member.workspace.id,
            name: "urgent",
            color: "#ff0000",
          })
          .returning(),
        "label",
      );
      return { path: `/api/label/${row.id}`, id: row.id };
    },
    survives: (id) =>
      present(
        db.select().from(schema.labelTable).where(eq(schema.labelTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/workspace/{workspaceId}/roles/{roleId}",
    seed: async (w) => {
      const role = await upsertWorkspaceRoleRows(
        w.member.workspace.id,
        "auditor",
        { project: ["read"] },
      );
      return {
        path: `/api/workspace/${w.member.workspace.id}/roles/${role.id}`,
        id: role.id,
      };
    },
    survives: (id) =>
      present(
        db.select().from(schema.roleTable).where(eq(schema.roleTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/invitation/{id}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(schema.invitationTable)
          .values({
            workspaceId: w.member.workspace.id,
            email: `invitee-${randomUUID()}@example.com`,
            role: "member",
            expiresAt: new Date(Date.now() + 86_400_000),
            inviterId: w.member.user.id,
          })
          .returning(),
        "invitation",
      );
      return { path: `/api/invitation/${row.id}`, id: row.id };
    },
    survives: async (id) =>
      requireRow(
        await db
          .select({ status: schema.invitationTable.status })
          .from(schema.invitationTable)
          .where(eq(schema.invitationTable.id, id)),
        "invitation",
      ).status === "pending",
  },
  {
    route: "DELETE /api/teams/{id}",
    seed: async (w) => {
      const now = new Date();
      const row = requireRow(
        await db
          .insert(schema.teamTable)
          .values({
            id: `team-${randomUUID()}`,
            name: "Service desk",
            workspaceId: w.member.workspace.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning(),
        "team",
      );
      return { path: `/api/teams/${row.id}`, id: row.id };
    },
    survives: (id) =>
      present(
        db.select().from(schema.teamTable).where(eq(schema.teamTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/automations/{id}",
    seed: async (w) => {
      const role = requireRow(
        await db
          .insert(schema.roleTable)
          .values({
            scope: "workspace",
            workspaceId: w.member.workspace.id,
            key: `automation-agent-${randomUUID()}`,
            name: "Automation agent",
            rank: 50,
            capabilities: ["work_item:read"],
          })
          .returning(),
        "role",
      );
      const row = requireRow(
        await db
          .insert(automationTable)
          .values({
            workspaceId: w.member.workspace.id,
            name: "Tidy up",
            trigger: "work_item.created",
            effectiveRoleId: role.id,
            createdBy: w.person.id,
          })
          .returning(),
        "automation",
      );
      return { path: `/api/automations/${row.id}`, id: row.id };
    },
    survives: (id) =>
      present(
        db.select().from(automationTable).where(eq(automationTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/project/{id}",
    seed: async (w) => ({
      path: `/api/project/${w.project.id}`,
      id: w.project.id,
    }),
    survives: async (id) =>
      requireRow(
        await db
          .select({ deletedAt: schema.projectTable.deletedAt })
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, id)),
        "project",
      ).deletedAt === null,
  },
  {
    route: "DELETE /api/workspace/{workspaceId}",
    seed: async (w) => ({
      path: `/api/workspace/${w.member.workspace.id}`,
      id: w.member.workspace.id,
    }),
    survives: (id) =>
      present(
        db
          .select()
          .from(schema.workspaceTable)
          .where(eq(schema.workspaceTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/label/project/{projectId}/catalogue/{id}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(schema.labelTable)
          .values({
            workspaceId: w.member.workspace.id,
            projectId: w.project.id,
            name: "Project-specific",
            color: "blue",
          })
          .returning(),
        "project label",
      );
      return {
        path: `/api/label/project/${w.project.id}/catalogue/${row.id}`,
        id: row.id,
      };
    },
    survives: (id) =>
      present(
        db.select().from(schema.labelTable).where(eq(schema.labelTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/workspaces/{id}/api-keys/{keyId}",
    seed: async (w) => {
      const key = await createServiceApiKey(
        { userId: w.member.user.id },
        w.member.workspace.id,
        { name: "CI service key", capabilities: ["workspace:read"] },
      );
      return {
        path: `/api/workspaces/${w.member.workspace.id}/api-keys/${key.id}`,
        id: key.id,
      };
    },
    survives: (id) =>
      present(
        db
          .select()
          .from(schema.apikeyTable)
          .where(eq(schema.apikeyTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/custom-fields/{id}",
    seed: async (w) => {
      const [section] = await db
        .insert(customFieldSectionTable)
        .values({
          id: randomUUID(),
          workspaceId: w.member.workspace.id,
          name: "Facts",
        })
        .returning();
      const row = requireRow(
        await db
          .insert(customFieldTable)
          .values({
            id: randomUUID(),
            workspaceId: w.member.workspace.id,
            sectionId: section?.id ?? "",
            key: `cf-${randomUUID().slice(0, 6)}`,
            name: "Region",
            format: "text",
          })
          .returning(),
        "custom field",
      );
      return { path: `/api/custom-fields/${row.id}`, id: row.id };
    },
    survives: async (id) =>
      requireRow(
        await db
          .select({ deletedAt: customFieldTable.deletedAt })
          .from(customFieldTable)
          .where(eq(customFieldTable.id, id)),
        "custom field",
      ).deletedAt === null,
  },
  {
    route: "DELETE /api/request-types/{id}",
    seed: async (w) => {
      const type = requireRow(
        await db
          .insert(schema.workItemTypeTable)
          .values({
            workspaceId: w.member.workspace.id,
            key: `rt-${randomUUID().slice(0, 6)}`,
            name: "Request",
            category: "service",
          })
          .returning(),
        "work item type",
      );
      const row = requireRow(
        await db
          .insert(schema.requestTypeTable)
          .values({
            workspaceId: w.member.workspace.id,
            key: randomUUID(),
            name: "Request",
            group: "Support",
            workItemTypeId: type.id,
            formSchema: { fields: [] },
          })
          .returning(),
        "request type",
      );
      return { path: `/api/request-types/${row.id}`, id: row.id };
    },
    survives: (id) =>
      present(
        db
          .select()
          .from(schema.requestTypeTable)
          .where(eq(schema.requestTypeTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/cycles/{id}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(cycleTable)
          .values({
            workspaceId: w.member.workspace.id,
            projectId: w.project.id,
            name: "Cycle",
            startDate: new Date(Date.now() + 86_400_000)
              .toISOString()
              .slice(0, 10),
            endDate: new Date(Date.now() + 8 * 86_400_000)
              .toISOString()
              .slice(0, 10),
          })
          .returning(),
        "cycle",
      );
      return { path: `/api/cycles/${row.id}`, id: row.id };
    },
    survives: (id) =>
      present(db.select().from(cycleTable).where(eq(cycleTable.id, id))),
  },
  {
    route: "DELETE /api/modules/{id}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(moduleTable)
          .values({
            workspaceId: w.member.workspace.id,
            projectId: w.project.id,
            name: "Module",
          })
          .returning(),
        "module",
      );
      return { path: `/api/modules/${row.id}`, id: row.id };
    },
    survives: (id) =>
      present(db.select().from(moduleTable).where(eq(moduleTable.id, id))),
  },
  {
    route: "DELETE /api/projects/{projectId}/pages/{id}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(projectPageTable)
          .values({
            workspaceId: w.member.workspace.id,
            projectId: w.project.id,
            title: "Runbook",
            body: { type: "doc", content: [] },
          })
          .returning(),
        "page",
      );
      return {
        path: `/api/projects/${w.project.id}/pages/${row.id}`,
        id: row.id,
      };
    },
    survives: async (id) =>
      requireRow(
        await db
          .select({ deletedAt: projectPageTable.deletedAt })
          .from(projectPageTable)
          .where(eq(projectPageTable.id, id)),
        "page",
      ).deletedAt === null,
  },
  {
    route: "DELETE /api/dashboards/{id}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(dashboardTable)
          .values({
            workspaceId: w.member.workspace.id,
            name: "Team overview",
            scope: "workspace",
          })
          .returning(),
        "dashboard",
      );
      return { path: `/api/dashboards/${row.id}`, id: row.id };
    },
    survives: (id) =>
      present(
        db.select().from(dashboardTable).where(eq(dashboardTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/kb/categories/{id}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(kbCategoryTable)
          .values({ workspaceId: w.member.workspace.id, name: "Guides" })
          .returning(),
        "kb category",
      );
      return { path: `/api/kb/categories/${row.id}`, id: row.id };
    },
    survives: (id) =>
      present(
        db.select().from(kbCategoryTable).where(eq(kbCategoryTable.id, id)),
      ),
  },
  {
    route: "DELETE /api/services/{id}",
    seed: async (w) => {
      const row = requireRow(
        await db
          .insert(serviceTable)
          .values({
            workspaceId: w.member.workspace.id,
            name: "Payments API",
            createdBy: w.member.user.id,
          })
          .returning(),
        "service",
      );
      return { path: `/api/services/${row.id}`, id: row.id };
    },
    survives: (id) =>
      present(db.select().from(serviceTable).where(eq(serviceTable.id, id))),
  },
];

/**
 * Registered targets whose runtime 202 + pending-action proof lives in a feature test with the
 * world it needs. Each named file must exist and request the route (checked below).
 */
const RUNTIME_ELSEWHERE: Record<string, { file: string; fragment: string }> = {
  "DELETE /api/project/{id}/prerequisites/{prerequisiteId}": {
    file: "project-prerequisites.test.ts",
    fragment: "/prerequisites/",
  },
  "DELETE /api/project/{id}/document-links/{documentLinkId}": {
    file: "project-document-links.test.ts",
    fragment: "/document-links/",
  },
  "DELETE /api/me/api-keys/{id}": {
    file: "personal-api-key-deletion.test.ts",
    fragment: "/api/me/api-keys/",
  },
  "DELETE /api/time-entries/{id}": {
    file: "p5-time-entries.test.ts",
    fragment: "/api/time-entries/",
  },
  "DELETE /api/cost-entries/{id}": {
    file: "p5-cost-entries.test.ts",
    fragment: "/api/cost-entries/",
  },
  "DELETE /api/webhooks/{id}": {
    file: "god-mode-p4-operations.test.ts",
    fragment: "/api/webhooks/",
  },
  "DELETE /api/instance/organisations/{id}": {
    file: "instance-organisation-lifecycle.test.ts",
    fragment: "/api/instance/organisations/",
  },
  "DELETE /api/instance/identity-connections/{id}": {
    file: "identity-connection-deletion.test.ts",
    fragment: "/api/instance/identity-connections/",
  },
};

describe("API integration: registered DELETE routes answer 202 with a pending action at runtime (P0R1-08)", () => {
  beforeEach(() => resetTestDatabase());

  it.each(CASES.map((entry) => [entry.route, entry] as const))(
    "%s: 202, a pending action for exactly that target, the target survives",
    async (_route, entry) => {
      const w = await world();
      const { path, id } = await entry.seed(w);
      const response = await w.app.request(path, { method: "DELETE" });
      expect(response.status, await response.clone().text()).toBe(202);
      const body = (await response.json()) as { pendingActionId?: string };
      expect(body.pendingActionId).toEqual(expect.any(String));
      const row = requireRow(
        await db
          .select()
          .from(schema.pendingActionTable)
          .where(
            eq(schema.pendingActionTable.id, body.pendingActionId as string),
          ),
        "pending action",
      );
      expect(row).toMatchObject({
        state: "pending",
        action: "delete",
        requestedByPersonId: w.person.id,
        targetIds: [id],
      });
      expect(normalise(row.routeKey)).toBe(normalise(entry.route));
      expect(
        registeredDeletionTargets().some(
          (target) =>
            target.routeKey === row.routeKey &&
            target.targetType === row.targetType,
        ),
      ).toBe(true);
      expect(await entry.survives(id)).toBe(true);
    },
  );

  it("records the trusted-proxy client address, never a forged X-Forwarded-For (P0R1-09)", async () => {
    const w = await world();
    const response = await w.app.request(
      `/api/column/${w.columns.inReview.id}`,
      {
        method: "DELETE",
        headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" },
      },
    );
    expect(response.status, await response.clone().text()).toBe(202);
    const { pendingActionId } = (await response.json()) as {
      pendingActionId: string;
    };
    const [requested] = await db
      .select({ actorIp: schema.auditLogTable.actorIp })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, pendingActionId));
    expect(requested).toBeDefined();
    // One trusted hop (the default): the entry the proxy appended is the client; the
    // caller-supplied prefix is ignored. A raw header read would store the whole chain.
    expect(requested?.actorIp).toBe("203.0.113.9");
  });

  it("every registered DELETE target is proven at runtime here or in a named feature test", () => {
    const here = new Set(CASES.map((entry) => normalise(entry.route)));
    const elsewhere = new Map(
      Object.entries(RUNTIME_ELSEWHERE).map(([key, value]) => [
        normalise(key),
        value,
      ]),
    );
    const missing: string[] = [];
    for (const target of registeredDeletionTargets()) {
      if (!target.routeKey.startsWith("DELETE ")) continue;
      const key = normalise(target.routeKey);
      if (here.has(key)) continue;
      const proof = elsewhere.get(key);
      if (!proof) {
        missing.push(target.routeKey);
        continue;
      }
      const file = new URL(`./${proof.file}`, import.meta.url);
      expect(existsSync(file), `${target.routeKey}: ${proof.file}`).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source, `${target.routeKey}: ${proof.file}`).toContain(
        proof.fragment,
      );
      expect(source, `${target.routeKey}: ${proof.file}`).toMatch(
        /toBe\(202\)/,
      );
    }
    expect(missing).toEqual([]);
  });
});
