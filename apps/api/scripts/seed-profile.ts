import { asc, eq, like } from "drizzle-orm";
import {
  HOSTILE_HIERARCHY_DEPTH,
  HOSTILE_TITLE_LENGTH,
  HOSTILE_TITLES,
  SEED_PROFILE_COUNTS,
  type SeedProfile,
} from "../../../tests/fixtures/seed-profiles";
import db, { getDatabasePool, schema } from "../src/database";
import { DEFAULT_PROJECT_COLUMNS } from "../src/project/controllers/create-project";
import {
  DEFAULT_STATE_GROUP,
  DEFAULT_STATE_TEMPLATES,
} from "../src/utils/default-state-templates";
import { DEFAULT_WORK_ITEM_TYPES } from "../src/utils/default-work-item-types";
import { ensureInternalOrganisation } from "../src/utils/seed-internal-organisation";
import { seedProjectStates } from "../src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../src/utils/seed-workspace-defaults";

const FIXTURE_PREFIX = "taskdesk-seed";
const STATE_GROUP_ORDER = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

function fixtureConflict(namespace: string, kind: string, key: string): never {
  throw new Error(`Fixture default conflict: ${namespace}/${kind}/${key}`);
}

function assertUniqueIds(
  rows: readonly { id: string }[],
  namespace: string,
  kind: string,
) {
  const ids = new Set(rows.map((row) => row.id));
  if (ids.size !== rows.length || rows.some((row) => !row.id)) {
    fixtureConflict(namespace, kind, "row-ids");
  }
}

async function verifyWorkspaceDefaults(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: string,
  namespace: string,
) {
  const types = await tx
    .select()
    .from(schema.workItemTypeTable)
    .where(eq(schema.workItemTypeTable.workspaceId, workspaceId));
  assertUniqueIds(types, namespace, "work-item-types");
  if (types.length !== DEFAULT_WORK_ITEM_TYPES.length) {
    fixtureConflict(namespace, "work-item-types", "set");
  }
  for (const expected of DEFAULT_WORK_ITEM_TYPES) {
    const actual = types.find((row) => row.key === expected.key);
    if (
      !actual ||
      actual.workspaceId !== workspaceId ||
      actual.name !== expected.name ||
      actual.category !== expected.category ||
      actual.icon !== null ||
      actual.workflowId !== null ||
      actual.slaPolicyId !== null ||
      actual.isEpic !== (expected.isEpic ?? false) ||
      actual.isChange !== (expected.isChange ?? false)
    ) {
      fixtureConflict(namespace, "work-item-type", expected.key);
    }
  }

  const templates = await tx
    .select()
    .from(schema.stateTemplateTable)
    .where(eq(schema.stateTemplateTable.workspaceId, workspaceId));
  assertUniqueIds(templates, namespace, "state-templates");
  if (templates.length !== DEFAULT_STATE_TEMPLATES.length) {
    fixtureConflict(namespace, "state-templates", "set");
  }
  for (const expected of DEFAULT_STATE_TEMPLATES) {
    const actual = templates.find((row) => row.key === expected.key);
    if (
      !actual ||
      actual.workspaceId !== workspaceId ||
      actual.name !== expected.name ||
      actual.group !== expected.group ||
      actual.colour !== null ||
      actual.archivedAt !== null
    ) {
      fixtureConflict(namespace, "state-template", expected.key);
    }
  }
  return { types, templates };
}

async function verifyProjectDefaults(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: string,
  namespace: string,
  templates: Awaited<ReturnType<typeof verifyWorkspaceDefaults>>["templates"],
) {
  const columns = await tx
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, projectId));
  assertUniqueIds(columns, namespace, `columns-${projectId}`);
  if (columns.length !== DEFAULT_PROJECT_COLUMNS.length) {
    fixtureConflict(namespace, "columns", projectId);
  }
  for (const expected of DEFAULT_PROJECT_COLUMNS) {
    const actual = columns.find((row) => row.slug === expected.slug);
    if (
      !actual ||
      actual.projectId !== projectId ||
      actual.name !== expected.name ||
      actual.position !== expected.position ||
      actual.isFinal !== expected.isFinal ||
      actual.icon !== null ||
      actual.color !== null
    ) {
      fixtureConflict(namespace, "column", `${projectId}/${expected.slug}`);
    }
  }

  const states = await tx
    .select()
    .from(schema.stateTable)
    .where(eq(schema.stateTable.projectId, projectId));
  assertUniqueIds(states, namespace, `states-${projectId}`);
  if (states.length !== DEFAULT_STATE_TEMPLATES.length) {
    fixtureConflict(namespace, "states", projectId);
  }
  const templateByKey = new Map(templates.map((row) => [row.key, row]));
  const ordered = [...DEFAULT_STATE_TEMPLATES].sort((left, right) => {
    const groupDelta =
      STATE_GROUP_ORDER.indexOf(left.group) -
      STATE_GROUP_ORDER.indexOf(right.group);
    return groupDelta || left.key.localeCompare(right.key);
  });
  for (const [position, expected] of ordered.entries()) {
    const template = templateByKey.get(expected.key);
    const actual = states.find(
      (state) => state.stateTemplateId === template?.id,
    );
    if (
      !template ||
      !actual ||
      actual.projectId !== projectId ||
      actual.position !== position ||
      actual.isDefault !== (expected.group === DEFAULT_STATE_GROUP) ||
      actual.archivedAt !== null
    ) {
      fixtureConflict(namespace, "state", `${projectId}/${expected.key}`);
    }
  }
  return states.find((state) => state.isDefault)?.id;
}

function assertProfile(
  value: string | undefined,
): asserts value is SeedProfile {
  if (value !== "minimal" && value !== "realistic" && value !== "hostile") {
    throw new Error("Usage: pnpm seed <minimal|realistic|hostile>");
  }
}

async function seedProfile(profile: SeedProfile) {
  const counts = SEED_PROFILE_COUNTS[profile];
  const now = new Date("2026-01-01T00:00:00.000Z");
  const namespace = `${FIXTURE_PREFIX}-${profile}`;

  await db.transaction(async (tx) => {
    const organisation = await ensureInternalOrganisation(tx);
    const workspaceSlug = `${namespace}-workspace`;
    const [existingWorkspace] = await tx
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.slug, workspaceSlug))
      .limit(1);
    const isNewWorkspace = !existingWorkspace;
    let workspace = existingWorkspace;
    if (!workspace) {
      [workspace] = await tx
        .insert(schema.workspaceTable)
        .values({
          id: `${namespace}-workspace`,
          organisationId: organisation.id,
          name: `TaskDesk ${profile} seed`,
          slug: workspaceSlug,
          createdAt: now,
        })
        .returning();
    }
    if (
      !workspace ||
      workspace.id !== `${namespace}-workspace` ||
      workspace.organisationId !== organisation.id ||
      workspace.name !== `TaskDesk ${profile} seed`
    ) {
      throw new Error(`Fixture workspace conflict: ${workspaceSlug}`);
    }
    if (isNewWorkspace) {
      await seedWorkspaceDefaults(workspace.id, tx);
    }

    const { types, templates } = await verifyWorkspaceDefaults(
      tx,
      workspace.id,
      namespace,
    );
    const defaultType = types.find((type) => type.key === "task");
    if (!defaultType) fixtureConflict(namespace, "work-item-type", "task");

    const projectIds: string[] = [];
    const stateByProject = new Map<string, string>();
    for (let index = 0; index < counts.projects; index += 1) {
      const suffix = String(index + 1).padStart(2, "0");
      const slug = `${namespace}-project-${suffix}`;
      const [existing] = await tx
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.slug, slug))
        .limit(1);
      let project: typeof schema.projectTable.$inferSelect;
      if (existing) {
        project = existing;
        if (
          project.id !== slug ||
          project.workspaceId !== workspace.id ||
          project.name !== `TaskDesk ${profile} project ${index + 1}` ||
          project.slug !== slug ||
          project.lastTaskNumber !== Math.ceil(counts.items / counts.projects)
        ) {
          throw new Error(`Fixture project conflict: ${slug}`);
        }
      } else {
        const [created] = await tx
          .insert(schema.projectTable)
          .values({
            id: slug,
            workspaceId: workspace.id,
            name: `TaskDesk ${profile} project ${index + 1}`,
            slug,
            icon: "Folder",
            position: index,
            lastTaskNumber: Math.ceil(counts.items / counts.projects),
            createdAt: now,
          })
          .returning();
        if (!created)
          throw new Error(`Could not create fixture project: ${slug}`);
        project = created;
        await tx.insert(schema.projectSlugClaimTable).values({
          slug,
          projectId: project.id,
          createdAt: now,
        });
        await tx.insert(schema.columnTable).values(
          DEFAULT_PROJECT_COLUMNS.map((column) => ({
            projectId: project.id,
            ...column,
          })),
        );
        await seedProjectStates(project.id, workspace.id, tx);
      }

      const [claim] = await tx
        .select()
        .from(schema.projectSlugClaimTable)
        .where(eq(schema.projectSlugClaimTable.slug, slug))
        .limit(1);
      if (claim?.projectId !== project.id) {
        throw new Error(`Fixture project slug is permanently claimed: ${slug}`);
      }
      const defaultStateId = await verifyProjectDefaults(
        tx,
        project.id,
        namespace,
        templates,
      );
      if (!defaultStateId) {
        fixtureConflict(namespace, "default-state", project.id);
      }
      stateByProject.set(project.id, defaultStateId);
      projectIds.push(project.id);
    }

    const projects = await tx
      .select()
      .from(schema.projectTable)
      .where(like(schema.projectTable.slug, `${namespace}-project-%`))
      .orderBy(asc(schema.projectTable.slug));
    if (projects.length !== counts.projects) {
      throw new Error(`Unexpected fixture project count for ${namespace}`);
    }
    if (stateByProject.size !== projectIds.length) {
      throw new Error(
        `Unexpected fixture project state count for ${namespace}`,
      );
    }

    const personIds: string[] = [];
    for (let index = 0; index < counts.people; index += 1) {
      const id = `${namespace}-person-${String(index + 1).padStart(3, "0")}`;
      const [existing] = await tx
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.id, id))
        .limit(1);
      if (existing) {
        if (
          existing.organisationId !== organisation.id ||
          existing.userId !== null ||
          !existing.isPlaceholder ||
          existing.side !== "staff" ||
          !existing.active ||
          existing.jobTitle !== `Seed role ${index + 1}`
        ) {
          throw new Error(`Fixture person conflict: ${id}`);
        }
      } else {
        await tx.insert(schema.personTable).values({
          id,
          organisationId: organisation.id,
          side: "staff",
          jobTitle: `Seed role ${index + 1}`,
          isPlaceholder: true,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      personIds.push(id);
    }
    const fixturePeople = await tx
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(like(schema.personTable.id, `${namespace}-person-%`));
    if (fixturePeople.length !== counts.people) {
      throw new Error(`Fixture person count mismatch for ${namespace}`);
    }

    const existingItems = await tx
      .select({
        id: schema.workItemTable.id,
        key: schema.workItemTable.key,
        projectId: schema.workItemTable.projectId,
        workspaceId: schema.workItemTable.workspaceId,
        typeId: schema.workItemTable.typeId,
        number: schema.workItemTable.number,
        title: schema.workItemTable.title,
        stateId: schema.workItemTable.stateId,
        parentId: schema.workItemTable.parentId,
        customerVisibility: schema.workItemTable.customerVisibility,
      })
      .from(schema.workItemTable)
      .where(like(schema.workItemTable.key, `${namespace}-project-%-%`));
    if (existingItems.length > counts.items) {
      throw new Error(`Unexpected fixture item count for ${namespace}`);
    }
    const existingByKey = new Map(
      existingItems.map((item) => [item.key, item]),
    );
    const perProject = Math.ceil(counts.items / counts.projects);
    const newItems: (typeof schema.workItemTable.$inferInsert)[] = [];
    for (let number = 1; number <= counts.items; number += 1) {
      const projectIndex = Math.min(
        Math.floor((number - 1) / perProject),
        projects.length - 1,
      );
      const project = projects[projectIndex];
      if (!project) throw new Error(`Missing project at index ${projectIndex}`);
      const itemNumber = number - projectIndex * perProject;
      const key = `${project.slug}-${itemNumber}`;
      const hostile = profile === "hostile";
      const title = hostile
        ? number === 1
          ? "x".repeat(HOSTILE_TITLE_LENGTH)
          : (HOSTILE_TITLES[(number - 2) % HOSTILE_TITLES.length] ?? "Issue")
        : `${profile} seeded work item ${number}`;
      const parentNumber =
        hostile && number > 1 && number <= HOSTILE_HIERARCHY_DEPTH
          ? number - 1
          : null;
      const parentProjectNumber = parentNumber
        ? Math.floor((parentNumber - 1) / perProject) + 1
        : undefined;
      const parentItemNumber =
        parentNumber !== null && parentProjectNumber !== undefined
          ? parentNumber - (parentProjectNumber - 1) * perProject
          : undefined;
      const parentId = parentProjectNumber
        ? `${namespace}-item-${String(parentProjectNumber).padStart(2, "0")}-${String(parentItemNumber).padStart(4, "0")}`
        : null;
      const itemId = `${namespace}-item-${String(projectIndex + 1).padStart(2, "0")}-${String(itemNumber).padStart(4, "0")}`;
      const stateId = stateByProject.get(project.id);
      if (!stateId) throw new Error(`Missing default state for ${project.id}`);

      const existing = existingByKey.get(key);
      if (existing) {
        if (
          existing.id !== itemId ||
          existing.projectId !== project.id ||
          existing.workspaceId !== workspace.id ||
          existing.typeId !== defaultType.id ||
          existing.number !== itemNumber ||
          existing.title !== title ||
          existing.stateId !== stateId ||
          existing.parentId !== parentId ||
          existing.customerVisibility !== "private"
        ) {
          throw new Error(`Fixture item conflicts with expected data: ${key}`);
        }
        continue;
      }

      newItems.push({
        id: itemId,
        projectId: project.id,
        workspaceId: workspace.id,
        typeId: defaultType.id,
        number: itemNumber,
        key,
        title,
        description:
          hostile && number % 2 === 0 ? null : { type: "doc", content: [] },
        stateId,
        position: String(itemNumber),
        parentId,
        customerVisibility: "private",
        createdAt: now,
        updatedAt: now,
      });
    }

    for (let start = 0; start < newItems.length; start += 500) {
      await tx
        .insert(schema.workItemTable)
        .values(newItems.slice(start, start + 500));
    }

    const finalItems = await tx
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(like(schema.workItemTable.key, `${namespace}-project-%-%`));
    if (finalItems.length !== counts.items) {
      throw new Error(`Fixture item count mismatch for ${namespace}`);
    }

    if (profile === "hostile" && personIds.length > 0) {
      throw new Error("Hostile fixture unexpectedly created people");
    }
    // Keep the scope check explicit: fixture project rows all remain in this workspace.
    const wrongWorkspace = projects.some(
      (project) => project.workspaceId !== workspace.id,
    );
    if (wrongWorkspace) throw new Error(`Fixture scope mismatch: ${namespace}`);
  });
}

export async function seed(profile: SeedProfile) {
  await seedProfile(profile);
}

export async function runSeedCli() {
  const args = process.argv.slice(2);
  if (args.length !== 1)
    throw new Error("Usage: pnpm seed <minimal|realistic|hostile>");
  assertProfile(args[0]);
  try {
    await seed(args[0]);
    console.log(`Seeded ${args[0]} TaskDesk fixture profile.`);
  } finally {
    await getDatabasePool().end();
  }
}
