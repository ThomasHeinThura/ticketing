import { client } from "@taskdesk/libs";

export type CommentMentionPreflight = {
  reachablePersonIds: string[];
  unreachablePersonIds: string[];
};

export async function preflightCommentMentions({
  key,
  personIds,
  visibility,
}: {
  key: string;
  personIds: string[];
  visibility: "public" | "internal";
}): Promise<CommentMentionPreflight> {
  const response = await client["work-items"][":key"].comments[
    "mention-preflight"
  ].$post({ param: { key }, json: { personIds, visibility } });
  if (!response.ok) throw new Error("Failed to check comment mention access");
  return response.json();
}

export default preflightCommentMentions;
