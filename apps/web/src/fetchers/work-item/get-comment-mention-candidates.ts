import { client } from "@taskdesk/libs";

export type CommentMentionCandidate = {
  personId: string;
  name: string;
  image: string | null;
  side: "staff" | "customer";
  reachable: boolean;
};

export async function getCommentMentionCandidates({
  key,
  visibility,
}: {
  key: string;
  visibility: "public" | "internal";
}): Promise<CommentMentionCandidate[]> {
  const response = await client["work-items"][":key"].comments[
    "mention-candidates"
  ].$get({ param: { key }, query: { visibility } });
  if (!response.ok)
    throw new Error("Failed to load comment mention candidates");
  return response.json();
}

export default getCommentMentionCandidates;
