/**
 * P5-R1-06: the P5 tables carry RESTRICT / NO ACTION links (`release_service_fk`,
 * `change_service_service_fk`, `module_lead_id_person_id_fk`). With every P5 table populated, the
 * deletes the platform performs must still succeed: a workspace hard delete (route and account
 * erasure), deleting a person who leads a module, and deleting the organisation a person belongs to.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { moduleTable } from "../../apps/api/src/database/schema-p5-agile";
import deleteAccountData from "../../apps/api/src/user/controllers/delete-account-data";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import deleteWorkspace from "../../apps/api/src/workspace/controllers/delete-workspace";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";
import { populateP5 } from "./helpers/p5-populated";

beforeEach(async () => resetTestDatabase());

const TABLES = [
  "service",
  "service_link",
  "service_dependency",
  "release",
  "change_detail",
  "change_service",
  "module",
  "cycle",
  "kb_article",
  "time_entry",
  "time_activity",
  "project_page",
  "project_page_version",
  "dashboard",
] as const;

async function counts(workspaceId: string) {
  const out: Record<string, number> = {};
  for (const table of TABLES) {
    const column = table === "project_page_version" ? null : "workspace_id";
    const result = column
      ? await db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${workspaceId}`,
        )
      : await db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM project_page_version v
          JOIN project_page p ON p.id = v.page_id WHERE p.workspace_id = ${workspaceId}`);
    out[table] = result.rows[0]?.n ?? 0;
  }
  return out;
}

async function staffWorld() {
  const member = await createWorkspaceMember({ role: "owner" });
  await ensureStaffPersonForUser(member.user.id);
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id))
      .limit(1),
    "person",
  );
  return { ...member, person };
}

async function foreignOrgPerson() {
  const orgId = `org-${randomUUID()}`;
  await db
    .insert(schema.organisationTable)
    .values({ id: orgId, key: orgId, name: "Leaver org", isInternal: false });
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId: orgId,
        side: "staff",
        active: true,
        isPlaceholder: true,
        displayName: "Module lead",
      })
      .returning(),
    "person",
  );
  return { orgId, person };
}

describe("P5 data does not block deletes (P5-R1-06)", () => {
  it("hard-deletes a workspace with every P5 table populated", async () => {
    const w = await staffWorld();
    await populateP5(w.workspace.id, w.person.id);
    const before = await counts(w.workspace.id);
    for (const table of TABLES) expect(before[table], table).toBeGreaterThan(0);
    const deleted = await deleteWorkspace(w.workspace.id, "no-session");
    expect(deleted?.id).toBe(w.workspace.id);
    const after = await counts(w.workspace.id);
    for (const table of TABLES) expect(after[table], table).toBe(0);
  });

  it("cascades a bare workspace row delete through RESTRICT service links (no trigger-order dependence)", async () => {
    const w = await staffWorld();
    await populateP5(w.workspace.id, w.person.id);
    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, w.workspace.id));
    const after = await counts(w.workspace.id);
    for (const table of TABLES) expect(after[table], table).toBe(0);
  });

  it("erases an account whose sole workspace holds P5 data, including a module it leads", async () => {
    const w = await staffWorld();
    await populateP5(w.workspace.id, w.person.id);
    await deleteAccountData(w.user.id);
    const after = await counts(w.workspace.id);
    for (const table of TABLES) expect(after[table], table).toBe(0);
  });

  it("deletes a person who leads a module: the module stays, its lead clears", async () => {
    const w = await staffWorld();
    const lead = await foreignOrgPerson();
    const world = await populateP5(w.workspace.id, lead.person.id);
    await db
      .delete(schema.personTable)
      .where(eq(schema.personTable.id, lead.person.id));
    const [mod] = await db
      .select()
      .from(moduleTable)
      .where(eq(moduleTable.id, world.mod.id));
    expect(mod).toBeDefined();
    expect(mod?.leadId).toBeNull();
  });

  it("keeps the person and the module when only the user account of a lead is deleted", async () => {
    const w = await staffWorld();
    const world = await populateP5(w.workspace.id, w.person.id);
    await db.delete(schema.userTable).where(eq(schema.userTable.id, w.user.id));
    const [mod] = await db
      .select()
      .from(moduleTable)
      .where(eq(moduleTable.id, world.mod.id));
    expect(mod?.leadId).toBe(w.person.id);
  });

  it("purges an organisation whose person leads a module in another organisation's workspace", async () => {
    const w = await staffWorld();
    const lead = await foreignOrgPerson();
    const world = await populateP5(w.workspace.id, lead.person.id);
    await db
      .delete(schema.organisationTable)
      .where(eq(schema.organisationTable.id, lead.orgId));
    const [mod] = await db
      .select()
      .from(moduleTable)
      .where(eq(moduleTable.id, world.mod.id));
    expect(mod?.leadId).toBeNull();
    // The workspace's own data is untouched apart from rows owned by the purged people.
    const after = await counts(w.workspace.id);
    expect(after.service).toBe(2);
    expect(after.release).toBe(1);
    expect(after.change_service).toBe(1);
  });
});
