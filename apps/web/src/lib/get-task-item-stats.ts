type TaskItemsStats = {
  total: number;
  completed: number;
};

const TASK_ITEM_PATTERN =
  /^\s*(?:>\s*)*(?:[-+*]|\d{1,9}[.)])\s+\[([ xX])\](?:\s|$)/;
const FENCE_PATTERN = /^\s*(?:>\s*)*(`{3,}|~{3,})/;

/**
 * Counts Markdown task-list items in a task description.
 *
 * A task item must start a line (after indentation and optional blockquote
 * prefixes), use a bullet or an ordered-list marker, and have a `[ ]` or
 * `[x]` checkbox. Other checkbox-like text is intentionally ignored.
 *
 * Lines inside fenced code blocks are excluded. Fences may be backticks or
 * tildes, including within blockquotes; a closing fence must use the same
 * character and be at least as long as its opening fence.
 *
 * @param description - Markdown task description, or null when absent.
 * @returns The total number of task items and the number marked complete.
 */
export function getTaskItemStats(description: string | null): TaskItemsStats {
  if (!description) return { total: 0, completed: 0 };

  let total = 0;
  let completed = 0;
  let fenceChar: string | null = null;
  let fenceLen = 0;

  let lineStart = 0;
  while (true) {
    const newlineIndex = description.indexOf("\n", lineStart);
    const lineEnd = newlineIndex < 0 ? description.length : newlineIndex;
    const contentEnd =
      lineEnd > lineStart && description.charCodeAt(lineEnd - 1) === 13
        ? lineEnd - 1
        : lineEnd;
    const line = description.slice(lineStart, contentEnd);
    const fenceMatch = FENCE_PATTERN.exec(line);

    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fenceChar) {
        // Opening a new fence
        fenceChar = marker[0];
        fenceLen = marker.length;
      } else if (
        marker[0] === fenceChar &&
        marker.length >= fenceLen &&
        /^[\t ]*$/.test(line.slice(fenceMatch[0].length))
      ) {
        // Closing the current fence
        fenceChar = null;
      }
    } else if (!fenceChar) {
      const taskMatch = TASK_ITEM_PATTERN.exec(line);
      if (taskMatch) {
        total++;
        if (taskMatch[1].toLowerCase() === "x") completed++;
      }
    }

    if (newlineIndex < 0) break;
    lineStart = newlineIndex + 1;
  }

  return { total, completed };
}
