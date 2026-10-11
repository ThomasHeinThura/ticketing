import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import db, { getDatabasePool, schema } from "../../../apps/api/src/database";

type SeedInput =
  | { phase: "instance" }
  | {
      phase: "workspace";
      workspaceId: string;
      projectId: string;
      workItemTypeId: string;
    };

type SeededPerson = { email: string; password: string; organisationId: string };

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
  const role = required(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "organisation",
        workspaceId: null,
        key: `intake-${suffix}`,
        name: `${name} role`,
        rank: 0,
        capabilities: [],
      })
      .returning(),
    `${name} role`,
  );
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

  return { email, password, organisationId: organisation.id };
}

async function main(input: SeedInput) {
  if (input.phase === "instance") {
    await db.insert(schema.instanceFeatureFlagTable).values({
      featureKey: "feature.intake",
      enabled: true,
      locked: false,
    });
    return { feature: "feature.intake", enabled: true };
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

  return {
    customer,
    outsider,
    requestTypeId: requestType.id,
    requestTypeKey: requestType.key,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemTypeId: input.workItemTypeId,
  };
}

try {
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as SeedInput;
  const result = await main(input);
  writeFileSync(resolve(outputPath), JSON.stringify(result), { mode: 0o600 });
} finally {
  await getDatabasePool().end();
}
