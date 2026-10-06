import { HTTPException } from "hono/http-exception";
import { getProjectQuery } from "../repository";

async function getProject(id: string, workspaceId: string) {
  const project = await getProjectQuery(id, workspaceId);

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  return project;
}

export default getProject;
