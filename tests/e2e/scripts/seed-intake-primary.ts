import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import db, { getDatabasePool, schema } from "../../../apps/api/src/database";
import { ensureInternalOrganisation } from "../../../apps/api/src/utils/seed-internal-organisation";

type SeedInput =
  | { phase: "instance" }
  | { phase: "auth-ui" }
  | { phase: "staff"; workspaceId: string }
  | { phase: "off"; workspaceId: string }
  | {
      phase: "workspace";
      workspaceId: string;
      projectId: string;
      workItemTypeId: string;
    };

type SeededPerson = {
  email: string;
  password: string;
  personId: string;
  organisationId: string;
};

const apiRequire = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath)
  throw new Error("Private input and output paths are required.");

function required<T>(rows: readonly (T | undefined)[], label: string): T {
  const [row] = rows;
  if (!row)
    throw new Error(`Intake primary fixture could not create ${label}.`);
  return row;
}

/**
 * The portal identity check (`hasCustomerPortalIdentity` -> `hasCanonicalCustomerMembership`)
 * admits only a customer-side person whose single organisation membership holds the canonical
 * built-in `customer` role: system, not editable, with the built-in rank and capabilities.
 * Any other row makes the sign-in after-hook revoke the new session (a 200 that clears the
 * session cookie), so the fixture creates exactly the built-in role, shared by both people.
 */
async function getOrCreateCustomerRole() {
  const [existing] = await db
    .select()
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "organisation"),
        eq(schema.roleTable.key, "customer"),
        isNull(schema.roleTable.workspaceId),
      ),
    )
    .limit(1);
  if (existing) return existing;
  return required(
    await db
      .insert(schema.roleTable)
      .values({
        scope: BUILT_IN_ROLES.customer.scope,
        workspaceId: null,
        key: BUILT_IN_ROLES.customer.key,
        name: "Customer",
        rank: BUILT_IN_ROLES.customer.rank,
        capabilities: [...BUILT_IN_ROLES.customer.capabilities],
        isSystem: true,
        isEditable: false,
      })
      .returning(),
    "customer role",
  );
}

async function createPortalPerson(
  name: string,
  emailPrefix: string,
): Promise<SeededPerson> {
  const suffix = randomUUID();
  const email = `${emailPrefix}-${suffix}@example.test`;
  const password = randomUUID();
  const organisation = required(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `intake-${suffix}`,
        name,
        isInternal: false,
        portalAccess: true,
        defaultCustomerVisibility: "organisation",
      })
      .returning(),
    `${name} organisation`,
  );
  const role = await getOrCreateCustomerRole();
  const user = required(
    await db
      .insert(schema.userTable)
      .values({ name, email, emailVerified: true })
      .returning(),
    `${name} user`,
  );
  const person = required(
    await db
      .insert(schema.personTable)
      .values({
        userId: user.id,
        organisationId: organisation.id,
        side: "customer",
        displayName: name,
        active: true,
        isPlaceholder: false,
      })
      .returning(),
    `${name} person`,
  );
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "organisation",
    scopeId: organisation.id,
    roleId: role.id,
    seesAll: false,
  });
  const now = new Date();
  await db.insert(schema.accountTable).values({
    id: `account-${suffix}`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(password, 4),
    createdAt: now,
    updatedAt: now,
  });

  return {
    email,
    password,
    personId: person.id,
    organisationId: organisation.id,
  };
}

async function main(input: SeedInput) {
  if (
    input.phase === "staff" ||
    input.phase === "off" ||
    input.phase === "auth-ui"
  ) {
    const target = new URL(process.env.TASKDESK_DATABASE_URL ?? "");
    if (
      !/^\/mfa_csrf_[a-f0-9]{32}_test$/.test(target.pathname) ||
      ["62870", "62873"].includes(target.port)
    )
      throw new Error(
        "This seed phase requires a disposable MFA/CSRF fixture database",
      );
  }
  if (input.phase === "auth-ui") {
    await db.insert(schema.instancePluginConfigTable).values({
      id: `a87-mail-${randomUUID()}`,
      pluginId: "notify.email",
      instanceKey: "default",
      displayName: "Disposable UI availability only",
      enabled: true,
      scope: "instance",
      workspaceId: null,
      portalScope: null,
      config: {
        host: "smtp.example.invalid",
        port: 587,
        secure: false,
        requireTLS: true,
        username: null,
        fromAddress: "fixture@example.test",
        replyTo: null,
      },
      secrets: null,
      configVersion: 1,
    });
    return { emailUi: true };
  }
  if (input.phase === "instance") {
    // Migration 0096 creates every canonical instance flag disabled. Enable the
    // existing row only in this disposable E2E fixture instead of inserting a
    // duplicate or changing the shipped default.
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({
        featureKey: "feature.intake",
        enabled: true,
        locked: false,
      })
      .onConflictDoUpdate({
        target: schema.instanceFeatureFlagTable.featureKey,
        set: { enabled: true, locked: false },
      });
    const actual = required(
      await db
        .select({
          enabled: schema.instanceFeatureFlagTable.enabled,
          locked: schema.instanceFeatureFlagTable.locked,
        })
        .from(schema.instanceFeatureFlagTable)
        .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"))
        .limit(1),
      "instance intake feature flag readback",
    );
    if (!actual.enabled || actual.locked)
      throw new Error(
        "Instance intake feature flag readback did not match the fixture state.",
      );
    return { feature: "feature.intake", actual };
  }

  if (input.phase === "off") {
    const actual = required(
      await db
        .insert(schema.workspaceFeatureFlagTable)
        .values({
          workspaceId: input.workspaceId,
          featureKey: "feature.intake",
          enabled: false,
        })
        .onConflictDoUpdate({
          target: [
            schema.workspaceFeatureFlagTable.workspaceId,
            schema.workspaceFeatureFlagTable.featureKey,
          ],
          set: { enabled: false },
        })
        .returning({ enabled: schema.workspaceFeatureFlagTable.enabled }),
      "disabled intake flag",
    );
    if (actual.enabled !== false)
      throw new Error("Intake flag did not persist disabled");
    return actual;
  }
  if (input.phase === "staff") {
    const internal = await ensureInternalOrganisation();
    const people: Record<string, SeededPerson> = {};
    for (const key of ["member", "lead", "admin"] as const) {
      const person = await createPortalPerson(`Mobile ${key}`, `mobile-${key}`);
      const [identity] = await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.id, person.personId));
      if (!identity?.userId) throw new Error("Staff fixture identity missing");
      await db
        .update(schema.personTable)
        .set({ side: "staff", organisationId: internal.id })
        .where(eq(schema.personTable.id, person.personId));
      await db
        .delete(schema.membershipTable)
        .where(eq(schema.membershipTable.personId, person.personId));
      const role = BUILT_IN_ROLES[key];
      const [stored] = await db
        .select()
        .from(schema.roleTable)
        .where(
          and(
            eq(schema.roleTable.key, key),
            eq(schema.roleTable.workspaceId, input.workspaceId),
          ),
        );
      const actual =
        stored ??
        required(
          await db
            .insert(schema.roleTable)
            .values({
              scope: role.scope,
              key: role.key,
              rank: role.rank,
              name: key,
              capabilities: [...role.capabilities],
              workspaceId: input.workspaceId,
              isSystem: true,
              isEditable: false,
            })
            .returning(),
          "staff role",
        );
      await db.insert(schema.membershipTable).values({
        personId: person.personId,
        scope: "workspace",
        scopeId: input.workspaceId,
        roleId: actual.id,
        seesAll: false,
      });
      await db.insert(schema.workspaceUserTable).values({
        userId: identity.userId,
        workspaceId: input.workspaceId,
        role: key,
        joinedAt: new Date(),
      });
      people[key] = { ...person, organisationId: internal.id };
    }
    return people;
  }
  const customer = await createPortalPerson(
    "Intake primary requester",
    "intake-requester",
  );
  const outsider = await createPortalPerson(
    "Intake primary unrelated requester",
    "intake-outsider",
  );

  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: input.workspaceId,
    featureKey: "feature.intake",
    enabled: true,
  });
  await db
    .update(schema.projectTable)
    .set({ organisationId: customer.organisationId })
    // The provided project ID was created through the real API. This fixture-only
    // update establishes the exact organisation reach required by IQ-7.
    .where(eq(schema.projectTable.id, input.projectId));

  const instanceFlag = required(
    await db
      .select({
        enabled: schema.instanceFeatureFlagTable.enabled,
        locked: schema.instanceFeatureFlagTable.locked,
      })
      .from(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"))
      .limit(1),
    "instance intake feature flag readback",
  );
  const workspaceFlag = required(
    await db
      .select({ enabled: schema.workspaceFeatureFlagTable.enabled })
      .from(schema.workspaceFeatureFlagTable)
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, input.workspaceId),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      )
      .limit(1),
    "workspace intake feature flag readback",
  );
  const actualProject = required(
    await db
      .select({
        id: schema.projectTable.id,
        workspaceId: schema.projectTable.workspaceId,
        organisationId: schema.projectTable.organisationId,
      })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, input.projectId))
      .limit(1),
    "project tenant readback",
  );

  const requestTypeId = `intake-primary-${randomUUID()}`;
  const formSchema = {
    fields: [
      {
        key: "summary",
        type: "text" as const,
        label: "Summary",
        required: true,
        mapsTo: { field: "title" },
      },
    ],
  };
  const requestType = required(
    await db
      .insert(schema.requestTypeTable)
      .values({
        id: requestTypeId,
        workspaceId: input.workspaceId,
        key: "access",
        name: "Access request draft",
        description: "A test request type authored in the staff UI.",
        group: "Access",
        workItemTypeId: input.workItemTypeId,
        defaultProjectId: input.projectId,
        formSchema,
        autoAccept: false,
        customerVisible: false,
        forcePrivate: false,
        published: false,
        position: 0,
        version: 1,
      })
      .returning(),
    "request type draft",
  );

  // This is canonical initial fixture state, not a God Mode assignment action.
  // The held UI/API assignment operation remains outside this journey.
  await db.insert(schema.organisationRequestTypeTable).values({
    organisationId: customer.organisationId,
    requestTypeId: requestType.id,
  });

  const actualRequestType = required(
    await db
      .select({
        id: schema.requestTypeTable.id,
        workspaceId: schema.requestTypeTable.workspaceId,
        defaultProjectId: schema.requestTypeTable.defaultProjectId,
        workItemTypeId: schema.requestTypeTable.workItemTypeId,
      })
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, requestType.id))
      .limit(1),
    "request type tenant readback",
  );
  const actualAssignment = required(
    await db
      .select({
        organisationId: schema.organisationRequestTypeTable.organisationId,
        requestTypeId: schema.organisationRequestTypeTable.requestTypeId,
      })
      .from(schema.organisationRequestTypeTable)
      .where(
        and(
          eq(
            schema.organisationRequestTypeTable.organisationId,
            customer.organisationId,
          ),
          eq(schema.organisationRequestTypeTable.requestTypeId, requestType.id),
        ),
      )
      .limit(1),
    "requester catalogue assignment readback",
  );

  return {
    customer,
    outsider,
    requestTypeId: requestType.id,
    requestTypeKey: requestType.key,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemTypeId: input.workItemTypeId,
    actual: {
      instanceFlag,
      workspaceFlag,
      project: actualProject,
      requestType: actualRequestType,
      assignment: actualAssignment,
    },
  };
}

try {
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as SeedInput;
  const result = await main(input);
  writeFileSync(resolve(outputPath), JSON.stringify(result), { mode: 0o600 });
} finally {
  await getDatabasePool().end();
}
