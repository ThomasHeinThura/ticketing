import { and, eq, inArray } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { validateWorkspaceAccess } from "./validate-workspace-access";

// T4 (independent Opus security review of PR #271, delta round): a NUL byte in an id
// pulled from a path param (e.g. `GET /api/projects/%00/work-items`, `fromProject`'s
// `idKey`) reached `lookupWorkspaceId`'s query unvalidated, threw, and was caught by that
// function's own fail-closed `catch` as a masked 503 ("Could not verify workspace
// access") -- Postgres `text`/`uuid` columns reject a NUL outright, and no legitimate id
// this codebase issues (cuid2, `{slug}-{number}`) ever contains one.
//
// FIRST ROUND of this fix treated a NUL-bearing id as simply ABSENT, falling through to
// the generic "workspace id could not be determined" 400 -- but "absent" used to be what
// made the 8 `[lookup, query]`-shaped helpers (`fromTask`, `fromTaskId`, `fromLabel`,
// `fromTimeEntry`, `fromActivity`, `fromComment`, `fromColumn`, `fromWorkflowRule`) fall
// through to their OWN `{ type: "query", key: "workspaceId" }` source next -- exactly
// issue #256's caller-supplied-`?workspaceId=` fallback class this file's own `catch`
// comment above already documents. A request with a NUL-bearing lookup id and a
// `?workspaceId=<the caller's own real workspace>` therefore PASSED this middleware
// against that workspace, and only then 500'd inside the controller trying to act on the
// NUL id -- fail-open relative to the original fail-closed 503, not a fix. So: a NUL byte
// in ANY source's id is answered with an IMMEDIATE 400, the same way an empty/missing
// `key` already is in `require-work-item-reach.ts` -- never treated as absent, and never
// allowed to fall through to a later source. (Issue #256 has since removed that fallback
// entirely for the 8 helpers above, so this particular fall-through no longer exists --
// the NUL check stays, unconditionally, because it is still the right answer for every
// other source shape.)
function hasNulByte(value: string): boolean {
  return value.includes("\u0000");
}

const NUL_BYTE_MESSAGE =
  "Workspace/resource id must not contain a NUL (\\u0000) byte";

// Issue #256: a failed row lookup for these resources is a genuinely missing resource,
// not a malformed request -- so it answers with the same 404 the resource's own
// controller already uses when a caller reaches it with a fabricated `?workspaceId=`
// (`get-label.ts`, `update-time-entry.ts`, `delete-workflow-rule.ts`, etc. all 404 with
// exactly this wording). `"project"` is deliberately absent: `fromProject` has always
// answered the generic 400 for an unknown id (`workflow-rule/index.ts`'s own route
// comments document this, and #202's tests depend on it), and #256 does not touch it --
// only the 8 `[lookup, query]`-shaped helpers below ever resolve one of these 7 resources.
const RESOURCE_NOT_FOUND_MESSAGE: Record<
  | "task"
  | "label"
  | "timeEntry"
  | "activity"
  | "comment"
  | "column"
  | "workflowRule",
  string
> = {
  task: "Task not found",
  label: "Label not found",
  timeEntry: "Time entry not found",
  activity: "Activity not found",
  comment: "Comment not found",
  column: "Column not found",
  workflowRule: "Workflow rule not found",
};

type WorkspaceIdSource =
  | { type: "query"; key: string }
  | { type: "body"; key: string }
  | { type: "param"; key: string }
  | {
      type: "lookup";
      resource:
        | "project"
        | "task"
        | "label"
        | "timeEntry"
        | "activity"
        | "comment"
        | "column"
        | "workflowRule";
      idKey: string;
    }
  | {
      type: "lookupMany";
      resource: "task";
      idKey: string;
    };

type WorkspaceAccessMiddlewareConfig = {
  sources: WorkspaceIdSource[];
};

async function readJsonObjectBody(
  c: Context,
): Promise<Record<string, unknown>> {
  const raw = (await c.req.json().catch(() => ({}))) || {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

export function workspaceAccessMiddleware(
  config: WorkspaceAccessMiddlewareConfig,
) {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");

    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    let workspaceId: string | null = null;

    for (const source of config.sources) {
      if (source.type === "query") {
        const raw = c.req.query(source.key) || null;
        if (raw && hasNulByte(raw)) {
          throw new HTTPException(400, { message: NUL_BYTE_MESSAGE });
        }
        workspaceId = raw;
      } else if (source.type === "body") {
        const body = await readJsonObjectBody(c);
        const bodyValue = body[source.key];
        const raw = typeof bodyValue === "string" ? bodyValue : null;
        if (raw && hasNulByte(raw)) {
          throw new HTTPException(400, { message: NUL_BYTE_MESSAGE });
        }
        workspaceId = raw;
      } else if (source.type === "param") {
        const raw = c.req.param(source.key) || null;
        if (raw && hasNulByte(raw)) {
          throw new HTTPException(400, { message: NUL_BYTE_MESSAGE });
        }
        workspaceId = raw;
      } else if (source.type === "lookup") {
        const body = await readJsonObjectBody(c);
        const bodyId = body[source.idKey];
        const idFromBody = typeof bodyId === "string" ? bodyId : null;
        // Only accept the id from the same place the handler will read it
        // (path param or JSON body). Accepting it from the query string let a
        // caller authorize against one resource (`?taskId=<mine>`) while the
        // handler acted on another (`{"taskId": "<someone else's>"}`).
        const id = c.req.param(source.idKey) || idFromBody;
        if (id && hasNulByte(id)) {
          // NEVER treat this as absent -- that would fall through to this
          // helper's own `{ type: "query", key: "workspaceId" }` source next,
          // which is exactly issue #256's caller-supplied-fallback class (see
          // the file comment above `hasNulByte`).
          throw new HTTPException(400, { message: NUL_BYTE_MESSAGE });
        }
        if (id) {
          workspaceId = await lookupWorkspaceId(source.resource, id);
          if (!workspaceId && source.resource !== "project") {
            // #256: the row genuinely doesn't exist -- no more falling through to a
            // caller-supplied `?workspaceId=` to keep going. Answered as a clean 404,
            // matching what these resources' own controllers already say when they hit
            // this same "no such row" condition (`get-label.ts`, `update-time-entry.ts`,
            // `delete-workflow-rule.ts`, ...), so a nonexistent id is indistinguishable
            // from one that belongs to someone else -- no existence oracle. `"project"`
            // is excluded because `fromProject` is not one of #256's 8 helpers and its
            // generic-400-on-unknown-id behaviour is unchanged (see the comment on
            // `RESOURCE_NOT_FOUND_MESSAGE` above).
            throw new HTTPException(404, {
              message: RESOURCE_NOT_FOUND_MESSAGE[source.resource],
            });
          }
        }
      } else if (source.type === "lookupMany") {
        const body = await readJsonObjectBody(c);
        const ids = body[source.idKey];
        if (Array.isArray(ids)) {
          const taskIds = ids.filter(
            (id): id is string => typeof id === "string",
          );
          if (taskIds.some(hasNulByte)) {
            throw new HTTPException(400, { message: NUL_BYTE_MESSAGE });
          }
          if (taskIds.length > 0) {
            const tasks = await db
              .select({ workspaceId: schema.projectTable.workspaceId })
              .from(schema.taskTable)
              .innerJoin(
                schema.projectTable,
                eq(schema.taskTable.projectId, schema.projectTable.id),
              )
              .where(inArray(schema.taskTable.id, taskIds));
            const workspaceIds = [
              ...new Set(tasks.map((task) => task.workspaceId)),
            ];
            if (workspaceIds.length === 0) {
              throw new HTTPException(404, { message: "No tasks found" });
            }
            if (workspaceIds.length > 1) {
              throw new HTTPException(400, {
                message: "All tasks must belong to the same workspace",
              });
            }
            workspaceId = workspaceIds[0] ?? null;
          }
        }
      }

      if (workspaceId) {
        break;
      }
    }

    if (!workspaceId) {
      throw new HTTPException(400, {
        message: "Workspace ID could not be determined",
      });
    }

    const apiKey = c.get("apiKey");
    const apiKeyId = apiKey?.id;

    await validateWorkspaceAccess(userId, workspaceId, apiKeyId);

    c.set("workspaceId", workspaceId);

    return next();
  };
}

async function lookupWorkspaceId(
  resource:
    | "project"
    | "task"
    | "label"
    | "timeEntry"
    | "activity"
    | "comment"
    | "column"
    | "workflowRule",
  id: string,
): Promise<string | null> {
  try {
    switch (resource) {
      case "project": {
        const [project] = await db
          .select({ workspaceId: schema.projectTable.workspaceId })
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, id))
          .limit(1);
        return project?.workspaceId || null;
      }

      case "task": {
        const [task] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
          })
          .from(schema.taskTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.taskTable.id, id))
          .limit(1);
        return task?.workspaceId || null;
      }

      case "label": {
        const [label] = await db
          .select({ workspaceId: schema.labelTable.workspaceId })
          .from(schema.labelTable)
          .where(eq(schema.labelTable.id, id))
          .limit(1);
        return label?.workspaceId || null;
      }

      case "timeEntry": {
        const [timeEntry] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
          })
          .from(schema.timeEntryTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.timeEntryTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.timeEntryTable.id, id))
          .limit(1);
        return timeEntry?.workspaceId || null;
      }

      case "activity": {
        const [activity] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
          })
          .from(schema.activityTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.activityTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.activityTable.id, id))
          .limit(1);
        return activity?.workspaceId || null;
      }

      case "comment": {
        const [comment] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
          })
          .from(schema.activityTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.activityTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(
            and(
              eq(schema.activityTable.id, id),
              eq(schema.activityTable.type, "comment"),
            ),
          )
          .limit(1);
        return comment?.workspaceId || null;
      }

      case "column": {
        const [column] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
          })
          .from(schema.columnTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.columnTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.columnTable.id, id))
          .limit(1);
        return column?.workspaceId || null;
      }

      case "workflowRule": {
        const [workflowRule] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
          })
          .from(schema.workflowRuleTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.workflowRuleTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.workflowRuleTable.id, id))
          .limit(1);
        return workflowRule?.workspaceId || null;
      }

      default:
        return null;
    }
  } catch (error) {
    // Fail CLOSED. This used to `return null`, which is indistinguishable from
    // "the row does not exist" — and several sources (fromTask, fromTaskId,
    // fromLabel, fromComment, fromColumn, fromTimeEntry, fromActivity,
    // fromWorkflowRule) used to fall back to an attacker-supplied `?workspaceId=`
    // when the lookup yielded null. A transient database error therefore downgraded
    // a tenant check to caller-controlled input while the handler still acted on
    // the resource id from the path. Issue #6. (Issue #256 has since removed that
    // fallback entirely, so a `null` result from a genuinely absent row is now
    // answered with a 404 by the caller of `lookupWorkspaceId`, never a fallback —
    // but a transient error must still fail closed here, not `return null`, the
    // same as before.)
    console.error(`Error looking up workspaceId for ${resource}:`, error);
    throw new HTTPException(503, {
      message: "Could not verify workspace access. Please retry.",
    });
  }
}

export const workspaceAccess = {
  fromQuery: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "query", key }] }),

  fromBody: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "body", key }] }),

  fromParam: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "param", key }] }),

  fromProject: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "project", idKey }],
    }),

  fromTask: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "task", idKey }],
    }),

  fromTaskId: (idKey = "taskId") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "task", idKey }],
    }),

  fromTasks: (idKey = "taskIds") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookupMany", resource: "task", idKey }],
    }),

  fromLabel: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "label", idKey }],
    }),

  fromTimeEntry: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "timeEntry", idKey }],
    }),

  fromActivity: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "activity", idKey }],
    }),

  fromComment: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "comment", idKey }],
    }),

  fromColumn: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "column", idKey }],
    }),

  fromWorkflowRule: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "workflowRule", idKey }],
    }),
};
