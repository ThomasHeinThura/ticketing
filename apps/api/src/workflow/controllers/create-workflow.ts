import { isUniqueViolation } from "../../utils/is-unique-violation";
import { insertWorkflow } from "../repository";

/** Thrown when `(workspaceId, key)` collides with an existing workflow -- see `workflow_workspace_key_unique`. */
export class WorkflowKeyTakenError extends Error {
  constructor(public readonly key: string) {
    super(`Workflow key "${key}" is already taken in this workspace`);
    this.name = "WorkflowKeyTakenError";
  }
}

async function createWorkflow(workspaceId: string, key: string, name: string) {
  try {
    return await insertWorkflow({ workspaceId, key, name });
  } catch (error) {
    if (isUniqueViolation(error, "workflow_workspace_key_unique")) {
      throw new WorkflowKeyTakenError(key);
    }
    throw error;
  }
}

export default createWorkflow;
