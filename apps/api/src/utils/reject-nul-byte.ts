import { HTTPException } from "hono/http-exception";

// Issue #281 (follow-up to #277's Opus review): a raw path/query id read directly
// with `c.req.param()`/`c.req.query()` -- outside `workspace-access-middleware.ts`'s
// own `workspaceAccess.*` helpers and `require-work-item-reach.ts`, which already
// carry this same check -- can still reach a Postgres query unvalidated. A NUL
// (`\u0000`) byte in that value makes `pg` throw ("invalid byte sequence for
// encoding UTF8"), an unhandled error that surfaces as a 500 instead of a clean 4xx.
// Postgres `text`/`uuid` columns reject a NUL outright, and no legitimate id this
// codebase issues (cuid2, `{slug}-{number}`) ever contains one, so this is always a
// malformed request, never a real lookup -- answered immediately as 400, the same
// rule `workspace-access-middleware.ts`'s `hasNulByte` already enforces for every
// `workspaceAccess.*`-gated route (issue #271 T4 / #256).
export function rejectNulByte(value: string, label = "id"): void {
  if (value.includes("\u0000")) {
    throw new HTTPException(400, {
      message: `${label} must not contain a NUL (\\u0000) byte`,
    });
  }
}
