#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: a diagnostic message quotes GitHub's `${{ … }}` expression syntax back to the reader; it is prose, not a template
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
  // A8 invariant 3: `runs-on` was in INERT_JOB_KEYS, and it is not inert. The runner
  // decides the DEFAULT SHELL, and the default shell decides whether a failing command
  // fails the step. `runs-on: windows-latest` with no explicit shell runs PowerShell,
  // where a native command's non-zero exit does not by itself fail the step.
  "runs-on",
]);

/**
 * Runners whose default shell is PROVEN, and why.
 *
 * GitHub's hosted Linux and macOS images run `run:` steps through `bash -e {0}` unless a
 * step says otherwise, so a failing command fails the step. That is the property being
 * relied on, and it is a property of the IMAGE, not of the workflow — which is why the
 * image has to be named rather than assumed.
 *
 * Windows is deliberately absent: its default is PowerShell, where a failing NATIVE
 * command sets `$LASTEXITCODE` without terminating the script, so a gate can fail and the
 * step still succeed. A self-hosted label says nothing about the image at all, and a
 * `${{ … }}` expression says nothing until the run happens. All three are NOT PROVEN here
 * and must instead declare an explicit proven shell on the step.
 */
const PROVEN_RUNNER_DEFAULT_SHELL = new Set([
  "ubuntu-latest",
  "ubuntu-24.04",
  "ubuntu-22.04",
  "ubuntu-20.04",
  "macos-latest",
  "macos-15",
  "macos-14",
  "macos-13",
]);

/** Is this `runs-on` value a single named runner whose default shell is proven? */
export function runnerDefaultShellProven(raw) {
  if (typeof raw !== "string") return false;
  const value = raw.replace(/\s+#.*$/, "").trim();
  if (value === "") return false;
  // A matrix expression, a group/label mapping or a list is not a single named image.
  if (/[$[\]{}]/.test(value)) return false;
  return PROVEN_RUNNER_DEFAULT_SHELL.has(value);
}

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
const PROVEN_SHELLS = new Set(["bash", "sh"]);

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
/**
 * **A8 invariant 5 — "cannot parse" must never become "nothing exists".**
 *
 * The old reader accepted exactly two block indicators, `|` and `>`, and treated every
 * other scalar form as an inline value. So `run: |-` stored the literal string `"|-"`, the
 * commands underneath it were never read, and a gate moved into one simply vanished — a
 * silent discard, which is F7 and the worst possible failure mode for a gate scanner.
 *
 * Now every `run:` scalar form is classified. `|` is deliberately implemented, because the
 * shipped workflows use it and its lines must still be READ so a gate hidden there is seen
 * (and then refused as non-atomic). Every other multiline indicator — `|-`, `|+`, `|2`,
 * `>`, `>-`, `>+`, `|8` and anything else — is a HARD FAILURE rather than a guess.
 *
 * Scoped to `run:` on purpose: `options: >-` on a service container is ordinary and
 * harmless, and refusing it would be a gate failing over something that cannot hide a
 * command.
 */
function classifyScalar(key, value, origin, lineNumber) {
  const trimmed = value.trim();
  const indicator = /^([|>])([+-]?)(\d*)([+-]?)\s*$/.exec(trimmed);
  if (!indicator) {
    // A plain inline scalar. `run: pnpm x` — the only shape an atomic gate can have.
    return { kind: "plain", value };
  }
  const [, style, chompA, digits, chompB] = indicator;
  if (style === "|" && chompA === "" && digits === "" && chompB === "") {
    return { kind: "literal-block", value: "" };
  }
  if (key !== "run") {
    // Not a command carrier; read it as a block we ignore the shape of.
    return { kind: "literal-block", value: "" };
  }
  throw new WorkflowGatesUnavailableError(
    `${origin}:${lineNumber} writes \`run: ${trimmed}\`, a block scalar form this scanner ` +
      "does not deliberately implement. It is refused rather than read as the literal " +
      `string "${trimmed}": the previous reader did exactly that, and every command ` +
      "underneath such a step became invisible to the gate scan (F7). Implement the form " +
      "here with a written argument for how its content is extracted, or write the step as " +
      "a single-line `run:` — which is what an atomic gate invocation needs anyway.",
  );
}

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

    if (indent <= stepsIndent) {
      // A8 invariant 5 / F7: YAML permits a sequence flush with its key —
      //     steps:
      //     - name: ...
      // which is valid and which this indentation walk cannot attribute, because it looks
      // exactly like the end of the block. The old reader broke here and returned ZERO
      // steps for a job full of them: a silent discard, not an error.
      if (
        /^\s*-\s/.test(line) &&
        indent === stepsIndent &&
        steps.length === 0
      ) {
        throw new WorkflowGatesUnavailableError(
          `${origin}:${i + 1} writes the \`steps:\` sequence FLUSH with its key (\`- \` at ` +
            "the same indentation). That is valid YAML and this scanner reads steps by " +
            "indentation, so it cannot tell the first item from the end of the block — and " +
            "the previous reader silently returned no steps at all for such a job, which " +
            "made every gate in it invisible. Indent the sequence under `steps:`, or teach " +
            "this reader the flush form deliberately.",
        );
      }
      break;
    }

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
        const scalar = classifyScalar(pair[1], pair[2], origin, i + 1);
        current.keys[pair[1]] = scalar.value;
        if (pair[1] === "run") current.plainRun = scalar.kind === "plain";
        if (scalar.kind === "literal-block") {
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
    if (!pair) {
      // A8 invariant 5: a plain scalar may continue on following, more-indented lines —
      //     run: pnpm check:overrides
      //       --some-flag
      // YAML folds that into one value; the old reader kept only the first line and
      // discarded the rest, so a gate's real arguments were invisible. Refused rather
      // than half-read.
      if (
        current !== null &&
        current.plainRun === true &&
        keyIndent !== null &&
        indent > keyIndent
      ) {
        throw new WorkflowGatesUnavailableError(
          `${origin}:${i + 1} continues a plain \`run:\` scalar onto another line. YAML ` +
            "folds those into a single value; this scanner read only the first line and " +
            "silently dropped the rest. Write the command on one line — an atomic gate " +
            "invocation is one command anyway — or implement folding here deliberately.",
        );
      }
      continue;
    }
    if (indent <= itemIndent) break;
    // A7: record only the step's OWN keys, at its key column. Anything deeper belongs to
    // a sub-mapping — `env:`'s variable names, `with:`'s inputs — and recording those as
    // step keys was harmless while only `if` and `continue-on-error` were read, but it
    // makes an unknown-key check report `GITHUB_TOKEN` as an unreasoned step property.
    // A sub-mapping cannot change scheduling, execution or failure propagation; the key
    // that INTRODUCES it (`env`, `with`) is the one that matters, and that is recorded.
    if (keyIndent === null) keyIndent = indent;
    if (indent > keyIndent) continue;
    const scalar = classifyScalar(pair[1], pair[2], origin, i + 1);
    current.keys[pair[1]] = scalar.value;
    if (pair[1] === "run") current.plainRun = scalar.kind === "plain";
    if (scalar.kind === "literal-block") {
      blockKey = pair[1];
      blockIndent = indent;
    }
  }

  return steps;
}

/**
 * **A8 invariant 7 — the default `pull_request` types, and why the list matters.**
 *
 * With no `types:`, GitHub runs a `pull_request` workflow on `opened`, `synchronize` and
 * `reopened` — every context in which a pull request gains or changes code. Narrowing the
 * list removes contexts, and a stage that is required in a context its workflow does not
 * run in is a stage that is not enforced there.
 */
export const DEFAULT_PULL_REQUEST_TYPES = ["opened", "synchronize", "reopened"];

/** The explicit `types:` under `on: pull_request`, or null when the default applies. */
function parsePullRequestTypes(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s{2}pull_request:\s*$/.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (isBlank(lines[j])) continue;
      const indent = indentOf(lines[j]);
      if (indent <= 2) break;
      const types = /^\s+types:\s*(.*)$/.exec(lines[j]);
      if (!types) continue;
      const inline = types[1].trim();
      if (inline !== "") {
        return inline
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);
      }
      const listed = [];
      for (let k = j + 1; k < lines.length; k += 1) {
        if (isBlank(lines[k])) continue;
        const item = /^\s+-\s*(\S+)\s*$/.exec(lines[k]);
        if (!item) break;
        listed.push(item[1]);
      }
      return listed;
    }
    return null;
  }
  return null;
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
/**
 * **A8 invariant 1 — stop parsing shell programs; require an ATOMIC invocation.**
 *
 * A7d declared a grammar of "a simple command or an `&&` chain", and that was still a
 * partial shell parser: it had to decide what `&&`, `;`, `|`, `$( )`, `!` and a background
 * `&` each do to an exit status. Every one of those decisions is a place to be wrong, and
 * F1–F4 are the proof — `set +ex`, a gate inside an uncalled function, a gate inside
 * heredoc data, a gate after an unconditional `exit 0`, a gate in a zero-iteration loop.
 * A parser that models shell will always have one more shape.
 *
 * So the model changes rather than the rule list. A required gate counts only when its
 * step runs **exactly one command and nothing else**. Then there is no control flow to
 * reason about, no dead code to detect, no shell state to track, and `set`/`shopt` are
 * refused for free because they would be a second statement.
 *
 * This is an ALLOWLIST of one shape, not a denylist of many. Everything below is
 * consequence, not enumeration: no pipeline, no `||`, no `&&`, no `;`, no backgrounding,
 * no substitution, no inversion, no redirection, no heredoc, no function, no loop, no
 * case, no continuation. None of them is a rule; they are all "not one command".
 *
 * Every gate line in the shipped workflows already is exactly one command, so the strictest
 * available model costs nothing here.
 */
const ATOMIC_ARGUMENT = `[A-Za-z0-9_@./:=+,~^-]+|'[^']*'|"[^"]*"`;
const ATOMIC_COMMAND = new RegExp(
  `^[A-Za-z0-9_@./:+-]+(?:[ \\t]+(?:${ATOMIC_ARGUMENT}))*$`,
);

/**
 * Is this `run:` value one atomic command?
 *
 * `plain` says the YAML scalar was a single-line plain scalar. A block scalar is never
 * atomic — not because block scalars are forbidden, but because a gate written as one is
 * not provably a lone statement, and this function's whole job is to answer "provably".
 */
export function atomicGateInvocation(runValue, { plain } = {}) {
  if (plain !== true) {
    return {
      atomic: false,
      why: "the `run:` value is not a single-line plain scalar",
    };
  }
  if (typeof runValue !== "string") {
    return {
      atomic: false,
      why: "the `run:` value is not a scalar this scanner read",
    };
  }
  const command = runValue.trim();
  if (command === "") {
    return { atomic: false, why: "the `run:` value is empty" };
  }
  if (/\r|\n/.test(runValue)) {
    return { atomic: false, why: "the `run:` value spans more than one line" };
  }
  const head = /^([A-Za-z][\w.-]*)/.exec(command)?.[1];
  if (head !== undefined && SHELL_KEYWORDS.has(head)) {
    return {
      atomic: false,
      why: `it begins with the shell keyword \`${head}\`, so it is control flow rather than a command`,
    };
  }
  if (head === "set" || head === "shopt") {
    return {
      atomic: false,
      why: `it is a \`${head}\` builtin, which changes shell state instead of running the gate`,
    };
  }
  if (!ATOMIC_COMMAND.test(command)) {
    return {
      atomic: false,
      why:
        "it is not one command with simple arguments — a pipeline, `&&`, `||`, `;`, a " +
        "background `&`, a substitution, a redirection, an inversion or a continuation is " +
        "a second statement, and this scanner proves one statement rather than reasoning " +
        "about what the others do to an exit status",
    };
  }
  return { atomic: true, why: null };
}

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
    // A8 invariant 1. A gate is still OBSERVED wherever it textually appears — moving one
    // into a heredoc, a function body or a `run: |` block must never make it invisible,
    // because invisible is how F2 worked. What changes is whether the occurrence is
    // PROVEN: only an atomic single-command plain scalar is.
    const verdict = atomicGateInvocation(run, {
      plain: step.plainRun === true,
    });

    // Scan every line for gate NAMES so nothing is silently discarded, then attach the
    // one verdict for the step. There is deliberately no per-line shell reasoning here:
    // that was A7d's model, and F1–F4 are what it missed.
    for (const rawLine of run.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === "") continue;
      const pnpm =
        /(?:^|[\s;&|(`$])pnpm\s+(?:--filter\s+\S+\s+)?([a-z][a-z0-9:-]*)/.exec(
          line,
        );
      if (pnpm) {
        gates.push({
          name: `pnpm ${pnpm[1]}`,
          propagates: verdict.atomic,
          masked: verdict.atomic
            ? null
            : `the step is not an atomic gate invocation — ${verdict.why}`,
        });
        continue;
      }
      const first = /^([A-Za-z][\w.-]*)/.exec(line);
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

  return {
    triggers,
    pullRequestTypes: parsePullRequestTypes(lines),
    steps: collected,
  };
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
  // ── A8 invariants 2 and 3: WHICH SHELL actually runs the gate ──────────────────────
  // Two independent ways to prove it, and a gate needs one of them:
  //   * the step names a proven shell explicitly, or
  //   * the job runs on a named runner whose DEFAULT shell is proven.
  // `runs-on: windows-latest` with no explicit shell is the shape that matters: PowerShell
  // sets $LASTEXITCODE for a failing native command without terminating the script, so the
  // gate fails and the step passes. A `${{ … }}` runner or a self-hosted label proves
  // nothing about the image, so they must name a shell instead.
  const shell = step.keys?.shell;
  const shellDeclared = typeof shell === "string" && shell.trim() !== "";
  if (shellDeclared) {
    const declared = shell.trim();
    const name = declared.split(/\s+/)[0];
    if (!PROVEN_SHELLS.has(name) || declared !== name) {
      return {
        kind: KINDS.unprovenPropagation,
        reason:
          `step sets \`shell: ${declared}\`, which is not a proven shell. Only bare \`bash\` ` +
          "and bare `sh` are: both stop on the first failing command. A custom template " +
          "such as `bash {0}` drops `-e`; `pwsh`, `powershell` and `python` each have their " +
          "own failure semantics and were removed from the proven set precisely because " +
          "assuming they behave like bash is the mistake",
      };
    }
  } else {
    const runsOn = step.jobKeys?.get("runs-on");
    if (runsOn === undefined) {
      return {
        kind: KINDS.unprovenShape,
        reason:
          "the gate's job declares no `runs-on` and the step names no shell, so which " +
          "shell runs the command — and therefore whether its failure fails the step — is " +
          "not determined by anything this scanner can read",
      };
    }
    if (!runnerDefaultShellProven(runsOn)) {
      return {
        kind: KINDS.unprovenPropagation,
        reason:
          `the job runs on \`${String(runsOn).trim()}\` and the step names no shell. That ` +
          "runner's default shell is not proven: Windows defaults to PowerShell, where a " +
          "failing native command does not by itself fail the step; a `${{ … }}` " +
          "expression or a self-hosted label says nothing about the image at all. Either " +
          "run on a named Linux/macOS image, or declare `shell: bash`",
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
  const triggers = new Map();
  const read = [];

  const record = (name, entry) => {
    if (!occurrences.has(name)) occurrences.set(name, []);
    occurrences.get(name).push(entry);
  };

  const ingest = async (
    relative,
    inheritedTriggers,
    visited,
    entryWorkflow,
  ) => {
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
    if (inheritedTriggers === null) {
      triggers.set(relative, {
        names: parsed.triggers,
        pullRequestTypes: parsed.pullRequestTypes,
      });
    }
    const effective = inheritedTriggers ?? parsed.triggers;
    if (parsed.steps.length === 0) {
      throw new WorkflowGatesUnavailableError(
        `${relative} declares no steps at all. A workflow that executes nothing is ` +
          "indistinguishable from one whose steps were all deleted, so this is a hard " +
          "failure rather than an empty set.",
      );
    }

    for (const step of parsed.steps) {
      const { kind, reason } = classify(step, effective);
      const entry = {
        kind,
        reason,
        where: where(step, relative),
        // A8 invariant 6: an occurrence's WORKFLOW is part of its identity — a gate proven
        // in some other workflow does not satisfy the stage that requires it.
        //
        // `workflow` is the ENTRY POINT, not the file the step happens to be written in.
        // `pnpm install --frozen-lockfile` is written in .github/actions/setup, and it is
        // authorized because ci-fast.yml CALLS that composite action: authority follows the
        // pipeline that reaches the step. `definedIn` keeps the real location for messages.
        workflow: entryWorkflow ?? relative,
        definedIn: relative,
      };

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
          await ingest(resolved, effective, visited, entryWorkflow ?? relative);
        }
      }
    }
  };

  for (const relative of files) {
    await ingest(relative, null, new Set(), relative);
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
    triggers,
  };
}
