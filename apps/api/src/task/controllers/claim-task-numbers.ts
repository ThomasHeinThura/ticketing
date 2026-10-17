import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Executor } from "../../database/executor";
import { advanceProjectTaskNumberForIdentity } from "../repository";

type DbOrTx = Executor;

async function claimTaskNumbers(
  projectId: string,
  count: number,
  identity: ResolvedIdentity,
  dbOrTx: DbOrTx = db,
) {
  const updated = await advanceProjectTaskNumberForIdentity(
    dbOrTx,
    identity,
    projectId,
    count,
  );

  if (!updated) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  return updated.lastTaskNumber - count + 1;
}

export async function claimTaskNumberForIdentity(
  identity: ResolvedIdentity,
  projectId: string,
  dbOrTx: DbOrTx = db,
) {
  return claimTaskNumbers(projectId, 1, identity, dbOrTx);
}
