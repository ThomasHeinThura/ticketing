import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { findWorkflowTree } from "../repository";

async function getWorkflow(identity: ResolvedIdentity, id: string) {
  const workflow = await findWorkflowTree(identity, id);

  if (!workflow) {
    throw new HTTPException(404, { message: "Workflow not found" });
  }

  return workflow;
}

export default getWorkflow;
