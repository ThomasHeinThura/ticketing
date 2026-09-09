import path from "node:path";
import { readText, repoRoot } from "./repo.mjs";

/**
 * Some overrides in pnpm-workspace.yaml do not close an advisory by bumping a version —
 * they close it by making the package leave the resolved graph entirely. `next` is the
 * live example: it is materialized only as better-auth's optional peer, and the override
 * does not bump it to a patched release, it stops pnpm from auto-installing it at all
 * (closing GHSA-p293-qw3h-jr36 / GHSA-2xp9-vwfh-vxw4, both CRITICAL). `sharp` rides along
 * as `next`'s own optional transitive dependency and leaves the same way, which is also
 * how GHSA-rgj7-g3m4-5g8c (and GHSA-2jg2-4ch7-h545, the same libheif advisory) stay closed
 * for it — sharp has no other route into this graph today.
 *
 * That kind of protection has no version number for `pnpm audit` to check: a deactivated
 * floor sits exactly where there is no advisory to find, which is the whole reason
 * `check-overrides.mjs` exists as a mechanical check rather than a comment. The `next`
 * entry's own comment in pnpm-workspace.yaml admits its mechanism is "an emergent pnpm
 * behavior around overrides + auto-installed optional peers, not one pnpm documents",
 * verified once by hand. Nothing had verified it since.
 *
 * So this reads the one artifact that actually shows what got resolved — pnpm-lock.yaml
 * — rather than trusting the override's comment or re-deriving pnpm's own resolution
 * logic. The invariant is simple and general: for any override whose security value is
 * "this package must not resolve at all", a resolved entry for it while the override is
 * still declared means that protection is no longer in effect, silently. Not tied to
 * `next` and `sharp` in the checking logic — REMOVAL_INVARIANTS is a short, explicit list
 * because that is what is true today, and a precise check beats a framework built for
 * invariants that do not exist yet.
 */
export const REMOVAL_INVARIANTS = [
  {
    name: "next",
    advisories: ["GHSA-p293-qw3h-jr36", "GHSA-2xp9-vwfh-vxw4"],
    note:
      "next is materialized only as better-auth's optional peer dependency; the override's " +
      "security value is next leaving the graph, not a patched version being resolved.",
  },
  {
    name: "sharp",
    advisories: ["GHSA-rgj7-g3m4-5g8c", "GHSA-2jg2-4ch7-h545"],
    note:
      "sharp enters this graph only as next's own optional transitive dependency and is " +
      "expected to leave alongside it; sharp's own version floor (^0.35.4) is a separate, " +
      "additional protection for the case it is ever legitimately reintroduced some other way.",
  },
];

export const LOCKFILE_RELATIVE_PATH = "pnpm-lock.yaml";
export const lockfilePath = path.join(repoRoot, LOCKFILE_RELATIVE_PATH);

export class LockfileUnreadableError extends Error {
  constructor(message) {
    super(message);
    this.name = "LockfileUnreadableError";
  }
}

/** Escape a package name for use inside a RegExp. */
function escapeForRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The body of a top-level (column-0) YAML mapping in pnpm-lock.yaml, dedented lines only
 * — the same "read until the next unindented line" grammar `check-overrides.mjs` already
 * uses for pnpm-workspace.yaml's `overrides:` block. No YAML dependency: the shape read
 * here is small and fixed, and anything outside it is a parse failure, not a guess.
 */
function topLevelSection(source, key) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^${key}:\\s*$`).test(line),
  );
  if (start === -1) return null;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

/** Does this 2-space-indented mapping body declare `name` as a key? */
function declaresKey(sectionBody, name) {
  return new RegExp(`^  ['"]?${escapeForRegExp(name)}['"]?:`, "m").test(
    sectionBody,
  );
}

/** Does this 2-space-indented package-list body carry a resolved `name@<version>` entry? */
function resolvesPackage(sectionBody, name) {
  return new RegExp(`^  ['"]?${escapeForRegExp(name)}['"]?@`, "m").test(
    sectionBody,
  );
}

/**
 * @returns {Promise<{ name: string, advisories: string[], note: string }[]>} the removal
 *   invariants that are BROKEN in pnpm-lock.yaml today: the override is declared, and a
 *   resolved entry for the package it is supposed to keep out exists anyway.
 *
 * Fails closed (throws) if the lockfile cannot be read, or does not have the top-level
 * `overrides:` and `packages:` mappings this parses — an unreadable or unrecognisable
 * lockfile must never read as "nothing is broken".
 */
export async function readBrokenRemovalInvariants() {
  let source;
  try {
    source = await readText(lockfilePath);
  } catch (error) {
    throw new LockfileUnreadableError(
      `${LOCKFILE_RELATIVE_PATH} could not be read (${error.code ?? error.message}). ` +
        "check:overrides refuses to certify that next/sharp are absent from a graph it " +
        "cannot open.",
    );
  }

  const overrides = topLevelSection(source, "overrides");
  const packages = topLevelSection(source, "packages");
  if (overrides === null || packages === null) {
    const missing = [
      overrides === null && "overrides:",
      packages === null && "packages:",
    ]
      .filter(Boolean)
      .join(" and ");
    throw new LockfileUnreadableError(
      `${LOCKFILE_RELATIVE_PATH} has no top-level \`${missing}\` mapping this parser ` +
        "recognises -- the lockfile format may have changed. check:overrides refuses to " +
        "certify next/sharp are absent when it cannot parse the sections it needs to check.",
    );
  }

  return REMOVAL_INVARIANTS.filter(
    ({ name }) =>
      declaresKey(overrides, name) && resolvesPackage(packages, name),
  );
}
