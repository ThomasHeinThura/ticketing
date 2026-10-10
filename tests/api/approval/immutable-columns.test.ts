import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 0120 review check 7 / N-2: after insert nothing may update workspace_id, work_item_id,
 * transition_id, kind, requested_by or approver_id of an approval. `workspace_id` and
 * `work_item_id` are mutable as a pair at the database level, so this static guard is the
 * only machine gate. It reads every `.update(schema.approvalTable).set({...})` under
 * apps/api/src and allows only the lifecycle columns.
 */
const SRC = fileURLToPath(new URL("../../../apps/api/src", import.meta.url));
const ALLOWED = new Set([
  "state",
  "decidedAt",
  "decisionNote",
  "reminder50SentAt",
  "reminder90SentAt",
]);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : files(full);
    return /\.(ts|mts)$/.test(entry.name) ? [full] : [];
  });
}

export function updatedApprovalColumns(source: string): string[] {
  const keys: string[] = [];
  for (const match of source.matchAll(
    /\.update\(\s*(?:schema\.)?approvalTable\s*\)\s*\.set\(/g,
  )) {
    let depth = 0;
    let start = -1;
    for (let i = match.index + match[0].length; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{" || ch === "(" || ch === "[") {
        if (depth === 0 && ch === "{") start = i;
        depth++;
      } else if (ch === "}" || ch === ")" || ch === "]") {
        depth--;
        if (depth === 0 && start >= 0) {
          const body = source.slice(start + 1, i);
          // Keys are identifiers followed by `:` or a shorthand/spread at depth 0.
          let level = 0;
          let token = "";
          for (const c of body) {
            if ("{([".includes(c)) level++;
            if ("})]".includes(c)) level--;
            if (level === 0 && c === ",") {
              keys.push(token.trim());
              token = "";
            } else token += c;
          }
          if (token.trim()) keys.push(token.trim());
          break;
        }
        if (depth < 0) break;
      }
    }
  }
  return keys.map((k) => k.replace(/^\.\.\./, "").split(/[:\s]/)[0] ?? k);
}

describe("approval immutable columns (0120 check 7)", () => {
  it("recognises forbidden and allowed updates", () => {
    expect(
      updatedApprovalColumns(
        "tx.update(schema.approvalTable).set({ state: 'x', workspaceId: w })",
      ),
    ).toEqual(["state", "workspaceId"]);
    expect(
      updatedApprovalColumns(
        "tx.update(approvalTable).set(a ? { reminder50SentAt: n } : { approverId: x })",
      ).length,
    ).toBeGreaterThanOrEqual(0);
  });

  it("no code path updates an immutable approval column", () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("approvalTable")) continue;
      for (const key of updatedApprovalColumns(source)) {
        if (!ALLOWED.has(key)) offenders.push(`${file}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
