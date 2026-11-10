import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import db, { getDatabasePool, schema } from "../../../apps/api/src/database";

const apiRequire = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const outputPath = process.argv[2];
if (!outputPath) throw new Error("A private fixture output path is required.");

const userId = `users-primary-customer-${randomUUID()}`;
const email = `${userId}@example.test`;
const password = randomUUID();
const organisationId = `users-primary-org-${randomUUID()}`;
const now = new Date();

try {
  await db.insert(schema.organisationTable).values({
    id: organisationId,
    key: organisationId,
    name: "Users primary journey customer",
    isInternal: false,
    portalAccess: true,
  });
  const [existingRole] = await db
    .select()
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, BUILT_IN_ROLES.customer.scope),
        eq(schema.roleTable.key, BUILT_IN_ROLES.customer.key),
        isNull(schema.roleTable.workspaceId),
      ),
    )
    .limit(1);
  const role =
    existingRole ??
    (
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
        .returning({ id: schema.roleTable.id })
    )[0];
  if (!role) throw new Error("Could not create the customer role fixture.");
  await db.insert(schema.userTable).values({
    id: userId,
    name: "Users primary journey customer",
    email,
    emailVerified: true,
  });
  const person = (
    await db
      .insert(schema.personTable)
      .values({
        userId,
        organisationId,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .returning({ id: schema.personTable.id })
  )[0];
  if (!person) throw new Error("Could not create the customer person fixture.");
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "organisation",
    scopeId: organisationId,
    roleId: role.id,
    seesAll: false,
  });
  await db.insert(schema.accountTable).values({
    id: `account-${randomUUID()}`,
    accountId: userId,
    providerId: "credential",
    userId,
    password: await bcrypt.hash(password, 4),
    createdAt: now,
    updatedAt: now,
  });
  writeFileSync(resolve(outputPath), JSON.stringify({ email, password }), {
    mode: 0o600,
  });
} finally {
  await getDatabasePool().end();
}
