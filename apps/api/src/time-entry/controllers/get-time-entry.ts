import { findTimeEntryById } from "../repository";

async function getTimeEntry(id: string) {
  const timeEntry = await findTimeEntryById(id);

  return timeEntry;
}

export default getTimeEntry;
