import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 0120 review check 7 / N-2: after insert nothing may update workspace_id, work_item_id,
 * transition_id, kind, requested_by or approver_id of an approval. `workspace_id` and
 * `work_item_id` are mutable as a pair at the database level, so this static guard is the
 * only machine gate. It reads every `.update(...approvalTable...).set(<arg>)` under
 * apps/api/src, collects the keys of EVERY object literal in the argument (including both
 * branches of a conditional), refuses a non-literal argument it cannot read, and refuses an
 * aliased import of the table, so the check cannot be sidestepped by indirection.
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

/** The text between the parenthesis opened at `open` and its match. */
function balanced(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let level = 0;
  let token = "";
  const flush = () => {
    const key = token
      .trim()
      .replace(/^\.\.\./, "")
      .split(/[:\s(]/)[0];
    if (key) keys.push(key);
    token = "";
  };
  for (const c of body) {
    if ("{([".includes(c)) level++;
    if ("})]".includes(c)) level--;
    if (level === 0 && c === ",") flush();
    else token += c;
  }
  flush();
  return keys;
}

export function updatedApprovalColumns(source: string): string[] {
  const keys: string[] = [];
  const update = /\.update\(\s*([^()]*approvalTable[^()]*)\)\s*\.set\(/g;
  for (const match of source.matchAll(update)) {
    const argument = balanced(source, match.index + match[0].length - 1);
    let literal = false;
    for (let i = 0; i < argument.length; i++) {
      if (argument[i] !== "{") continue;
      literal = true;
      keys.push(...topLevelKeys(balanced(argument, i)));
    }
    if (!literal) keys.push("<non-literal set argument>");
  }
  if (/approvalTable\s+as\s+\w+/.test(source))
    keys.push("<aliased approvalTable>");
  return keys;
}

describe("approval immutable columns (0120 check 7)", () => {
  it("reads every object literal of a conditional set()", () => {
    expect(
      updatedApprovalColumns(
        "tx.update(approvalTable).set(a ? { reminder50SentAt: n } : { approverId: x })",
      ),
    ).toEqual(["reminder50SentAt", "approverId"]);
  });

  it("flags forbidden keys, shorthand keys, spreads and non-literal arguments", () => {
    expect(
      updatedApprovalColumns(
        "tx.update(schema.approvalTable).set({ state: 'x', workspaceId: w })",
      ),
    ).toEqual(["state", "workspaceId"]);
    expect(
      updatedApprovalColumns("tx.update(schema.approvalTable).set({ kind })"),
    ).toEqual(["kind"]);
    expect(
      updatedApprovalColumns(
        "tx.update(schema.approvalTable).set({ ...patch, state })",
      ),
    ).toEqual(["patch", "state"]);
    expect(
      updatedApprovalColumns("tx.update(schema.approvalTable).set(values)"),
    ).toEqual(["<non-literal set argument>"]);
    expect(
      updatedApprovalColumns("import { approvalTable as a } from './x'"),
    ).toEqual(["<aliased approvalTable>"]);
  });

  it("ignores updates of other tables", () => {
    expect(
      updatedApprovalColumns(
        "tx.update(schema.workItemTable).set({ stateId: s })",
      ),
    ).toEqual([]);
  });

  it("no code path updates an immutable approval column", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("approvalTable")) continue;
      scanned++;
      for (const key of updatedApprovalColumns(source)) {
        if (!ALLOWED.has(key)) offenders.push(`${file}: ${key}`);
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
