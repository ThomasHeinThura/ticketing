import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { ResolveIdentityInput } from "../../permissions/resolve-identity";
import { resolveIdentity } from "../../permissions/resolve-identity";
import {
  findWorkflowVersion,
  hasCompleteWorkflowProjectReach,
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
  identityInput: ResolveIdentityInput,
  workflowId: string,
  number: number,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.transaction(
        async (tx) => {
          const identity = await resolveIdentity(identityInput, tx);
          if (!identity) throw new HTTPException(403, { message: "Forbidden" });
          const version = await findWorkflowVersion(
            identity,
            workflowId,
            number,
            tx,
          );
          if (!version) {
            throw new HTTPException(404, {
              message: "Workflow version not found",
            });
          }
          if (
            !(await hasCompleteWorkflowProjectReach(identity, workflowId, tx))
          ) {
            throw new HTTPException(403, {
              message: "Workflow project access required",
            });
          }
          const published = await stampVersionPublished(
            tx,
            version.id,
            identity.personId,
          );
          if (!published)
            throw new HTTPException(404, {
              message: "Workflow version not found",
            });
          await setActiveWorkflowVersion(tx, workflowId, version.id);
          const transitions = await listVersionTransitions(
            identity,
            version.id,
            tx,
          );
          return { ...published, transitions };
        },
        { isolationLevel: "serializable" },
      );
    } catch (error) {
      let current: unknown = error;
      let serializationFailure = false;
      for (
        let depth = 0;
        depth < 5 && current && typeof current === "object";
        depth += 1
      ) {
        const value = current as { code?: unknown; cause?: unknown };
        if (value.code === "40001") {
          serializationFailure = true;
          break;
        }
        current = value.cause;
      }
      if (!serializationFailure || attempt === 2) throw error;
    }
  }
  throw new Error("Workflow publication transaction exhausted its retries");
}

export default publishWorkflowVersion;
