import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Executor } from "../../database/executor";
import { advanceProjectTaskNumber } from "../repository";

type DbOrTx = Executor;

async function claimTaskNumbers(
  projectId: string,
  count: number,
  dbOrTx: DbOrTx = db,
) {
  const updated = await advanceProjectTaskNumber(dbOrTx, projectId, count);

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

export default claimTaskNumbers;
