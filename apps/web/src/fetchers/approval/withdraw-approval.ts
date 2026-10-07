import { client } from "@taskdesk/libs";

async function withdrawApproval(input: {
  id: string;
  asInstanceAdmin: boolean;
}) {
  const response = input.asInstanceAdmin
    ? await client.admin.approvals[":id"].withdraw.$post({
        param: { id: input.id },
      })
    : await client.approvals[":id"].withdraw.$post({
        param: { id: input.id },
      });
  if (!response.ok) throw new Error("Failed to withdraw approval");
  return response.json();
}

export default withdrawApproval;
