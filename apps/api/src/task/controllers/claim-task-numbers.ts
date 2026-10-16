import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Executor } from "../../database/executor";
import {
  advanceProjectTaskNumber,
  advanceProjectTaskNumberForIdentity,
} from "../repository";

type DbOrTx = Executor;

async function claimTaskNumbers(
  projectId: string,
  count: number,
  dbOrTx: DbOrTx = db,
  identity?: ResolvedIdentity,
) {
  const updated = identity
    ? await advanceProjectTaskNumberForIdentity(
        identity,
        dbOrTx,
        projectId,
        count,
      )
    : await advanceProjectTaskNumber(dbOrTx, projectId, count);

  if (!updated) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  return updated.lastTaskNumber - count + 1;
}

export async function claimTaskNumber(projectId: string, dbOrTx: DbOrTx = db) {
  return claimTaskNumbers(projectId, 1, dbOrTx);
}

export async function claimTaskNumberForIdentity(
  identity: ResolvedIdentity,
  projectId: string,
  dbOrTx: DbOrTx = db,
) {
  return claimTaskNumbers(projectId, 1, dbOrTx, identity);
}

export default claimTaskNumbers;
