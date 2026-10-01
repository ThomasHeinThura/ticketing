import { count, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureTestDatabaseMigrated } from "../../../tests/api-integration/helpers/database";
import {
  HOSTILE_HIERARCHY_DEPTH,
  HOSTILE_TITLE_LENGTH,
  HOSTILE_TITLES,
  SEED_PROFILE_COUNTS,
  type SeedProfile,
} from "../../../tests/fixtures/seed-profiles";
import db, { getDatabasePool, schema } from "../src/database";
import { seed } from "./seed-profile";

const unrelatedUser = {
  id: "seed-test-unrelated-user",
  name: "Preserved row",
  email: "seed-test-unrelated@example.test",
  emailVerified: true,
};

async function profileCounts(profile: SeedProfile) {
  const namespace = `taskdesk-seed-${profile}`;
  const organisations = await db
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.key, "internal"));
  const [workspace] = await db
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.slug, `${namespace}-workspace`));
  const projects = await db
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(like(schema.projectTable.slug, `${namespace}-project-%`));
  const [people] = await db
    .select({ total: count() })
    .from(schema.personTable)
    .where(like(schema.personTable.id, `${namespace}-person-%`));
  const [items] = await db
    .select({ total: count() })
    .from(schema.workItemTable)
    .where(like(schema.workItemTable.key, `${namespace}-project-%-%`));

  return {
    organisations: organisations.length,
    workspaceId: workspace?.id,
    projects: projects.length,
    people: Number(people?.total ?? 0),
    items: Number(items?.total ?? 0),
  };
}

describe("P0 seed CLI profiles use isolated PostgreSQL and are additive", () => {
  beforeAll(async () => {
    await ensureTestDatabaseMigrated();
    await db.insert(schema.userTable).values(unrelatedUser);
  });

  afterAll(async () => {
    await getDatabasePool().end();
  });

  for (const profile of ["minimal", "realistic", "hostile"] as const) {
    it(`${profile} has canonical counts after one run and no duplicates after two`, async () => {
      await seed(profile);
      const expected = SEED_PROFILE_COUNTS[profile];
      const first = await profileCounts(profile);
      expect(first).toMatchObject({ ...expected, organisations: 1 });
      expect(first.workspaceId).toBe(`taskdesk-seed-${profile}-workspace`);

      await seed(profile);
      const second = await profileCounts(profile);
      expect(second).toEqual(first);

      const [preserved] = await db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.id, unrelatedUser.id));
      expect(preserved).toMatchObject(unrelatedUser);
    });
  }

  it("hostile data exercises allowed empty, Unicode, null-heavy, long-title and deep-parent cases", async () => {
    const namespace = "taskdesk-seed-hostile";
    const rows = await db
      .select({
        id: schema.workItemTable.id,
        title: schema.workItemTable.title,
        description: schema.workItemTable.description,
        parentId: schema.workItemTable.parentId,
      })
      .from(schema.workItemTable)
      .where(like(schema.workItemTable.key, `${namespace}-project-%-%`));
    const titles = new Set(rows.map((row) => row.title));

    expect(titles.has("x".repeat(HOSTILE_TITLE_LENGTH))).toBe(true);
    for (const title of HOSTILE_TITLES) expect(titles.has(title)).toBe(true);
    expect(rows.some((row) => row.description === null)).toBe(true);

    const parentById = new Map(rows.map((row) => [row.id, row.parentId]));
    let deepest = 0;
    for (const row of rows) {
      let depth = 1;
      let parentId = row.parentId;
      const seen = new Set([row.id]);
      while (parentId) {
        expect(seen.has(parentId)).toBe(false);
        seen.add(parentId);
        depth += 1;
        parentId = parentById.get(parentId) ?? null;
      }
      deepest = Math.max(deepest, depth);
    }
    expect(deepest).toBe(HOSTILE_HIERARCHY_DEPTH);
  });

  it("keeps each seeded item attached to its project's workspace and state", async () => {
    const namespace = "taskdesk-seed-realistic";
    const violations = await db.execute<{ total: string }>(sql`
      SELECT count(*)::text AS total
      FROM work_item AS wi
      JOIN project AS p ON p.id = wi.project_id
      JOIN state AS s ON s.id = wi.state_id
      JOIN work_item_type AS wit ON wit.id = wi.type_id
      WHERE wi.key LIKE ${`${namespace}-project-%-%`}
        AND (wi.workspace_id <> p.workspace_id
          OR s.project_id <> p.id
          OR wit.workspace_id <> p.workspace_id)
    `);
    expect(Number(violations.rows[0]?.total ?? 0)).toBe(0);
  });
});
