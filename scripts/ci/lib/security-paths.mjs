import path from "node:path";
import { readText, repoRoot } from "./repo.mjs";

/**
 * docs/04-engineering/ci-cd.md holds the authoritative list of paths whose change requires
 * a recorded Opus security review — it says so itself: "this list is the authoritative
 * scope; sdlc.md and security-model.md cite it and do not restate it".
 *
 * So the list is parsed out of that document rather than copied here. If the block cannot
 * be found the parser throws, and the check fails closed rather than reviewing nothing.
 */
export const ciCdPath = path.join(repoRoot, "docs/04-engineering/ci-cd.md");

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
 * @returns {Promise<{ globs: string[], matches: (file: string) => boolean }>}
 */
export async function readSecurityReviewPaths() {
  const source = await readText(ciCdPath);
  const blocks = source.match(/```[\s\S]*?```/g) ?? [];
  const block = blocks.find((candidate) =>
    candidate.includes("packages/permissions/**"),
  );

  if (!block) {
    throw new Error(
      `Could not find the security-review path list in ${ciCdPath}. ` +
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

  if (globs.length < 8) {
    throw new Error(
      `Parsed only ${globs.length} security-review path(s) from ${ciCdPath}; expected the full list.`,
    );
  }

  const expressions = globs.map(globToRegExp);
  return {
    globs,
    matches: (file) => expressions.some((expression) => expression.test(file)),
  };
}

/**
 * ci-cd.md's list ends with "any new route file (a new *.ts exporting a Hono router)",
 * which is a property of the file's contents rather than of its path.
 */
export function looksLikeHonoRouter(source) {
  return /new\s+(?:OpenAPI)?Hono\s*[<(]/.test(source);
}
