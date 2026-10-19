import { buildAvatarUrl, decodeAvatarUpload } from "../avatar";
import { upsertAvatar } from "../repository";

export async function saveAvatar({
  userId,
  contentType,
  data,
}: {
  userId: string;
  contentType: string;
  data: string;
}) {
  const { mimeType, bytes } = decodeAvatarUpload({ contentType, data });

  const saved = await upsertAvatar({ userId, mimeType, data: bytes });

  if (!saved) {
    throw new Error("Failed to store avatar");
  }

  return { id: saved.id, url: buildAvatarUrl(saved.id), size: bytes.length };
}

export default saveAvatar;
