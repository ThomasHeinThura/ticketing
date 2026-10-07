import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { verifyPassword } from "better-auth/crypto";
import { and, asc, count, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase } from "../../../tests/api-integration/helpers/database";
import {
  HOSTILE_HIERARCHY_DEPTH,
  HOSTILE_TITLE_LENGTH,
  HOSTILE_TITLES,
  SEED_PROFILE_COUNTS,
  type SeedProfile,
} from "../../../tests/fixtures/seed-profiles";
import db, { schema } from "../src/database";
import { resolveIdentity } from "../src/permissions/resolve-identity";
import { DEFAULT_PROJECT_COLUMNS } from "../src/project/controllers/create-project";
import { ensureInternalOrganisation } from "../src/utils/seed-internal-organisation";
import { seedProjectStates } from "../src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../src/utils/seed-workspace-defaults";
import { seed } from "./seed-profile";
import { SUPPORTED_TEST_USER_ROLES, seedTestUsers } from "./seed-test-users";
import { generateTestUserPassword } from "./test-user-credentials";

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

describe("P0 seed CLI profiles use disposable PostgreSQL and are additive", () => {
  beforeAll(async () => {
    // This file joins the shared serial integration runner as well as the
    // standalone seed runner. Start and finish with a clean disposable _test
    // database so the fixed preservation fixture cannot collide or leak.
    await resetTestDatabase();
    await db.insert(schema.userTable).values(unrelatedUser);
  });

  afterAll(async () => {
    await resetTestDatabase();
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
    await seedWorkspaceDefaults(workspaceId);
    await db
      .update(schema.workItemTypeTable)
      .set({ name: "Unexpected task label" })
      .where(
        and(
          eq(schema.workItemTypeTable.workspaceId, workspaceId),
          eq(schema.workItemTypeTable.key, "task"),
        ),
      );
    const typesBefore = await db
      .select()
      .from(schema.workItemTypeTable)
      .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
      .orderBy(asc(schema.workItemTypeTable.id));
    const templatesBefore = await db
      .select()
      .from(schema.stateTemplateTable)
      .where(eq(schema.stateTemplateTable.workspaceId, workspaceId))
      .orderBy(asc(schema.stateTemplateTable.id));

    try {
      await expect(seed("minimal")).rejects.toThrow(
        `Fixture default conflict: ${namespace}/work-item-type/task`,
      );

      const remainingTypes = await db
        .select()
        .from(schema.workItemTypeTable)
        .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
        .orderBy(asc(schema.workItemTypeTable.id));
      const remainingTemplates = await db
        .select()
        .from(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.workspaceId, workspaceId))
        .orderBy(asc(schema.stateTemplateTable.id));
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

      expect(remainingTypes).toEqual(typesBefore);
      expect(remainingTemplates).toEqual(templatesBefore);
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
    await seedWorkspaceDefaults(workspaceId);
    const typesBefore = await db
      .select()
      .from(schema.workItemTypeTable)
      .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
      .orderBy(asc(schema.workItemTypeTable.id));
    const templatesBefore = await db
      .select()
      .from(schema.stateTemplateTable)
      .where(eq(schema.stateTemplateTable.workspaceId, workspaceId))
      .orderBy(asc(schema.stateTemplateTable.id));
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
      const typesAfter = await db
        .select()
        .from(schema.workItemTypeTable)
        .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
        .orderBy(asc(schema.workItemTypeTable.id));
      const templatesAfter = await db
        .select()
        .from(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.workspaceId, workspaceId))
        .orderBy(asc(schema.stateTemplateTable.id));
      expect(typesAfter).toEqual(typesBefore);
      expect(templatesAfter).toEqual(templatesBefore);
      await expectNoProfileRows(namespace);
    } finally {
      await db
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
    }
  });

  it.each(["work-item-type", "state-template"] as const)(
    "rejects and preserves an incomplete existing workspace %s set",
    async (missingSet) => {
      const namespace = "taskdesk-seed-minimal";
      const organisation = await ensureInternalOrganisation();
      const workspaceId = `${namespace}-workspace`;
      await db.insert(schema.workspaceTable).values({
        id: workspaceId,
        organisationId: organisation.id,
        name: "TaskDesk minimal seed",
        slug: workspaceId,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await seedWorkspaceDefaults(workspaceId);
      if (missingSet === "work-item-type") {
        await db
          .delete(schema.workItemTypeTable)
          .where(
            and(
              eq(schema.workItemTypeTable.workspaceId, workspaceId),
              eq(schema.workItemTypeTable.key, "task"),
            ),
          );
      } else {
        await db
          .delete(schema.stateTemplateTable)
          .where(
            and(
              eq(schema.stateTemplateTable.workspaceId, workspaceId),
              eq(schema.stateTemplateTable.key, "backlog"),
            ),
          );
      }
      const typesBefore = await db
        .select()
        .from(schema.workItemTypeTable)
        .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
        .orderBy(asc(schema.workItemTypeTable.id));
      const templatesBefore = await db
        .select()
        .from(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.workspaceId, workspaceId))
        .orderBy(asc(schema.stateTemplateTable.id));

      try {
        await expect(seed("minimal")).rejects.toThrow(
          `Fixture default conflict: ${namespace}/${missingSet === "work-item-type" ? "work-item-types" : "state-templates"}/set`,
        );
        const typesAfter = await db
          .select()
          .from(schema.workItemTypeTable)
          .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
          .orderBy(asc(schema.workItemTypeTable.id));
        const templatesAfter = await db
          .select()
          .from(schema.stateTemplateTable)
          .where(eq(schema.stateTemplateTable.workspaceId, workspaceId))
          .orderBy(asc(schema.stateTemplateTable.id));
        expect(typesAfter).toEqual(typesBefore);
        expect(templatesAfter).toEqual(templatesBefore);
        await expectNoProfileRows(namespace);
        const projects = await db
          .select()
          .from(schema.projectTable)
          .where(eq(schema.projectTable.workspaceId, workspaceId));
        expect(projects).toHaveLength(0);
      } finally {
        await db
          .delete(schema.workspaceTable)
          .where(eq(schema.workspaceTable.id, workspaceId));
      }
    },
  );

  it.each(["column", "state"] as const)(
    "rejects and preserves an incomplete existing project %s set",
    async (missingSet) => {
      const namespace = "taskdesk-seed-minimal";
      const organisation = await ensureInternalOrganisation();
      const workspaceId = `${namespace}-workspace`;
      const projectId = `${namespace}-project-01`;
      await db.insert(schema.workspaceTable).values({
        id: workspaceId,
        organisationId: organisation.id,
        name: "TaskDesk minimal seed",
        slug: workspaceId,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await seedWorkspaceDefaults(workspaceId);
      await db.insert(schema.projectTable).values({
        id: projectId,
        workspaceId,
        name: "TaskDesk minimal project 1",
        slug: projectId,
        icon: "Folder",
        position: 0,
        lastTaskNumber: 10,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await db.insert(schema.projectSlugClaimTable).values({
        slug: projectId,
        projectId,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await db.insert(schema.columnTable).values(
        DEFAULT_PROJECT_COLUMNS.map((column) => ({
          projectId,
          ...column,
        })),
      );
      await seedProjectStates(projectId, workspaceId);
      if (missingSet === "column") {
        await db
          .delete(schema.columnTable)
          .where(
            and(
              eq(schema.columnTable.projectId, projectId),
              eq(schema.columnTable.slug, "to-do"),
            ),
          );
      } else {
        const [firstState] = await db
          .select({ id: schema.stateTable.id })
          .from(schema.stateTable)
          .where(eq(schema.stateTable.projectId, projectId))
          .limit(1);
        if (!firstState) throw new Error("Expected seeded project state");
        await db
          .delete(schema.stateTable)
          .where(eq(schema.stateTable.id, firstState.id));
      }
      const columnsBefore = await db
        .select()
        .from(schema.columnTable)
        .where(eq(schema.columnTable.projectId, projectId))
        .orderBy(asc(schema.columnTable.id));
      const statesBefore = await db
        .select()
        .from(schema.stateTable)
        .where(eq(schema.stateTable.projectId, projectId))
        .orderBy(asc(schema.stateTable.id));
      const typesBefore = await db
        .select()
        .from(schema.workItemTypeTable)
        .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
        .orderBy(asc(schema.workItemTypeTable.id));
      const templatesBefore = await db
        .select()
        .from(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.workspaceId, workspaceId))
        .orderBy(asc(schema.stateTemplateTable.id));
      const [projectBefore] = await db
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, projectId));
      const claimsBefore = await db
        .select()
        .from(schema.projectSlugClaimTable)
        .where(eq(schema.projectSlugClaimTable.slug, projectId));

      try {
        await expect(seed("minimal")).rejects.toThrow(
          `Fixture default conflict: ${namespace}/${missingSet === "column" ? "columns" : "states"}/${projectId}`,
        );
        const columnsAfter = await db
          .select()
          .from(schema.columnTable)
          .where(eq(schema.columnTable.projectId, projectId))
          .orderBy(asc(schema.columnTable.id));
        const statesAfter = await db
          .select()
          .from(schema.stateTable)
          .where(eq(schema.stateTable.projectId, projectId))
          .orderBy(asc(schema.stateTable.id));
        const typesAfter = await db
          .select()
          .from(schema.workItemTypeTable)
          .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
          .orderBy(asc(schema.workItemTypeTable.id));
        const templatesAfter = await db
          .select()
          .from(schema.stateTemplateTable)
          .where(eq(schema.stateTemplateTable.workspaceId, workspaceId))
          .orderBy(asc(schema.stateTemplateTable.id));
        const [projectAfter] = await db
          .select()
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, projectId));
        const claimsAfter = await db
          .select()
          .from(schema.projectSlugClaimTable)
          .where(eq(schema.projectSlugClaimTable.slug, projectId));
        expect(columnsAfter).toEqual(columnsBefore);
        expect(statesAfter).toEqual(statesBefore);
        expect(typesAfter).toEqual(typesBefore);
        expect(templatesAfter).toEqual(templatesBefore);
        expect(projectAfter).toEqual(projectBefore);
        expect(claimsAfter).toEqual(claimsBefore);
        await expectNoProfileRows(namespace);
      } finally {
        await db
          .delete(schema.projectSlugClaimTable)
          .where(eq(schema.projectSlugClaimTable.slug, projectId));
        await db
          .delete(schema.workspaceTable)
          .where(eq(schema.workspaceTable.id, workspaceId));
      }
    },
  );

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
  expect(types).toHaveLength(0);
  expect(templates).toHaveLength(0);
  expect(projects.map((project) => project.id)).toEqual(
    preservedProjectId ? [preservedProjectId] : [],
  );
  await expectNoProfileRows(namespace);
}

async function expectNoProfileRows(namespace: string) {
  const people = await db
    .select()
    .from(schema.personTable)
    .where(like(schema.personTable.id, `${namespace}-person-%`));
  const items = await db
    .select()
    .from(schema.workItemTable)
    .where(like(schema.workItemTable.key, `${namespace}-project-%-%`));
  expect(people).toHaveLength(0);
  expect(items).toHaveLength(0);
}

describe("explicit test-user seed batch", () => {
  const databaseName = new URL(
    process.env.TASKDESK_DATABASE_URL ?? "",
  ).pathname.replace(/^\//, "");

  afterAll(async () => {
    await resetTestDatabase();
  });

  it("refuses an email collision without seeding unrelated accounts or workspaces", async () => {
    await resetTestDatabase();
    const expectedEmail = "taskdesk-test-user+owner@taskdesk-test.invalid";
    const preserved = {
      id: "unrelated-colliding-test-user",
      name: "Preserve this account",
      email: expectedEmail,
    };
    await db.insert(schema.userTable).values(preserved);

    const directory = await mkdtemp(
      path.join(os.tmpdir(), "taskdesk-test-users-collision-"),
    );
    await chmod(directory, 0o700);
    const credentialFile = path.join(directory, "credentials.json");
    const args = [
      "--test-database",
      databaseName,
      "--credentials-file",
      credentialFile,
    ];
    try {
      await expect(seedTestUsers(databaseName, args)).rejects.toThrow(
        /partial or collide/,
      );
      const [unchanged] = await db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.id, preserved.id))
        .limit(1);
      expect(unchanged?.name).toBe(preserved.name);
      const [workspace] = await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, "taskdesk-seed-minimal-workspace"))
        .limit(1);
      expect(workspace).toBeUndefined();
      await expect(stat(credentialFile)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("is additive and idempotent, assigns each supported role at its real scope, and authenticates by Better Auth's credential hash", async () => {
    await resetTestDatabase();
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "taskdesk-test-users-batch-"),
    );
    await chmod(directory, 0o700);
    const credentialFile = path.join(directory, "credentials.json");
    const args = [
      "--test-database",
      databaseName,
      "--credentials-file",
      credentialFile,
    ];
    try {
      const firstSummary = await seedTestUsers(databaseName, args);
      const manifest = JSON.parse(await readFile(credentialFile, "utf8")) as {
        formatVersion: number;
        targetDatabase: string;
        users: Array<{
          role: string;
          email: string;
          password: string | null;
          authentication: string;
          scope: { kind: string; scopeId: string | null };
        }>;
      };
      const credentials = manifest.users;
      expect(manifest.formatVersion).toBe(1);
      expect(manifest.targetDatabase).toBe(databaseName);
      expect(credentials.map(({ role }) => role)).toEqual(
        SUPPORTED_TEST_USER_ROLES,
      );
      expect(credentials.map(({ role, scope }) => [role, scope.kind])).toEqual([
        ["instance_admin", "instance"],
        ["owner", "workspace"],
        ["admin", "workspace"],
        ["manager", "workspace"],
        ["lead", "workspace"],
        ["member", "workspace"],
        ["viewer", "workspace"],
        ["customer", "organisation"],
      ]);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(credentialFile)).mode & 0o777).toBe(0o600);
      const credentialBytes = await readFile(credentialFile);
      const savedUsers = await db
        .select()
        .from(schema.userTable)
        .where(
          inArray(
            schema.userTable.id,
            SUPPORTED_TEST_USER_ROLES.map(
              (role) => `taskdesk-test-user-${role}`,
            ),
          ),
        );
      const savedAccounts = await db
        .select()
        .from(schema.accountTable)
        .where(
          inArray(
            schema.accountTable.userId,
            SUPPORTED_TEST_USER_ROLES.map(
              (role) => `taskdesk-test-user-${role}`,
            ),
          ),
        );
      const savedPeople = await db
        .select()
        .from(schema.personTable)
        .where(
          inArray(
            schema.personTable.userId,
            SUPPORTED_TEST_USER_ROLES.map(
              (role) => `taskdesk-test-user-${role}`,
            ),
          ),
        );
      const savedMemberships = await db
        .select()
        .from(schema.workspaceUserTable)
        .where(
          inArray(
            schema.workspaceUserTable.userId,
            SUPPORTED_TEST_USER_ROLES.map(
              (role) => `taskdesk-test-user-${role}`,
            ),
          ),
        );

      expect(savedUsers).toHaveLength(8);
      expect(savedAccounts).toHaveLength(7);
      expect(savedPeople).toHaveLength(8);
      expect(
        savedMemberships
          .map((row) => [row.userId, row.role])
          .sort(([left], [right]) => String(left).localeCompare(String(right))),
      ).toEqual([
        ["taskdesk-test-user-admin", "admin"],
        ["taskdesk-test-user-lead", "lead"],
        ["taskdesk-test-user-manager", "manager"],
        ["taskdesk-test-user-member", "member"],
        ["taskdesk-test-user-owner", "owner"],
        ["taskdesk-test-user-viewer", "viewer"],
      ]);
      for (const credential of credentials) {
        const account = savedAccounts.find(
          (row) => row.userId === `taskdesk-test-user-${credential.role}`,
        );
        if (credential.authentication === "local_password") {
          expect(account?.providerId).toBe("credential");
          expect(account?.password).toBeTruthy();
          expect(credential.password).toBeTruthy();
          expect(
            await verifyPassword({
              hash: account?.password ?? "",
              password: credential.password ?? "",
            }),
          ).toBe(true);
        } else {
          expect(credential.role).toBe("customer");
          expect(credential.password).toBeNull();
          expect(account).toBeUndefined();
        }
        const person = savedPeople.find(
          (row) => row.userId === `taskdesk-test-user-${credential.role}`,
        );
        expect(person?.side).toBe(
          credential.role === "customer" ? "customer" : "staff",
        );
        if (credential.role === "instance_admin") {
          expect(
            savedUsers.find(
              (row) => row.id === `taskdesk-test-user-${credential.role}`,
            )?.role,
          ).toBe("admin");
        }
      }
      const customer = savedPeople.find(
        (row) => row.userId === "taskdesk-test-user-customer",
      );
      expect(customer?.organisationId).toBe(
        "taskdesk-test-user-customer-organisation",
      );
      const customerOrg = await db
        .select()
        .from(schema.organisationTable)
        .where(
          eq(
            schema.organisationTable.id,
            "taskdesk-test-user-customer-organisation",
          ),
        );
      expect(customerOrg[0]?.portalAccess).toBe(true);

      for (const role of ["manager", "lead"] as const) {
        const identity = await resolveIdentity({
          userId: `taskdesk-test-user-${role}`,
          credential: "session",
        });
        const authority = identity?.authority.find(
          (entry) => entry.roleKey === role,
        );
        expect(identity?.side, role).toBe("staff");
        expect(authority).toMatchObject({
          roleKey: role,
          scope: "workspace",
          scopeId: "taskdesk-seed-minimal-workspace",
          rank: BUILT_IN_ROLES[role].rank,
          capabilities: BUILT_IN_ROLES[role].capabilities,
        });
      }

      const secondSummary = await seedTestUsers(databaseName, args);
      expect(secondSummary).toBe(firstSummary);
      expect(await readFile(credentialFile)).toEqual(credentialBytes);
      expect(
        await db
          .select()
          .from(schema.userTable)
          .where(
            inArray(
              schema.userTable.id,
              SUPPORTED_TEST_USER_ROLES.map(
                (role) => `taskdesk-test-user-${role}`,
              ),
            ),
          ),
      ).toHaveLength(8);

      const { auth, portalAuth } = await import("../src/auth");
      for (const credential of credentials) {
        if (credential.authentication !== "local_password") continue;
        const selectedAuth = credential.role === "customer" ? portalAuth : auth;
        const origin =
          credential.role === "customer"
            ? "http://localhost:5174"
            : "http://localhost:5173";
        const response = await selectedAuth.handler(
          new Request(`${origin}/api/auth/sign-in/email`, {
            method: "POST",
            headers: { "content-type": "application/json", origin },
            body: JSON.stringify({
              email: credential.email,
              password: credential.password,
            }),
          }),
        );
        expect(response.status, credential.role).toBe(200);
      }
      const customerCredential = credentials.find(
        ({ role }) => role === "customer",
      );
      expect(customerCredential?.authentication).toBe(
        "external_provider_required",
      );
      expect(customerCredential?.password).toBeNull();
      const customerPasswordAttempt = await portalAuth.handler(
        new Request("http://localhost:5174/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:5174",
          },
          body: JSON.stringify({
            email: customerCredential?.email,
            password: generateTestUserPassword(),
          }),
        }),
      );
      expect(customerPasswordAttempt.status).not.toBe(200);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
