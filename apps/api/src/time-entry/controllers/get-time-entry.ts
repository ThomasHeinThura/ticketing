import db from "../../database";
import { getTimeEntry as readTimeEntry } from "../repository";

async function getTimeEntry(id: string) {
  const [timeEntry] = await readTimeEntry(db, id);

  return timeEntry;
}

export default getTimeEntry;
