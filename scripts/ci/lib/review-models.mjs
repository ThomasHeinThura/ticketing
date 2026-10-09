import {
  BaselineHistoryUnavailableError,
  readTextAtCommit,
  resolveMergeBase,
} from "./git-baseline.mjs";

/**
 * Which models may sign `## Security review`, read from the TRUSTED merge base.
 *
 * The accepted models are policy, written once in the model-policy section of
 * `docs/04-engineering/agent-workflow.md` as a fenced list:
 *
 *     <!-- policy:security-review-models -->
 *     - `GPT-6 Sol`
 *     - `Claude Opus 5.5 (claude-opus-5-5)`
 *     <!-- /policy:security-review-models -->
 *
 * The list is taken from the MERGE BASE, never from HEAD. A pull request that adds a model to
 * the list and names that model in its own `## Security review` would otherwise approve itself;
 * read from the base, an addition only takes effect for the pull requests that come after it.
 * This is the opposite direction from the security-path list (`lib/security-paths.mjs`), which
 * UNIONS base and HEAD: there a pull request must not shrink its own scope; here it must not
 * widen its own authority. Both read the base for the same reason — the diff is not trusted to
 * judge itself.
 *
 * Only pull requests into the default branch are judged: the merge base is taken with
 * `main`, never with an arbitrary target branch. Labels are printable ASCII.
 *
 * Bootstrap: when the merge base has no such document or no such block, the accepted set is the
 * one this check enforced before the list existed — exactly `GPT-6 Sol`. A block that is present
 * but unreadable fails closed rather than falling back: "the list could not be read" and "the
 * list is the legacy one" are different facts.
 */
export const MODEL_POLICY_RELATIVE_PATH =
  "docs/04-engineering/agent-workflow.md";
/**
 * The trusted base is the DEFAULT branch, never whatever branch a pull request targets: a
 * pull request retargeted at a branch that carries a widened list must not inherit it.
 */
export const DEFAULT_BRANCH = "main";
export const LEGACY_SECURITY_REVIEW_MODELS = Object.freeze(["GPT-6 Sol"]);

const OPEN = "<!-- policy:security-review-models -->";
const CLOSE = "<!-- /policy:security-review-models -->";

export class ReviewModelsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReviewModelsUnavailableError";
  }
}

/**
 * The model labels in the block, or `null` when the document has no block at all.
 *
 * @param {string} source agent-workflow.md contents
 * @param {string} origin where `source` came from, for the error messages
 * @returns {string[]|null}
 */
export function parseSecurityReviewModels(
  source,
  origin = MODEL_POLICY_RELATIVE_PATH,
) {
  const opens = source.split(OPEN).length - 1;
  const closes = source.split(CLOSE).length - 1;
  if (opens === 0 && closes === 0) return null;
  if (opens !== 1 || closes !== 1) {
    throw new ReviewModelsUnavailableError(
      `${origin} must contain exactly one \`${OPEN}\` … \`${CLOSE}\` block; found ${opens} ` +
        `opening and ${closes} closing marker(s). Two blocks would let one hide behind the other.`,
    );
  }
  const start = source.indexOf(OPEN) + OPEN.length;
  const end = source.indexOf(CLOSE);
  if (end < start) {
    throw new ReviewModelsUnavailableError(
      `${origin}: the closing \`${CLOSE}\` comes before the opening marker.`,
    );
  }

  const models = [];
  for (const raw of source.slice(start, end).split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const match = /^- `([^`]+)`$/.exec(line);
    if (!match) {
      throw new ReviewModelsUnavailableError(
        `${origin}: every line of the security-review model block must be a list item holding ` +
          `one model label in backticks (\`- \\\`GPT-6 Sol\\\`\`); found ${JSON.stringify(line)}.`,
      );
    }
    const label = match[1].trim();
    if (!/^[\x20-\x7e]+$/.test(match[1])) {
      throw new ReviewModelsUnavailableError(
        `${origin}: model label ${JSON.stringify(match[1])} contains a character outside printable ` +
          "ASCII. Labels are compared exactly; an invisible or look-alike character would make " +
          "two labels that read the same.",
      );
    }
    if (label === "" || label !== match[1]) {
      throw new ReviewModelsUnavailableError(
        `${origin}: model label ${JSON.stringify(match[1])} is empty or padded with spaces.`,
      );
    }
    models.push(label);
  }
  if (models.length === 0) {
    throw new ReviewModelsUnavailableError(
      `${origin}: the security-review model block is empty. An empty list would make every ` +
        "security-scope pull request unmergeable; a deliberate freeze belongs in the ruleset.",
    );
  }
  if (new Set(models).size !== models.length) {
    throw new ReviewModelsUnavailableError(
      `${origin}: the security-review model block repeats a label.`,
    );
  }
  return models;
}

/**
 * The accepted security-review models for this branch, from the merge base.
 *
 * @returns {{models: string[], source: "merge-base"|"legacy", base: {ref: string, sha: string}}}
 */
export function readAcceptedSecurityReviewModels() {
  const target = process.env.GITHUB_BASE_REF;
  if (target && target !== DEFAULT_BRANCH) {
    throw new ReviewModelsUnavailableError(
      `this pull request targets \`${target}\`, not \`${DEFAULT_BRANCH}\`. Accepted security-review ` +
        `models are read only from \`${DEFAULT_BRANCH}\`'s history; retarget the pull request.`,
    );
  }
  const base = resolveMergeBase();
  if (base.kind === "unresolved") {
    throw new ReviewModelsUnavailableError(
      `cannot resolve a merge base (tried ${base.triedRefs.join(", ")}), so the accepted ` +
        "security-review models cannot be read from trusted history. Use `fetch-depth: 0`, or " +
        "`git fetch origin main`, and run it again.",
    );
  }
  let shown;
  try {
    shown = readTextAtCommit(base.sha, MODEL_POLICY_RELATIVE_PATH);
  } catch (error) {
    if (error instanceof BaselineHistoryUnavailableError) {
      throw new ReviewModelsUnavailableError(error.message);
    }
    throw error;
  }
  const origin = `${MODEL_POLICY_RELATIVE_PATH} at the merge base ${base.sha.slice(0, 9)} (${base.ref})`;
  const parsed =
    shown === null ? null : parseSecurityReviewModels(shown, origin);
  return parsed === null
    ? { models: [...LEGACY_SECURITY_REVIEW_MODELS], source: "legacy", base }
    : { models: parsed, source: "merge-base", base };
}
