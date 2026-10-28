import { client } from "@taskdesk/libs";

async function markNotificationAsUnread(id: string) {
  const response = await client.notification[":id"].unread.$patch({
    param: { id },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();
  return data;
}

export default markNotificationAsUnread;
