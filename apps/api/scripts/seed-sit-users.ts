import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createId } from "@paralleldrive/cuid2";
import { BUILT_IN_ROLES, type BuiltInRoleKey } from "@taskdesk/permissions";
import bcrypt from "bcryptjs";
import { config } from "dotenv-mono";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import db, { getDatabasePool, schema } from "../src/database";
import {
  createRequestType,
  createSubmission,
  publishRequestType,
} from "../src/intake/repository";
import { lockWorkspaceLabelNames } from "../src/label/repository";
import { DEFAULT_PROJECT_COLUMNS } from "../src/project/controllers/create-project";
import { seedDefaultWorkspaceRoles } from "../src/utils/seed-default-workspace-roles";
import { ensureInternalOrganisation } from "../src/utils/seed-internal-organisation";
import { seedProjectStates } from "../src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../src/utils/seed-workspace-defaults";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type SitAccount = {
  id: string;
  personId: string;
  email: string;
  password: string;
  name: string;
  userRole: "admin" | "user";
  side: "staff" | "customer";
  workspaceRole: "owner" | "admin" | "member" | null;
  scopedRoleKey: BuiltInRoleKey;
};

const SIT_ACCOUNTS: readonly SitAccount[] = [
  {
    id: "sit-user-admin",
    personId: "sit-person-admin",
    email: "admin@taskdesk.local",
    password: randomBytes(24).toString("base64url"),
    name: "Ada Lovelace (Instance & Workspace Admin)",
    userRole: "admin",
    side: "staff",
    workspaceRole: "owner",
    scopedRoleKey: "owner",
  },
  {
    id: "sit-user-agent",
    personId: "sit-person-agent",
    email: "agent@taskdesk.local",
    password: randomBytes(24).toString("base64url"),
    name: "Grace Hopper (Service Desk Agent)",
    userRole: "user",
    side: "staff",
    workspaceRole: "member",
    scopedRoleKey: "member",
  },
  {
    id: "sit-user-lead",
    personId: "sit-person-lead",
    email: "lead@taskdesk.local",
    password: randomBytes(24).toString("base64url"),
    name: "Alan Turing (Project Lead & Approver)",
    userRole: "user",
    side: "staff",
    workspaceRole: "admin",
    scopedRoleKey: "lead",
  },
  {
    id: "sit-user-customer",
    personId: "sit-person-customer",
    email: "customer@acme.example",
    password: randomBytes(24).toString("base64url"),
    name: "Katherine Johnson (Acme Customer Requester)",
    userRole: "user",
    side: "customer",
    workspaceRole: null,
    scopedRoleKey: "customer",
  },
];

async function upsertUserAndPassword(
  tx: Tx,
  account: SitAccount,
  now: Date,
): Promise<string> {
  const passwordHash = await bcrypt.hash(account.password, 12);

  const [existingByEmail] = await tx
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.email, account.email))
    .limit(1);

  let userId = account.id;
  if (existingByEmail) {
    userId = existingByEmail.id;
    await tx
      .update(schema.userTable)
      .set({
        name: account.name,
        role: account.userRole,
        emailVerified: true,
        banned: false,
        twoFactorEnabled: false,
        updatedAt: now,
      })
      .where(eq(schema.userTable.id, userId));
  } else {
    await tx
      .insert(schema.userTable)
      .values({
        id: userId,
        name: account.name,
        email: account.email,
        emailVerified: true,
        role: account.userRole,
        isAnonymous: false,
        twoFactorEnabled: false,
        banned: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.userTable.id,
        set: {
          name: account.name,
          email: account.email,
          role: account.userRole,
          emailVerified: true,
          banned: false,
          twoFactorEnabled: false,
          updatedAt: now,
        },
      });
  }

  const [existingCred] = await tx
    .select()
    .from(schema.accountTable)
    .where(
      and(
        eq(schema.accountTable.userId, userId),
        eq(schema.accountTable.providerId, "credential"),
      ),
    )
    .limit(1);

  if (existingCred) {
    await tx
      .update(schema.accountTable)
      .set({
        accountId: userId,
        password: passwordHash,
        updatedAt: now,
      })
      .where(eq(schema.accountTable.id, existingCred.id));
  } else {
    await tx.insert(schema.accountTable).values({
      id: `sit-cred-${userId}`,
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  }

  await tx
    .delete(schema.sessionTable)
    .where(eq(schema.sessionTable.userId, userId));
  return userId;
}

async function upsertPerson(
  tx: Tx,
  input: {
    userId: string;
    preferredPersonId: string;
    organisationId: string;
    side: "staff" | "customer";
    displayName: string;
    now: Date;
  },
): Promise<string> {
  const [existingByUser] = await tx
    .select()
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, input.userId))
    .limit(1);

  if (existingByUser) {
    await tx
      .update(schema.personTable)
      .set({
        organisationId: input.organisationId,
        side: input.side,
        displayName: input.displayName,
        active: true,
        isPlaceholder: false,
        updatedAt: input.now,
      })
      .where(eq(schema.personTable.id, existingByUser.id));
    return existingByUser.id;
  }

  const personId = input.preferredPersonId || createId();
  await tx
    .insert(schema.personTable)
    .values({
      id: personId,
      userId: input.userId,
      organisationId: input.organisationId,
      side: input.side,
      displayName: input.displayName,
      active: true,
      isPlaceholder: false,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: schema.personTable.id,
      set: {
        userId: input.userId,
        organisationId: input.organisationId,
        side: input.side,
        displayName: input.displayName,
        active: true,
        isPlaceholder: false,
        updatedAt: input.now,
      },
    });
  return personId;
}

async function ensureSystemRole(
  tx: Tx,
  input: {
    roleKey: BuiltInRoleKey;
    workspaceId: string | null;
    now: Date;
  },
): Promise<string> {
  const def = BUILT_IN_ROLES[input.roleKey];
  const targetWorkspaceId =
    def.scope === "workspace" ? input.workspaceId : null;

  const existingRows = await tx
    .select()
    .from(schema.roleTable)
    .where(
      targetWorkspaceId
        ? and(
            eq(schema.roleTable.scope, def.scope),
            eq(schema.roleTable.workspaceId, targetWorkspaceId),
            eq(schema.roleTable.key, def.key),
          )
        : and(
            eq(schema.roleTable.scope, def.scope),
            sql`${schema.roleTable.workspaceId} IS NULL`,
            eq(schema.roleTable.key, def.key),
          ),
    )
    .limit(1);

  if (existingRows[0]) {
    await tx
      .update(schema.roleTable)
      .set({
        name: def.key.charAt(0).toUpperCase() + def.key.slice(1),
        rank: def.rank,
        capabilities: [...def.capabilities],
        isSystem: true,
        isEditable: def.isEditable,
        updatedAt: input.now,
      })
      .where(eq(schema.roleTable.id, existingRows[0].id));
    return existingRows[0].id;
  }

  const roleId = `sit-role-${def.scope}-${targetWorkspaceId ?? "global"}-${def.key}`;
  await tx.insert(schema.roleTable).values({
    id: roleId,
    scope: def.scope,
    workspaceId: targetWorkspaceId,
    key: def.key,
    name: def.key.charAt(0).toUpperCase() + def.key.slice(1),
    description: def.intent,
    rank: def.rank,
    capabilities: [...def.capabilities],
    isSystem: true,
    isEditable: def.isEditable,
    createdAt: input.now,
    updatedAt: input.now,
  });
  return roleId;
}

async function upsertScopedMembership(
  tx: Tx,
  input: {
    personId: string;
    scope: "organisation" | "workspace" | "project";
    scopeId: string;
    roleId: string;
    seesAll: boolean;
    now: Date;
  },
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.personId, input.personId),
        eq(schema.membershipTable.scope, input.scope),
        eq(schema.membershipTable.scopeId, input.scopeId),
      ),
    )
    .limit(1);

  const membershipId =
    existing?.id ?? `sit-mbr-${input.personId}-${input.scope}-${input.scopeId}`;
  if (existing) {
    await tx
      .update(schema.membershipTable)
      .set({
        roleId: input.roleId,
        seesAll: input.seesAll,
        updatedAt: input.now,
      })
      .where(eq(schema.membershipTable.id, existing.id));
  } else {
    await tx.insert(schema.membershipTable).values({
      id: membershipId,
      personId: input.personId,
      scope: input.scope,
      scopeId: input.scopeId,
      roleId: input.roleId,
      seesAll: input.seesAll,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  await tx.execute(sql`
    INSERT INTO membership_grant (
      id, membership_id, person_id, scope, scope_id, role_id, source_kind, direct_origin, sees_all, created_at, updated_at
    ) VALUES (
      ${`sit-grant-${membershipId}`},
      ${membershipId},
      ${input.personId},
      ${input.scope},
      ${input.scopeId},
      ${input.roleId},
      'direct',
      'system_backfill',
      ${input.seesAll},
      now(),
      now()
    )
    ON CONFLICT (person_id, scope, scope_id) WHERE ((revoked_at IS NULL) AND (source_kind = 'direct'::text))
    DO UPDATE SET
      membership_id = EXCLUDED.membership_id,
      role_id = EXCLUDED.role_id,
      sees_all = EXCLUDED.sees_all,
      updated_at = now()
  `);
}

const SIT_REQUEST_TYPES = [
  {
    name: "Access request",
    group: "Accounts and access",
    description: "Ask for access to a system, application or shared folder.",
    fields: [
      {
        key: "summary",
        type: "text",
        label: "What do you need access to?",
        required: true,
        mapsTo: { field: "title" },
      },
      {
        key: "details",
        type: "textarea",
        label: "Why do you need it?",
        mapsTo: { field: "description" },
      },
    ],
  },
  {
    name: "Report a problem",
    group: "Support",
    description: "Something is broken or not working as expected.",
    fields: [
      {
        key: "summary",
        type: "text",
        label: "Short summary",
        required: true,
        mapsTo: { field: "title" },
      },
      {
        key: "details",
        type: "textarea",
        label: "What happened?",
        required: true,
        mapsTo: { field: "description" },
      },
      {
        key: "impact",
        type: "select",
        label: "How badly does it affect you?",
        options: ["Blocked", "Slowed down", "Minor"],
        mapsTo: {
          field: "priority",
          map: { Blocked: "urgent", "Slowed down": "high", Minor: "low" },
        },
      },
    ],
  },
] as const;

/**
 * Publishes customer-visible request types for Acme through the real intake repository, so
 * the portal catalogue and agent triage have something to work with. Idempotent by name.
 */
async function seedSitRequestTypes(input: {
  workspaceId: string;
  helpProjectId: string;
  acmeOrgId: string;
  workItemTypeId: string | null;
}) {
  if (!input.workItemTypeId)
    throw new Error(
      "SIT workspace has no work item type; request types cannot be seeded.",
    );
  const [admin] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, "sit-user-admin"))
    .limit(1);
  if (!admin) throw new Error("SIT admin person is missing; seed users first.");
  const [customer] = await db
    .select({ userId: schema.userTable.id, personId: schema.personTable.id })
    .from(schema.userTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.userId, schema.userTable.id),
    )
    .where(eq(schema.userTable.email, "customer@acme.example"))
    .limit(1);
  if (!customer)
    throw new Error("SIT customer person is missing; seed users first.");
  for (const [position, def] of SIT_REQUEST_TYPES.entries()) {
    const [existing] = await db
      .select({
        id: schema.requestTypeTable.id,
        published: schema.requestTypeTable.published,
      })
      .from(schema.requestTypeTable)
      .where(
        and(
          eq(schema.requestTypeTable.workspaceId, input.workspaceId),
          eq(schema.requestTypeTable.name, def.name),
        ),
      )
      .limit(1);
    const id =
      existing?.id ??
      (
        await createRequestType(
          {
            workspaceId: input.workspaceId,
            name: def.name,
            description: def.description,
            group: def.group,
            workItemTypeId: input.workItemTypeId,
            defaultProjectId: input.helpProjectId,
            formSchema: { fields: def.fields.map((field) => ({ ...field })) },
            autoAccept: false,
            customerVisible: true,
            forcePrivate: false,
            position,
          },
          admin.id,
        )
      ).id;
    await db
      .insert(schema.organisationRequestTypeTable)
      .values({ organisationId: input.acmeOrgId, requestTypeId: id })
      .onConflictDoNothing();
    if (!existing?.published) await publishRequestType(id, admin.id);
    const summary =
      position === 0
        ? "SIT: access to the shared support folder"
        : "SIT: unable to connect to the office printer";
    const [submission] = await db
      .select({ id: schema.submissionTable.id })
      .from(schema.submissionTable)
      .where(
        and(
          eq(schema.submissionTable.requesterId, customer.personId),
          eq(schema.submissionTable.requestTypeId, id),
          sql`${schema.submissionTable.formData}->>'summary' = ${summary}`,
        ),
      )
      .limit(1);
    if (!submission) {
      const [requestType] = await db
        .select({ key: schema.requestTypeTable.key })
        .from(schema.requestTypeTable)
        .where(eq(schema.requestTypeTable.id, id));
      if (!requestType)
        throw new Error("Published SIT request type is missing.");
      await createSubmission({
        userId: customer.userId,
        key: requestType.key,
        formData: {
          summary,
          details:
            "Seeded for the customer portal and agent triage walkthrough.",
          ...(position === 1 ? { impact: "Slowed down" } : {}),
        },
        customerVisibility: position === 0 ? "private" : "organisation",
      });
    }
  }
}

/**
 * Seeds the SIT login accounts (published test passwords, an owner with `sees_all`) and marks
 * instance setup complete. It must never touch a real database, so it refuses unless the
 * caller passes `--sit` explicitly; `scripts/deploy.sh` does so only in `local` mode.
 */
/** Seed-owned runtime configuration only; never overrides an operator's denial. */
export async function seedSitApprovalDemoFlag(
  tx: Tx,
  workspaceId: string,
  projectId: string,
  now: Date,
) {
  const [project] = await tx
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        eq(schema.projectTable.workspaceId, workspaceId),
        eq(schema.projectTable.slug, "HELP"),
      ),
    )
    .limit(1);
  if (!project)
    throw new Error(
      "SIT approval flag requires the HELP project in its seed workspace",
    );
  const [existing] = await tx
    .select({ enabled: schema.projectFeatureFlagTable.enabled })
    .from(schema.projectFeatureFlagTable)
    .where(
      and(
        eq(schema.projectFeatureFlagTable.projectId, projectId),
        eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
      ),
    )
    .limit(1);
  if (existing) return;
  const [workspace] = await tx
    .select({ enabled: schema.workspaceFeatureFlagTable.enabled })
    .from(schema.workspaceFeatureFlagTable)
    .where(
      and(
        eq(schema.workspaceFeatureFlagTable.workspaceId, workspaceId),
        eq(schema.workspaceFeatureFlagTable.featureKey, "feature.approvals"),
      ),
    )
    .limit(1);
  const [instance] = await tx
    .select({
      enabled: schema.instanceFeatureFlagTable.enabled,
      locked: schema.instanceFeatureFlagTable.locked,
    })
    .from(schema.instanceFeatureFlagTable)
    .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.approvals"))
    .limit(1);
  if (workspace?.enabled === false || (instance?.locked && !instance.enabled))
    return;
  await tx
    .insert(schema.projectFeatureFlagTable)
    .values({
      projectId,
      featureKey: "feature.approvals",
      enabled: true,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

/** Seed-only examples use their own workflow/type, leaving customer configuration intact. */
const SIT_LABEL_DEFINITIONS = [
  {
    id: "sit-label-access",
    name: "Access",
    color: "teal",
    project: false,
    items: [2, 5, 6],
  },
  {
    id: "sit-label-incident",
    name: "Incident",
    color: "red",
    project: false,
    items: [7],
  },
  {
    id: "sit-label-help-change",
    name: "Change window",
    color: "purple",
    project: true,
    items: [1, 3, 4],
  },
  {
    id: "sit-label-help-customer",
    name: "Customer follow-up",
    color: "yellow",
    project: true,
    items: [4, 5, 7],
  },
] as const;

/** Narrow additive fixture repair: no account/session/item writes. Existing definitions
 * and deliberately removed links remain untouched on repeat runs.
 */
export async function seedSitLabelCatalogue(
  tx: Tx,
  workspaceId: string,
  projectId: string,
  now: Date,
) {
  await lockWorkspaceLabelNames(
    tx,
    workspaceId,
    SIT_LABEL_DEFINITIONS.map((label) => label.name),
  );
  const items = await tx
    .select()
    .from(schema.workItemTable)
    .where(
      inArray(
        schema.workItemTable.id,
        Array.from({ length: 7 }, (_, index) => `sit-wi-help-${index + 1}`),
      ),
    )
    .orderBy(schema.workItemTable.id)
    .for("update");
  if (
    items.length !== 7 ||
    items.some(
      (item) =>
        item.workspaceId !== workspaceId ||
        item.projectId !== projectId ||
        item.key !== `HELP-${item.number}` ||
        item.id !== `sit-wi-help-${item.number}`,
    )
  )
    throw new Error(
      "SIT label fixtures require the seven original HELP examples in their seed workspace/project",
    );
  const [project] = await tx
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        eq(schema.projectTable.workspaceId, workspaceId),
        eq(schema.projectTable.slug, "HELP"),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    .for("share");
  if (!project)
    throw new Error(
      "SIT label fixtures require the live HELP project in its seed workspace",
    );
  let definitionsInserted = 0;
  let linksInserted = 0;
  for (const definition of SIT_LABEL_DEFINITIONS) {
    const projectScope = definition.project ? projectId : null;
    const [existing] = await tx
      .select()
      .from(schema.labelTable)
      .where(eq(schema.labelTable.id, definition.id))
      .for("share");
    if (existing) {
      if (
        existing.workspaceId !== workspaceId ||
        existing.projectId !== projectScope ||
        existing.taskId !== null
      )
        throw new Error(
          "SIT label identifier collides with a configured record outside its catalogue scope",
        );
      continue;
    }
    const inserted = await tx
      .insert(schema.labelTable)
      .values({
        id: definition.id,
        workspaceId,
        projectId: projectScope,
        taskId: null,
        name: definition.name,
        color: definition.color,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.labelTable.id });
    if (!inserted[0])
      throw new Error(
        "SIT label name collides with configured catalogue data; existing definitions were preserved",
      );
    definitionsInserted++;
    const links = items
      .filter(
        (item) =>
          definition.items.some((number) => number === item.number) &&
          !item.deletedAt &&
          !item.archivedAt,
      )
      .map((item) => ({ workItemId: item.id, labelId: definition.id }));
    if (links.length)
      linksInserted += (
        await tx
          .insert(schema.workItemLabelTable)
          .values(links)
          .onConflictDoNothing()
          .returning()
      ).length;
  }
  return { definitionsInserted, linksInserted };
}

async function seedSitJourney(
  tx: Tx,
  workspaceId: string,
  projectId: string,
  now: Date,
  people: Map<string, string>,
) {
  const person = (account: string) => {
    const id = people.get(account);
    if (!id) throw new Error(`Missing SIT person: ${account}`);
    return id;
  };
  const user = async (account: string) => {
    const [row] = await tx
      .select({ userId: schema.personTable.userId })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, person(account)))
      .limit(1);
    if (!row?.userId) throw new Error(`Missing SIT user: ${account}`);
    return row.userId;
  };
  const agentUserId = await user("sit-user-agent");
  const leadUserId = await user("sit-user-lead");
  await seedSitApprovalDemoFlag(tx, workspaceId, projectId, now);
  // Reach is separate from authority. Scope walkthrough access to HELP, never sees_all.
  for (const account of ["sit-user-agent", "sit-user-lead"] as const) {
    const roleId = `sit-help-role-${account}`;
    const base =
      account === "sit-user-lead" ? BUILT_IN_ROLES.lead : BUILT_IN_ROLES.member;
    await tx
      .insert(schema.roleTable)
      .values({
        id: roleId,
        workspaceId,
        scope: "project",
        key: `sit-help-${account}`,
        name:
          account === "sit-user-lead"
            ? "SIT HELP CAB approver"
            : "SIT HELP agent",
        rank: 1,
        capabilities: [
          ...base.capabilities,
          account === "sit-user-lead"
            ? "approval:decide_cab"
            : "approval:request_cab",
        ],
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [membership] = await tx
      .insert(schema.membershipTable)
      .values({
        id: `sit-help-membership-${account}`,
        personId: person(account),
        scope: "project",
        scopeId: projectId,
        roleId,
        seesAll: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (membership) {
      await tx
        .insert(schema.membershipGrantTable)
        .values({
          id: `sit-help-grant-${account}`,
          membershipId: membership.id,
          personId: membership.personId,
          scope: membership.scope,
          scopeId: membership.scopeId,
          roleId: membership.roleId,
          sourceKind: "direct",
          directOrigin: "system_backfill",
          seesAll: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  }
  await tx
    .insert(schema.teamTable)
    .values({
      id: "sit-help-cab",
      workspaceId,
      name: "SIT HELP Change Advisory Board",
      isCab: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  await tx
    .insert(schema.teamMemberTable)
    .values({
      id: "sit-help-cab-lead",
      teamId: "sit-help-cab",
      userId: leadUserId,
      createdAt: now,
    })
    .onConflictDoNothing();
  const states = await tx
    .select({
      id: schema.stateTable.id,
      templateId: schema.stateTemplateTable.id,
      group: schema.stateTemplateTable.group,
    })
    .from(schema.stateTable)
    .innerJoin(
      schema.stateTemplateTable,
      eq(schema.stateTable.stateTemplateId, schema.stateTemplateTable.id),
    )
    .where(eq(schema.stateTable.projectId, projectId));
  const state = (group: string) => {
    const row = states.find((candidate) => candidate.group === group);
    if (!row) throw new Error(`Missing SIT state group: ${group}`);
    return row;
  };
  const date = (days: number) => new Date(now.getTime() + days * 86_400_000);
  const calendarId = "sit-service-calendar";
  const policyId = "sit-sla-policy";
  const policyVersionId = "sit-sla-version-1";
  const workflowId = "sit-maintenance-workflow";
  const workflowVersionId = "sit-maintenance-workflow-1";
  const transitionId = "sit-maintenance-approve";
  const typeId = "sit-maintenance-type";
  await tx
    .insert(schema.serviceCalendarTable)
    .values({
      id: calendarId,
      workspaceId,
      name: "SIT continuous support",
      timezone: "UTC",
      windows: Object.fromEntries(
        ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((day) => [
          day,
          [{ from: 0, to: 1440 }],
        ]),
      ),
      holidays: [],
    })
    .onConflictDoNothing();
  const [policy] = await tx
    .insert(schema.slaPolicyTable)
    .values({ id: policyId, workspaceId, name: "SIT support response" })
    .onConflictDoNothing()
    .returning();
  await tx
    .insert(schema.slaPolicyVersionTable)
    .values({
      id: policyVersionId,
      workspaceId,
      policyId,
      number: 1,
      calendarId,
      atRiskThresholdPct: 80,
      effectiveFrom: null,
    })
    .onConflictDoNothing();
  const [workflow] = await tx
    .insert(schema.workflowTable)
    .values({
      id: workflowId,
      workspaceId,
      key: "sit-maintenance",
      name: "SIT maintenance approval",
    })
    .onConflictDoNothing()
    .returning();
  await tx
    .insert(schema.workflowVersionTable)
    .values({
      id: workflowVersionId,
      workflowId,
      number: 1,
      publishedAt: date(-7),
      publishedBy: person("sit-user-admin"),
    })
    .onConflictDoNothing();
  await tx
    .insert(schema.workflowTransitionTable)
    .values({
      id: transitionId,
      versionId: workflowVersionId,
      fromStateTemplateId: state("unstarted").templateId,
      toStateTemplateId: state("completed").templateId,
      requiresApproval: true,
      requiresCab: true,
      approvalPolicy: "any",
      notePolicy: "none",
      noteVisibility: "internal",
    })
    .onConflictDoNothing();
  for (const [from, to] of [
    ["backlog", "unstarted"],
    ["unstarted", "started"],
    ["started", "completed"],
  ] as const) {
    await tx
      .insert(schema.workflowTransitionTable)
      .values({
        id: `sit-maintenance-${from}-${to}`,
        versionId: workflowVersionId,
        fromStateTemplateId: state(from).templateId,
        toStateTemplateId: state(to).templateId,
        requiresApproval: to === "completed",
        requiresCab: to === "completed",
        approvalPolicy: to === "completed" ? "any" : null,
        notePolicy: "none",
        noteVisibility: "internal",
      })
      .onConflictDoNothing();
  }
  if (workflow)
    await tx
      .update(schema.workflowTable)
      .set({ activeVersionId: workflowVersionId })
      .where(eq(schema.workflowTable.id, workflowId));
  await tx
    .insert(schema.workItemTypeTable)
    .values({
      id: typeId,
      workspaceId,
      key: "sit-maintenance",
      name: "Maintenance change",
      category: "service",
      isChange: true,
      workflowId,
      slaPolicyId: policyId,
    })
    .onConflictDoNothing();
  if (policy) {
    // Like the real policy publisher: draft → complete goals → publish → activate.
    // Skip goal writes on reruns: published versions are immutable even for
    // INSERT ON CONFLICT DO NOTHING because PostgreSQL executes BEFORE triggers.
    for (const metric of ["first_response", "resolution"] as const) {
      for (const priority of ["low", "medium", "high", "urgent"] as const) {
        await tx.insert(schema.slaGoalTable).values({
          id: `sit-sla-${metric}-${priority}`,
          workspaceId,
          versionId: policyVersionId,
          metric,
          workItemTypeId: typeId,
          priority,
          targetMinutes: metric === "first_response" ? 240 : 2880,
        });
      }
    }
    await tx
      .update(schema.slaPolicyVersionTable)
      .set({ effectiveFrom: date(-7) })
      .where(eq(schema.slaPolicyVersionTable.id, policyVersionId));
    await tx
      .update(schema.slaPolicyTable)
      .set({ activeVersionId: policyVersionId })
      .where(eq(schema.slaPolicyTable.id, policyId));
  }
  // New records avoid overwriting existing HELP-1..3 walkthrough state.
  const examples = [
    {
      number: 4,
      title: "Rotate production SSO certificate after CAB approval",
      group: "unstarted",
      visibility: "organisation",
      parentId: null,
    },
    {
      number: 5,
      title: "Verify certificate chain and sign-in on the customer portal",
      group: "started",
      visibility: "organisation",
      parentId: "sit-wi-help-4",
    },
    {
      number: 6,
      title: "Complete VPN onboarding and publish access guide",
      group: "completed",
      visibility: "organisation",
      parentId: null,
    },
    {
      number: 7,
      title: "Investigate intermittent analytics refresh failures",
      group: "backlog",
      visibility: "private",
      parentId: null,
    },
  ];
  for (const example of examples) {
    const itemId = `sit-wi-help-${example.number}`;
    await tx
      .insert(schema.workItemTable)
      .values({
        id: itemId,
        projectId,
        workspaceId,
        typeId,
        number: example.number,
        key: `HELP-${example.number}`,
        title: example.title,
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Coordinate the change window with Acme, verify the production journey, and record the outcome here.",
                },
              ],
            },
          ],
        },
        stateId: state(example.group).id,
        priority: "high",
        assigneeId: person(
          example.number === 4 ? "sit-user-lead" : "sit-user-agent",
        ),
        requesterId: person("sit-user-customer"),
        parentId: example.parentId,
        startDate: date(example.number === 6 ? -4 : -1),
        dueDate: date(example.number === 6 ? -1 : example.number - 3),
        position: String(example.number),
        customerVisibility: example.visibility,
        slaStartedAt: example.number === 6 ? date(-4) : now,
        slaPolicyVersionId: policyVersionId,
        firstResponseAt: example.number === 6 ? date(-3) : null,
        resolvedAt: example.number === 6 ? date(-1) : null,
        createdAt: example.number === 6 ? date(-4) : now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
  await tx
    .insert(schema.workItemRelationTable)
    .values({
      id: "sit-relation-help-4-blocks-help-7",
      sourceId: "sit-wi-help-4",
      targetId: "sit-wi-help-7",
      type: "blocks",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  await tx
    .update(schema.projectTable)
    .set({
      lastTaskNumber: sql`greatest(${schema.projectTable.lastTaskNumber}, 7)`,
    })
    .where(eq(schema.projectTable.id, projectId));
  for (const visibility of ["public", "internal"] as const) {
    await tx
      .insert(schema.commentTable)
      .values({
        id: `sit-help-4-${visibility}`,
        workspaceId,
        workItemId: "sit-wi-help-4",
        // Match the real comment writer: actor IDs here are users, not people.
        authorId: agentUserId,
        createdAt: now,
        updatedAt: now,
        actorType: "person",
        visibility,
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text:
                    visibility === "public"
                      ? "The certificate is staged. We will confirm the approved maintenance window before changing production."
                      : "Rollback certificate is stored in the vault. Keep this implementation note internal.",
                },
              ],
            },
          ],
        },
      })
      .onConflictDoNothing();
  }
  await tx
    .insert(schema.approvalTable)
    .values({
      id: "sit-help-4-cab",
      workspaceId,
      workItemId: "sit-wi-help-4",
      transitionId,
      kind: "cab",
      requestedBy: person("sit-user-agent"),
      approverId: person("sit-user-lead"),
      state: "pending",
      createdAt: now,
      expiresAt: date(3),
    })
    .onConflictDoNothing();
}

export async function runSitUserSeed(argv: readonly string[] = process.argv) {
  if (!argv.includes("--sit")) {
    throw new Error(
      "seed-sit-users requires --sit and a private --credentials-file destination. Use it only on a dedicated SIT database.",
    );
  }
  const credentialsIndex = argv.indexOf("--credentials-file");
  const credentialsFile =
    credentialsIndex >= 0 ? argv[credentialsIndex + 1] : undefined;
  if (!credentialsFile || credentialsFile.startsWith("--"))
    throw new Error(
      "Supply --credentials-file with a new private file outside the source checkout.",
    );
  const destination = path.join(
    realpathSync(path.dirname(path.resolve(credentialsFile))),
    path.basename(credentialsFile),
  );
  const repository = realpathSync(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  const relative = path.relative(repository, destination);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
    throw new Error(
      "SIT credentials must be written outside the source checkout.",
    );
  let existingCredentials: unknown;
  try {
    const info = lstatSync(destination);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
      throw new Error(
        "The credentials file must be a private regular file (mode 0600).",
      );
    existingCredentials = JSON.parse(readFileSync(destination, "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  if (existingCredentials) {
    const rows = (existingCredentials as { accounts?: unknown }).accounts;
    if (!Array.isArray(rows) || rows.length !== SIT_ACCOUNTS.length)
      throw new Error(
        "The private credentials file must contain exactly the four SIT accounts.",
      );
    for (const account of SIT_ACCOUNTS) {
      const matching = rows.filter((row) => row && row.email === account.email);
      if (
        matching.length !== 1 ||
        typeof matching[0].password !== "string" ||
        matching[0].password.length < 24
      )
        throw new Error(
          "The private credentials file has missing, duplicate or weak account credentials.",
        );
      account.password = matching[0].password;
    }
  } else {
    writeFileSync(
      destination,
      `${JSON.stringify({ accounts: SIT_ACCOUNTS.map(({ email, password }) => ({ email, password })) }, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
  }
  config();
  const now = new Date();

  try {
    const seeded = await db.transaction(async (tx) => {
      await tx
        .insert(schema.instanceSettingTable)
        .values({
          id: "singleton",
          setupCompletedAt: now,
          setupTokenHash: null,
          setupTokenExpiresAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.instanceSettingTable.id,
          set: {
            setupCompletedAt: now,
            setupTokenHash: null,
            setupTokenExpiresAt: null,
            updatedAt: now,
          },
        });

      await tx.execute(sql`
        INSERT INTO instance_plugin_config (
          id, plugin_id, instance_key, display_name, enabled, config, scope, portal_scope, config_version, created_at, updated_at
        ) VALUES (
          'sit-auth-password-both',
          'auth.password',
          'default',
          'Local Email & Password',
          true,
          '{}'::jsonb,
          'instance',
          'both',
          2,
          now(),
          now()
        )
        ON CONFLICT (plugin_id, instance_key) DO UPDATE SET
          enabled = true,
          portal_scope = 'both',
          config_version = instance_plugin_config.config_version + 1,
          updated_at = now()
      `);

      const internalOrg = await ensureInternalOrganisation(tx);

      const [existingAcme] = await tx
        .select()
        .from(schema.organisationTable)
        .where(eq(schema.organisationTable.key, "acme"))
        .limit(1);

      const acmeOrgId = existingAcme?.id ?? "org-acme";
      if (!existingAcme) {
        await tx.insert(schema.organisationTable).values({
          id: acmeOrgId,
          key: "acme",
          name: "Acme Corp",
          isInternal: false,
          domain: ["acme.example"],
          active: true,
          portalAccess: true,
          defaultCustomerVisibility: "organisation",
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await tx
          .update(schema.organisationTable)
          .set({
            name: "Acme Corp",
            domain: ["acme.example"],
            active: true,
            portalAccess: true,
            deletedAt: null,
            updatedAt: now,
          })
          .where(eq(schema.organisationTable.id, acmeOrgId));
      }

      const workspaceSlug = "taskdesk-service-desk";
      const [existingWs] = await tx
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.slug, workspaceSlug))
        .limit(1);

      const workspaceId = existingWs?.id ?? "ws-taskdesk-sit";
      if (!existingWs) {
        await tx.insert(schema.workspaceTable).values({
          id: workspaceId,
          organisationId: internalOrg.id,
          name: "TaskDesk Service Desk",
          slug: workspaceSlug,
          description: "Primary SIT Service Desk & Delivery Workspace",
          createdAt: now,
        });
        await seedWorkspaceDefaults(workspaceId, tx);
      }

      const allWorkspaces = await tx.select().from(schema.workspaceTable);

      const [existingHelpProject] = await tx
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.slug, "HELP"))
        .limit(1);

      const helpProjectId = existingHelpProject?.id ?? "proj-help-sit";
      if (!existingHelpProject) {
        await tx.insert(schema.projectTable).values({
          id: helpProjectId,
          workspaceId,
          organisationId: acmeOrgId,
          kind: "project",
          slug: "HELP",
          name: "Customer Support Desk",
          description: "Primary IT & Customer Service Desk queue",
          icon: "Headset",
          position: 0,
          lastTaskNumber: 3,
          createdAt: now,
        });
        await tx
          .insert(schema.projectSlugClaimTable)
          .values({
            slug: "HELP",
            projectId: helpProjectId,
            createdAt: now,
          })
          .onConflictDoNothing();
        await tx.insert(schema.columnTable).values(
          DEFAULT_PROJECT_COLUMNS.map((column) => ({
            projectId: helpProjectId,
            ...column,
          })),
        );
        await seedProjectStates(helpProjectId, workspaceId, tx);
      }

      const customerRoleId = await ensureSystemRole(tx, {
        roleKey: "customer",
        workspaceId: null,
        now,
      });

      const journeyPeople = new Map<string, string>();
      for (const account of SIT_ACCOUNTS) {
        const userId = await upsertUserAndPassword(tx, account, now);
        const targetOrgId =
          account.side === "customer" ? acmeOrgId : internalOrg.id;

        const personId = await upsertPerson(tx, {
          userId,
          preferredPersonId: account.personId,
          organisationId: targetOrgId,
          side: account.side,
          displayName: account.name,
          now,
        });

        journeyPeople.set(account.id, personId);

        if (account.side === "customer") {
          await upsertScopedMembership(tx, {
            personId,
            scope: "organisation",
            scopeId: acmeOrgId,
            roleId: customerRoleId,
            seesAll: false,
            now,
          });
        } else if (account.workspaceRole) {
          for (const ws of allWorkspaces) {
            await tx
              .delete(schema.workspaceUserTable)
              .where(
                and(
                  eq(schema.workspaceUserTable.workspaceId, ws.id),
                  eq(schema.workspaceUserTable.userId, userId),
                ),
              );
            await tx.insert(schema.workspaceUserTable).values({
              id: `sit-wm-${ws.id}-${userId}`,
              workspaceId: ws.id,
              userId,
              role: account.workspaceRole,
              joinedAt: now,
            });

            const wsRoleId = await ensureSystemRole(tx, {
              roleKey: account.scopedRoleKey,
              workspaceId: ws.id,
              now,
            });

            await upsertScopedMembership(tx, {
              personId,
              scope: "workspace",
              scopeId: ws.id,
              roleId: wsRoleId,
              seesAll: account.scopedRoleKey === "owner",
              now,
            });
          }
        }
      }

      const [defaultState] = await tx
        .select()
        .from(schema.stateTable)
        .where(
          and(
            eq(schema.stateTable.projectId, helpProjectId),
            eq(schema.stateTable.isDefault, true),
          ),
        )
        .limit(1);

      const [defaultType] = await tx
        .select()
        .from(schema.workItemTypeTable)
        .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
        .limit(1);

      // Intake is off by default (feature.intake); SIT needs triage and the portal catalogue.
      await tx
        .insert(schema.workspaceFeatureFlagTable)
        .values({ workspaceId, featureKey: "feature.intake", enabled: true })
        .onConflictDoUpdate({
          target: [
            schema.workspaceFeatureFlagTable.workspaceId,
            schema.workspaceFeatureFlagTable.featureKey,
          ],
          set: { enabled: true, updatedAt: now },
        });

      if (defaultState && defaultType) {
        const sampleItems = [
          {
            id: "sit-wi-help-1",
            number: 1,
            key: "HELP-1",
            title: "Production SSO certificate rotation & SLA verification",
            priority: "high",
            customerVisibility: "organisation",
          },
          {
            id: "sit-wi-help-2",
            number: 2,
            key: "HELP-2",
            title: "Provision VPN & analytics access for Acme engineering",
            priority: "medium",
            customerVisibility: "organisation",
          },
          {
            id: "sit-wi-help-3",
            number: 3,
            key: "HELP-3",
            title: "Internal database index maintenance review",
            priority: "low",
            customerVisibility: "private",
          },
        ];

        for (const item of sampleItems) {
          await tx
            .insert(schema.workItemTable)
            .values({
              id: item.id,
              projectId: helpProjectId,
              workspaceId,
              typeId: defaultType.id,
              number: item.number,
              key: item.key,
              title: item.title,
              description: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: item.title }],
                  },
                ],
              },
              stateId: defaultState.id,
              priority: item.priority,
              position: String(item.number),
              customerVisibility: item.customerVisibility,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing();
        }
      }
      await seedSitJourney(tx, workspaceId, helpProjectId, now, journeyPeople);
      await seedSitLabelCatalogue(tx, workspaceId, helpProjectId, now);
      return {
        workspaceId,
        helpProjectId,
        acmeOrgId,
        workItemTypeId: defaultType?.id ?? null,
      };
    });

    await seedSitRequestTypes(seeded);
    await seedDefaultWorkspaceRoles();
    console.log(
      "✅ Seeded SIT interactive accounts, organisations, workspaces, and sample work items.",
    );
  } finally {
    await getDatabasePool().end();
  }
}
