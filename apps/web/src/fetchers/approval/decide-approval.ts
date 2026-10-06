import { client } from "@taskdesk/libs";

async function decideApproval(input: {
  id: string;
  action: "approve" | "reject";
  note?: string;
}) {
  const response = await client.approvals[":id"].decide.$post({
    param: { id: input.id },
    json: { action: input.action, ...(input.note ? { note: input.note } : {}) },
  });
  if (!response.ok) throw new Error("Failed to record approval decision");
  return response.json();
}

export default decideApproval;
