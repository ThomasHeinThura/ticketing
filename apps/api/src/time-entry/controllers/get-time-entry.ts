import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { findTimeEntryById } from "../repository";

async function getTimeEntry(identity: ResolvedIdentity, id: string) {
  const timeEntry = await findTimeEntryById(identity, id);
  if (!timeEntry) {
    throw new HTTPException(404, { message: "Time entry not found" });
  }
  return timeEntry;
}

export default getTimeEntry;
