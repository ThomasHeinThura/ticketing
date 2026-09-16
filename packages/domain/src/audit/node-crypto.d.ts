/**
 * A minimal ambient declaration for the one `node:crypto` shape `audit.ts` actually
 * calls — `createHash("sha256").update(text, "utf8").digest("hex")` — kept local to this
 * module rather than pulled in via `@types/node`.
 *
 * Why not `@types/node`, the way `apps/api`, `packages/email` and `packages/mcp` already
 * do: adding it as a devDependency here would touch `packages/domain/package.json` and
 * `pnpm-lock.yaml`, both literally on `docs/04-engineering/ci-cd.md`'s security-review-
 * scope glob list (every workspace package's manifest, and the lockfile) — mechanically
 * pulling this pull request into the CI-enforced Opus-review-and-committed-note
 * requirement for a one-line, type-only, dev-only addition unrelated to any actual
 * dependency-graph risk. Flagged in the pull request description as the alternative
 * considered and not taken by default; this file is easily deleted in favour of
 * `@types/node` if the orchestrating session prefers that route instead.
 *
 * `node:crypto` itself needs no dependency and no permission — it is the JavaScript
 * runtime (AGENTS.md do-not 4 governs *third-party* dependencies); this file only supplies
 * the *type* `tsc` needs to check a call already made against a built-in Node module.
 */
declare module "node:crypto" {
  interface Hash {
    update(data: string, inputEncoding: "utf8"): Hash;
    digest(encoding: "hex"): string;
  }

  export function createHash(algorithm: "sha256"): Hash;
}
