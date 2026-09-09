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
 * **A6 — "I do not recognise this condition" was treated as "it runs".** A2 classified
 * occurrences and then `isExecuting()` accepted `executes` OR `conditional`, where
 * `conditional` meant *any* `if:` that was not statically false and not label-gated. So the
 * shape A2 exists to refuse survived in the general case:
 *
 *     if: github.repository == 'definitely/not-this-repo'
 *     run: pnpm check:overrides
 *
 * false on every real run, classified `conditional`, counted as executed. Three forbidden
 * forms were enumerated and everything else was waved through — an allowlist problem solved
 * with a denylist, which is the same mistake as trusting a proxy: it is correct only for the
 * cases someone thought of.
 *
 * So the default is inverted. A condition counts as executing ONLY when it matches an
 * explicitly allowlisted shape that is PROVEN to hold in the required pull-request context,
 * and every allowlisted shape carries the argument for why in `PR_CONTEXT_PROVEN`. Anything
 * else — an unrecognised expression, a disjunction, a comparison against a repository, a ref
 * or an actor — is `unknown-condition`, which does not execute. The class this closes is:
 * *a gate may be present in YAML and still not be guaranteed to participate in the required
 * pull-request execution.*
 *
 * Growing the allowlist is deliberate, reviewable and cheap. Guessing is none of those.
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

/**
 * Occurrence kinds, worst to best.
 *
 * Only `executes` and `prContext` gate a pull request. `unknownCondition` is deliberately
 * NOT one of them: before A6 its equivalent was, and that is precisely the hole.
 */
export const KINDS = {
  never: "never",
  advisory: "advisory",
  labelGated: "label-gated",
  offPullRequest: "off-pull-request",
  unknownCondition: "unknown-condition",
  unprovenPropagation: "unproven-propagation",
  unprovenSchedule: "unproven-schedule",
  unprovenShape: "unproven-shape",
  prContext: "pr-context",
  executes: "executes",
};

/** Which kinds actually gate a pull request. Fail closed: the list is short on purpose. */
export function isExecuting(kind) {
  return kind === KINDS.executes || kind === KINDS.prContext;
}

/**
 * Conditions PROVEN to hold whenever a pull request is being gated.
 *
 * Every entry needs the argument, not just the pattern — the entry IS the proof, and a
 * future reader adding one has to write the same kind of sentence. An entry without a
 * reason is the denylist again, wearing an allowlist's clothes.
 */
export const PR_CONTEXT_PROVEN = [
  {
    pattern: /^github\.event_name\s*==\s*'pull_request'$/,
    why:
      "the required context IS the pull_request run, so on every run that gates a pull " +
      "request this is true by construction. It skips the workflow's `push` runs, which " +
      "gate nothing and are not what the ruleset requires.",
  },
  {
    pattern: /^success\(\)$/,
    why:
      "the implicit default when no `if:` is written at all. Stating it changes nothing " +
      "about whether the step participates.",
  },
  {
    pattern: /^always\(\)$/,
    why: "runs regardless of what came before, which is strictly more participation.",
  },
  {
    pattern: /^!\s*cancelled\(\)$/,
    why:
      "runs unless the run was cancelled, and a cancelled run produces no verdict for " +
      "either side of the gate.",
  },
];

/**
 * **A7 — three obligations, not one.** A6 asked whether a step's CONDITION let it run. That
 * is one third of the question. For a required gate to mean anything, all three must hold:
 *
 *   SCHEDULED   is the containing job guaranteed to participate in the required pull-request
 *               execution?  (job `if` — A6; `needs` — A7b; `strategy`; a job-level `uses:`)
 *   EXECUTED    is the command guaranteed to run?  (step `if` — A6)
 *   PROPAGATED  is failure of that command guaranteed to fail the required check?
 *               (`continue-on-error` — A7a; shell error semantics; exit-code masking)
 *
 * Each of the three is closed by an ALLOWLIST, never by enumerating dangerous forms. A6 was
 * itself a denylist and that is exactly why A7a and A7b existed: `continue-on-error: true`
 * was rejected while `${{ true }}` was not, and `needs:` was not modelled at all.
 *
 * So the keys are allowlisted too. A job key that is not known to be inert and not
 * explicitly handled below makes the occurrence UNPROVEN. The shipped workflows use seven
 * job keys and seven step keys, all covered, so this costs nothing today and closes the
 * open end.
 */

/**
 * Job keys proven not to affect whether a failing gate fails the required check.
 *
 * `services`, `env`, `container`, `permissions`, `concurrency`, `outputs`, `runs-on` and
 * `timeout-minutes` change WHERE or WITH WHAT a job runs, or what it exposes afterwards —
 * none changes whether a non-zero exit becomes a red required check.
 *
 * `defaults` is deliberately NOT here either, but for a weaker reason than it first looked,
 * and the difference is worth writing down because I nearly recorded the stronger one.
 *
 * `defaults.run.shell: 'bash {0}'` drops `-e`. That sounds like it neutralises a gate, and
 * it was investigated as such. It does not, for the shape this repository actually ships:
 * without `-e` a SINGLE-command script still exits with that command's status, so a failing
 * gate still fails the step — measured, `bash -c 'fail'` exits 1 either way. A false green
 * needs the gate to be a NON-final command in a multi-command script as well
 * (`bash -c 'fail; echo after'` exits 0), which is a compound condition and already refused
 * twice over: by the custom-`shell` check below, and by this list.
 *
 * So `defaults` is absent from INERT_JOB_KEYS because nobody has proven it inert — not
 * because it has been shown to be exploitable. It fails closed as an unreasoned key, which
 * is the correct strength of claim.
 */
const INERT_JOB_KEYS = new Set([
  "name",
  "runs-on",
  "timeout-minutes",
  "services",
  "env",
  "container",
  "permissions",
  "concurrency",
  "outputs",
  "steps",
  // A composite action's container is `runs:`, not a job, and `using: composite` declares
  // which action type it is. It says nothing about scheduling or failure propagation — the
  // calling job's context governs both, and that context is carried in when the composite
  // is resolved.
  "using",
  "description",
]);

/** Job keys this scanner reasons about explicitly. Anything outside both sets is unproven. */
const HANDLED_JOB_KEYS = new Set([
  "if",
  "continue-on-error",
  "needs",
  "strategy",
  "uses",
]);

/** Step keys proven not to affect scheduling, execution or failure propagation. */
const INERT_STEP_KEYS = new Set([
  "name",
  "id",
  "run",
  "uses",
  "with",
  "env",
  "working-directory",
  "timeout-minutes",
]);

const HANDLED_STEP_KEYS = new Set(["if", "continue-on-error", "shell"]);

/**
 * Shells whose failure semantics are GitHub's documented default: the script stops on the
 * first failing command and the step fails. A custom template (`bash {0}`, dropping `-e`)
 * is not one of them.
 */
const PROVEN_SHELLS = new Set(["bash", "sh", "pwsh", "powershell", "python"]);

/**
 * **A7a.** `continue-on-error` must be PROVEN FALSE, not merely "not the literal `true`".
 *
 * Absent is the normal case and means normal semantics. An unquoted YAML boolean `false` is
 * the one written form that is proven. Everything else fails closed, and the list of things
 * that means is deliberately not enumerated: `${{ true }}`, `${{ matrix.allow_failure }}`,
 * `${{ github.event_name == 'pull_request' }}`, the quoted string `'false'`, an empty value
 * and `null` are all simply NOT the proven form.
 *
 * The quoted string is called out because it is the tempting one to wave through. This
 * scanner does not evaluate YAML types, so it cannot tell a string `'false'` from the
 * boolean `false` by meaning — only by spelling. Treating the spelling it cannot verify as
 * safe is how A7a happened.
 */
export function continueOnErrorProvenFalse(raw) {
  if (raw === null || raw === undefined) return true; // absent: normal semantics
  const value = String(raw)
    .replace(/\s+#.*$/, "")
    .trim();
  return value === "false";
}

/** Normalise an `if:` expression enough to compare it against the allowlist. */
function normaliseCondition(expression) {
  return expression
    .trim()
    .replace(/^\$\{\{\s*/, "")
    .replace(/\s*\}\}$/, "")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is this whole condition proven to hold in the required pull-request context?
 *
 * An `&&` chain of proven atoms is proven — every conjunct must hold, and each one does.
 * A disjunction is NOT: `||` is exactly how an escape hatch would be smuggled in beside a
 * harmless-looking atom, and nothing in this repository needs one. If something ever does,
 * it gets an allowlist entry and the sentence explaining why.
 */
export function provenInPullRequestContext(expression) {
  const normalised = normaliseCondition(expression);
  if (normalised === "") return false;
  if (/\|\|/.test(normalised)) return false;
  const atoms = normalised.split("&&").map((atom) => atom.trim());
  return atoms.every((atom) =>
    PR_CONTEXT_PROVEN.some((entry) => entry.pattern.test(atom)),
  );
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
  let keyIndent = null;

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
      keyIndent = null;
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
    if (!pair) continue; // a list item, a bare scalar — nothing we read.
    if (indent <= itemIndent) break;
    // A7: record only the step's OWN keys, at its key column. Anything deeper belongs to
    // a sub-mapping — `env:`'s variable names, `with:`'s inputs — and recording those as
    // step keys was harmless while only `if` and `continue-on-error` were read, but it
    // makes an unknown-key check report `GITHUB_TOKEN` as an unreasoned step property.
    // A sub-mapping cannot change scheduling, execution or failure propagation; the key
    // that INTRODUCES it (`env`, `with`) is the one that matters, and that is recorded.
    if (keyIndent === null) keyIndent = indent;
    if (indent > keyIndent) continue;
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
 * **A7d — a gate invocation must be able to propagate a non-zero status.**
 *
 * Gemini's finding, and it needs no YAML at all: `pnpm check:overrides || true` and
 * `pnpm check:overrides || exit 0` leave the command visibly present, run it, and discard
 * its exit code. So does a pipeline without `pipefail`, a `set +e` earlier in the block, an
 * `if` that consumes the status as a condition, a `&` that never awaits it, a `!` that
 * inverts it, and a `$( )` that captures it.
 *
 * Patching `|| true` would be a denylist, and this pull request has already learned that
 * lesson twice — A6 was a denylist of forbidden conditions, which is exactly why A7a and
 * A7b existed. So the SUPPORTED shape is declared instead: a gate must be a simple command,
 * alone or in an `&&` chain, with no shell operator that can consume its status. Every gate
 * line in the shipped workflows is exactly that, so this costs nothing today.
 *
 * Anything else is NOT PROVEN — including shapes nobody has thought of yet. Adding one is a
 * deliberate edit to this grammar with the argument for why the status still propagates.
 */
const SIMPLE_ARGUMENT = `[A-Za-z0-9_@./:=+,~^-]+|'[^']*'|"[^"]*"`;
const SIMPLE_COMMAND = new RegExp(
  String.raw`^[A-Za-z0-9_@./:+-]+(?:\s+(?:${SIMPLE_ARGUMENT}))*$`,
);

/**
 * Can a gate in this logical line fail the step?
 *
 * `&&` is the one operator that is safe: under GitHub's `bash -e` a failure short-circuits
 * the chain and the step fails. `;` is handled by the caller, which splits on it — under
 * errexit a failing command aborts the script rather than continuing.
 */
export function exitStatusPropagates(logicalLine) {
  const parts = logicalLine.split("&&").map((part) => part.trim());
  return parts.every((part) => {
    if (part === "") return false;
    const head = /^([A-Za-z][\w.-]*)/.exec(part)?.[1];
    if (head !== undefined && SHELL_KEYWORDS.has(head)) return false;
    return SIMPLE_COMMAND.test(part);
  });
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

    // A7 · PROPAGATED, third mechanism. Neither A7a nor A7b names this one, and it needs
    // no YAML at all: `pnpm check:overrides || true` leaves the command visibly present,
    // runs it, and throws its exit code away. So does `|| :`, so does a `set +e` earlier
    // in the block, and so does a pipeline without `pipefail`, where the shell reports the
    // LAST element's status. `&&` and `;` are fine: under GitHub's `bash -e` a failure
    // short-circuits or aborts the script either way.
    const disablesErrexit = /(^|\s)set\s+(\+e\b|\+o\s+errexit\b)/m.test(joined);

    for (const logical of joined.split(/\n|;/)) {
      const masksExitCode = !exitStatusPropagates(logical);
      for (const raw of logical.split("&&")) {
        const command = raw.trim().replace(/^[|(]+\s*/, "");
        if (command === "") continue;
        const pnpm = /^pnpm\s+(?:--filter\s+\S+\s+)?([a-z][a-z0-9:-]*)/.exec(
          command,
        );
        if (pnpm) {
          gates.push({
            name: `pnpm ${pnpm[1]}`,
            propagates: !masksExitCode && !disablesErrexit,
            masked: masksExitCode
              ? `its exit status is not proven to propagate: \`${logical.trim().slice(0, 70)}\` ` +
                "is not a simple command or an `&&` chain of them, so a shell operator can " +
                "consume or discard the failure (A7d)"
              : disablesErrexit
                ? "the block disables errexit with `set +e` before it runs"
                : null,
          });
          continue;
        }
        const first = /^([A-Za-z][\w.-]*)/.exec(command);
        if (first && !SHELL_KEYWORDS.has(first[1])) commands.push(first[1]);
      }
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
    // A7: every job key is captured, because the check is now "is this key known to be
    // inert or explicitly reasoned about?" — a question three named variables cannot ask.
    const jobKeys = new Map();
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
      if (!jobKeys.has(pair[1])) jobKeys.set(pair[1], pair[2]);
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
        jobKeys,
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

  // ── PROPAGATED (A7a) ─────────────────────────────────────────────────────────────
  // `continue-on-error` must be PROVEN FALSE. Absent is proven; an unquoted `false` is
  // proven; everything else — an expression, a context or matrix value, the quoted string
  // `'false'`, an empty value — is not, and is refused without enumerating the forms.
  for (const [level, flag] of [
    ["job", step.jobContinue],
    ["step", step.stepContinue],
  ]) {
    if (flag === null || flag === undefined) continue;
    if (continueOnErrorProvenFalse(flag)) continue;
    const literalTrue = /^true$/i.test(String(flag).trim());
    return {
      kind: literalTrue ? KINDS.advisory : KINDS.unprovenPropagation,
      reason: literalTrue
        ? `${level} \`continue-on-error: true\` — it runs but cannot fail the build`
        : `${level} \`continue-on-error: ${String(flag).trim()}\` is not PROVEN FALSE. Only ` +
          "an absent property or an unquoted `false` is. An expression, a matrix or " +
          "context value, or a quoted string can evaluate truthy on the very run that " +
          "gates the pull request, and then the command is present, runs, fails — and the " +
          "required check still goes green",
    };
  }

  // ── SCHEDULED (A7b and its siblings) ──────────────────────────────────────────────
  // A gate-bearing job must be reachable on its own. `needs` is refused by PRESENCE, in
  // whatever shape it is written: a scalar id, a flow list, a block list. A prerequisite
  // that is skipped or fails takes this job with it, and modelling the dependency graph
  // properly is a decision to take deliberately, not to guess at here.
  if (step.jobKeys?.has("needs")) {
    return {
      kind: KINDS.unprovenSchedule,
      reason:
        `job declares \`needs\` (${String(step.jobKeys.get("needs")).trim() || "block list"}), ` +
        "so whether it participates in the required pull-request execution depends on " +
        "prerequisite state this scanner does not model. That is the whole finding, and it " +
        "is deliberately narrower than any claim about what branch protection then does " +
        "with the result: NOT PROVEN is sufficient to refuse. A job carrying a required " +
        "gate stands alone until a reviewed proof model for the dependency graph exists",
    };
  }
  if (step.jobKeys?.has("strategy")) {
    return {
      kind: KINDS.unprovenSchedule,
      reason:
        "job declares `strategy`, so how many jobs exist — possibly none — is computed " +
        "rather than written. A matrix that produces no combinations produces no run of " +
        "this gate",
    };
  }
  if (step.jobKeys?.has("uses")) {
    return {
      kind: KINDS.unprovenSchedule,
      reason:
        "job calls a reusable workflow with `uses`, so what it actually executes lives in " +
        "another document this scan has not read",
    };
  }

  // ── SHAPE: anything not known to be inert and not reasoned about above ────────────
  for (const key of step.jobKeys?.keys() ?? []) {
    if (INERT_JOB_KEYS.has(key) || HANDLED_JOB_KEYS.has(key)) continue;
    return {
      kind: KINDS.unprovenShape,
      reason:
        `job declares \`${key}\`, which this scanner has not reasoned about. Unknown is ` +
        "NOT PROVEN: `defaults.run.shell` can replace the shell with one that does not " +
        "stop on error, and a key added to GitHub Actions next month can do something " +
        "else again. Add it to INERT_JOB_KEYS with the argument for why it cannot affect " +
        "scheduling, execution or failure propagation, or handle it",
    };
  }
  for (const key of Object.keys(step.keys ?? {})) {
    if (INERT_STEP_KEYS.has(key) || HANDLED_STEP_KEYS.has(key)) continue;
    return {
      kind: KINDS.unprovenShape,
      reason: `step declares \`${key}\`, which this scanner has not reasoned about`,
    };
  }
  const shell = step.keys?.shell;
  if (typeof shell === "string" && shell.trim() !== "") {
    const name = shell.trim().split(/\s+/)[0];
    if (!PROVEN_SHELLS.has(name) || shell.trim() !== name) {
      return {
        kind: KINDS.unprovenPropagation,
        reason:
          `step sets \`shell: ${shell.trim()}\`. GitHub's documented shells stop on the ` +
          "first failing command; a custom template such as `bash {0}` drops `-e`, and " +
          "then a failing gate leaves a passing step",
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

  // A6: the default is NOT "unknown means it runs". A condition counts only when every
  // part of it is on the proven list, and the first one that is not is named.
  const unproven = conditions.filter(
    ([, expression]) => !provenInPullRequestContext(expression),
  );
  if (unproven.length > 0) {
    const [level, expression] = unproven[0];
    return {
      kind: KINDS.unknownCondition,
      reason:
        `${level} \`if: ${expression.trim()}\` is not a condition this scanner can PROVE ` +
        "holds in the required pull-request context, so it does not count as execution. " +
        "A gate can be present in YAML and still never participate — " +
        "`github.repository == '…'`, a ref or actor comparison, or a disjunction hiding " +
        "an escape hatch all read as ordinary conditions. If this one genuinely always " +
        "holds on a pull request, add it to PR_CONTEXT_PROVEN in " +
        "scripts/ci/lib/workflow-gates.mjs with the argument for why",
    };
  }

  if (conditions.length > 0) {
    const [level, expression] = conditions[0];
    return {
      kind: KINDS.prContext,
      reason: `${level} \`if: ${expression.trim()}\` — proven to hold on a pull request`,
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

      for (const gate of step.observations.gates) {
        record(
          gate.name,
          gate.propagates
            ? entry
            : {
                kind: KINDS.unprovenPropagation,
                reason: `${gate.masked}, so the command runs and the required check stays green`,
                where: entry.where,
              },
        );
      }
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
