import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type callerReach,
  callerReach as resolveCallerReach,
} from "./caller-reach";
import { markReach } from "./reach-mark";

/**
 * A workspace-level LIST or SEARCH route returns rows from more than one project, so no
 * single-row reach middleware can gate it: workspace membership is not project reach (#712,
 * #720, #740). This middleware resolves the caller's reach decision source once
 * (`caller-reach.ts`) and hands it to the handler, which must apply
 * `reach.reachableProjectIds(...)` IN ITS OWN SQL, so a hidden project's rows are never
 * selected, paged or counted.
 *
 * It is the declaration the structural guard (`tests/permissions/project-reach-guard.test.ts`)
 * requires of every project-bearing list route, and the handler genuinely depends on it: a
 * route that declares it but never reads `listReach` fails at runtime, and a route that reads it
 * without the middleware fails closed. A mark is still self-attested, so every such route also
 * needs a behavioural row in `project-reach-reads.test.ts`.
 */
export type ListReach = Awaited<ReturnType<typeof callerReach>>;

const LIST_REACH_KEY = "listReach";

async function resolveListReach(c: Context, next: Next) {
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  c.set(LIST_REACH_KEY, await resolveCallerReach(c, userId));
  return next();
}

export const requireReachFilteredList = markReach(resolveListReach, {
  projectReach: true,
  reachFilteredList: true,
});

/**
 * The same reach context for a WRITE whose target project is named in the body or settled by
 * the handler (a saved view's project scope, a submission's destination project, #741). The
 * handler must decide `reach.reaches(project)` and answer an unreachable project exactly like
 * a missing one.
 */
export const requireReachContext = markReach(
  async (c: Context, next: Next) => resolveListReach(c, next),
  { projectReach: true },
);

/** The caller's reach, as resolved by `requireReachFilteredList` for this request. */
export function listReachOf(c: Context): ListReach {
  const reach = c.get(LIST_REACH_KEY) as ListReach | undefined;
  if (!reach) {
    // A list route that forgot the middleware must not silently list everything.
    throw new HTTPException(500, {
      message: "Project reach context could not be determined",
    });
  }
  return reach;
}
