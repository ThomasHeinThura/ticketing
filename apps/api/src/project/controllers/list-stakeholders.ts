import { asc, eq, getTableColumns, sql } from "drizzle-orm";
import db from "../../database";
import {
  personTable,
  stakeholderTable,
  userTable,
} from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

async function listStakeholders(projectId: string, workspaceId: string) {
  await requireActiveProject(projectId, workspaceId);

  // The Overview's Team tab names each stakeholder. A stakeholder may be a placeholder person
  // with no login, so the name falls back from the person's display name to the user's name.
  return db
    .select({
      ...getTableColumns(stakeholderTable),
      displayName: sql<
        string | null
      >`coalesce(nullif(btrim(${personTable.displayName}), ''), nullif(btrim(${userTable.name}), ''))`,
    })
    .from(stakeholderTable)
    .innerJoin(personTable, eq(personTable.id, stakeholderTable.personId))
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(stakeholderTable.projectId, projectId))
    .orderBy(asc(stakeholderTable.escalationOrder));
}

export default listStakeholders;
