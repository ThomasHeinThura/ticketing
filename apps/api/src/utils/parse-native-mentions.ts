/** Read recipient ids only from native Tiptap mention nodes. Display text and
 * arbitrary document attributes are not recipient authority. */
export function parseNativeMentionPersonIds(body: unknown): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!value || typeof value !== "object") return;

    const node = value as Record<string, unknown>;
    if (
      node.type === "taskdeskMention" &&
      node.attrs &&
      typeof node.attrs === "object"
    ) {
      const id = (node.attrs as Record<string, unknown>).id;
      if (typeof id === "string" && id.length > 0) ids.add(id);
    }
    visit(node.content);
  };

  visit(body);
  return [...ids];
}
