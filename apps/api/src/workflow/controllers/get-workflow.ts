import { HTTPException } from "hono/http-exception";
import { getWorkflowQuery } from "../repository";

async function getWorkflow(id: string) {
  const workflow = await getWorkflowQuery(id);

  if (!workflow) {
    throw new HTTPException(404, { message: "Workflow not found" });
  }

  return workflow;
}

export default getWorkflow;
