#!/usr/bin/env node
/**
 * The gates the workflows ACTUALLY execute — the third party to the reconciliation.
 *
 * **M2 — "CI matches ci-cd.md" reconciled two sets, not three.** `test-all.mjs` compared
 * `docs/04-engineering/ci-cd.md`'s declared list against its own hand-maintained manifest.
 * Both are documents. Neither is the workflow, so a gate could run in CI while appearing
 * in neither, or appear in both while running as something else. Measured drift at the
 * reviewed head:
 *
 *   pnpm check:overrides      executed by ci-fast.yml, declared nowhere
 *   pnpm check:route-policy   executed by ci-fast.yml, declared nowhere
 *   pnpm test:permissions     in the manifest, while CI runs the stricter wrapper
 *
 * A reconciliation between two documents is a spell-check. This reads the workflows.
 *
 * Deliberately a text scan rather than a YAML parse: the repository has no YAML parser at
 * the root, adding one is a dependency change to a frozen manifest, and `run:` lines are
 * the only thing being extracted. The scan is anchored to `run:` so a gate named in a
 * comment or a job title is not mistaken for one that executes — which matters, because
 * this file's own predecessors were fooled by exactly that class of thing.
 */

import path from "node:path";
import { readText, repoRoot } from "./repo.mjs";

export const WORKFLOW_RELATIVE_PATHS = [
  ".github/workflows/ci-fast.yml",
  ".github/workflows/ci-full.yml",
];

export class WorkflowGatesUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkflowGatesUnavailableError";
  }
}

/**
 * Every `pnpm <script>` invocation reachable from a `run:` step in one workflow.
 *
 * Handles the three shapes in use: `run: pnpm x`, a `run: |` block with several commands,
 * and a command with flags (`pnpm audit --audit-level=high` -> `pnpm audit`).
 */
export function parseWorkflowGates(source, origin) {
  const lines = source.split("\n");
  const gates = new Set();
  let blockIndent = null;

  const record = (command) => {
    const match = /^pnpm\s+(--filter\s+\S+\s+)?([a-z][a-z0-9:-]*)/.exec(
      command.trim(),
    );
    if (match) gates.add(`pnpm ${match[2]}`);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Inside a `run: |` block: every non-blank line at deeper indent is a command.
    if (blockIndent !== null) {
      const indent = line.length - line.trimStart().length;
      if (line.trim() === "") continue;
      if (indent > blockIndent) {
        for (const part of line.split("&&")) record(part);
        continue;
      }
      blockIndent = null;
    }

    const inline = /^(\s*)-?\s*run:\s*(.*)$/.exec(line);
    if (!inline) continue;
    const [, indent, rest] = inline;
    if (rest.trim() === "|" || rest.trim() === ">") {
      blockIndent = indent.length;
      continue;
    }
    for (const part of rest.split("&&")) record(part);
  }

  if (gates.size === 0) {
    throw new WorkflowGatesUnavailableError(
      `${origin} declares no \`run: pnpm …\` step. A workflow that executes no gate is ` +
        "indistinguishable from one whose gates were all deleted, so this is a hard " +
        "failure rather than an empty set.",
    );
  }
  return [...gates].sort();
}

/**
 * The union of gates executed across every workflow that exists.
 *
 * A workflow file that is absent is not an error — `ci-full.yml` may legitimately not
 * exist yet in some branch — but a workflow that exists and runs nothing is.
 *
 * @returns {Promise<{ gates: string[], byWorkflow: Record<string, string[]> }>}
 */
export async function readWorkflowGates() {
  const byWorkflow = {};
  const all = new Set();
  let found = 0;

  for (const relative of WORKFLOW_RELATIVE_PATHS) {
    let source;
    try {
      source = await readText(path.join(repoRoot, relative));
    } catch {
      continue;
    }
    found += 1;
    const gates = parseWorkflowGates(source, relative);
    byWorkflow[relative] = gates;
    for (const gate of gates) all.add(gate);
  }

  if (found === 0) {
    throw new WorkflowGatesUnavailableError(
      "no workflow file was found at " +
        `${WORKFLOW_RELATIVE_PATHS.join(" or ")}. The reconciliation compares ci-cd.md ` +
        "and the local manifest against what CI actually runs; with no workflow to read, " +
        "two documents agreeing with each other proves nothing.",
    );
  }

  return { gates: [...all].sort(), byWorkflow };
}
