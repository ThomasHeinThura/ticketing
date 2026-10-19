import { deleteReadableNotifications } from "../inbox.repository";

async function clearNotifications(userId: string) {
  await deleteReadableNotifications(userId);

  return { success: true };
}

export default clearNotifications;
