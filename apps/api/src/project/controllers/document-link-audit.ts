/** Who wrote a Documents entry: a person or an API key acting for one. */
export type DocumentLinkActor = {
  actorId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
};

export function documentLinkActorOf(c: {
  get(key: "userId"): string;
  get(key: "apiKey"): { id: string } | undefined;
}): DocumentLinkActor {
  const apiKey = c.get("apiKey");
  return {
    actorId: c.get("userId"),
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
  };
}
