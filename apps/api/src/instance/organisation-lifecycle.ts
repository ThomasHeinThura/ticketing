import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { clientIpForContext } from "../api-key/enforce";
import { appendAuditLog } from "../audit/audit-writer";
import type { StepUpExecutor } from "../auth/repository";
import { isCurrentInstanceAdminForStepUp } from "../auth/repository";
import { ORGANISATION_RESTORE_OPERATION } from "../auth/step-up-ext";
import { runWithStepUp, stepUpTokenHeader } from "../auth/step-up-spend";
import {
  type PreparedCustomerInvitation,
  prepareCustomerInvitation,
} from "../customer-invitation/service";
import db, { schema } from "../database";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireCurrentInstanceAdmin } from "./require-instance-admin";
import { getActiveStaffPerson } from "./users/repository";

const O = schema.organisationTable;
const Q = schema.organisationQuotaTable;
const D = schema.organisationProjectDefaultTable;
const W = schema.workspaceTable;
const C = schema.serviceCalendarTable;
const S = schema.slaPolicyTable;
const R = schema.requestTypeTable;
const V = schema.requestTypeVersionTable;
const M = schema.organisationRequestTypeTable;
const P = schema.projectTable;
const Person = schema.personTable;
const Session = schema.sessionTable;
const OrganisationDeletion = schema.organisationDeletionSnapshotTable;
const OrganisationDeletionProject =
  schema.organisationDeletionProjectSnapshotTable;

const domainPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(domainPattern, "invalid_email_domain");
const emailDomainsSchema = z
  .array(domainSchema)
  .max(100)
  .superRefine((domains, context) => {
    if (new Set(domains).size !== domains.length)
      context.addIssue({ code: "custom", message: "duplicate_email_domain" });
  })
  .transform((domains) => [...domains].sort());

const maxInt = 2_147_483_647;
const quotaSchema = z
  .object({
    maxProjects: z.number().int().min(0).max(maxInt),
    maxWorkItems: z.number().int().min(0).max(maxInt),
    maxStorageBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    maxPortalUsers: z.number().int().min(0).max(maxInt),
    maxApiRequestsPerMinute: z.number().int().min(0).max(maxInt),
    maxWebhooks: z.number().int().min(0).max(maxInt),
  })
  .strict();
const projectDefaultSchema = z
  .object({
    workspaceId: z.string().min(1).max(128),
    serviceCalendarId: z.string().min(1).max(128).nullable(),
    slaPolicyId: z.string().min(1).max(128).nullable(),
  })
  .strict()
  .refine(
    (value) => value.serviceCalendarId !== null || value.slaPolicyId !== null,
    "project_default_empty",
  );
const projectDefaultsSchema = z
  .array(projectDefaultSchema)
  .max(500)
  .superRefine((defaults, context) => {
    if (
      new Set(defaults.map((item) => item.workspaceId)).size !== defaults.length
    )
      context.addIssue({
        code: "custom",
        message: "duplicate_workspace_defaults",
      });
  })
  .transform((defaults) =>
    [...defaults].sort((a, b) => a.workspaceId.localeCompare(b.workspaceId)),
  );
const initialContactSchema = z
  .object({
    email: z.string().trim().email().max(320),
    workspaceId: z.string().min(1).max(128),
  })
  .strict();
const profileFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    key: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u, "invalid_organisation_key"),
    emailDomains: emailDomainsSchema,
    portalAccess: z.boolean(),
    defaultCustomerVisibility: z.enum(["private", "organisation"]),
    quota: quotaSchema,
    projectDefaults: projectDefaultsSchema,
  })
  .strict();
const createBodySchema = profileFieldsSchema
  .extend({
    requestTypeIds: z.array(z.string().min(1).max(128)).max(500),
    initialContact: initialContactSchema.optional(),
  })
  .strict();
const patchBodySchema = profileFieldsSchema
  .extend({ expectedProfileEtag: z.string().min(1).max(128) })
  .strict();
const statusBodySchema = z
  .object({ expectedProfileEtag: z.string().min(1).max(128) })
  .strict();
const restoreBodySchema = z
  .object({
    expectedOperationId: z.string().min(1).max(128),
    expectedGeneration: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const deleteBodySchema = z.object({}).strict();
const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const errorSchema = z.object({ message: z.string() });
const quotaResponseSchema = quotaSchema;
const projectDefaultResponseSchema = projectDefaultSchema;
export const organisationProfileResponseSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    emailDomains: z.array(z.string()),
    active: z.boolean(),
    portalAccess: z.boolean(),
    defaultCustomerVisibility: z.enum(["private", "organisation"]),
    quota: quotaResponseSchema,
    projectDefaults: z.array(projectDefaultResponseSchema),
    profileEtag: z.string(),
  })
  .strict();
const profileEnvelopeSchema = z.object({
  data: organisationProfileResponseSchema,
});
const createResponseSchema = z.object({
  data: organisationProfileResponseSchema.extend({
    initialInvitation: z
      .object({
        id: z.string(),
        status: z.enum(["pending", "accepted", "revoked", "expired"]),
        expiresAt: z.string().datetime(),
      })
      .nullable(),
  }),
});
const conflictSchema = z.object({
  message: z.literal("organisation_profile_conflict"),
  profileEtag: z.string(),
});

type Quota = z.infer<typeof quotaSchema>;
type ProfileValues = z.infer<typeof profileFieldsSchema>;
type ProjectDefault = z.infer<typeof projectDefaultSchema>;
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export type OrganisationDeletionExecutor = StepUpExecutor;

export type OrganisationProfile = z.infer<
  typeof organisationProfileResponseSchema
>;

const DEFAULT_QUOTA: Quota = {
  maxProjects: 200,
  maxWorkItems: 500_000,
  maxStorageBytes: 21_474_836_480,
  maxPortalUsers: 500,
  maxApiRequestsPerMinute: 600,
  maxWebhooks: 10,
};

function sortedDomains(domains: string[] | null | undefined) {
  return [
    ...new Set((domains ?? []).map((domain) => domain.toLowerCase())),
  ].sort();
}

function canonicalDefaults(defaults: ProjectDefault[]) {
  return [...defaults]
    .map((item) => ({
      workspaceId: item.workspaceId,
      serviceCalendarId: item.serviceCalendarId,
      slaPolicyId: item.slaPolicyId,
    }))
    .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
}

export function buildOrganisationProfileEtag(input: {
  id: string;
  name: string;
  key: string;
  emailDomains: string[];
  active: boolean;
  portalAccess: boolean;
  defaultCustomerVisibility: "private" | "organisation";
  quota: Quota;
  projectDefaults: ProjectDefault[];
}) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        input.id,
        input.name,
        input.key,
        sortedDomains(input.emailDomains),
        input.active,
        input.portalAccess,
        input.defaultCustomerVisibility,
        input.quota.maxProjects,
        input.quota.maxWorkItems,
        input.quota.maxStorageBytes,
        input.quota.maxPortalUsers,
        input.quota.maxApiRequestsPerMinute,
        input.quota.maxWebhooks,
        canonicalDefaults(input.projectDefaults),
      ]),
    )
    .digest("base64url");
  return `"${digest}"`;
}

function normalizeProfile(row: {
  id: string;
  key: string;
  name: string;
  domain: string[] | null;
  active: boolean;
  portalAccess: boolean;
  defaultCustomerVisibility: string;
  quota: Quota | null;
  projectDefaults: ProjectDefault[];
}): OrganisationProfile {
  const visibility = z
    .enum(["private", "organisation"])
    .safeParse(row.defaultCustomerVisibility);
  if (!visibility.success)
    throw new HTTPException(503, {
      message: "Organisation profile unavailable",
    });
  const values = {
    id: row.id,
    key: row.key,
    name: row.name,
    emailDomains: sortedDomains(row.domain),
    active: row.active,
    portalAccess: row.portalAccess,
    defaultCustomerVisibility: visibility.data,
    quota: row.quota ?? DEFAULT_QUOTA,
    projectDefaults: canonicalDefaults(row.projectDefaults),
  };
  const parsed = organisationProfileResponseSchema
    .omit({ profileEtag: true })
    .safeParse(values);
  if (!parsed.success)
    throw new HTTPException(503, {
      message: "Organisation profile unavailable",
    });
  return {
    ...parsed.data,
    profileEtag: buildOrganisationProfileEtag(values),
  };
}

function quotaFromRow(row: {
  maxProjects: number | null;
  maxWorkItems: number | null;
  maxStorageBytes: number | null;
  maxPortalUsers: number | null;
  maxApiRequestsPerMinute: number | null;
  maxWebhooks: number | null;
}): Quota | null {
  if (row.maxProjects === null) return null;
  const parsed = quotaSchema.safeParse({
    maxProjects: row.maxProjects,
    maxWorkItems: row.maxWorkItems,
    maxStorageBytes: row.maxStorageBytes,
    maxPortalUsers: row.maxPortalUsers,
    maxApiRequestsPerMinute: row.maxApiRequestsPerMinute,
    maxWebhooks: row.maxWebhooks,
  });
  if (!parsed.success)
    throw new HTTPException(503, { message: "Organisation quota unavailable" });
  return parsed.data;
}

async function readLockedProfile(
  tx: Executor,
  id: string,
  lockDefaults = true,
) {
  const [org] = await tx
    .select({
      id: O.id,
      key: O.key,
      name: O.name,
      domain: O.domain,
      isInternal: O.isInternal,
      active: O.active,
      portalAccess: O.portalAccess,
      deletedAt: O.deletedAt,
      defaultCustomerVisibility: O.defaultCustomerVisibility,
    })
    .from(O)
    .where(and(eq(O.id, id), eq(O.isInternal, false), isNull(O.deletedAt)))
    .for("update")
    .limit(1);
  if (!org) return null;
  const [quotaRow] = await tx
    .select({
      maxProjects: Q.maxProjects,
      maxWorkItems: Q.maxWorkItems,
      maxStorageBytes: Q.maxStorageBytes,
      maxPortalUsers: Q.maxPortalUsers,
      maxApiRequestsPerMinute: Q.maxApiRequestsPerMinute,
      maxWebhooks: Q.maxWebhooks,
    })
    .from(Q)
    .where(eq(Q.organisationId, id))
    .for("update")
    .limit(1);
  const defaultsQuery = tx
    .select({
      workspaceId: D.workspaceId,
      serviceCalendarId: D.serviceCalendarId,
      slaPolicyId: D.slaPolicyId,
    })
    .from(D)
    .where(eq(D.organisationId, id))
    .orderBy(asc(D.workspaceId));
  const defaults = lockDefaults
    ? await defaultsQuery.for("update")
    : await defaultsQuery;
  return normalizeProfile({
    ...org,
    quota: quotaRow ? quotaFromRow(quotaRow) : null,
    projectDefaults: defaults,
  });
}

export async function loadOrganisationProfileForDeletion(
  tx: OrganisationDeletionExecutor,
  organisationId: string,
): Promise<{ profile: OrganisationProfile; generation: number } | null> {
  await lockOrganisationIdentityDomainBindings(tx);
  const profile = await readLockedProfile(tx, organisationId);
  if (!profile) return null;
  const [row] = await tx
    .select({ generation: O.deletionGeneration })
    .from(O)
    .where(eq(O.id, organisationId))
    .limit(1);
  if (!row) return null;
  return { profile, generation: row.generation };
}

export async function loadDeletedOrganisationForPurge(
  tx: OrganisationDeletionExecutor,
  input: {
    organisationId: string;
    expectedOperationId: string;
    expectedGeneration: number;
  },
): Promise<
  | {
      kind: "purgeable";
      deletedAt: string;
      purgeAfter: string;
      generation: number;
    }
  | { kind: "not_found" }
  | { kind: "conflict" }
> {
  await lockOrganisationIdentityDomainBindings(tx);
  const [organisation] = await tx
    .select({
      id: O.id,
      isInternal: O.isInternal,
      deletedAt: O.deletedAt,
      purgeAfter: O.purgeAfter,
      generation: O.deletionGeneration,
    })
    .from(O)
    .where(eq(O.id, input.organisationId))
    .for("update")
    .limit(1);
  if (!organisation || organisation.isInternal) return { kind: "not_found" };
  if (!organisation.deletedAt || !organisation.purgeAfter)
    return { kind: "conflict" };

  const [snapshot] = await tx
    .select({
      operationId: OrganisationDeletion.operationId,
      generation: OrganisationDeletion.generation,
      deletedAt: OrganisationDeletion.deletedAt,
      purgeAfter: OrganisationDeletion.purgeAfter,
    })
    .from(OrganisationDeletion)
    .where(eq(OrganisationDeletion.organisationId, input.organisationId))
    .for("update")
    .limit(1);
  if (!snapshot) return { kind: "conflict" };

  const [expiredMatchingSnapshot] = await tx
    .select({ id: O.id })
    .from(O)
    .innerJoin(
      OrganisationDeletion,
      and(
        eq(OrganisationDeletion.organisationId, O.id),
        eq(OrganisationDeletion.deletedAt, O.deletedAt),
        eq(OrganisationDeletion.purgeAfter, O.purgeAfter),
      ),
    )
    .where(
      and(
        eq(O.id, input.organisationId),
        eq(O.deletionGeneration, input.expectedGeneration),
        eq(OrganisationDeletion.operationId, input.expectedOperationId),
        eq(OrganisationDeletion.generation, input.expectedGeneration),
        sql`${O.purgeAfter} <= clock_timestamp()`,
      ),
    )
    .limit(1);
  if (
    !expiredMatchingSnapshot ||
    snapshot.operationId !== input.expectedOperationId ||
    snapshot.generation !== input.expectedGeneration ||
    organisation.generation !== input.expectedGeneration
  )
    return { kind: "conflict" };

  return {
    kind: "purgeable",
    deletedAt: snapshot.deletedAt.toISOString(),
    purgeAfter: snapshot.purgeAfter.toISOString(),
    generation: snapshot.generation,
  };
}

export async function softDeleteOrganisationInTransaction(
  tx: OrganisationDeletionExecutor,
  input: {
    organisationId: string;
    expectedProfileEtag: string;
    expectedGeneration: number;
    operationId: string;
    actorUserId: string;
    traceId: string;
  },
): Promise<
  | {
      kind: "deleted";
      generation: number;
      deletedAt: string;
      purgeAfter: string;
    }
  | { kind: "not_found" }
  | { kind: "conflict"; profileEtag: string; generation: number }
> {
  await lockOrganisationIdentityDomainBindings(tx);
  const current = await readLockedProfile(tx, input.organisationId);
  if (!current) return { kind: "not_found" };
  const [row] = await tx
    .select({ generation: O.deletionGeneration })
    .from(O)
    .where(eq(O.id, input.organisationId))
    .limit(1);
  if (!row) return { kind: "not_found" };
  if (
    current.profileEtag !== input.expectedProfileEtag ||
    row.generation !== input.expectedGeneration
  )
    return {
      kind: "conflict",
      profileEtag: current.profileEtag,
      generation: row.generation,
    };
  if (
    !Number.isSafeInteger(row.generation) ||
    row.generation < 0 ||
    row.generation >= Number.MAX_SAFE_INTEGER
  )
    return {
      kind: "conflict",
      profileEtag: current.profileEtag,
      generation: row.generation,
    };
  const [existingSnapshot] = await tx
    .select({ operationId: OrganisationDeletion.operationId })
    .from(OrganisationDeletion)
    .where(eq(OrganisationDeletion.organisationId, input.organisationId))
    .limit(1);
  if (existingSnapshot)
    return {
      kind: "conflict",
      profileEtag: current.profileEtag,
      generation: row.generation,
    };

  const generation = row.generation + 1;
  const deletedAt = new Date();
  const purgeAfter = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const projects = await tx
    .select({
      id: P.id,
      archiveVersion: P.archiveVersion,
      archivedAt: P.archivedAt,
    })
    .from(P)
    .where(and(eq(P.organisationId, input.organisationId), isNull(P.deletedAt)))
    .orderBy(asc(P.id))
    .for("update");
  if (
    projects.some(
      (project) => project.archiveVersion >= Number.MAX_SAFE_INTEGER,
    )
  )
    throw new HTTPException(409, {
      message: "organisation_project_archive_version_exhausted",
    });

  const [deleted] = await tx
    .update(O)
    .set({
      active: false,
      portalAccess: false,
      deletedAt,
      purgeAfter,
      deletionGeneration: generation,
      updatedAt: deletedAt,
    })
    .where(and(eq(O.id, input.organisationId), eq(O.isInternal, false)))
    .returning({ id: O.id });
  if (!deleted) return { kind: "not_found" };
  await tx.insert(OrganisationDeletion).values({
    organisationId: input.organisationId,
    operationId: input.operationId,
    generation,
    deletedAt,
    purgeAfter,
    priorActive: current.active,
    priorPortalAccess: current.portalAccess,
  });
  await tx.execute(sql`
    INSERT INTO organisation_deletion_project_snapshot (
      operation_id,
      organisation_id,
      project_id,
      prior_archived_at,
      prior_archive_version,
      expected_archive_version,
      archived_by_operation
    )
    SELECT
      ${input.operationId},
      p.organisation_id,
      p.id,
      p.archived_at,
      p.archive_version,
      p.archive_version,
      false
    FROM project p
    WHERE p.organisation_id = ${input.organisationId}
      AND p.deleted_at IS NULL
  `);
  const archivedProjects = await tx
    .update(P)
    .set({
      archivedAt: deletedAt,
      organisationDeletionOperationId: input.operationId,
    })
    .where(
      and(
        eq(P.organisationId, input.organisationId),
        isNull(P.deletedAt),
        isNull(P.archivedAt),
      ),
    )
    .returning({ id: P.id, archiveVersion: P.archiveVersion });
  for (const project of archivedProjects) {
    await tx
      .update(OrganisationDeletionProject)
      .set({
        expectedArchiveVersion: project.archiveVersion,
        archivedByOperation: true,
      })
      .where(
        and(
          eq(OrganisationDeletionProject.operationId, input.operationId),
          eq(OrganisationDeletionProject.projectId, project.id),
        ),
      );
  }
  await revokeCustomerSessions(tx, input.organisationId);
  await appendAuditLog(tx, {
    action: "organisation.deleted",
    actorId: input.actorUserId,
    actorType: "person",
    traceId: input.traceId,
    workspaceId: null,
    organisationId: input.organisationId,
    entityType: "organisation",
    entityId: input.organisationId,
    before: null,
    after: {
      changedKeys: ["active", "portalAccess", "deletedAt", "purgeAfter"],
      generation,
      affectedProjectCount: projects.length,
    },
  });
  return {
    kind: "deleted",
    generation,
    deletedAt: deletedAt.toISOString(),
    purgeAfter: purgeAfter.toISOString(),
  };
}

export async function restoreOrganisationInTransaction(
  tx: OrganisationDeletionExecutor,
  input: {
    organisationId: string;
    expectedOperationId: string;
    expectedGeneration: number;
    actorUserId: string;
    traceId: string;
    beforeRestore: (tx: OrganisationDeletionExecutor) => Promise<void>;
  },
): Promise<
  | { kind: "restored"; profile: OrganisationProfile }
  | { kind: "not_found" }
  | { kind: "conflict" }
> {
  await lockOrganisationIdentityDomainBindings(tx);
  const [org] = await tx
    .select({
      id: O.id,
      isInternal: O.isInternal,
      deletedAt: O.deletedAt,
      domain: O.domain,
    })
    .from(O)
    .where(eq(O.id, input.organisationId))
    .for("update")
    .limit(1);
  if (!org || org.isInternal) return { kind: "not_found" };
  if (!org.deletedAt) return { kind: "conflict" };
  const [snapshot] = await tx
    .select()
    .from(OrganisationDeletion)
    .where(eq(OrganisationDeletion.organisationId, input.organisationId))
    .for("update")
    .limit(1);
  if (!snapshot) return { kind: "conflict" };
  if (
    snapshot.operationId !== input.expectedOperationId ||
    snapshot.generation !== input.expectedGeneration
  )
    return { kind: "conflict" };
  const [matchingMarker] = await tx
    .select({ id: O.id })
    .from(O)
    .innerJoin(
      OrganisationDeletion,
      and(
        eq(OrganisationDeletion.organisationId, O.id),
        eq(OrganisationDeletion.deletedAt, O.deletedAt),
        eq(OrganisationDeletion.purgeAfter, O.purgeAfter),
      ),
    )
    .where(
      and(
        eq(O.id, input.organisationId),
        eq(O.deletionGeneration, input.expectedGeneration),
        eq(OrganisationDeletion.operationId, input.expectedOperationId),
        eq(OrganisationDeletion.generation, input.expectedGeneration),
        sql`${O.purgeAfter} > clock_timestamp()`,
      ),
    )
    .limit(1);
  if (!matchingMarker) return { kind: "conflict" };

  try {
    await assertDomainsAvailable(tx, org.domain ?? [], input.organisationId);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 409)
      return { kind: "conflict" };
    throw error;
  }

  const projectSnapshots = await tx
    .select()
    .from(OrganisationDeletionProject)
    .where(
      eq(OrganisationDeletionProject.operationId, input.expectedOperationId),
    )
    .orderBy(asc(OrganisationDeletionProject.projectId))
    .for("update");
  const restorableProjects = await tx
    .select({ archiveVersion: P.archiveVersion })
    .from(P)
    .innerJoin(
      OrganisationDeletionProject,
      and(
        eq(OrganisationDeletionProject.projectId, P.id),
        eq(OrganisationDeletionProject.organisationId, input.organisationId),
        eq(OrganisationDeletionProject.operationId, input.expectedOperationId),
        eq(OrganisationDeletionProject.archivedByOperation, true),
        eq(
          OrganisationDeletionProject.expectedArchiveVersion,
          P.archiveVersion,
        ),
      ),
    )
    .where(
      and(
        eq(P.organisationId, input.organisationId),
        eq(P.organisationDeletionOperationId, input.expectedOperationId),
        isNull(P.deletedAt),
      ),
    )
    .orderBy(asc(P.id))
    .for("update");
  if (
    restorableProjects.some(
      (project) => project.archiveVersion >= Number.MAX_SAFE_INTEGER,
    )
  )
    return { kind: "conflict" };

  await input.beforeRestore(tx);

  const [restoredOrganisation] = await tx
    .update(O)
    .set({
      active: snapshot.priorActive,
      portalAccess: snapshot.priorPortalAccess,
      deletedAt: null,
      purgeAfter: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(O.id, input.organisationId),
        eq(O.deletionGeneration, input.expectedGeneration),
        sql`${O.purgeAfter} > clock_timestamp()`,
      ),
    )
    .returning({ id: O.id });
  if (!restoredOrganisation)
    throw new HTTPException(409, {
      message: "organisation_restore_conflict",
    });
  let restoredProjectCount = 0;
  for (const project of projectSnapshots) {
    if (!project.archivedByOperation) continue;
    const [restoredProject] = await tx
      .update(P)
      .set({
        archivedAt: project.priorArchivedAt,
        organisationDeletionOperationId: null,
      })
      .where(
        and(
          eq(P.id, project.projectId),
          eq(P.organisationId, input.organisationId),
          isNull(P.deletedAt),
          eq(P.organisationDeletionOperationId, input.expectedOperationId),
          eq(P.archiveVersion, project.expectedArchiveVersion),
        ),
      )
      .returning({ id: P.id });
    if (restoredProject) restoredProjectCount += 1;
  }
  await tx
    .delete(OrganisationDeletionProject)
    .where(
      eq(OrganisationDeletionProject.operationId, input.expectedOperationId),
    );
  await tx
    .delete(OrganisationDeletion)
    .where(eq(OrganisationDeletion.organisationId, input.organisationId));
  const profile = await readLockedProfile(tx, input.organisationId);
  if (!profile) return { kind: "not_found" };
  await appendAuditLog(tx, {
    action: "organisation.restored",
    actorId: input.actorUserId,
    actorType: "person",
    traceId: input.traceId,
    workspaceId: null,
    organisationId: input.organisationId,
    entityType: "organisation",
    entityId: input.organisationId,
    before: null,
    after: {
      changedKeys: ["active", "portalAccess", "deletedAt", "purgeAfter"],
      generation: input.expectedGeneration,
      restoredProjectCount,
    },
  });
  return { kind: "restored", profile };
}

export async function readOrganisationProfiles(executor: Executor = db) {
  const rows = await executor
    .select({
      id: O.id,
      key: O.key,
      name: O.name,
      domain: O.domain,
      active: O.active,
      portalAccess: O.portalAccess,
      defaultCustomerVisibility: O.defaultCustomerVisibility,
      maxProjects: Q.maxProjects,
      maxWorkItems: Q.maxWorkItems,
      maxStorageBytes: Q.maxStorageBytes,
      maxPortalUsers: Q.maxPortalUsers,
      maxApiRequestsPerMinute: Q.maxApiRequestsPerMinute,
      maxWebhooks: Q.maxWebhooks,
      workspaceId: D.workspaceId,
      serviceCalendarId: D.serviceCalendarId,
      slaPolicyId: D.slaPolicyId,
    })
    .from(O)
    .leftJoin(Q, eq(Q.organisationId, O.id))
    .leftJoin(D, eq(D.organisationId, O.id))
    .where(and(eq(O.isInternal, false), isNull(O.deletedAt)))
    .orderBy(asc(O.name), asc(O.id), asc(D.workspaceId));
  const grouped = new Map<string, OrganisationProfile>();
  for (const row of rows) {
    const existing = grouped.get(row.id);
    if (existing) {
      if (row.workspaceId)
        existing.projectDefaults.push({
          workspaceId: row.workspaceId,
          serviceCalendarId: row.serviceCalendarId,
          slaPolicyId: row.slaPolicyId,
        });
      continue;
    }
    const quota = quotaFromRow(row);
    grouped.set(
      row.id,
      normalizeProfile({
        id: row.id,
        key: row.key,
        name: row.name,
        domain: row.domain,
        active: row.active,
        portalAccess: row.portalAccess,
        defaultCustomerVisibility: row.defaultCustomerVisibility,
        quota,
        projectDefaults: row.workspaceId
          ? [
              {
                workspaceId: row.workspaceId,
                serviceCalendarId: row.serviceCalendarId,
                slaPolicyId: row.slaPolicyId,
              },
            ]
          : [],
      }),
    );
  }
  return [...grouped.values()].map((profile) => {
    profile.projectDefaults = canonicalDefaults(profile.projectDefaults);
    profile.profileEtag = buildOrganisationProfileEtag(profile);
    return profile;
  });
}

export type OrganisationDirectoryEntry = OrganisationProfile & {
  deletedAt: string | null;
  purgeAfter: string | null;
  deletionGeneration: number;
  deletionOperationId: string | null;
};

export async function readOrganisationDirectory(
  executor: Executor = db,
): Promise<OrganisationDirectoryEntry[]> {
  const rows = await executor
    .select({
      id: O.id,
      key: O.key,
      name: O.name,
      domain: O.domain,
      active: O.active,
      portalAccess: O.portalAccess,
      deletedAt: O.deletedAt,
      purgeAfter: O.purgeAfter,
      deletionGeneration: O.deletionGeneration,
      deletionOperationId: OrganisationDeletion.operationId,
      defaultCustomerVisibility: O.defaultCustomerVisibility,
      maxProjects: Q.maxProjects,
      maxWorkItems: Q.maxWorkItems,
      maxStorageBytes: Q.maxStorageBytes,
      maxPortalUsers: Q.maxPortalUsers,
      maxApiRequestsPerMinute: Q.maxApiRequestsPerMinute,
      maxWebhooks: Q.maxWebhooks,
      workspaceId: D.workspaceId,
      serviceCalendarId: D.serviceCalendarId,
      slaPolicyId: D.slaPolicyId,
    })
    .from(O)
    .leftJoin(Q, eq(Q.organisationId, O.id))
    .leftJoin(D, eq(D.organisationId, O.id))
    .leftJoin(
      OrganisationDeletion,
      eq(OrganisationDeletion.organisationId, O.id),
    )
    .where(eq(O.isInternal, false))
    .orderBy(asc(O.name), asc(O.id), asc(D.workspaceId));
  const grouped = new Map<string, OrganisationDirectoryEntry>();
  for (const row of rows) {
    const existing = grouped.get(row.id);
    if (existing) {
      if (row.workspaceId)
        existing.projectDefaults.push({
          workspaceId: row.workspaceId,
          serviceCalendarId: row.serviceCalendarId,
          slaPolicyId: row.slaPolicyId,
        });
      continue;
    }
    const profile = normalizeProfile({
      id: row.id,
      key: row.key,
      name: row.name,
      domain: row.domain,
      active: row.active,
      portalAccess: row.portalAccess,
      defaultCustomerVisibility: row.defaultCustomerVisibility,
      quota: quotaFromRow(row),
      projectDefaults: row.workspaceId
        ? [
            {
              workspaceId: row.workspaceId,
              serviceCalendarId: row.serviceCalendarId,
              slaPolicyId: row.slaPolicyId,
            },
          ]
        : [],
    });
    grouped.set(row.id, {
      ...profile,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      purgeAfter: row.purgeAfter?.toISOString() ?? null,
      deletionGeneration: row.deletionGeneration,
      deletionOperationId: row.deletionOperationId,
    });
  }
  return [...grouped.values()].map((organisation) => {
    organisation.projectDefaults = canonicalDefaults(
      organisation.projectDefaults,
    );
    organisation.profileEtag = buildOrganisationProfileEtag(organisation);
    return organisation;
  });
}

export async function readOrganisationProjectDefaultOptions(
  executor: Executor = db,
) {
  const workspaces = await executor
    .select({ id: W.id, name: W.name })
    .from(W)
    .innerJoin(O, eq(O.id, W.organisationId))
    .where(
      and(
        eq(O.isInternal, true),
        eq(O.active, true),
        isNull(O.deletedAt),
        isNull(W.deletedAt),
      ),
    )
    .orderBy(asc(W.name), asc(W.id));
  if (workspaces.length === 0) return [];
  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const calendars = await executor
    .select({ id: C.id, workspaceId: C.workspaceId, name: C.name })
    .from(C)
    .where(inArray(C.workspaceId, workspaceIds))
    .orderBy(asc(C.workspaceId), asc(C.name), asc(C.id));
  const policies = await executor
    .select({
      id: S.id,
      workspaceId: S.workspaceId,
      name: S.name,
      activeVersionId: S.activeVersionId,
    })
    .from(S)
    .where(inArray(S.workspaceId, workspaceIds))
    .orderBy(asc(S.workspaceId), asc(S.name), asc(S.id));
  return workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    serviceCalendars: calendars
      .filter((calendar) => calendar.workspaceId === workspace.id)
      .map(({ id, name }) => ({ id, name })),
    slaPolicies: policies
      .filter((policy) => policy.workspaceId === workspace.id)
      .map(({ id, name, activeVersionId }) => ({
        id,
        name,
        published: activeVersionId !== null,
      })),
  }));
}

export async function lockOrganisationIdentityDomainBindings(tx: Executor) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('taskdesk:identity-domain-bindings'), 0)`,
  );
}

async function lockIdentityDomainBindings(tx: Executor) {
  return lockOrganisationIdentityDomainBindings(tx);
}

async function assertDomainsAvailable(
  tx: Executor,
  domains: string[],
  organisationId?: string,
) {
  if (!domains.length) return;
  const organisations = await tx
    .select({ id: O.id, domain: O.domain })
    .from(O)
    .where(and(eq(O.isInternal, false), isNull(O.deletedAt)));
  const requested = new Set(domains);
  if (
    organisations.some(
      (org) =>
        org.id !== organisationId &&
        (org.domain ?? []).some((domain) =>
          requested.has(domain.toLowerCase()),
        ),
    )
  )
    throw new HTTPException(409, {
      message: "organisation_email_domain_conflict",
    });
  const connections = await tx
    .select({
      organisationId: schema.identityConnectionTable.organisationId,
      domainBindings: schema.identityConnectionTable.domainBindings,
    })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.portalScope, "customer"));
  if (
    connections.some(
      (connection) =>
        connection.organisationId !== organisationId &&
        connection.domainBindings.some((domain) =>
          requested.has(domain.toLowerCase()),
        ),
    )
  )
    throw new HTTPException(409, {
      message: "organisation_email_domain_conflict",
    });
}

async function validateProjectDefaults(
  tx: Executor,
  defaults: ProjectDefault[],
  previousDefaults: ProjectDefault[] = [],
) {
  if (defaults.length === 0) return;
  const workspaceIds = defaults.map((item) => item.workspaceId);
  const workspaces = await tx
    .select({ id: W.id })
    .from(W)
    .innerJoin(O, eq(O.id, W.organisationId))
    .where(
      and(
        inArray(W.id, workspaceIds),
        eq(O.isInternal, true),
        eq(O.active, true),
        isNull(O.deletedAt),
        isNull(W.deletedAt),
      ),
    )
    .orderBy(asc(W.id))
    .for("share");
  if (workspaces.length !== workspaceIds.length)
    throw new HTTPException(422, {
      message: "invalid_project_default_workspace",
    });

  const calendarIds = defaults.flatMap((item) =>
    item.serviceCalendarId ? [item.serviceCalendarId] : [],
  );
  const calendarRows = calendarIds.length
    ? await tx
        .select({ id: C.id, workspaceId: C.workspaceId })
        .from(C)
        .where(inArray(C.id, calendarIds))
        .orderBy(asc(C.id))
        .for("share")
    : [];
  const calendarById = new Map(
    calendarRows.map((row) => [row.id, row.workspaceId]),
  );

  const policyIds = defaults.flatMap((item) =>
    item.slaPolicyId ? [item.slaPolicyId] : [],
  );
  const policyRows = policyIds.length
    ? await tx
        .select({
          id: S.id,
          workspaceId: S.workspaceId,
          activeVersionId: S.activeVersionId,
        })
        .from(S)
        .where(inArray(S.id, policyIds))
        .orderBy(asc(S.id))
        .for("share")
    : [];
  const policyById = new Map(policyRows.map((row) => [row.id, row]));
  const previousByWorkspace = new Map(
    previousDefaults.map((item) => [item.workspaceId, item]),
  );
  if (
    defaults.some((item) => {
      const calendarWorkspace = item.serviceCalendarId
        ? calendarById.get(item.serviceCalendarId)
        : item.workspaceId;
      const policy = item.slaPolicyId
        ? policyById.get(item.slaPolicyId)
        : undefined;
      return (
        (item.serviceCalendarId && calendarWorkspace !== item.workspaceId) ||
        (item.slaPolicyId &&
          (!policy ||
            policy.workspaceId !== item.workspaceId ||
            (policy.activeVersionId === null &&
              previousByWorkspace.get(item.workspaceId)?.slaPolicyId !==
                item.slaPolicyId)))
      );
    })
  )
    throw new HTTPException(422, { message: "invalid_project_default_target" });
}

async function validateRequestTypes(
  tx: Executor,
  requestTypeIds: string[],
  organisationId: string,
) {
  if (new Set(requestTypeIds).size !== requestTypeIds.length)
    throw new HTTPException(400, { message: "Duplicate request type IDs" });
  const ids = [...requestTypeIds].sort();
  if (ids.length === 0) return [];
  const types = await tx
    .select({
      id: R.id,
      key: R.key,
      name: R.name,
      description: R.description,
      icon: R.icon,
      group: R.group,
      workspaceId: R.workspaceId,
      published: R.published,
      customerVisible: R.customerVisible,
    })
    .from(R)
    .where(inArray(R.id, ids))
    .orderBy(asc(R.id))
    .for("share");
  if (
    types.length !== ids.length ||
    types.some((type) => !type.published || !type.customerVisible)
  )
    throw new HTTPException(422, {
      message: "One or more request types cannot be assigned",
    });
  const versions = await tx
    .select({
      requestTypeId: V.requestTypeId,
      number: V.number,
      autoAccept: V.autoAccept,
      defaultProjectId: V.defaultProjectId,
      workspaceId: V.workspaceId,
    })
    .from(V)
    .where(inArray(V.requestTypeId, ids))
    .orderBy(asc(V.requestTypeId), asc(V.number));
  const latest = new Map<string, (typeof versions)[number]>();
  for (const version of versions) latest.set(version.requestTypeId, version);
  if (types.some((type) => !latest.has(type.id)))
    throw new HTTPException(422, {
      message: "One or more request types cannot be assigned",
    });
  const autoAccept = types.filter((type) => latest.get(type.id)?.autoAccept);
  if (autoAccept.length) {
    const projectIds = [
      ...new Set(
        autoAccept
          .map((type) => latest.get(type.id)?.defaultProjectId)
          .filter((id): id is string => Boolean(id)),
      ),
    ].sort();
    const projects = projectIds.length
      ? await tx
          .select({
            id: P.id,
            workspaceId: P.workspaceId,
            organisationId: P.organisationId,
            archivedAt: P.archivedAt,
            deletedAt: P.deletedAt,
          })
          .from(P)
          .where(inArray(P.id, projectIds))
          .orderBy(asc(P.id))
          .for("share")
      : [];
    const byId = new Map(projects.map((project) => [project.id, project]));
    if (
      autoAccept.some((type) => {
        const version = latest.get(type.id);
        const project = version?.defaultProjectId
          ? byId.get(version.defaultProjectId)
          : undefined;
        return (
          !project ||
          project.workspaceId !== type.workspaceId ||
          project.organisationId !== organisationId ||
          project.archivedAt !== null ||
          project.deletedAt !== null
        );
      })
    )
      throw new HTTPException(422, {
        message: "One or more request types cannot be assigned",
      });
  }
  return types;
}

async function replaceProjectDefaults(
  tx: Executor,
  organisationId: string,
  defaults: ProjectDefault[],
) {
  await tx.delete(D).where(eq(D.organisationId, organisationId));
  if (defaults.length)
    await tx.insert(D).values(
      canonicalDefaults(defaults).map((item) => ({
        organisationId,
        ...item,
      })),
    );
}

async function replaceQuota(
  tx: Executor,
  organisationId: string,
  quota: Quota,
  updatedBy: string,
) {
  await tx
    .insert(Q)
    .values({ organisationId, ...quota, updatedBy })
    .onConflictDoUpdate({
      target: Q.organisationId,
      set: { ...quota, updatedBy, updatedAt: new Date() },
    });
}

async function revokeCustomerSessions(tx: Executor, organisationId: string) {
  const users = await tx
    .select({ userId: Person.userId })
    .from(Person)
    .where(
      and(
        eq(Person.organisationId, organisationId),
        eq(Person.side, "customer"),
        isNotNull(Person.userId),
      ),
    );
  const userIds = [
    ...new Set(users.flatMap((row) => (row.userId ? [row.userId] : []))),
  ];
  if (userIds.length)
    await tx.delete(Session).where(inArray(Session.userId, userIds));
}

function changedProfileKeys(before: OrganisationProfile, after: ProfileValues) {
  const changed: string[] = [];
  if (before.name !== after.name) changed.push("name");
  if (before.key !== after.key) changed.push("key");
  if (
    JSON.stringify(before.emailDomains) !== JSON.stringify(after.emailDomains)
  )
    changed.push("emailDomains");
  if (before.portalAccess !== after.portalAccess) changed.push("portalAccess");
  if (before.defaultCustomerVisibility !== after.defaultCustomerVisibility)
    changed.push("defaultCustomerVisibility");
  if (JSON.stringify(before.quota) !== JSON.stringify(after.quota))
    changed.push("quota");
  if (
    JSON.stringify(canonicalDefaults(before.projectDefaults)) !==
    JSON.stringify(canonicalDefaults(after.projectDefaults))
  )
    changed.push("projectDefaults");
  return changed;
}

function isOrganisationKeyConflict(error: unknown) {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === "23505" &&
      candidate.constraint === "organisation_key_unique"
    )
      return true;
    current = candidate.cause;
  }
  return false;
}

const createRouteDefinition = createRoute({
  method: "post",
  path: "/organisations",
  operationId: "createCustomerOrganisation",
  tags: ["Organisations"],
  summary: "Create a customer organisation",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createBodySchema } },
    },
  },
  responses: {
    201: jsonResponse("Created customer organisation", createResponseSchema),
    400: jsonResponse("Invalid request", errorSchema),
    403: jsonResponse("Forbidden", errorSchema),
    409: jsonResponse(
      "Organisation key or email domain already exists",
      errorSchema,
    ),
    422: jsonResponse("Invalid catalogue or project defaults", errorSchema),
  },
});

const patchRouteDefinition = createRoute({
  method: "patch",
  path: "/organisations/{id}",
  operationId: "updateCustomerOrganisation",
  tags: ["Organisations"],
  summary: "Update a customer organisation profile",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: paramsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: patchBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated customer organisation", profileEnvelopeSchema),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Organisation not found", errorSchema),
    409: jsonResponse("Organisation profile changed", conflictSchema),
    422: jsonResponse("Invalid project defaults", errorSchema),
  },
});

function createStatusRouteDefinition(action: "suspend" | "unsuspend") {
  return createRoute({
    method: "post",
    path: `/organisations/{id}/${action}`,
    operationId: `${action}CustomerOrganisation`,
    tags: ["Organisations"],
    summary: `${action === "suspend" ? "Suspend" : "Unsuspend"} a customer organisation`,
    middleware: [requireSessionOnly()] as const,
    request: {
      params: paramsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: statusBodySchema } },
      },
    },
    responses: {
      200: jsonResponse(
        "Updated customer organisation status",
        profileEnvelopeSchema,
      ),
      403: jsonResponse("Forbidden", errorSchema),
      404: jsonResponse("Organisation not found", errorSchema),
      409: jsonResponse("Organisation profile changed", conflictSchema),
    },
  });
}

const suspendRouteDefinition = createStatusRouteDefinition("suspend");
const unsuspendRouteDefinition = createStatusRouteDefinition("unsuspend");

const restoreRouteDefinition = createRoute({
  method: "post",
  path: "/organisations/{id}/restore",
  operationId: "restoreCustomerOrganisation",
  tags: ["Organisations"],
  summary: "Restore a customer organisation",
  description:
    "Restores a soft-deleted customer organisation within its recovery window. Requires a fresh operation-bound step-up proof.",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: paramsSchema,
    headers: stepUpTokenHeader,
    body: {
      required: true,
      content: { "application/json": { schema: restoreBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Restored customer organisation", profileEnvelopeSchema),
    401: jsonResponse("Unauthorized", errorSchema),
    403: jsonResponse("Forbidden or step-up required", errorSchema),
    404: jsonResponse("Organisation not found", errorSchema),
    409: jsonResponse("Organisation deletion state changed", errorSchema),
  },
});

const deleteRouteDefinition = createRoute({
  method: "delete",
  path: "/organisations/{id}",
  operationId: "requestCustomerOrganisationDeletion",
  tags: ["Organisations"],
  summary: "Request customer organisation deletion",
  description:
    "Creates a pending action. The organisation is not changed until the requester approves the typed-name and step-up confirmation.",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: paramsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: deleteBodySchema } },
    },
  },
  responses: {
    202: jsonResponse(
      "Organisation deletion pending action",
      z.object({
        pendingActionId: z.string(),
        action: z.literal("delete"),
        confirmation: z.literal("typed_name_step_up"),
        summary: z.record(z.string(), z.unknown()),
        expiresAt: z.string().datetime(),
        approveUrl: z.string(),
      }),
    ),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Organisation not found", errorSchema),
    409: jsonResponse("Deletion already pending", errorSchema),
  },
});

const routes = apiRouter()
  .openapi(createRouteDefinition, async (c) => {
    await requireCurrentInstanceAdmin(c, "POST", "/api/instance/organisations");
    c.header("Cache-Control", "no-store");
    const body = c.req.valid("json");
    const actorUserId = c.get("userId");
    const [actor] = await getActiveStaffPerson(actorUserId);
    if (!actor) throw new HTTPException(403, { message: "Forbidden" });
    const identity = body.initialContact
      ? await resolveIdentity({ userId: actorUserId, credential: "session" })
      : null;
    if (body.initialContact && !identity)
      throw new HTTPException(403, { message: "Forbidden" });
    const id = createId();
    const invitationRef: { value: PreparedCustomerInvitation | null } = {
      value: null,
    };
    let result: {
      profile: OrganisationProfile;
      preparedInvitation: PreparedCustomerInvitation | null;
    };
    try {
      result = await db.transaction(async (tx) => {
        await lockIdentityDomainBindings(tx);
        await assertDomainsAvailable(tx, body.emailDomains);
        const selectedTypes = await validateRequestTypes(
          tx,
          body.requestTypeIds,
          id,
        );
        if (
          body.initialContact &&
          !selectedTypes.some(
            (type) => type.workspaceId === body.initialContact?.workspaceId,
          )
        )
          throw new HTTPException(422, {
            message:
              "Initial contact workspace must serve an assigned request type",
          });
        await validateProjectDefaults(tx, body.projectDefaults);
        const [created] = await tx
          .insert(O)
          .values({
            id,
            key: body.key,
            name: body.name,
            domain: body.emailDomains,
            active: true,
            portalAccess: body.portalAccess,
            defaultCustomerVisibility: body.defaultCustomerVisibility,
          })
          .returning({ id: O.id });
        if (!created)
          throw new HTTPException(503, { message: "Organisation unavailable" });
        await replaceQuota(tx, id, body.quota, actor.id);
        await replaceProjectDefaults(tx, id, body.projectDefaults);
        if (body.requestTypeIds.length)
          await tx.insert(M).values(
            [...body.requestTypeIds].sort().map((requestTypeId) => ({
              organisationId: id,
              requestTypeId,
            })),
          );
        if (body.initialContact && identity) {
          invitationRef.value = await prepareCustomerInvitation(tx, {
            actor: {
              userId: actorUserId,
              actorType: "person",
              apiKeyId: null,
            },
            identity,
            scope: {
              workspaceId: body.initialContact.workspaceId,
              organisationId: id,
            },
            email: body.initialContact.email,
          });
        }
        const [saved] = await tx
          .select({
            id: O.id,
            key: O.key,
            name: O.name,
            domain: O.domain,
            active: O.active,
            portalAccess: O.portalAccess,
            defaultCustomerVisibility: O.defaultCustomerVisibility,
            maxProjects: Q.maxProjects,
            maxWorkItems: Q.maxWorkItems,
            maxStorageBytes: Q.maxStorageBytes,
            maxPortalUsers: Q.maxPortalUsers,
            maxApiRequestsPerMinute: Q.maxApiRequestsPerMinute,
            maxWebhooks: Q.maxWebhooks,
          })
          .from(O)
          .innerJoin(Q, eq(Q.organisationId, O.id))
          .where(eq(O.id, id))
          .limit(1);
        if (!saved)
          throw new HTTPException(503, { message: "Organisation unavailable" });
        const profile = normalizeProfile({
          ...saved,
          quota: quotaFromRow(saved),
          projectDefaults: body.projectDefaults,
        });
        await appendAuditLog(tx, {
          action: "organisation.created",
          actorId: actorUserId,
          actorType: "person",
          traceId: normaliseTraceId(c.req.header("x-request-id")),
          workspaceId: null,
          organisationId: id,
          entityType: "organisation",
          entityId: id,
          before: null,
          after: {
            changedKeys: [
              "name",
              "key",
              "emailDomains",
              "portalAccess",
              "defaultCustomerVisibility",
              "quota",
              "projectDefaults",
              "requestCatalogue",
            ],
          },
        });
        return { profile, preparedInvitation: invitationRef.value };
      });
    } catch (error) {
      invitationRef.value?.rollback();
      if (isOrganisationKeyConflict(error))
        throw new HTTPException(409, { message: "organisation_key_conflict" });
      throw error;
    }
    const preparedInvitation = result.preparedInvitation;
    preparedInvitation?.activate();
    setShadowLegacyAuthorization(c, "allowed");
    const initialInvitation = preparedInvitation
      ? {
          id: preparedInvitation.view.id,
          status: preparedInvitation.view.status,
          expiresAt: preparedInvitation.view.expiresAt,
        }
      : null;
    return c.json({ data: { ...result.profile, initialInvitation } }, 201);
  })
  .openapi(deleteRouteDefinition, async (c) => {
    const { id } = c.req.valid("param");
    c.req.valid("json");
    const actorUserId = c.get("userId");
    const session = c.get("session") as
      | { id?: string; portal?: string; impersonatedBy?: string | null }
      | null
      | undefined;
    if (!session?.id || session.portal !== "agent" || session.impersonatedBy)
      throw new HTTPException(403, { message: "Forbidden" });
    await requireCurrentInstanceAdmin(
      c,
      "DELETE",
      "/api/instance/organisations/{id}",
    );
    const [actor] = await getActiveStaffPerson(actorUserId);
    if (!actor) throw new HTTPException(403, { message: "Forbidden" });
    const { createPendingAction } = await import("../pending-action/service");
    const requested = await createPendingAction({
      requesterPersonId: actor.id,
      credentialType: "session",
      credentialId: session.id,
      origin: "web",
      action: "delete",
      routeKey: "DELETE /api/instance/organisations/{id}",
      targetType: "organisation",
      targetIds: [id],
      workspaceId: null,
      projectId: null,
      organisationId: id,
      actorId: actorUserId,
      actorType: "person",
      actorIp: clientIpForContext(c),
      userAgent: c.req.header("user-agent") ?? null,
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        ...requested,
        action: "delete" as const,
        confirmation: "typed_name_step_up" as const,
      },
      202,
    );
  })
  .openapi(patchRouteDefinition, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "PATCH",
      "/api/instance/organisations/{id}",
    );
    c.header("Cache-Control", "no-store");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const actorUserId = c.get("userId");
    const [actor] = await getActiveStaffPerson(actorUserId);
    if (!actor) throw new HTTPException(403, { message: "Forbidden" });
    let result: Awaited<ReturnType<typeof patchOrganisationProfile>>;
    try {
      result = await patchOrganisationProfile({
        id,
        body,
        actorId: actor.id,
        actorUserId,
        traceId: normaliseTraceId(c.req.header("x-request-id")),
      });
    } catch (error) {
      if (isOrganisationKeyConflict(error))
        throw new HTTPException(409, { message: "organisation_key_conflict" });
      throw error;
    }
    if (result.kind === "not_found")
      throw new HTTPException(404, { message: "Organisation not found" });
    if (result.kind === "conflict")
      return c.json(
        {
          message: "organisation_profile_conflict" as const,
          profileEtag: result.profileEtag,
        },
        409,
      );
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ data: result.profile }, 200);
  })
  .openapi(suspendRouteDefinition, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "POST",
      "/api/instance/organisations/{id}/suspend",
    );
    c.header("Cache-Control", "no-store");
    const { id } = c.req.valid("param");
    const { expectedProfileEtag } = c.req.valid("json");
    const actorUserId = c.get("userId");
    const [actor] = await getActiveStaffPerson(actorUserId);
    if (!actor) throw new HTTPException(403, { message: "Forbidden" });
    const result = await updateOrganisationStatus({
      id,
      expectedProfileEtag,
      actorUserId,
      action: "suspend",
      traceId: normaliseTraceId(c.req.header("x-request-id")),
    });
    if (result.kind === "not_found")
      throw new HTTPException(404, { message: "Organisation not found" });
    if (result.kind === "conflict")
      return c.json(
        {
          message: "organisation_profile_conflict" as const,
          profileEtag: result.profileEtag,
        },
        409,
      );
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ data: result.profile }, 200);
  })
  .openapi(unsuspendRouteDefinition, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "POST",
      "/api/instance/organisations/{id}/unsuspend",
    );
    c.header("Cache-Control", "no-store");
    const { id } = c.req.valid("param");
    const { expectedProfileEtag } = c.req.valid("json");
    const actorUserId = c.get("userId");
    const [actor] = await getActiveStaffPerson(actorUserId);
    if (!actor) throw new HTTPException(403, { message: "Forbidden" });
    const result = await updateOrganisationStatus({
      id,
      expectedProfileEtag,
      actorUserId,
      action: "unsuspend",
      traceId: normaliseTraceId(c.req.header("x-request-id")),
    });
    if (result.kind === "not_found")
      throw new HTTPException(404, { message: "Organisation not found" });
    if (result.kind === "conflict")
      return c.json(
        {
          message: "organisation_profile_conflict" as const,
          profileEtag: result.profileEtag,
        },
        409,
      );
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ data: result.profile }, 200);
  })
  .openapi(restoreRouteDefinition, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "POST",
      "/api/instance/organisations/{id}/restore",
    );
    c.header("Cache-Control", "no-store");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const actorUserId = c.get("userId");
    const result = await runWithStepUp(
      c,
      {
        operation: ORGANISATION_RESTORE_OPERATION,
        organisationId: id,
        expectedOperationId: body.expectedOperationId,
        expectedGeneration: body.expectedGeneration,
      },
      (spend) =>
        db.transaction(async (tx) =>
          restoreOrganisationInTransaction(tx, {
            organisationId: id,
            expectedOperationId: body.expectedOperationId,
            expectedGeneration: body.expectedGeneration,
            actorUserId,
            traceId: normaliseTraceId(c.req.header("x-request-id")),
            beforeRestore: async (lockedTx) => {
              if (
                !(await isCurrentInstanceAdminForStepUp(actorUserId, lockedTx))
              )
                throw new HTTPException(403, { message: "Forbidden" });
              await spend(lockedTx);
            },
          }),
        ),
    );
    if (result.kind === "not_found")
      throw new HTTPException(404, { message: "Organisation not found" });
    if (result.kind === "conflict")
      throw new HTTPException(409, {
        message: "organisation_restore_conflict",
      });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ data: result.profile }, 200);
  });

async function patchOrganisationProfile(input: {
  id: string;
  body: ProfileValues & { expectedProfileEtag: string };
  actorId: string;
  actorUserId: string;
  traceId: string;
}) {
  const { id, body, actorId, actorUserId, traceId } = input;
  return db.transaction(async (tx) => {
    // Match the IDP configuration writer's global domain lock order before the
    // organisation row lock, including profile edits that leave domains unchanged.
    await lockIdentityDomainBindings(tx);
    const current = await readLockedProfile(tx, id, false);
    if (!current) return { kind: "not_found" as const };
    if (current.profileEtag !== body.expectedProfileEtag)
      return { kind: "conflict" as const, profileEtag: current.profileEtag };
    const values: ProfileValues = {
      name: body.name,
      key: body.key,
      emailDomains: body.emailDomains,
      portalAccess: body.portalAccess,
      defaultCustomerVisibility: body.defaultCustomerVisibility,
      quota: body.quota,
      projectDefaults: body.projectDefaults,
    };
    const changedKeys = changedProfileKeys(current, values);
    if (changedKeys.length === 0)
      return { kind: "updated" as const, profile: current };
    if (changedKeys.includes("emailDomains"))
      await assertDomainsAvailable(tx, values.emailDomains, id);
    if (changedKeys.includes("projectDefaults"))
      await validateProjectDefaults(
        tx,
        values.projectDefaults,
        current.projectDefaults,
      );
    const lockedCurrent = await readLockedProfile(
      tx,
      id,
      changedKeys.includes("projectDefaults"),
    );
    if (!lockedCurrent) return { kind: "not_found" as const };
    if (lockedCurrent.profileEtag !== body.expectedProfileEtag)
      return {
        kind: "conflict" as const,
        profileEtag: lockedCurrent.profileEtag,
      };
    const lockedChangedKeys = changedProfileKeys(lockedCurrent, values);
    if (lockedChangedKeys.length === 0)
      return { kind: "updated" as const, profile: lockedCurrent };
    const previousPortalAccess = lockedCurrent.portalAccess;
    await tx
      .update(O)
      .set({
        name: values.name,
        key: values.key,
        domain: values.emailDomains,
        portalAccess: values.portalAccess,
        defaultCustomerVisibility: values.defaultCustomerVisibility,
        updatedAt: new Date(),
      })
      .where(and(eq(O.id, id), eq(O.isInternal, false), isNull(O.deletedAt)));
    if (lockedChangedKeys.includes("quota"))
      await replaceQuota(tx, id, values.quota, actorId);
    if (lockedChangedKeys.includes("projectDefaults"))
      await replaceProjectDefaults(tx, id, values.projectDefaults);
    if (previousPortalAccess && !values.portalAccess)
      await revokeCustomerSessions(tx, id);
    const saved = await readLockedProfile(tx, id, false);
    if (!saved) return { kind: "not_found" as const };
    await appendAuditLog(tx, {
      action: "organisation.updated",
      actorId: actorUserId,
      actorType: "person",
      traceId,
      workspaceId: null,
      organisationId: id,
      entityType: "organisation",
      entityId: id,
      before: null,
      after: { changedKeys: lockedChangedKeys },
    });
    return { kind: "updated" as const, profile: saved };
  });
}

async function updateOrganisationStatus(input: {
  id: string;
  expectedProfileEtag: string;
  actorUserId: string;
  action: "suspend" | "unsuspend";
  traceId: string;
}) {
  const { id, expectedProfileEtag, actorUserId, action, traceId } = input;
  return db.transaction(async (tx) => {
    await lockIdentityDomainBindings(tx);
    const current = await readLockedProfile(tx, id, false);
    if (!current) return { kind: "not_found" as const };
    if (current.profileEtag !== expectedProfileEtag)
      return { kind: "conflict" as const, profileEtag: current.profileEtag };
    const active = action === "unsuspend";
    if (current.active === active)
      return { kind: "updated" as const, profile: current };
    const [updated] = await tx
      .update(O)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(O.id, id), eq(O.isInternal, false), isNull(O.deletedAt)))
      .returning({ id: O.id });
    if (!updated) return { kind: "not_found" as const };
    if (!active || !current.portalAccess) await revokeCustomerSessions(tx, id);
    const profile = await readLockedProfile(tx, id, false);
    if (!profile) return { kind: "not_found" as const };
    await appendAuditLog(tx, {
      action: active ? "organisation.unsuspended" : "organisation.suspended",
      actorId: actorUserId,
      actorType: "person",
      traceId,
      workspaceId: null,
      organisationId: id,
      entityType: "organisation",
      entityId: id,
      before: null,
      after: { changedKeys: ["active"] },
    });
    return { kind: "updated" as const, profile };
  });
}

export default routes;
