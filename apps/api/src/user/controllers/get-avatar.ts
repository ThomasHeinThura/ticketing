import { findAvatarById } from "../repository";

export async function getAvatar(id: string) {
  const avatar = await findAvatarById(id);

  return avatar ?? null;
}

export default getAvatar;
