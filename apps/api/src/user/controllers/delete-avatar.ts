import { deleteAvatarByUserId } from "../repository";

export async function deleteAvatar(userId: string) {
  const deleted = await deleteAvatarByUserId(userId);

  return { deleted: deleted.length > 0 };
}

export default deleteAvatar;
