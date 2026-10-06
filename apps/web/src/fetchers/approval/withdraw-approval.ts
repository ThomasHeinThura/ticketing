import { client } from "@taskdesk/libs";

async function withdrawApproval(id: string) {
  const response = await client.approvals[":id"].withdraw.$post({
    param: { id },
  });
  if (!response.ok) throw new Error("Failed to withdraw approval");
  return response.json();
}

export default withdrawApproval;
