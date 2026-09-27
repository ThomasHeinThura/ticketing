import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workflowTable } from "../../database/schema";

async function getWorkflow(id: string) {
  const workflow = await db.query.workflowTable.findFirst({
    where: eq(workflowTable.id, id),
    with: {
      versions: {
        with: { transitions: true },
      },
    },
  });

  if (!workflow) {
    throw new HTTPException(404, { message: "Workflow not found" });
  }

  return workflow;
}

export default getWorkflow;
