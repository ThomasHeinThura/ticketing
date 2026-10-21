/** CA-19a: pure rich-text interpolation. Values are literal text, never expressions. */
export interface CannedResponseContext {
  requesterName: string | null;
  workItemKey: string;
  dueDate: string | null;
}

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is Node & { text: string } =>
  isNode(value) && value.type === "text" && typeof value.text === "string";

/** Does not mutate the template or expand attributes, URLs or inserted values. */
export function resolveCannedResponseBody(
  body: unknown,
  context: CannedResponseContext,
): unknown {
  const values = {
    "requester.name": context.requesterName ?? "",
    "work_item.key": context.workItemKey,
    "work_item.due_date": context.dueDate ?? "",
  };
  function expandRun(nodes: (Node & { text: string })[]): Node[] {
    const text = nodes.map((node) => node.text).join("");
    const matches = Array.from(
      text.matchAll(
        /\{\{\s*(requester\.name|work_item\.key|work_item\.due_date)\s*\}\}/g,
      ),
      (match) => ({
        start: match.index,
        end: match.index + match[0].length,
        value: values[match[1] as keyof typeof values],
      }),
    );
    let offset = 0;
    return nodes.flatMap((node) => {
      const start = offset;
      const end = start + node.text.length;
      offset = end;
      let cursor = start;
      let replacement = "";
      for (const match of matches) {
        if (match.end <= start || match.start >= end) continue;
        if (match.start > cursor)
          replacement += text.slice(cursor, match.start);
        if (match.start >= start) replacement += match.value;
        cursor = Math.max(cursor, Math.min(end, match.end));
      }
      replacement += text.slice(cursor, end);
      // Tiptap forbids empty text nodes; the surrounding paragraph may be empty.
      return replacement ? [{ ...node, text: replacement }] : [];
    });
  }
  function visit(value: unknown): unknown {
    if (!isNode(value)) return value;
    if (isText(value)) return expandRun([value])[0] ?? null;
    if (!Array.isArray(value.content)) return value;
    const content: unknown[] = [];
    for (let index = 0; index < value.content.length; ) {
      const child = value.content[index];
      if (isText(child)) {
        const run = [child];
        index++;
        while (index < value.content.length && isText(value.content[index])) {
          run.push(value.content[index] as Node & { text: string });
          index++;
        }
        content.push(...expandRun(run));
      } else {
        content.push(visit(child));
        index++;
      }
    }
    return { ...value, content };
  }
  return visit(body);
}
