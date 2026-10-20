import { createId } from "@paralleldrive/cuid2";
import { BUILT_IN_ROLES, type BuiltInRoleKey } from "@taskdesk/permissions";
import bcrypt from "bcryptjs";
import { config } from "dotenv-mono";
import { and, eq, sql } from "drizzle-orm";
import db, { getDatabasePool, schema } from "../src/database";
import {
  createRequestType,
  publishRequestType,
} from "../src/intake/repository";
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
    password: "TaskDesk!Admin2026",
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
    password: "TaskDesk!Agent2026",
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
    password: "TaskDesk!Lead2026",
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
    password: "TaskDesk!Customer2026",
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
  const passwordHash = await bcrypt.hash(account.password, 10);

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
    def.scope === "workspace" || def.scope === "project"
      ? input.workspaceId
      : null;

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
  }
}

/**
 * Seeds the SIT login accounts (published test passwords, an owner with `sees_all`) and marks
 * instance setup complete. It must never touch a real database, so it refuses unless the
 * caller passes `--sit` explicitly; `scripts/deploy.sh` does so only in `local` mode.
 */
export async function runSitUserSeed(argv: readonly string[] = process.argv) {
  if (!argv.includes("--sit")) {
    throw new Error(
      "seed-sit-users refuses to run without --sit: it publishes test passwords and completes instance setup. Use it only on a local SIT database.",
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
