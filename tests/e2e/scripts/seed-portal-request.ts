import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import db, { getDatabasePool, schema } from "../../../apps/api/src/database";

/**
 * U-12 portal request conversation journey. Staff create the work item through the real API and
 * name the customer with the agent Requester field (A-03); this fixture only assigns it to the
 * staff member, keeps it private and gives it a description. Private input/output paths only;
 * nothing secret is written.
 */
type SeedInput = {
  workItemId: string;
  staffEmail: string;
};

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath)
  throw new Error("Private input and output paths are required.");

async function main(input: SeedInput) {
  const [staff] = await db
    .select({ personId: schema.personTable.id })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(eq(schema.userTable.email, input.staffEmail))
    .limit(1);
  if (!staff) throw new Error("The staff member has no person row.");
  const [item] = await db
    .update(schema.workItemTable)
    .set({
      assigneeId: staff.personId,
      customerVisibility: "private",
      priority: "high",
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Please test the new VPN profile on your laptop.",
              },
            ],
          },
        ],
      },
    })
    .where(eq(schema.workItemTable.id, input.workItemId))
    .returning({ key: schema.workItemTable.key });
  if (!item) throw new Error("The staff-raised work item was not found.");
  return { key: item.key, staffPersonId: staff.personId };
}

try {
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as SeedInput;
  writeFileSync(outputPath, JSON.stringify(await main(input)), {
    mode: 0o600,
  });
} finally {
  await getDatabasePool().end();
}
