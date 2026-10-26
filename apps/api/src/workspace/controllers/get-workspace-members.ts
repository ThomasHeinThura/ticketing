import { and, eq } from "drizzle-orm";
import db from "../../database";
import {
  personTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import type { WorkspaceMember } from "../response";

async function getWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const members = await db
    .select({
      id: userTable.id,
      personId: personTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .leftJoin(
      personTable,
      and(
        eq(personTable.userId, userTable.id),
        eq(personTable.side, "staff"),
        eq(personTable.active, true),
      ),
    )
    .where(eq(workspaceUserTable.workspaceId, workspaceId));

  return members;
}

export default getWorkspaceMembers;
