import type { ResolvedIdentity } from "@taskdesk/permissions";
import { listTaskCommentRows } from "../repository";

async function getComments(identity: ResolvedIdentity, taskId: string) {
  const comments = await listTaskCommentRows(identity, taskId);

  return comments.map((c) => ({
    id: c.id,
    taskId: c.taskId,
    userId: c.userId,
    content: c.content as string,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    user: {
      name: c.userName,
      image: c.userImage,
    },
  }));
}

export default getComments;
