import { markReadableNotificationsRead } from "../inbox.repository";

async function markAllNotificationsAsRead(userId: string) {
  await markReadableNotificationsRead(userId);

  return { success: true };
}

export default markAllNotificationsAsRead;
