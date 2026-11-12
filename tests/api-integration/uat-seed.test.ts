import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { reaches } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  G1_AUTOMATIONS,
  G1_PENDING_CUSTOMER,
  G1_PROJECT_IDS,
  G1_SERVICE_STATES,
} from "../../apps/api/scripts/uat-seed-plan";
import { finalizeVerifiedFirstUserSetup } from "../../apps/api/src/auth/repository";
import { validateRuleDefinition } from "../../apps/api/src/automation/validation";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { automationTable } from "../../apps/api/src/database/schema";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";

const execute = promisify(execFile);
let directory: string;
async function snapshot() {
  const tables = (
    await db.execute<{ name: string }>(
      sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    )
  ).rows;
  const result: Record<string, string[]> = {};
  for (const { name } of tables)
    result[name] = (
      await db.execute<{ row: string }>(
        sql`select row_to_json(t)::text as row from ${sql.identifier(name)} t`,
      )
    ).rows
      .map((r) => r.row)
      .sort();
  return result;
}
async function run() {
  return execute(
    "pnpm",
    [
      "exec",
      "tsx",
      "../../scripts/seed-uat.mjs",
      "--uat",
      "--credentials-file",
      path.join(directory, "credentials.json"),
    ],
    {
      cwd: `${import.meta.dirname}/../../apps/api`,
      env: process.env,
      timeout: 120000,
    },
  );
}
afterAll(async () => {
  await getDatabasePool().end();
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe("clean-install seed on a disposable migrated database", () => {
  it("keeps setup, creates the journeys, grants exact reach, and writes nothing on rerun", async () => {
    await resetTestDatabase({ defaultOffFeatures: false });
    directory = await mkdtemp(
      path.join(os.tmpdir(), "taskdesk-g1-credentials-"),
    );
    await expect(run()).rejects.toThrow(/Complete first-administrator setup/);
    await db.transaction(async (tx) => {
      const org = await ensureInternalOrganisation(tx);
      await tx.insert(schema.userTable).values({
        id: "g1-first-admin",
        name: "First administrator",
        email: "first-admin@example.test",
        role: "admin",
        emailVerified: true,
        twoFactorEnabled: true,
      });
      await tx.insert(schema.personTable).values({
        id: "g1-first-admin-person",
        userId: "g1-first-admin",
        organisationId: org.id,
        side: "staff",
      });
      await tx.insert(schema.twoFactorTable).values({
        id: "g1-first-admin-factor",
        userId: "g1-first-admin",
        secret: randomBytes(32).toString("hex"),
        backupCodes: randomBytes(32).toString("hex"),
        verified: true,
      });
      await finalizeVerifiedFirstUserSetup(tx, "g1-first-admin");
    });
    const marker = await db.select().from(schema.instanceSettingTable);
    const first = await run();
    expect(await db.select().from(schema.instanceSettingTable)).toEqual(marker);
    const projects = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.workspaceId, "uat-ws"));
    expect(projects).toHaveLength(4);
    for (const project of projects)
      expect(project.managerId).toBe("uat-person-manager");
    expect(projects.find((p) => p.id === "uat-proj-support")?.kind).toBe(
      "managed_service",
    );
    const expected: Record<string, string[]> = {
      owner: [...G1_PROJECT_IDS],
      admin: [...G1_PROJECT_IDS],
      manager: [...G1_PROJECT_IDS],
      lead: ["uat-proj-support", "uat-proj-itops", "uat-proj-web"],
      agent1: ["uat-proj-support", "uat-proj-itops", "uat-proj-web"],
      agent2: [...G1_PROJECT_IDS],
      viewer: ["uat-proj-web"],
    };
    for (const [key, ids] of Object.entries(expected)) {
      const identity = await resolveIdentity({
        userId: `uat-user-${key}`,
        credential: "session",
      });
      expect(identity).toBeTruthy();
      if (!identity) throw new Error("Missing staff identity");
      expect(
        projects
          .filter((p) =>
            reaches(identity, {
              projectId: p.id,
              workspaceId: p.workspaceId,
              organisationId: p.organisationId,
              ownerTeamId: p.ownerTeamId,
            }),
          )
          .map((p) => p.id)
          .sort(),
      ).toEqual([...ids].sort());
    }
    for (const [key, ids] of Object.entries({
      contoso1: ["uat-proj-support"],
      contoso2: ["uat-proj-contoso-managed"],
      contoso3: ["uat-proj-support", "uat-proj-contoso-managed"],
      fabrikam1: ["uat-proj-web"],
    })) {
      const rows = await db
        .select()
        .from(schema.customerProjectAccessTable)
        .where(
          eq(schema.customerProjectAccessTable.personId, `uat-person-${key}`),
        );
      expect(rows.map((r) => r.projectId).sort()).toEqual(ids.sort());
      expect(rows.every((r) => r.grantedBy === "uat-person-owner")).toBe(true);
    }
    const [invitation] = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.email, G1_PENDING_CUSTOMER.email));
    expect(invitation?.status).toBe("pending");
    expect(invitation?.validatedProjectIds?.sort()).toEqual(
      [...G1_PENDING_CUSTOMER.projectIds].sort(),
    );
    const states = await db
      .select({ name: schema.stateTemplateTable.name })
      .from(schema.stateTable)
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTable.stateTemplateId, schema.stateTemplateTable.id),
      )
      .where(eq(schema.stateTable.projectId, "uat-proj-support"))
      .orderBy(schema.stateTable.position);
    expect(states.map((s) => s.name)).toEqual(
      G1_SERVICE_STATES.map((s) => s.name),
    );
    const approvals = await db
      .select()
      .from(schema.approvalTable)
      .where(
        and(
          eq(schema.approvalTable.workspaceId, "uat-ws"),
          eq(schema.approvalTable.state, "pending"),
        ),
      );
    expect(approvals).toHaveLength(1);
    for (const target of G1_AUTOMATIONS) {
      const validated = validateRuleDefinition(target.definition);
      const rows = await db
        .select()
        .from(automationTable)
        .where(eq(automationTable.name, target.name));
      if (validated.ok) expect(rows[0]?.enabled).toBe(true);
      else {
        expect(
          validated.problems.every(
            (p) =>
              p.code === "unavailable" ||
              (p.path === "conditions[1].basis" &&
                "scheduleCron" in target.definition),
          ),
        ).toBe(true);
        expect(rows).toEqual([]);
        expect(first.stdout).toContain(
          `Skipped automation "${target.name}": missing ${target.requires}.`,
        );
      }
    }
    for (const [table, id] of Object.entries({
      cycle: "uat-cycle",
      module: "uat-module",
      milestone: "uat-milestone",
      prerequisite: "uat-prerequisite",
      stakeholder: "uat-stakeholder",
      document_link: "uat-document-link",
      saved_view: "uat-saved-view",
      dashboard: "uat-dashboard",
      dashboard_widget: "uat-dashboard-widget",
      time_entry: "uat-time-entry",
      budget: "uat-budget",
      announcement: "uat-announcement",
      attachment: "uat-attachment",
      custom_field: "uat-custom-field",
      webhook: "uat-webhook",
      report_export: "uat-report-export",
    })) {
      const result = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where id = ${id}`,
      );
      expect(result.rows[0]?.n, table).toBe(1);
    }
    const [change] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, "uat-wi-sup-11"));
    const [changeState] = await db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.id, change?.stateId ?? ""));
    const [transition] = await db
      .select()
      .from(schema.workflowTransitionTable)
      .where(
        eq(schema.workflowTransitionTable.id, approvals[0]?.transitionId ?? ""),
      );
    expect(transition?.fromStateTemplateId).toBe(changeState?.stateTemplateId);
    const [triage] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .where(
        and(
          eq(schema.requestTypeTable.workspaceId, "uat-ws"),
          eq(schema.submissionTable.state, "new"),
        ),
      );
    expect(triage?.n).toBeGreaterThan(0);
    const before = await snapshot();
    await run();
    expect(await snapshot()).toEqual(before);
  });
});
