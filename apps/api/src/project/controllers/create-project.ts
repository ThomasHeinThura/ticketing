import { and, eq, isNull, max } from "drizzle-orm";
import db from "../../database";
import {
  columnTable,
  organisationTable,
  projectSlugClaimTable,
  projectTable,
  workspaceTable,
} from "../../database/schema";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { seedProjectStates } from "../../utils/seed-project-states";
import { lockProjectCreation } from "../project-creation-lock";
import {
  grantProjectCreatorLead,
  lockCreatorPerson,
} from "../project-creator-grant";

export const DEFAULT_PROJECT_COLUMNS = [
  { name: "To Do", slug: "to-do", position: 0, isFinal: false },
  { name: "In Progress", slug: "in-progress", position: 1, isFinal: false },
  { name: "In Review", slug: "in-review", position: 2, isFinal: false },
  { name: "Done", slug: "done", position: 3, isFinal: true },
] as const;

/**
 * #23's mandatory Opus security review of PR #261, finding F1 (decision log 2026-09-22):
 * `project.slug` is now globally unique (migration 0064), because `work_item.key`
 * (`{project.slug}-{number}`) was already assuming that and carries its own global unique
 * index on top of it -- a colliding slug used to permanently 500 the victim project's
 * first work-item create. Mirrors `WorkspaceSlugTakenError`
 * (`workspace/controllers/create-workspace.ts`) exactly: the DB constraint is the
 * backstop, this is the clean error a caller actually gets.
 *
 * Also thrown when a slug is free among LIVE projects but PERMANENTLY claimed in
 * `project_slug_claim` (F1's delta-confirmation review, D1, 2026-09-22) -- see
 * `projectSlugClaimTable`'s own schema.ts comment. Same error, same 409: the caller has no
 * need to know which of the two registries rejected it.
 */
export class ProjectSlugTakenError extends Error {
  constructor(public readonly slug: string) {
    super(`Project slug "${slug}" is already taken`);
    this.name = "ProjectSlugTakenError";
  }
}

/**
 * Decision log 2026-10-13 "Recovered record: Bind customer-serving projects at creation":
 * `project.organisation_id` is chosen explicitly at creation and never rebound by a general
 * update. Thrown for EVERY way the choice can be invalid -- unknown id, internal
 * organisation, inactive, soft-deleted, or a workspace that is not an internal-organisation
 * workspace -- with one message, so the 422 never reveals which of those an id is.
 */
export class InvalidProjectOrganisationError extends Error {
  constructor() {
    super("organisation_must_be_an_active_customer_organisation");
    this.name = "InvalidProjectOrganisationError";
  }
}

type ProjectConfiguration = {
  kind: "project" | "managed_service";
  supportLevel: "L1" | "L2" | "L3" | null;
  serviceCalendarId: string | null;
  organisationId: string | null;
};

async function createProject(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  configuration: ProjectConfiguration,
  creatorUserId: string,
) {
  try {
    return await createProjectRow(
      workspaceId,
      name,
      icon,
      slug,
      configuration,
      creatorUserId,
    );
  } catch (error) {
    // Exact constraint names, not a substring match on `"slug"` (issue #269): this
    // transaction's own inserts can raise EITHER `project`'s `project_slug_unique`
    // (the live-projects check) OR `project_slug_claim`'s unnamed PRIMARY KEY on
    // `slug`, `project_slug_claim_pkey` (the permanent-claim registry below, raced
    // against a concurrent create past the pre-check) -- both confirmed live against
    // the schema.
    if (
      isUniqueViolation(error, [
        "project_slug_unique",
        "project_slug_claim_pkey",
      ])
    ) {
      throw new ProjectSlugTakenError(slug);
    }
    throw error;
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The binding rule, evaluated in the creating transaction. The organisation row is locked
 * `FOR SHARE` so a concurrent deactivation or delete cannot slip between this check and the
 * insert. A customer organisation is instance-level (no workspace-to-customer link exists in
 * `data-model.md`), so "servable from this workspace" is: the organisation is a live, active
 * customer organisation, and the workspace is one of the internal organisation's own
 * (`multi-tenancy.md`: the internal organisation's staff work across the customer ones).
 */
async function assertServableCustomerOrganisation(
  tx: Tx,
  workspaceId: string,
  organisationId: string,
) {
  const [organisation] = await tx
    .select({ id: organisationTable.id })
    .from(organisationTable)
    .where(
      and(
        eq(organisationTable.id, organisationId),
        eq(organisationTable.active, true),
        eq(organisationTable.isInternal, false),
        isNull(organisationTable.deletedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!organisation) throw new InvalidProjectOrganisationError();

  const [workspaceOwner] = await tx
    .select({ isInternal: organisationTable.isInternal })
    .from(workspaceTable)
    .innerJoin(
      organisationTable,
      eq(organisationTable.id, workspaceTable.organisationId),
    )
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  if (!workspaceOwner?.isInternal) throw new InvalidProjectOrganisationError();
}

async function createProjectRow(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  configuration: ProjectConfiguration,
  creatorUserId: string,
) {
  return db.transaction(async (tx) => {
    if (configuration.organisationId !== null) {
      await assertServableCustomerOrganisation(
        tx,
        workspaceId,
        configuration.organisationId,
      );
    }

    // Serialize ordering writes per workspace: without this, two concurrent
    // creates can read the same max(position) and land on the same slot, and a
    // create can interleave with a reorder's renumber. `reorderProjects` takes
    // the same lock with the same key.
    await lockProjectCreation(tx, workspaceId);

    // #261 F1's delta-confirmation (D1): a slug can be free among LIVE projects (so the
    // `project_slug_unique` constraint below would let it through) while still being
    // PERMANENTLY claimed -- by some other project, possibly in a different workspace,
    // possibly long deleted -- because a claim, once made, is never released. Checked
    // here, ahead of the insert, for a clean 409 in the common case; the claim table's own
    // PRIMARY KEY (inserted below) is the real arbiter of the race between this check and
    // the write, same idiom `project_slug_unique` already uses one layer up.
    const [existingClaim] = await tx
      .select({ slug: projectSlugClaimTable.slug })
      .from(projectSlugClaimTable)
      .where(eq(projectSlugClaimTable.slug, slug))
      .limit(1);
    if (existingClaim) {
      throw new ProjectSlugTakenError(slug);
    }

    // The creator's staff person (locked first: person -> grants -> audit is the repo-wide
    // lock order). Absent for a user with no provisioned staff person: `created_by` then
    // stays NULL and no grant is possible.
    const creator = await lockCreatorPerson(tx, creatorUserId);

    // New projects go to the bottom of the workspace's ordering.
    const [{ maxPosition } = { maxPosition: null }] = await tx
      .select({ maxPosition: max(projectTable.position) })
      .from(projectTable)
      .where(eq(projectTable.workspaceId, workspaceId));

    const [createdProject] = await tx
      .insert(projectTable)
      .values({
        workspaceId,
        name,
        icon,
        slug,
        kind: configuration.kind,
        supportLevel: configuration.supportLevel,
        serviceCalendarId: configuration.serviceCalendarId,
        organisationId: configuration.organisationId,
        createdBy: creator?.id ?? null,
        position: maxPosition === null ? 0 : maxPosition + 1,
      })
      .returning();

    if (createdProject) {
      // Claim the slug PERMANENTLY, in the same transaction as the project that just took
      // it -- see `projectSlugClaimTable`'s schema.ts comment for why this never happens
      // via a trigger and never gets undone by a later rename or delete.
      await tx.insert(projectSlugClaimTable).values({
        slug,
        projectId: createdProject.id,
      });

      for (const col of DEFAULT_PROJECT_COLUMNS) {
        await tx.insert(columnTable).values({
          projectId: createdProject.id,
          name: col.name,
          slug: col.slug,
          position: col.position,
          isFinal: col.isFinal,
        });
      }

      // Issue #309 (`projects-and-engagements.md` `PR-17`): seed this project's
      // concrete `state` rows from the workspace's default `state_template`s, in the
      // SAME transaction as the project itself.
      await seedProjectStates(createdProject.id, workspaceId, tx);

      // Decision log 2026-10-14: the creator holds a project-lead membership on the
      // project they just made (skipped for `sees_all` holders), audited, atomically.
      if (creator) {
        await grantProjectCreatorLead(tx, {
          workspaceId,
          projectId: createdProject.id,
          person: creator,
        });
      }
    }

    return createdProject;
  });
}

export default createProject;
