import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
export type CommentVersion = {
  number: number;
  body: unknown;
  editedBy: string | null;
  createdAt: string;
};

export type CommentVersionPage = {
  data: CommentVersion[];
  page: { nextCursor: string | null; hasMore: boolean };
};

async function getCommentVersionPage({
  key,
  commentId,
  cursor,
}: {
  key: string;
  commentId: string;
  cursor?: string;
}): Promise<CommentVersionPage> {
  const response = await client["work-items"][":key"].comments[
    ":id"
  ].versions.$get({
    param: { key, id: commentId },
    query: { limit: "5", ...(cursor ? { cursor } : {}) },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch comment history");
  }
  return response.json();
}

export default getCommentVersionPage;
