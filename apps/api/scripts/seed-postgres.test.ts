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
import { ensureInternalOrganisation } from "../src/utils/seed-internal-organisation";
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

  it("rejects conflicting workspace defaults and rolls back inserted defaults", async () => {
    const namespace = "taskdesk-seed-minimal";
    const organisation = await ensureInternalOrganisation();
    const workspaceId = `${namespace}-workspace`;
    await db.insert(schema.workspaceTable).values({
      id: workspaceId,
      organisationId: organisation.id,
      name: "TaskDesk minimal seed",
      slug: `${namespace}-workspace`,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await db.insert(schema.workItemTypeTable).values({
      id: `${namespace}-conflicting-task-type`,
      workspaceId,
      key: "task",
      name: "Unexpected task label",
      category: "delivery",
      isEpic: false,
      isChange: false,
    });

    try {
      await expect(seed("minimal")).rejects.toThrow(
        `Fixture default conflict: ${namespace}/work-item-type/task`,
      );

      const remainingTypes = await db
        .select()
        .from(schema.workItemTypeTable)
        .where(eq(schema.workItemTypeTable.workspaceId, workspaceId));
      const remainingTemplates = await db
        .select()
        .from(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.workspaceId, workspaceId));
      const remainingProjects = await db
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.workspaceId, workspaceId));
      const remainingPeople = await db
        .select()
        .from(schema.personTable)
        .where(like(schema.personTable.id, `${namespace}-person-%`));
      const remainingItems = await db
        .select()
        .from(schema.workItemTable)
        .where(like(schema.workItemTable.key, `${namespace}-project-%-%`));

      expect(remainingTypes).toHaveLength(1);
      expect(remainingTypes[0]).toMatchObject({
        id: `${namespace}-conflicting-task-type`,
        key: "task",
        name: "Unexpected task label",
      });
      expect(remainingTemplates).toHaveLength(0);
      expect(remainingProjects).toHaveLength(0);
      expect(remainingPeople).toHaveLength(0);
      expect(remainingItems).toHaveLength(0);
    } finally {
      // This test's deliberately created conflict exists only in the disposable
      // Testcontainers database; remove that test-owned workspace for later tests.
      await db
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
    }
  });

  it("rejects a matching workspace slug owned by a non-fixture ID before writes", async () => {
    const namespace = "taskdesk-seed-minimal";
    const organisation = await ensureInternalOrganisation();
    const workspaceId = "user-created-matching-seed-workspace";
    const workspaceValues = {
      id: workspaceId,
      organisationId: organisation.id,
      name: "TaskDesk minimal seed",
      slug: `${namespace}-workspace`,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    await db.insert(schema.workspaceTable).values(workspaceValues);

    try {
      await expect(seed("minimal")).rejects.toThrow(
        `Fixture workspace conflict: ${workspaceValues.slug}`,
      );

      const [workspace] = await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
      expect(workspace).toMatchObject(workspaceValues);
      await expectNoSeedRowsInWorkspace(workspaceId, namespace);
    } finally {
      await db
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
    }
  });

  it("rejects a matching project slug owned by a non-fixture ID and rolls back defaults", async () => {
    const namespace = "taskdesk-seed-minimal";
    const organisation = await ensureInternalOrganisation();
    const workspaceId = `${namespace}-workspace`;
    const projectSlug = `${namespace}-project-01`;
    const workspaceValues = {
      id: workspaceId,
      organisationId: organisation.id,
      name: "TaskDesk minimal seed",
      slug: `${namespace}-workspace`,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const projectValues = {
      id: "user-created-matching-seed-project",
      workspaceId,
      name: "TaskDesk minimal project 1",
      slug: projectSlug,
      icon: "Folder",
      position: 0,
      lastTaskNumber: 10,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    await db.insert(schema.workspaceTable).values(workspaceValues);
    await db.insert(schema.projectTable).values(projectValues);

    try {
      await expect(seed("minimal")).rejects.toThrow(
        `Fixture project conflict: ${projectSlug}`,
      );

      const [workspace] = await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
      const [project] = await db
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, projectValues.id));
      expect(workspace).toMatchObject(workspaceValues);
      expect(project).toMatchObject(projectValues);
      await expectNoSeedRowsInWorkspace(
        workspaceId,
        namespace,
        projectValues.id,
      );
    } finally {
      await db
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
    }
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

async function expectNoSeedRowsInWorkspace(
  workspaceId: string,
  namespace: string,
  preservedProjectId?: string,
) {
  const types = await db
    .select()
    .from(schema.workItemTypeTable)
    .where(eq(schema.workItemTypeTable.workspaceId, workspaceId));
  const templates = await db
    .select()
    .from(schema.stateTemplateTable)
    .where(eq(schema.stateTemplateTable.workspaceId, workspaceId));
  const projects = await db
    .select()
    .from(schema.projectTable)
    .where(eq(schema.projectTable.workspaceId, workspaceId));
  const people = await db
    .select()
    .from(schema.personTable)
    .where(like(schema.personTable.id, `${namespace}-person-%`));
  const items = await db
    .select()
    .from(schema.workItemTable)
    .where(like(schema.workItemTable.key, `${namespace}-project-%-%`));
  expect(types).toHaveLength(0);
  expect(templates).toHaveLength(0);
  expect(projects.map((project) => project.id)).toEqual(
    preservedProjectId ? [preservedProjectId] : [],
  );
  expect(people).toHaveLength(0);
  expect(items).toHaveLength(0);
}
