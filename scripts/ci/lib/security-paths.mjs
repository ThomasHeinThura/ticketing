import path from "node:path";
import {
  BaselineHistoryUnavailableError,
  readTextAtCommit,
  resolveMergeBase,
} from "./git-baseline.mjs";
import { readText, repoRoot } from "./repo.mjs";

/**
 * docs/04-engineering/ci-cd.md holds the authoritative list of paths whose change requires
 * a recorded Opus security review — it says so itself: "this list is the authoritative
 * scope; sdlc.md and security-model.md cite it and do not restate it".
 *
 * So the list is parsed out of that document rather than copied here. If the block cannot
 * be found the parser throws, and the check fails closed rather than reviewing nothing.
 */
export const CI_CD_RELATIVE_PATH = "docs/04-engineering/ci-cd.md";
export const ciCdPath = path.join(repoRoot, CI_CD_RELATIVE_PATH);

/** The parser needs at least this many globs before it believes it read the whole list. */
// A PARSE-SANITY floor, not the anti-narrowing control — that is
// `readSecurityReviewScope`, which unions the list at the merge base with the list at HEAD
// so a diff cannot escape scope by shrinking it.
//
// An independent Opus audit of `main@5270954` flagged this as LOW: 8 against a real list of
// 23 means a parse regression could silently drop fifteen globs and still "pass". True, and
// **raising it was tried and reverted**, because it is not safely actionable as stated: the
// red probes in `scripts/ci/probes/` construct SYNTHETIC ci-cd.md files with deliberately
// small glob lists — `stale-review-note.test.mjs` writes ten — and a floor above that turns
// every one of them into a parse error instead of the scenario it was built to test. At 16,
// six probes failed.
//
// So the floor stays at 8 and the finding is answered honestly rather than closed: a floor
// tied to a number cannot distinguish "the block format broke" from "a probe wrote a small
// list on purpose". The durable fix is a floor derived from the document being parsed rather
// than a constant — e.g. refusing a block whose token count fell since the merge base, which
// is the same baseline comparison the anti-narrowing control already does. Recorded, not
// done, because it belongs with that control and not with a constant.
const MINIMUM_GLOBS = 8;

export class SecurityScopeUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "SecurityScopeUnavailableError";
  }
}

/** Turn a ci-cd.md glob into an anchored regular expression over a repo-relative path. */
export function globToRegExp(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        pattern += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
        continue;
      }
      pattern += "[^/]*";
      continue;
    }
    pattern += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Parse the security-review glob list out of a ci-cd.md source string.
 *
 * Separated from the file read so the SAME parser can be pointed at the document as it
 * exists now and at the document as it existed at the merge base. See
 * `readSecurityReviewScope` for why both are needed.
 *
 * @param {string} source ci-cd.md contents
 * @param {string} origin where `source` came from, for the error messages
 * @returns {string[]}
 */
export function parseSecurityReviewPaths(source, origin = String(ciCdPath)) {
  const blocks = source.match(/```[\s\S]*?```/g) ?? [];
  const block = blocks.find((candidate) =>
    candidate.includes("packages/permissions/**"),
  );

  if (!block) {
    throw new Error(
      `Could not find the security-review path list in ${origin}. ` +
        "The PR-template check refuses to run against an unparsed authority document.",
    );
  }

  const globs = [];
  for (const line of block.split("\n").slice(1, -1)) {
    for (const token of line.trim().split(/\s{2,}/)) {
      const candidate = token.trim();
      if (candidate === "" || candidate.includes(" ")) {
        continue;
      }
      globs.push(candidate);
    }
  }

  if (globs.length < MINIMUM_GLOBS) {
    throw new Error(
      `Parsed only ${globs.length} security-review path(s) from ${origin}; expected the full list.`,
    );
  }

  return globs;
}

/**
 * The list as the working tree has it.
 *
 * Kept for callers that legitimately want only the current scope — the unit tests that
 * assert what ci-cd.md declares today. **Path-conditional gating must not use this**: use
 * `readSecurityReviewScope`, which also reads the merge base. See GPT-F1 below.
 *
 * @returns {Promise<{ globs: string[], matches: (file: string) => boolean }>}
 */
export async function readSecurityReviewPaths() {
  const globs = parseSecurityReviewPaths(await readText(ciCdPath));
  const expressions = globs.map(globToRegExp);
  return {
    globs,
    matches: (file) => expressions.some((expression) => expression.test(file)),
  };
}

/**
 * The security-review scope, evaluated against BOTH the merge base and HEAD.
 *
 * **GPT-F1 — the scope was evaluated only from HEAD.** `readSecurityReviewPaths` reads the
 * working tree, so the list a change is measured against was the list that same change had
 * just written. That is self-referential, and it inverts the F15 fix it was built on:
 *
 *   1. one commit removes `scripts/ci/**`, `.github/**` and
 *      `docs/04-engineering/ci-cd.md` from the block in ci-cd.md;
 *   2. the same commit edits `scripts/ci/check-pr-template.mjs`;
 *   3. the checker parses the SHRUNK list, finds nothing in the diff matching it, and
 *      prints "no security-review path touched".
 *
 * The files performing the reduction stopped matching the scope *because of* the
 * reduction. A gate whose scope the diff may narrow in the same diff is not a gate; F15
 * closed "the gate cannot see changes to itself" and this reopened it one level up.
 *
 * The fix is union semantics. A path is in scope when it matches the list at the merge
 * base **or** the list at HEAD. The merge-base list is not something the change can
 * rewrite — the same argument `lib/git-baseline.mjs` makes for the ratchets — so widening
 * is immediate and narrowing is not retroactive. Narrowing is still allowed; it just
 * cannot take effect on the pull request that performs it.
 *
 * `removed` carries the second half: shrinking the protected list is itself a
 * security-sensitive act, and the caller treats a non-empty `removed` as requiring a
 * review even if nothing else in the diff matched.
 *
 * Four outcomes, and only one of them skips the merge-base half:
 *
 *   resolved + document present     -> union of both lists.
 *   resolved + document absent      -> bootstrap: the branch introduces ci-cd.md, so
 *                                      there is no previous scope. Current list only.
 *   resolved + document unparseable -> FAIL CLOSED. The document exists and the base
 *                                      scope cannot be computed from it, which is
 *                                      exactly the blind spot.
 *   unresolved merge base           -> FAIL CLOSED. Same refusal as the ratchets:
 *                                      "could not run" is not "found nothing".
 *
 * @returns {Promise<{
 *   base: {ref: string, sha: string},
 *   current: string[],
 *   previous: string[] | null,
 *   globs: string[],
 *   removed: string[],
 *   added: string[],
 *   matches: (file: string) => boolean,
 *   matchesCurrent: (file: string) => boolean,
 *   matchesPrevious: (file: string) => boolean,
 * }>}
 */
export async function readSecurityReviewScope() {
  const current = parseSecurityReviewPaths(
    await readText(ciCdPath),
    `${CI_CD_RELATIVE_PATH} (working tree)`,
  );

  const base = resolveMergeBase();
  if (base.kind === "unresolved") {
    throw new SecurityScopeUnavailableError(
      `cannot resolve a merge base for ${CI_CD_RELATIVE_PATH} (tried ` +
        `${base.triedRefs.join(", ")}). The security-review scope is the UNION of the ` +
        "path list at the merge base and the list at HEAD, because a pull request that " +
        "shrinks the list must not thereby escape it (GPT-F1). Proving what the list " +
        "used to contain needs that history, and a shallow single-branch checkout has " +
        "none. This does NOT mean nothing sensitive was touched: it means the scope " +
        "could not be computed. Use `fetch-depth: 0`, or `git fetch origin main`, and " +
        "run it again.",
    );
  }

  let previous = null;
  let source;
  try {
    source = readTextAtCommit(base.sha, CI_CD_RELATIVE_PATH);
  } catch (error) {
    if (!(error instanceof BaselineHistoryUnavailableError)) throw error;
    throw new SecurityScopeUnavailableError(error.message);
  }

  if (source !== null) {
    try {
      previous = parseSecurityReviewPaths(
        source,
        `${CI_CD_RELATIVE_PATH} at the merge base ${base.sha}`,
      );
    } catch (error) {
      throw new SecurityScopeUnavailableError(
        `${CI_CD_RELATIVE_PATH} exists at the merge base ${base.sha} (${base.ref}) but ` +
          `its security-review path list could not be parsed: ${error.message} ` +
          "The previous scope is half of the union this gate is evaluated against, so a " +
          "document that exists and cannot be read is a hard failure rather than an " +
          "empty previous list — an empty previous list would let a narrowing change " +
          "measure itself against its own output, which is the GPT-F1 bypass.",
      );
    }
  }

  const union = [...new Set([...(previous ?? []), ...current])];
  const unionExpressions = union.map(globToRegExp);
  const currentExpressions = current.map(globToRegExp);
  const previousExpressions = (previous ?? []).map(globToRegExp);

  return {
    base: { ref: base.ref, sha: base.sha },
    current,
    previous,
    globs: union,
    removed: (previous ?? []).filter((glob) => !current.includes(glob)),
    added: current.filter((glob) => !(previous ?? []).includes(glob)),
    matches: (file) => unionExpressions.some((pattern) => pattern.test(file)),
    matchesCurrent: (file) =>
      currentExpressions.some((pattern) => pattern.test(file)),
    matchesPrevious: (file) =>
      previousExpressions.some((pattern) => pattern.test(file)),
  };
}

/**
 * ci-cd.md's list ends with "any new route file (a new *.ts exporting a Hono router)",
 * which is a property of the file's contents rather than of its path.
 */
export function looksLikeHonoRouter(source) {
  // `new Hono(` / `new OpenAPIHono(` matched exactly TWO files in this repository —
  // `apps/api/src/openapi.ts` and `apps/api/src/index.ts` — while **20** route modules
  // declare themselves with `apiRouter()`, the local factory that wraps
  // `new OpenAPIHono({ defaultHook })` (`apps/api/src/openapi.ts:25-26`). So the "any new
  // route file" clause in ci-cd.md was, in practice, matching nothing: a brand-new
  // authenticated route surface added as `apps/api/src/thing/index.ts` triggered no
  // security review. Found by an independent Opus audit of `main@5270954`.
  //
  // This is a TEXTUAL PROXY for "declares a router", and it is the weaker half of the
  // control on purpose. The strong half is now ci-cd.md's `apps/api/src/**/index.ts` path
  // glob, which covers every route module by location rather than by how it happens to be
  // written. Keep this as the backstop for a router declared somewhere unexpected.
  //
  // The durable version derives the surface from the artifact instead of from source text
  // — `collectRoutes(await loadApiApp())` in `tests/permissions/api-app.ts` boots the real
  // app and enumerates what is actually mounted. That is the right answer and it is not
  // done here, because booting the API inside the pull-request-template check is a larger
  // change than this fix. Recorded rather than pretended.
  return /new\s+(?:OpenAPI)?Hono\s*[<(]|\bapiRouter\s*[<(]/.test(source);
}
