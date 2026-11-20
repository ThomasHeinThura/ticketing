import { randomUUID } from "node:crypto";
import { can, reaches } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import {
  budgetTable,
  costTypeTable,
  hourlyRateTable,
} from "../../apps/api/src/database/schema-p5-time";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import { personIdOf, setTimeFlags } from "./helpers/p5-time";
import { addMember } from "./helpers/reach-world";

describe("mounted settings history HTTP policies", () => {
  beforeEach(async () => resetTestDatabase());

  it.each([
    "workspace_label",
    "project_label",
    "state",
    "cost_type",
    "hourly_rate",
    "budget",
  ] as const)(
    "%s requires its own capability and workspace reach",
    async (type) => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const foreign = await createWorkspaceMember({ role: "owner" });
      const workspaceId = owner.workspace.id;
      await setTimeFlags(workspaceId);
      const { project } = await createProjectFixture({ workspaceId });
      await grantProjectRole(owner.user.id, project.id, [
        "project:read",
        "budget:read",
      ]);
      const denied = await addMember(workspaceId, "member");
      const key = `history-empty-${randomUUID()}`;
      await db.insert(schema.roleTable).values({
        scope: "workspace",
        workspaceId,
        key,
        name: "No capabilities",
        rank: 1,
        capabilities: [],
      });
      await db
        .update(schema.workspaceUserTable)
        .set({ role: key })
        .where(eq(schema.workspaceUserTable.userId, denied.user.id));
      await grantProjectRole(denied.user.id, project.id, []);
      const deniedIdentity = await resolveIdentity({
        userId: denied.user.id,
        credential: "session",
      });
      if (!deniedIdentity) throw new Error("Missing denied identity");
      expect(
        reaches(deniedIdentity, {
          workspaceId,
          projectId: project.id,
          organisationId: project.organisationId,
        }),
      ).toBe(true);
      const capability =
        type === "state"
          ? "project:read"
          : type === "budget"
            ? "budget:read"
            : type === "cost_type" || type === "hourly_rate"
              ? "time_entry:manage_rates"
              : "workspace:read";
      const resource =
        type === "state" || type === "budget" || type === "project_label"
          ? "project"
          : "workspace";
      expect(
        can(deniedIdentity, capability, resource, {
          workspaceId,
          ...(resource === "project" ? { projectId: project.id } : {}),
        }),
      ).toBe(false);
      const personId = await personIdOf(owner.user.id);
      const template = requireRow(
        await db
          .insert(schema.stateTemplateTable)
          .values({
            workspaceId,
            key: `state-${randomUUID()}`,
            name: "Open",
            group: "backlog",
          })
          .returning(),
        "template",
      );
      const state = requireRow(
        await db
          .insert(schema.stateTable)
          .values({ projectId: project.id, stateTemplateId: template.id })
          .returning(),
        "state",
      );
      const cost = requireRow(
        await db
          .insert(costTypeTable)
          .values({ workspaceId, name: "cost", currency: "USD" })
          .returning(),
        "cost",
      );
      const rate = requireRow(
        await db
          .insert(hourlyRateTable)
          .values({
            workspaceId,
            projectId: project.id,
            personId,
            rateMinor: 100,
            currency: "USD",
            effectiveFrom: "2026-11-17",
          })
          .returning(),
        "rate",
      );
      const budget = requireRow(
        await db
          .insert(budgetTable)
          .values({
            workspaceId,
            projectId: project.id,
            name: "budget",
            plannedAmountMinor: 100,
            currency: "USD",
            periodStart: "2026-11-01",
            periodEnd: "2026-11-30",
          })
          .returning(),
        "budget",
      );
      const label = requireRow(
        await db
          .insert(schema.labelTable)
          .values({
            workspaceId,
            projectId: type === "project_label" ? project.id : null,
            name: "label",
            color: "blue",
          })
          .returning(),
        "label",
      );
      const entries = {
        workspace_label: {
          id: label.id,
          entityType: "label",
          action: "label.catalogue_created",
          projectId: null,
        },
        project_label: {
          id: label.id,
          entityType: "label",
          action: "label.catalogue_created",
          projectId: project.id,
        },
        state: {
          id: state.id,
          entityType: "state",
          action: "state.wip_limit_changed",
          projectId: project.id,
        },
        cost_type: {
          id: cost.id,
          entityType: "cost_type",
          action: "cost_type.created",
          projectId: null,
        },
        hourly_rate: {
          id: rate.id,
          entityType: "hourly_rate",
          action: "hourly_rate.created",
          projectId: project.id,
        },
        budget: {
          id: budget.id,
          entityType: "budget",
          action: "budget.created",
          projectId: project.id,
        },
      } as const;
      const entry = entries[type];
      await appendAuditLog(db, {
        actorId: owner.user.id,
        actorType: "person",
        workspaceId,
        projectId: entry.projectId,
        entityType: entry.entityType,
        entityId: entry.id,
        action: entry.action,
        after: { changedFields: ["name"] },
      });
      const { app } = createApp();
      const read = (user: typeof owner.user) => {
        mockAuthenticatedSession(user);
        return app.request(
          `/api/audit?entity_type=${type}&entity_id=${entry.id}`,
        );
      };
      const allowed = await read(owner.user);
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({
        entityType: type,
        entityId: entry.id,
        workspaceId,
        projectId: entry.projectId,
        rows: [expect.objectContaining({ action: entry.action })],
      });
      for (const user of [denied.user, foreign.user]) {
        const response = await read(user);
        expect([403, 404]).toContain(response.status);
        expect(await response.text()).not.toContain(entry.action);
      }
    },
  );
});
