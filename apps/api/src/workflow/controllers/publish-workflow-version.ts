import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  findPersonIdByUserId,
  findWorkflowVersion,
  listVersionTransitions,
  setActiveWorkflowVersion,
  stampVersionPublished,
} from "../repository";

/**
 * Publishes `number` for `workflowId`: stamps `published_at`/`published_by` on that
 * version and sets `workflow.active_version_id` to it (`WF-7`). Immutable once
 * published (`WF-6`) -- this route does not enforce that beyond writing
 * `published_at` once; nothing in this PR's scope offers an "edit a published
 * version" route to enforce it against.
 */
async function publishWorkflowVersion(
  workflowId: string,
  number: number,
  userId: string,
) {
  const version = await findWorkflowVersion(workflowId, number);

  if (!version) {
    throw new HTTPException(404, { message: "Workflow version not found" });
  }

  const caller = await findPersonIdByUserId(userId);

  return db.transaction(async (tx) => {
    const published = await stampVersionPublished(
      tx,
      version.id,
      caller?.id ?? null,
    );

    await setActiveWorkflowVersion(tx, workflowId, version.id);

    const transitions = await listVersionTransitions(version.id, tx);

    return { ...published, transitions };
  });
}

export default publishWorkflowVersion;
