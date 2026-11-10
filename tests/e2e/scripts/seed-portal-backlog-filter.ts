import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import db, { getDatabasePool, schema } from "../../../apps/api/src/database";

type Person = { personId: string; organisationId: string };
type Input = {
  workspaceId: string;
  typeId: string;
  projects: { id: string }[];
  items: string[];
  customer: Person;
  outsider: Person;
};
const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error("Private paths are required.");

async function main(input: Input) {
  const databaseUrl = new URL(process.env.TASKDESK_DATABASE_URL ?? "");
  if (
    !new Set(["localhost", "127.0.0.1"]).has(databaseUrl.hostname) ||
    !databaseUrl.port ||
    databaseUrl.port === "62870" ||
    !/^\/mfa_csrf_[a-f0-9]{32}_test$/.test(databaseUrl.pathname)
  )
    throw new Error("Refusing non-disposable fixture database.");
  if (input.projects.length !== 3 || input.items.length !== 3)
    throw new Error("Expected three projects and items.");
  const keys: string[] = [];
  const [requestType] = await db
    .insert(schema.requestTypeTable)
    .values({
      workspaceId: input.workspaceId,
      key: `backlog-${randomUUID()}`,
      name: "Backlog fixture",
      group: "General",
      workItemTypeId: input.typeId,
      formSchema: { fields: [] },
      published: true,
      customerVisible: true,
    })
    .returning();
  if (!requestType) throw new Error("Missing request type.");
  const [version] = await db
    .insert(schema.requestTypeVersionTable)
    .values({
      workspaceId: input.workspaceId,
      requestTypeId: requestType.id,
      number: 1,
      formSchema: { fields: [] },
      workItemTypeId: input.typeId,
    })
    .returning();
  if (!version) throw new Error("Missing request version.");
  for (let index = 0; index < 3; index++) {
    const project = input.projects[index];
    const itemId = input.items[index];
    if (!project || !itemId) throw new Error("Missing fixture input.");
    const person = index === 2 ? input.outsider : input.customer;
    const [updated] = await db
      .update(schema.projectTable)
      .set({ organisationId: person.organisationId })
      .where(
        and(
          eq(schema.projectTable.id, project.id),
          eq(schema.projectTable.workspaceId, input.workspaceId),
        ),
      )
      .returning({ key: schema.projectTable.slug });
    if (!updated) throw new Error("Missing project.");
    keys.push(updated.key);
    const [state] = await db
      .select({ id: schema.stateTable.id })
      .from(schema.stateTable)
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTable.stateTemplateId, schema.stateTemplateTable.id),
      )
      .where(
        and(
          eq(schema.stateTable.projectId, project.id),
          eq(schema.stateTemplateTable.group, "backlog"),
        ),
      )
      .limit(1);
    if (!state) throw new Error("Missing project backlog state.");
    const [item] = await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "organisation", stateId: state.id })
      .where(
        and(
          eq(schema.workItemTable.id, itemId),
          eq(schema.workItemTable.projectId, project.id),
        ),
      )
      .returning({ id: schema.workItemTable.id });
    if (!item) throw new Error("Missing work item.");
    await db.insert(schema.submissionTable).values({
      organisationId: person.organisationId,
      requesterId: person.personId,
      requestTypeId: requestType.id,
      requestTypeVersionId: version.id,
      formData: {},
      state: "accepted",
      submittedAt: new Date(),
      customerVisibility: "organisation",
      workItemId: item.id,
    });
  }
  return { keys };
}
try {
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as Input;
  writeFileSync(outputPath, JSON.stringify(await main(input)), { mode: 0o600 });
} finally {
  await getDatabasePool().end();
}
