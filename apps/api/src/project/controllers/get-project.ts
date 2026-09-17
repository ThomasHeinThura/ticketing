import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";

async function getProject(id: string, workspaceId: string) {
  const project = await db.query.projectTable.findFirst({
    // #187: a soft-deleted project is treated as gone everywhere in ordinary use --
    // unlike `archivedAt`, which stays individually fetchable and is only excluded
    // from the default list.
    where: and(
      eq(projectTable.id, id),
      eq(projectTable.workspaceId, workspaceId),
      isNull(projectTable.deletedAt),
    ),
    with: {
      tasks: true,
    },
  });

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  return project;
}

export default getProject;
