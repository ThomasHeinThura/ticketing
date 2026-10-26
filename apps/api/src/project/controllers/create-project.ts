import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  apikeyTable,
  organisationProjectDefaultTable,
  userTable,
  workspaceTable,
} from "../../database/schema";
import { enqueueOutboxEvent, eventScope } from "../../events/outbox";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { seedProjectStates } from "../../utils/seed-project-states";
import {
  grantProjectCreatorLead,
  lockCreatorPerson,
} from "../project-creator-grant";
import {
  claimProjectSlug,
  getMaxProjectPosition,
  hasProjectSlugClaim,
  insertProject,
  insertProjectColumn,
  isServableCustomerOrganisation,
  lockProjectOrdering,
} from "../repository";

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
  serviceCalendarId?: string | null;
  organisationId: string | null;
};

async function createProject(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  configuration: ProjectConfiguration,
  creatorUserId: string,
  apiKeyId?: string,
) {
  try {
    return await createProjectRow(
      workspaceId,
      name,
      icon,
      slug,
      configuration,
      creatorUserId,
      apiKeyId,
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

/**
 * The binding rule, evaluated in the creating transaction. The organisation row is locked
 * `FOR SHARE` so a concurrent deactivation or delete cannot slip between this check and the
 * insert. A customer organisation is instance-level (no workspace-to-customer link exists in
 * `data-model.md`), so "servable from this workspace" is: the organisation is a live, active
 * customer organisation, and the workspace is one of the internal organisation's own
 * (`multi-tenancy.md`: the internal organisation's staff work across the customer ones).
 */
async function createProjectRow(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  configuration: ProjectConfiguration,
  creatorUserId: string,
  apiKeyId?: string,
) {
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .select({
        defaultServiceCalendarId: workspaceTable.defaultServiceCalendarId,
      })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, workspaceId))
      .for("share")
      .limit(1);
    if (!workspace)
      throw new HTTPException(404, { message: "Workspace not found" });
    let inheritedCalendarId: string | null = null;
    let inheritedSlaPolicyId: string | null = null;
    let hasOrganisationDefaults = false;
    if (configuration.organisationId !== null) {
      const servable = await isServableCustomerOrganisation(
        tx,
        workspaceId,
        configuration.organisationId,
      );
      if (!servable) throw new InvalidProjectOrganisationError();
      const [defaults] = await tx
        .select({
          serviceCalendarId: organisationProjectDefaultTable.serviceCalendarId,
          slaPolicyId: organisationProjectDefaultTable.slaPolicyId,
        })
        .from(organisationProjectDefaultTable)
        .where(
          and(
            eq(
              organisationProjectDefaultTable.organisationId,
              configuration.organisationId,
            ),
            eq(organisationProjectDefaultTable.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      hasOrganisationDefaults = Boolean(defaults);
      inheritedCalendarId = defaults?.serviceCalendarId ?? null;
      inheritedSlaPolicyId = defaults?.slaPolicyId ?? null;
    }
    const serviceCalendarId =
      configuration.serviceCalendarId === undefined
        ? inheritedCalendarId
        : configuration.serviceCalendarId;
    const serviceCalendarMode =
      configuration.serviceCalendarId !== undefined || hasOrganisationDefaults
        ? "override"
        : "inherit";
    const effectiveServiceCalendarId =
      serviceCalendarMode === "override"
        ? serviceCalendarId
        : workspace.defaultServiceCalendarId;
    if (
      configuration.kind === "managed_service" &&
      (!configuration.supportLevel || !effectiveServiceCalendarId)
    )
      throw new HTTPException(422, {
        message:
          "PR-9: managed services require a support level and service calendar",
      });

    // Serialize ordering writes per workspace: without this, two concurrent
    // creates can read the same max(position) and land on the same slot, and a
    // create can interleave with a reorder's renumber. `reorderProjects` takes
    // the same lock with the same key.
    await lockProjectOrdering(tx, workspaceId);

    // #261 F1's delta-confirmation (D1): a slug can be free among LIVE projects (so the
    // `project_slug_unique` constraint below would let it through) while still being
    // PERMANENTLY claimed -- by some other project, possibly in a different workspace,
    // possibly long deleted -- because a claim, once made, is never released. Checked
    // here, ahead of the insert, for a clean 409 in the common case; the claim table's own
    // PRIMARY KEY (inserted below) is the real arbiter of the race between this check and
    // the write, same idiom `project_slug_unique` already uses one layer up.
    const existingClaim = await hasProjectSlugClaim(tx, slug);
    if (existingClaim) {
      throw new ProjectSlugTakenError(slug);
    }

    // The creator's staff person (locked first: person -> grants -> audit is the repo-wide
    // lock order). Absent for a user with no provisioned staff person: `created_by` then
    // stays NULL and no grant is possible.
    const creator = await lockCreatorPerson(tx, creatorUserId);

    // New projects go to the bottom of the workspace's ordering.
    const maxPosition = await getMaxProjectPosition(tx, workspaceId);

    const createdProject = await insertProject(tx, {
      workspaceId,
      name,
      icon,
      slug,
      kind: configuration.kind,
      supportLevel: configuration.supportLevel,
      serviceCalendarId,
      slaPolicyId: inheritedSlaPolicyId,
      serviceCalendarMode,
      slaPolicyMode: hasOrganisationDefaults ? "override" : "inherit",
      organisationId: configuration.organisationId,
      createdBy: creator?.id ?? null,
      position: maxPosition === null ? 0 : maxPosition + 1,
    });

    if (createdProject) {
      // Claim the slug PERMANENTLY, in the same transaction as the project that just took
      // it -- see `projectSlugClaimTable`'s schema.ts comment for why this never happens
      // via a trigger and never gets undone by a later rename or delete.
      await claimProjectSlug(tx, {
        slug,
        projectId: createdProject.id,
      });

      for (const col of DEFAULT_PROJECT_COLUMNS) {
        await insertProjectColumn(tx, {
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

      let eventActor: {
        type: "person" | "api_key";
        id: string;
        name: string;
      };
      if (apiKeyId) {
        const [apiKey] = await tx
          .select({ id: apikeyTable.id, name: apikeyTable.name })
          .from(apikeyTable)
          .where(
            and(
              eq(apikeyTable.id, apiKeyId),
              eq(apikeyTable.referenceId, creatorUserId),
            ),
          )
          .limit(1);
        if (!apiKey) {
          throw new Error("Could not resolve project-created API-key actor");
        }
        eventActor = {
          type: "api_key",
          id: apiKey.id,
          name: apiKey.name ?? "API key",
        };
      } else {
        if (!creator) {
          throw new Error("Could not resolve project-created person actor");
        }
        const [creatorUser] = await tx
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, creatorUserId))
          .limit(1);
        if (!creatorUser) {
          throw new Error("Could not resolve project-created person actor");
        }
        eventActor = {
          type: "person",
          id: creator.id,
          name: creatorUser.name,
        };
      }
      await enqueueOutboxEvent(tx, {
        id: `evt_${createId()}`,
        kind: "project.created",
        occurredAt: new Date().toISOString(),
        actor: eventActor,
        scope: eventScope({
          workspaceId,
          organisationId: createdProject.organisationId,
          projectId: createdProject.id,
        }),
        payload: {
          key: createdProject.slug,
          url: `/agent/projects/${encodeURIComponent(createdProject.slug)}`,
          kind: createdProject.kind,
        },
        causationId: null,
        depth: 0,
        originAutomationId: null,
      });
    }

    return createdProject;
  });
}

export default createProject;
