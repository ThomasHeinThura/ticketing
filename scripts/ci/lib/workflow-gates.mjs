#!/usr/bin/env node
/**
 * The gates the workflows ACTUALLY execute — the third party to the reconciliation.
 *
 * **M2 — "CI matches ci-cd.md" reconciled two sets, not three.** `test-all.mjs` compared
 * `docs/04-engineering/ci-cd.md`'s declared list against its own hand-maintained manifest.
 * Both are documents. Neither is the workflow, so a gate could run in CI while appearing
 * in neither, or appear in both while running as something else. A reconciliation between
 * two documents is a spell-check. This reads the workflows.
 *
 * **A2 — reading the workflows was not yet enough, in three ways.**
 *
 * 1. *One direction only.* The reconciliation walked workflow -> documents and asked "is
 *    this executed gate declared?". It never walked documents -> workflow and asked "is
 *    this declared, enabled gate executed?". So deleting a step from `ci-fast.yml` while
 *    leaving the manifest saying `enabled` and ci-cd.md saying it is a gate produced two
 *    documents in perfect agreement and a gate that had silently stopped running. The
 *    reverse walk lives in `test-all.mjs`; what this file owes it is the truth about what
 *    executes, which is the next two points.
 *
 * 2. *A step's shape was ignored.* Any `run:` line counted as execution. A step under
 *    `if: false`, a step with `continue-on-error: true`, a job gated on a label, or a
 *    workflow that does not trigger on `pull_request` at all, all counted exactly the same
 *    as a step that runs and can fail the build. `ci-full.yml` already carries four jobs
 *    disabled with `if: false` — today they run `exit 1` and name no gate, so nothing was
 *    actually miscounted, but the shape was one edit away from claiming `pnpm test:visual`
 *    executes. GitHub treats a SKIPPED required check as satisfied; that is the trap
 *    ci-full.yml's own header warns about and F5 removed from the integration job. A gate
 *    that cannot fail a pull request is not a gate, so occurrences are classified rather
 *    than counted.
 *
 * 3. *The file list was hardcoded, and composite actions were invisible.* Two paths were
 *    named in an array and any other workflow file was unreadable by construction — the
 *    same defect as `check-skips`'s hardcoded `roots` (M3) and `check-overrides`'s
 *    hardcoded workspace list (A5). Worse, `uses: ./.github/actions/setup` was never
 *    followed, and `pnpm install --frozen-lockfile` — a manifest gate — lives inside it.
 *    The directory is enumerated now, and local composite actions are resolved in the
 *    calling job's context.
 *
 * Still deliberately not a YAML dependency: the repository has no YAML parser at the root
 * and adding one is a dependency change to a frozen manifest. It is no longer a flat text
 * scan either. This walks structure by indentation, attributes every step to its job, and
 * **fails closed** on any shape it cannot attribute — an anchor, an alias, a flow-style
 * mapping, a tab, a step it cannot place. "I could not read it" must never arrive as
 * "there was nothing there", which is the whole lesson of this file's predecessors.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { readText, repoRoot } from "./repo.mjs";

export const WORKFLOWS_RELATIVE_DIR = ".github/workflows";

/** Occurrence kinds, worst to best. `executes` is the only one that gates a pull request. */
export const KINDS = {
  never: "never",
  advisory: "advisory",
  labelGated: "label-gated",
  offPullRequest: "off-pull-request",
  conditional: "conditional",
  executes: "executes",
};

/** Which kinds actually gate a pull request. */
export function isExecuting(kind) {
  return kind === KINDS.executes || kind === KINDS.conditional;
}

export class WorkflowGatesUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkflowGatesUnavailableError";
  }
}

const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => line.trim() === "" || /^\s*#/.test(line);

/**
 * Shapes this scanner refuses rather than guesses at.
 *
 * An anchor or alias means a step's real content is somewhere else in the file; a flow-style
 * `steps: [...]` puts it on one line; a tab makes every indentation comparison here wrong.
 * Each of them is rare in a GitHub workflow and each of them would let a step hide from an
 * indentation walk, so each of them is a hard failure.
 */
function refuseUnsupported(source, origin) {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isBlank(line)) continue;
    if (/^\s*\t|^\t/.test(line)) {
      throw new WorkflowGatesUnavailableError(
        `${origin}:${i + 1} indents with a TAB. This scanner attributes steps to jobs by ` +
          "indentation, and a tab makes every one of those comparisons meaningless. YAML " +
          "forbids tabs in indentation; fix the file rather than trusting a scan of it.",
      );
    }
    if (/(^|\s)[&*][A-Za-z0-9_-]+/.test(line.replace(/#.*$/, ""))) {
      throw new WorkflowGatesUnavailableError(
        `${origin}:${i + 1} uses a YAML anchor or alias (${line.trim()}). The step's real ` +
          "content then lives somewhere else in the document, where an indentation walk " +
          "cannot see it, so a gate could be defined in an anchor and never counted. " +
          "Write the steps out, or teach this scanner anchors deliberately.",
      );
    }
    if (/^\s*(jobs|steps):\s*[[{]/.test(line)) {
      throw new WorkflowGatesUnavailableError(
        `${origin}:${i + 1} declares ${line.trim().split(":")[0]} in flow style. Every ` +
          "step would then sit on one line, which this scanner does not read. Use block " +
          "style.",
      );
    }
  }
}

/** `if: false` and the handful of spellings that mean the same thing. */
function isStaticallyFalse(expression) {
  const trimmed = expression
    .trim()
    .replace(/^\$\{\{\s*/, "")
    .replace(/\s*\}\}$/, "")
    .trim();
  return /^(false|'false'|"false"|0)$/i.test(trimmed);
}

/** An `if:` whose truth depends on a pull-request LABEL. */
function isLabelGated(expression) {
  return /labels/.test(expression);
}

/**
 * One `steps:` sequence, as a list of `{ keys, line }`.
 *
 * Indentation-relative rather than absolute, because a workflow job's steps sit at a
 * different depth from a composite action's and both must parse. The sequence's own indent
 * is taken from its first `- ` item; the block ends at the first non-blank line shallower
 * than that, or at a sibling key of `steps:` itself.
 */
function parseStepSequence(lines, stepsLine, stepsIndent, origin) {
  const steps = [];
  let itemIndent = null;
  let current = null;
  let blockKey = null;
  let blockIndent = null;

  for (let i = stepsLine + 1; i < lines.length; i += 1) {
    const line = lines[i];

    // A `run: |` block: every deeper line belongs to the command, including a shell `if`,
    // which must never be mistaken for a YAML step `if:`.
    if (blockKey !== null) {
      if (isBlank(line)) {
        current.keys[blockKey] += "\n";
        continue;
      }
      if (indentOf(line) > blockIndent) {
        current.keys[blockKey] += `${line.trim()}\n`;
        continue;
      }
      blockKey = null;
      blockIndent = null;
    }

    if (isBlank(line)) continue;
    const indent = indentOf(line);

    if (indent <= stepsIndent) break;

    const item = /^(\s*)-\s*(.*)$/.exec(line);
    if (item && (itemIndent === null || item[1].length === itemIndent)) {
      if (itemIndent === null) itemIndent = item[1].length;
      current = { keys: {}, line: i + 1 };
      steps.push(current);
      const rest = item[2];
      if (rest !== "") {
        const pair = /^([A-Za-z][\w.-]*):\s*(.*)$/.exec(rest);
        if (!pair) {
          throw new WorkflowGatesUnavailableError(
            `${origin}:${i + 1} starts a step with "${rest}", which is not a \`key: value\` ` +
              "pair. This scanner reads steps as mappings; a step it cannot read is a step " +
              "whose commands it cannot see.",
          );
        }
        current.keys[pair[1]] = pair[2];
        if (pair[2].trim() === "|" || pair[2].trim() === ">") {
          current.keys[pair[1]] = "";
          blockKey = pair[1];
          blockIndent = item[1].length + 2;
        }
      }
      continue;
    }

    if (current === null) {
      throw new WorkflowGatesUnavailableError(
        `${origin}:${i + 1} sits under \`steps:\` but before any \`- \` item, so this ` +
          "scanner cannot attribute it to a step. Refusing to guess: an unattributed line " +
          "could be a gate.",
      );
    }

    const pair = /^([A-Za-z][\w.-]*):\s*(.*)$/.exec(line.trim());
    if (!pair) continue; // a `with:` sub-mapping value, a list item — nothing we read.
    if (indent <= itemIndent) break;
    current.keys[pair[1]] = pair[2];
    if (pair[2].trim() === "|" || pair[2].trim() === ">") {
      current.keys[pair[1]] = "";
      blockKey = pair[1];
      blockIndent = indent;
    }
  }

  return steps;
}

/** The `on:` triggers a workflow declares. A composite action has none. */
function parseTriggers(lines) {
  const triggers = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^on:\s*(.*)$/.test(line)) continue;
    const inline = /^on:\s*(\S.*)$/.exec(line);
    if (inline) {
      for (const name of inline[1].replace(/[[\]]/g, "").split(","))
        if (name.trim()) triggers.add(name.trim());
      continue;
    }
    for (let j = i + 1; j < lines.length; j += 1) {
      if (isBlank(lines[j])) continue;
      const indent = indentOf(lines[j]);
      if (indent === 0) break;
      const key = /^\s*-?\s*([A-Za-z][\w_]*):?\s*/.exec(lines[j]);
      if (key && indent === 2) triggers.add(key[1]);
    }
  }
  return [...triggers];
}

/**
 * Shell grammar, not gates. Recording `if`/`then`/`fi` as executed commands made the
 * observation set unreadable and would let a gate NAMED after a shell keyword match
 * something that is not it.
 */
const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "exit",
  "echo",
  "cd",
  "set",
  "export",
  "true",
  "false",
]);

/** Everything a step observably invokes. */
function observationsOf(step) {
  const gates = [];
  const commands = [];
  const uses = [];

  if (typeof step.keys.uses === "string" && step.keys.uses.trim() !== "") {
    const reference = step.keys.uses.trim().replace(/\s+#.*$/, "");
    uses.push(reference);
    // Also without the pin, so a gate can be looked up by the action that provides it
    // rather than by the SHA it happens to be pinned to this week.
    const unpinned = reference.split("@")[0];
    if (unpinned !== reference) uses.push(unpinned);
  }

  const run = step.keys.run;
  if (typeof run === "string" && run.trim() !== "") {
    // `&&`, `;` and newlines all separate commands; a trailing `\` continues one.
    const joined = run.replace(/\\\n/g, " ").replace(/\\$/gm, " ");
    for (const raw of joined.split(/\n|&&|;/)) {
      const command = raw.trim().replace(/^[|(]+\s*/, "");
      if (command === "") continue;
      const pnpm = /^pnpm\s+(?:--filter\s+\S+\s+)?([a-z][a-z0-9:-]*)/.exec(
        command,
      );
      if (pnpm) {
        gates.push(`pnpm ${pnpm[1]}`);
        continue;
      }
      const first = /^([A-Za-z][\w.-]*)/.exec(command);
      if (first && !SHELL_KEYWORDS.has(first[1])) commands.push(first[1]);
    }
  }

  return { gates, commands, uses };
}

/**
 * Every step in one workflow or composite-action file, attributed to its job and classified.
 *
 * @returns {{ triggers: string[], steps: Array<object> }}
 */
export function parseWorkflowFile(source, origin) {
  refuseUnsupported(source, origin);
  const lines = source.split("\n");
  const triggers = parseTriggers(lines);
  const collected = [];

  for (let i = 0; i < lines.length; i += 1) {
    const stepsKey = /^(\s*)steps:\s*$/.exec(lines[i]);
    if (!stepsKey) continue;
    const stepsIndent = stepsKey[1].length;

    // The job this `steps:` belongs to: the nearest shallower bare `key:` above it. For a
    // composite action that is `runs:`, which is not a job — recorded as such rather than
    // pretended to be one.
    let job = null;
    let jobIndent = null;
    let jobLine = null;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (isBlank(lines[j])) continue;
      const indent = indentOf(lines[j]);
      if (indent >= stepsIndent) continue;
      const key = /^\s*([A-Za-z][\w.-]*):\s*$/.exec(lines[j]);
      if (!key) continue;
      job = key[1];
      jobIndent = indent;
      jobLine = j;
      break;
    }
    if (job === null) {
      throw new WorkflowGatesUnavailableError(
        `${origin}:${i + 1} has a \`steps:\` sequence this scanner cannot attribute to a ` +
          "job. Refusing to guess which job's conditions apply to it: the wrong answer " +
          "either invents a gate or hides one.",
      );
    }

    // Job-level conditions, read across the WHOLE job block rather than only above
    // `steps:`, because a YAML mapping is unordered and `if:` may legally follow it.
    let jobIf = null;
    let jobContinue = null;
    let jobName = null;
    for (let j = jobLine + 1; j < lines.length; j += 1) {
      if (isBlank(lines[j])) continue;
      const indent = indentOf(lines[j]);
      if (indent <= jobIndent) break;
      if (indent !== stepsIndent) continue;
      const pair = /^\s*([A-Za-z][\w.-]*):\s*(.*)$/.exec(lines[j]);
      if (!pair) continue;
      if (pair[1] === "if") jobIf = pair[2];
      if (pair[1] === "continue-on-error") jobContinue = pair[2];
      if (pair[1] === "name") jobName = pair[2];
    }

    for (const step of parseStepSequence(lines, i, stepsIndent, origin)) {
      collected.push({
        job,
        jobName: jobName ?? (job === "runs" ? path.basename(origin) : job),
        jobIf,
        jobContinue,
        stepIf: step.keys.if ?? null,
        stepContinue: step.keys["continue-on-error"] ?? null,
        stepName: step.keys.name ?? null,
        line: step.line,
        origin,
        observations: observationsOf(step),
        keys: step.keys,
      });
    }
  }

  return { triggers, steps: collected };
}

/**
 * Classify one step in the context of the workflow that reaches it.
 *
 * Order matters: the reasons a step cannot gate a pull request are checked before the
 * reasons it merely might not run.
 */
function classify(step, triggers) {
  const conditions = [
    ["job", step.jobIf],
    ["step", step.stepIf],
  ].filter(([, expression]) => typeof expression === "string");

  for (const [level, expression] of conditions) {
    if (isStaticallyFalse(expression)) {
      return {
        kind: KINDS.never,
        reason: `${level} \`if: ${expression.trim()}\` — it never runs`,
      };
    }
  }

  for (const [level, flag] of [
    ["job", step.jobContinue],
    ["step", step.stepContinue],
  ]) {
    if (typeof flag === "string" && /^true$/i.test(flag.trim())) {
      return {
        kind: KINDS.advisory,
        reason: `${level} \`continue-on-error: true\` — it runs but cannot fail the build`,
      };
    }
  }

  for (const [level, expression] of conditions) {
    if (isLabelGated(expression)) {
      return {
        kind: KINDS.labelGated,
        reason:
          `${level} \`if: ${expression.trim()}\` gates on a pull-request LABEL. GitHub ` +
          "treats a skipped required check as satisfied, so a label-gated gate is green " +
          "on exactly the pull requests where it did not run (ci-full.yml's header, F5)",
      };
    }
  }

  if (triggers !== null && !triggers.includes("pull_request")) {
    return {
      kind: KINDS.offPullRequest,
      reason: `the workflow triggers on ${triggers.join(", ") || "nothing"} — not on \`pull_request\``,
    };
  }

  if (conditions.length > 0) {
    const [level, expression] = conditions[0];
    return {
      kind: KINDS.conditional,
      reason: `${level} \`if: ${expression.trim()}\``,
    };
  }

  return { kind: KINDS.executes, reason: "runs unconditionally" };
}

/** Where an occurrence came from, for a message a reader can act on. */
function where(step, relative) {
  return (
    `${relative}:${step.line} (job "${step.jobName}"` +
    `${step.stepName ? `, step "${step.stepName}"` : ""})`
  );
}

async function workflowFiles() {
  const directory = path.join(repoRoot, WORKFLOWS_RELATIVE_DIR);
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new WorkflowGatesUnavailableError(
        `${WORKFLOWS_RELATIVE_DIR} could not be listed (${error.code}). "I could not read ` +
          'the workflows" must not arrive as "the workflows run nothing".',
      );
    }
    throw new WorkflowGatesUnavailableError(
      `there is no ${WORKFLOWS_RELATIVE_DIR} directory. The reconciliation compares ` +
        "ci-cd.md and the local manifest against what CI actually runs; with no workflow " +
        "to read, two documents agreeing with each other proves nothing.",
    );
  }
  return entries
    .filter((entry) => /\.ya?ml$/.test(entry))
    .sort()
    .map((entry) => `${WORKFLOWS_RELATIVE_DIR}/${entry}`);
}

/**
 * What every workflow in the repository executes, classified.
 *
 * @returns {Promise<{
 *   files: string[],
 *   gates: string[],
 *   executed: string[],
 *   occurrences: Map<string, Array<{ kind: string, reason: string, where: string }>>,
 * }>}
 */
export async function readWorkflowGates() {
  const files = await workflowFiles();
  if (files.length === 0) {
    throw new WorkflowGatesUnavailableError(
      `${WORKFLOWS_RELATIVE_DIR} contains no .yml or .yaml file. A workflow directory ` +
        "with no workflows in it is indistinguishable from one whose gates were all " +
        "deleted, so this is a hard failure rather than an empty set.",
    );
  }

  const occurrences = new Map();
  const read = [];

  const record = (name, entry) => {
    if (!occurrences.has(name)) occurrences.set(name, []);
    occurrences.get(name).push(entry);
  };

  const ingest = async (relative, triggers, visited) => {
    if (visited.has(relative)) return;
    visited.add(relative);
    read.push(relative);

    let source;
    try {
      source = await readText(path.join(repoRoot, relative));
    } catch (error) {
      throw new WorkflowGatesUnavailableError(
        `${relative} is listed in ${WORKFLOWS_RELATIVE_DIR} (or referenced by a \`uses: ` +
          `./…\`) but could not be read (${error.code ?? error.message}). A gate that ` +
          "cannot be read is not a gate that is absent.",
      );
    }

    const parsed = parseWorkflowFile(source, relative);
    const effective = triggers ?? parsed.triggers;
    if (parsed.steps.length === 0) {
      throw new WorkflowGatesUnavailableError(
        `${relative} declares no steps at all. A workflow that executes nothing is ` +
          "indistinguishable from one whose steps were all deleted, so this is a hard " +
          "failure rather than an empty set.",
      );
    }

    for (const step of parsed.steps) {
      const { kind, reason } = classify(step, effective);
      const entry = { kind, reason, where: where(step, relative) };

      for (const gate of step.observations.gates) record(gate, entry);
      for (const command of step.observations.commands) record(command, entry);
      for (const uses of step.observations.uses) {
        record(`uses:${uses}`, entry);
        // A2: follow LOCAL composite actions. `pnpm install --frozen-lockfile` — a
        // manifest gate — lives in .github/actions/setup, and a scanner that reads only
        // .github/workflows cannot see it. The calling job's trigger context carries in.
        if (uses.startsWith("./")) {
          const base = uses.replace(/^\.\//, "").replace(/\/$/, "");
          const candidates = /\.ya?ml$/.test(base)
            ? [base]
            : [`${base}/action.yml`, `${base}/action.yaml`];
          let resolved = null;
          for (const candidate of candidates) {
            try {
              await readText(path.join(repoRoot, candidate));
              resolved = candidate;
              break;
            } catch {
              /* try the next spelling */
            }
          }
          if (resolved === null) {
            // Fail closed. A step referencing a local action that is not there would
            // break the real run, and treating it as "nothing to see" is precisely the
            // fail-open shape the rest of this file exists to refuse.
            throw new WorkflowGatesUnavailableError(
              `${where(step, relative)} uses the local action "${uses}" and none of ` +
                `${candidates.join(", ")} could be read. Whatever commands that action ` +
                "runs are gates this scan cannot see, so it is a hard failure rather " +
                "than an empty set.",
            );
          }
          await ingest(resolved, effective, visited);
        }
      }
    }
  };

  for (const relative of files) {
    await ingest(relative, null, new Set());
  }

  const gates = [...occurrences.keys()].filter((name) =>
    name.startsWith("pnpm "),
  );
  const executed = gates.filter((name) =>
    occurrences.get(name).some((entry) => isExecuting(entry.kind)),
  );

  return {
    files: [...new Set(read)].sort(),
    gates: gates.sort(),
    executed: executed.sort(),
    occurrences,
  };
}
