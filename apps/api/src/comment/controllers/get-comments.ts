import { listComments } from "../../activity/repository";
import db from "../../database";

async function getComments(taskId: string) {
  const comments = await listComments(db, taskId);

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
