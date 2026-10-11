import { HTTPException } from "hono/http-exception";
import { findPersonIdByUserId } from "./repository";

export async function resolveCallerPersonId(userId: string): Promise<string> {
  const personId = await findPersonIdByUserId(userId);
  if (!personId) {
    throw new HTTPException(403, {
      message: "No organisation identity for this account",
    });
  }
  return personId;
}
