import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function transitionWorkItem(input: {
  key: string;
  toStateTemplateId: string;
  note?: string;
}) {
  const response = await client["work-items"][":key"].transition.$post({
    param: { key: input.key },
    json: {
      toStateTemplateId: input.toStateTemplateId,
      ...(input.note ? { note: input.note } : {}),
    },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to transition work item");
  return response.json();
}
