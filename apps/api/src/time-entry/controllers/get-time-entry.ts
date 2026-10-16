import type { ResolvedIdentity } from "@taskdesk/permissions";
import { findTimeEntryById } from "../repository";

async function getTimeEntry(identity: ResolvedIdentity, id: string) {
  return findTimeEntryById(identity, id);
}

export default getTimeEntry;
