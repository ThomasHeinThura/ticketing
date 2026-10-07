import db from "../../database";
import { getAvatar as getAvatarQuery } from "../repository";

export async function getAvatar(id: string) {
  const [avatar] = await getAvatarQuery(db, id);

  return avatar ?? null;
}

export default getAvatar;
