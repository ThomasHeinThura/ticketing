import { saveAs } from "file-saver";
import { exportWorkItems } from "./export-work-items";

export async function downloadWorkItems(input: {
  workspaceId: string;
  projectSlug: string;
  filter: string;
  sort: "key" | "title" | "priority" | "dueDate";
  dir: "asc" | "desc";
}) {
  const csv = await exportWorkItems(input);
  saveAs(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `${input.projectSlug}-work-items.csv`,
  );
}
