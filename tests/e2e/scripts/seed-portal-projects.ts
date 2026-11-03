import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import db, { getDatabasePool, schema } from "../../../apps/api/src/database";

/**
 * S4c portal projects journey: adds the customer-facing engagement data to the project the
 * intake seed bound to the customer's organisation, and gives the outsider's organisation a
 * project of its own (the CP-2 cross-organisation key). Private input/output paths only.
 */
type SeedInput =
  | { phase: "instance" }
  | {
      phase: "engagement";
      workspaceId: string;
      projectId: string;
      outsiderOrganisationId: string;
    };

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath)
  throw new Error("Private input and output paths are required.");

function key(length = 6) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from(randomBytes(length), (byte) => letters[byte % 26]).join("");
}

function isoDaysFromToday(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function main(input: SeedInput) {
  if (input.phase === "instance") {
    // Migration 0096 creates every canonical instance flag disabled; this disposable fixture
    // turns the customer portal on before the API starts (the same pattern the intake seed
    // uses for feature.intake), never changing the shipped default.
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({
        featureKey: "feature.customer_portal",
        enabled: true,
        locked: false,
      })
      .onConflictDoUpdate({
        target: schema.instanceFeatureFlagTable.featureKey,
        set: { enabled: true, locked: false },
      });
    return { feature: "feature.customer_portal" };
  }
  await db
    .update(schema.projectTable)
    .set({
      name: "Portal rollout",
      description: "Move every customer team onto the new support portal.",
      objective: "Every customer team raises requests through the portal.",
      inScope: "Portal set-up, request types and training.",
      successCriteria: "All teams onboarded before go-live.",
      statusNote: "INTERNAL NOTE: never shown to customers",
      health: "green",
    })
    .where(eq(schema.projectTable.id, input.projectId));
  await db.insert(schema.milestoneTable).values([
    {
      projectId: input.projectId,
      name: "Kick-off",
      date: new Date(`${isoDaysFromToday(-30)}T00:00:00.000Z`),
      reachedAt: new Date(),
    },
    {
      projectId: input.projectId,
      name: "Go-live",
      date: new Date(`${isoDaysFromToday(60)}T00:00:00.000Z`),
    },
  ]);
  await db.insert(schema.prerequisiteTable).values({
    projectId: input.projectId,
    title: "Provide VPN access for the support team",
    ownerSide: "customer",
    isBlocking: true,
  });
  await db.insert(schema.documentLinkTable).values([
    {
      projectId: input.projectId,
      title: "Statement of work",
      url: "https://docs.example.test/sow",
      customerVisible: true,
    },
    {
      projectId: input.projectId,
      title: "Internal margin sheet",
      url: "https://docs.example.test/margin",
      customerVisible: false,
    },
  ]);
  await db.insert(schema.projectContractTable).values({
    projectId: input.projectId,
    startDate: isoDaysFromToday(-30),
    endDate: isoDaysFromToday(29),
    contractedMinutes: 6000,
    coverage: "9x5",
    kickoffStatus: "completed",
  });

  const outsiderKey = key();
  await db.insert(schema.projectTable).values({
    workspaceId: input.workspaceId,
    organisationId: input.outsiderOrganisationId,
    name: "Outsider operations",
    slug: outsiderKey,
  });
  const [project] = await db
    .select({ slug: schema.projectTable.slug })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, input.projectId))
    .limit(1);
  if (!project) throw new Error("Portal projects fixture lost its project.");
  return { projectKey: project.slug, outsiderKey };
}

try {
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as SeedInput;
  const result = await main(input);
  writeFileSync(resolve(outputPath), JSON.stringify(result), { mode: 0o600 });
} finally {
  await getDatabasePool().end();
}
