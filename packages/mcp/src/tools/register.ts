import { createHash, randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TaskDeskApiError, type TaskDeskClient } from "../taskdesk/client.js";
import {
  errorResult,
  errorResultWithDetail,
  explainFailure,
  textResult,
} from "../utils/mcp-result.js";
import { textToDoc } from "../utils/rich-text.js";
import {
  isSafeTimestamp,
  isSafeToken,
  UNTRUSTED_OUTPUT_NOTICE,
  untrustedContent,
  wrapUntrusted,
} from "../utils/untrusted.js";
import {
  PENDING_DELETION_NOTICE,
  requestPendingDeletion,
} from "./pending-deletion.js";

/**
 * The canonical TaskDesk tool set (mcp-server.md "Tools", `MC-1`..`MC-22`).
 *
 * This server is a thin client over the public API: every tool below is one documented
 * route, so the route's own policy, reach checks, capability intersection with the key's
 * subset, rate limits and audit apply unchanged (`MC-19`). There is no MCP-specific
 * authority. Three rules shape every tool:
 *
 * - `MC-5`: every write tool requires an `idempotencyKey`, sent as the `Idempotency-Key`
 *   header, so a retry after a timeout returns the original result instead of repeating
 *   the write. The model supplies it (a fresh random value per call would not survive the
 *   retry it exists for).
 * - `MC-7` / `MC-17`: no tool directly deletes or decides. A destructive tool only asks the
 *   canonical route for a pending action; the key's owner approves in the web app.
 * - `MC-15`: output is wrapped as untrusted content at the output boundary (`run`).
 *
 * Not offered, because the API route they would call does not exist yet: `list_my_work`,
 * `create_submission`. Not offered because the API refuses keys on the route they would call
 * (`403 session_required`): `list_workspaces` (`GET /api/workspace` and
 * `GET /api/workspace/{id}/members` are browser-session only).
 */

const nonEmptyString = z.string().trim().min(1);
const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const MAX_PAGE_SIZE = 50;

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;
const idempotencyKeySchema = z
  .string()
  .regex(IDEMPOTENCY_KEY_PATTERN, "1 to 255 printable characters, no spaces")
  .describe(
    "Required. A unique id you choose for this change, e.g. a UUID. If you retry the same change (after a timeout, say) send the SAME key and TaskDesk returns the original result instead of doing it twice. Use a NEW key for a different change.",
  );
const importIdempotencyKeySchema = idempotencyKeySchema.max(200);

const WRITE_NOTICE =
  "This changes data. It needs a key that was created with write access (keys are read-only by default); a read-only key is refused. Not approval-gated, but audited as an agent action and rate limited.";
const IMPORT_WRITE_NOTICE =
  "This changes data. It needs a write-enabled key (keys are read-only by default), is audited as an agent action and rate limited. Chunks over 50 records or links require approval by the API key owner in TaskDesk; this tool cannot approve them.";

/**
 * MC-15: every successful tool response passes through `wrapUntrusted` here, at the output
 * boundary, so user-authored fields reach the model only inside `untrusted_content`. A
 * bare string body (a non-JSON response) is wholly user-controllable and is wrapped too.
 */
function run(
  fn: () => Promise<unknown>,
  options: { paged?: boolean } = {},
): Promise<CallToolResult> {
  return fn()
    .then((data) => {
      if (typeof data === "string")
        return textResult(untrustedContent(data, "customer"));
      const wrapped = wrapUntrusted(data);
      // The paging hint is written here, after wrapping and overwriting any server field of
      // the same name, so it is trusted text only the tool can produce.
      return textResult(
        options.paged && hasNextPage(data) && isRecord(wrapped)
          ? { ...wrapped, pagingHint: PAGING_HINT }
          : wrapped,
      );
    })
    .catch((e: unknown) =>
      e instanceof TaskDeskApiError
        ? errorResultWithDetail(explainFailure(e.status, e.detail), e.detail)
        : errorResult(e instanceof Error ? e.message : String(e)),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * MC-9: responses are compact. Long descriptions are dropped unless the caller asks for
 * them; a work item's full text is one explicit `includeDescription` away.
 */
function compact(value: unknown, includeDescription: boolean): unknown {
  if (includeDescription) return value;
  if (Array.isArray(value))
    return value.map((item) => compact(item, includeDescription));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (key === "description") continue;
    out[key] = compact(field, includeDescription);
  }
  return out;
}

/** MC-9 / edge case "Agent requests 10,000 work items": the cap is hard, and the reply says how to page. */
const PAGING_HINT = `There are more results. Call this tool again with cursor set to the nextCursor value (at most ${MAX_PAGE_SIZE} per page).`;

function hasNextPage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const page = value.page;
  return (
    typeof value.nextCursor === "string" ||
    (isRecord(page) && typeof page.nextCursor === "string")
  );
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function writeInit(
  method: "POST" | "PATCH" | "DELETE",
  idempotencyKey: string,
  body?: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method,
    headers: { ...headers, "Idempotency-Key": idempotencyKey },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function scopedIdempotencyKey(key: string, operation: string): string {
  const digest = createHash("sha256")
    .update(`${operation}\0${key}`)
    .digest("hex");
  return `mcp-import-${digest}`;
}

function deterministicChunkId(key: string): string {
  return createHash("sha256")
    .update(`bulk_create_work_items:chunk\0${key}`)
    .digest("hex");
}

const importItemSchema = z
  .object({
    typeId: nonEmptyString,
    title: nonEmptyString.max(500),
    description: z.unknown().optional(),
    priority: prioritySchema.optional(),
    startDate: isoDateTimeSchema.nullable().optional(),
    dueDate: isoDateTimeSchema.nullable().optional(),
    labelIds: z
      .array(nonEmptyString)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate labels")
      .optional(),
    assigneeId: nonEmptyString.optional(),
  })
  .strict();

const importRecordSchema = z
  .object({
    sourceType: nonEmptyString.max(80),
    sourceId: nonEmptyString.max(512),
    sourceUrl: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        } catch {
          return false;
        }
      })
      .optional(),
    sourceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    sourceCreatedAt: isoDateTimeSchema.optional(),
    sourceAuthorEmail: z.string().email().max(320).optional(),
    item: importItemSchema,
  })
  .strict();

const importRecordsSchema = z
  .array(importRecordSchema)
  .min(1)
  .max(500)
  .superRefine((records, context) => {
    const seen = new Set<string>();
    records.forEach((record, index) => {
      const key = JSON.stringify([record.sourceType, record.sourceId]);
      if (seen.has(key))
        context.addIssue({
          code: "custom",
          path: [index, "sourceId"],
          message: "Duplicate source identity in import chunk",
        });
      seen.add(key);
    });
  });

const bulkPreviewSchema = z
  .object({
    action: z.literal("preview"),
    idempotencyKey: idempotencyKeySchema,
    workspaceId: nonEmptyString.max(128),
    projectId: nonEmptyString.max(128),
    sourceRef: nonEmptyString.max(200),
    profileId: nonEmptyString.optional(),
    records: importRecordsSchema,
  })
  .strict();

const bulkExecuteSchema = z
  .object({
    action: z.literal("execute"),
    idempotencyKey: idempotencyKeySchema,
    runId: nonEmptyString.max(128),
    chunkId: nonEmptyString.max(128),
    expectedVersion: z.number().int().positive().safe(),
    previewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    records: importRecordsSchema,
  })
  .strict();

const importLinkSchema = z
  .object({
    sourceType: nonEmptyString.max(80),
    sourceId: nonEmptyString.max(512),
    targetType: z.literal("work_item"),
    targetId: nonEmptyString.max(128),
    sourceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  })
  .strict();

type VersionedItem = { version?: unknown };

export function registerTools(
  server: McpServer,
  ctx: { client: TaskDeskClient },
): void {
  const { client } = ctx;

  // MC-15: the tool descriptions say, in words the model reads, that output is untrusted.
  const registerTool = ((
    name: string,
    config: { description?: string },
    cb: unknown,
  ) => {
    const tracked = async (...args: unknown[]) => {
      const invocationId = randomUUID();
      const startedAt = performance.now();
      let outcome: "success" | "error" = "error";
      try {
        const result = await (
          cb as (...callbackArgs: unknown[]) => Promise<unknown>
        )(...args);
        outcome =
          isRecord(result) && result.isError === true ? "error" : "success";
        return result;
      } finally {
        const durationMs = Math.max(
          0,
          Math.min(600_000, Math.floor(performance.now() - startedAt)),
        );
        void client
          .reportToolInvocation({
            invocationId,
            toolName: name,
            durationMs,
            outcome,
          })
          .catch(() => undefined);
      }
    };
    return server.registerTool(
      name,
      {
        ...config,
        description:
          `${config.description ?? ""} ${UNTRUSTED_OUTPUT_NOTICE}`.trim(),
      } as never,
      tracked as never,
    );
  }) as McpServer["registerTool"];

  /** Registers `name` and any older names kept as aliases for two minor releases. */
  const registerWithAliases = (
    names: readonly string[],
    config: { description?: string; inputSchema?: unknown },
    cb: unknown,
  ) => {
    for (const name of names) registerTool(name, config as never, cb as never);
  };

  async function readVersion(key: string): Promise<number> {
    const item = await client.json<VersionedItem>(
      `/api/work-items/${enc(key)}`,
      {
        method: "GET",
      },
    );
    if (typeof item.version !== "number")
      throw new Error(
        `Could not read the current version of work item ${key}; nothing was changed.`,
      );
    return item.version;
  }

  /** `PATCH /api/work-items/{key}` needs the item's version in `If-Match` (WI-7). */
  async function patchWorkItem(
    key: string,
    idempotencyKey: string,
    body: Record<string, unknown>,
    expectedVersion: number | undefined,
  ) {
    const version = expectedVersion ?? (await readVersion(key));
    return client.json(
      `/api/work-items/${enc(key)}`,
      writeInit("PATCH", idempotencyKey, body, {
        "If-Match": `"${version}"`,
      }),
    );
  }

  /* ---------------------------------------------------------------- *
   * Read tools
   * ---------------------------------------------------------------- */

  registerTool(
    "whoami",
    {
      description:
        "Return the authenticated TaskDesk user's own staff identity and credential type (GET /api/me/identity). Read-only; no session token or permissions are returned.",
      inputSchema: z.object({}),
    },
    async () => run(() => client.json("/api/me/identity", { method: "GET" })),
  );

  registerTool(
    "list_projects",
    {
      description:
        "List the projects of a workspace that this key can reach (GET /api/project). Read-only; needs project:read.",
      inputSchema: z.object({
        workspaceId: nonEmptyString.describe("Workspace ID"),
        includeArchived: z.boolean().optional(),
      }),
    },
    async (args) => {
      const qs = new URLSearchParams({ workspaceId: args.workspaceId });
      if (args.includeArchived === true) qs.set("includeArchived", "true");
      return run(() =>
        client.json(`/api/project?${qs.toString()}`, { method: "GET" }),
      );
    },
  );

  registerTool(
    "get_project",
    {
      description:
        "Get one project (GET /api/project/{id}). Read-only; needs project:read.",
      inputSchema: z.object({ projectId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/project/${enc(args.projectId)}`, { method: "GET" }),
      ),
  );

  registerTool(
    "search_work_items",
    {
      description: `Search work items in a workspace (POST /api/work-items/search; needs work_item:read, results limited to what this key can reach). Read-only. Returns at most ${MAX_PAGE_SIZE} per page without descriptions; set includeDescription to get them. 'filter' is the API's structured filter document (api-design.md, Work-item search v1).`,
      inputSchema: z.object({
        workspaceId: nonEmptyString,
        filter: z.record(z.string(), z.unknown()).optional(),
        sort: z
          .object({ field: nonEmptyString, order: z.enum(["asc", "desc"]) })
          .optional(),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
        cursor: nonEmptyString.optional(),
        includeDescription: z.boolean().optional(),
      }),
    },
    async (args) =>
      run(
        async () =>
          compact(
            await client.json("/api/work-items/search", {
              method: "POST",
              body: JSON.stringify({
                workspaceId: args.workspaceId,
                query: {
                  entity: "work_item",
                  ...(args.filter ? { filter: args.filter } : {}),
                  ...(args.sort ? { sort: [args.sort] } : {}),
                },
                limit: args.limit ?? 25,
                ...(args.cursor ? { cursor: args.cursor } : {}),
              }),
            }),
            args.includeDescription === true,
          ),
        { paged: true },
      ),
  );

  registerTool(
    "get_work_item",
    {
      description:
        "Get a work item by its permanent key, e.g. PROJ-123 (GET /api/work-items/{key}; needs work_item:read). Read-only. The description is left out unless includeDescription is true. The 'version' is what update_work_item needs.",
      inputSchema: z.object({
        key: nonEmptyString.describe("Work item key, e.g. PROJ-123"),
        includeDescription: z.boolean().optional(),
      }),
    },
    async (args) =>
      run(async () =>
        compact(
          await client.json(`/api/work-items/${enc(args.key)}`, {
            method: "GET",
          }),
          args.includeDescription === true,
        ),
      ),
  );

  registerWithAliases(
    ["get_work_item_activity", "list_work_item_activity"],
    {
      description:
        'A work item\'s combined activity and comment stream, newest first (GET /api/work-items/{key}/activity; needs work_item:read). Read-only. Rows with kind "comment" carry the comment ids delete_comment accepts. (list_work_item_activity is the older name of this tool.)',
      inputSchema: z.object({
        key: nonEmptyString.describe("Work item key, e.g. PROJ-123"),
        cursor: nonEmptyString
          .optional()
          .describe("Opaque cursor from a previous page"),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
      }),
    },
    async (args: { key: string; cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (args.cursor) qs.set("cursor", args.cursor);
      qs.set("limit", String(args.limit ?? 25));
      return run(
        () =>
          client.json(
            `/api/work-items/${enc(args.key)}/activity?${qs.toString()}`,
            { method: "GET" },
          ),
        { paged: true },
      );
    },
  );

  registerTool(
    "list_states",
    {
      description:
        "List a project's states (GET /api/projects/{projectId}/states; needs project:read). Read-only. To move a work item use list_work_item_transitions, which gives the ids transition_work_item needs.",
      inputSchema: z.object({ projectId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/projects/${enc(args.projectId)}/states`, {
          method: "GET",
        }),
      ),
  );

  registerTool(
    "list_time_activities",
    {
      description:
        "List a workspace's time activity types (GET /api/time-activities; needs time_entry:create). Read-only. Each id is the activityId log_time needs.",
      inputSchema: z.object({ workspaceId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/time-activities?workspaceId=${enc(args.workspaceId)}`,
          { method: "GET" },
        ),
      ),
  );

  registerTool(
    "list_work_item_transitions",
    {
      description:
        "List the transitions currently available for a work item (GET /api/work-items/{key}/transitions; needs work_item:read). Read-only. Each entry's toStateTemplateId is what transition_work_item takes.",
      inputSchema: z.object({ key: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/work-items/${enc(args.key)}/transitions`, {
          method: "GET",
        }),
      ),
  );

  registerTool(
    "list_work_item_types",
    {
      description:
        "List a workspace's work item types (GET /api/workspace/{workspaceId}/work-item-types; needs workspace:read). Read-only. Each type's id is the typeId create_work_item needs.",
      inputSchema: z.object({ workspaceId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/workspace/${enc(args.workspaceId)}/work-item-types`, {
          method: "GET",
        }),
      ),
  );

  registerTool(
    "list_request_types",
    {
      description:
        "List the request types of a workspace (GET /api/request-types; needs request_type:read). Read-only.",
      inputSchema: z.object({ workspaceId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/request-types?workspaceId=${enc(args.workspaceId)}`, {
          method: "GET",
        }),
      ),
  );

  registerTool(
    "list_people",
    {
      description:
        "List the people who can be assigned work in a project (GET /api/projects/{projectId}/assignable; needs work_item:read). Read-only. The ids are what assign_work_item takes.",
      inputSchema: z.object({ projectId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/projects/${enc(args.projectId)}/assignable`, {
          method: "GET",
        }),
      ),
  );

  registerTool(
    "get_sla_status",
    {
      description:
        "Get a work item's SLA status (GET /api/work-items/{key}/sla; needs work_item:read). Read-only.",
      inputSchema: z.object({ key: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/work-items/${enc(args.key)}/sla`, { method: "GET" }),
      ),
  );

  registerTool(
    "list_approvals",
    {
      description:
        "List the approvals waiting for this key's owner (GET /api/me/approvals). Read-only. You cannot decide them: approvals are decided by a person in the TaskDesk web app.",
      inputSchema: z.object({}),
    },
    async () => run(() => client.json("/api/me/approvals", { method: "GET" })),
  );

  registerTool(
    "list_saved_views",
    {
      description:
        "List saved views (GET /api/views; needs saved_view:read). Read-only.",
      inputSchema: z.object({ workspaceId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/views?workspaceId=${enc(args.workspaceId)}`, {
          method: "GET",
        }),
      ),
  );

  registerTool(
    "list_work_item_relations",
    {
      description:
        "List a work item's relations (GET /api/work-items/{key}/relations; needs work_item:read). Read-only. The returned relation ids are the ones delete_relation accepts.",
      inputSchema: z.object({ key: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/work-items/${enc(args.key)}/relations`, {
          method: "GET",
        }),
      ),
  );

  registerTool(
    "get_import_link",
    {
      description:
        "List source-to-work-item links for one import run (GET /api/imports/{id}/links; needs instance:admin plus work_item:read on the run's project). Read-only. Unreachable targets are returned without target identifiers. Use cursor from the response to continue; at most 100 links are returned per page.",
      inputSchema: z
        .object({
          runId: nonEmptyString.max(128),
          sourceType: nonEmptyString.max(80).optional(),
          sourceId: nonEmptyString.max(512).optional(),
          cursor: nonEmptyString.max(128).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
    },
    async (args) => {
      const query = new URLSearchParams();
      if (args.sourceType) query.set("sourceType", args.sourceType);
      if (args.sourceId) query.set("sourceId", args.sourceId);
      if (args.cursor) query.set("cursor", args.cursor);
      if (args.limit !== undefined) query.set("limit", String(args.limit));
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return run(
        async () =>
          compact(
            await client.json(
              `/api/imports/${enc(args.runId)}/links${suffix}`,
              { method: "GET" },
            ),
            false,
          ),
        { paged: true },
      );
    },
  );

  registerTool(
    "get_pending_action",
    {
      description:
        "Poll one of your own pending actions (GET /api/me/pending-actions/{id}) to learn whether a human approved, denied or let it expire, and whether it executed. Read-only: this tool cannot approve, deny or cancel anything.",
      inputSchema: z.object({ pendingActionId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/me/pending-actions/${enc(args.pendingActionId)}`, {
          method: "GET",
        }),
      ),
  );

  /* ---------------------------------------------------------------- *
   * Write tools (MC-5: idempotencyKey required; MC-7a: audited, bounded)
   * ---------------------------------------------------------------- */

  registerTool(
    "bulk_create_work_items",
    {
      description: `Create work items through the canonical import run and chunk API (POST /api/imports, /dry-run, then /records; needs instance:admin and project work_item:create). ${IMPORT_WRITE_NOTICE} This tool has two explicit actions. First call action "preview" with workspaceId, projectId, sourceRef, and records. Review the row outcomes. To write, call action "execute" with the returned runId, chunkId, runVersion as expectedVersion, previewDigest, and the exact same records. Each POST has a deterministic idempotency key derived from your required idempotencyKey. A chunk holds at most 500 records. More than 50 records returns a pending human approval request; this tool cannot approve it and has no confirm flag. Unsupported source authorship/timestamps are reported as rejected rows.`,
      inputSchema: z.discriminatedUnion("action", [
        bulkPreviewSchema,
        bulkExecuteSchema,
      ]),
    },
    async (args) =>
      run(async () => {
        if (args.action === "preview") {
          const created = await client.json<unknown>(
            "/api/imports",
            writeInit(
              "POST",
              scopedIdempotencyKey(args.idempotencyKey, "create-run"),
              {
                workspaceId: args.workspaceId,
                projectId: args.projectId,
                pluginId: "import.mcp",
                sourceRef: args.sourceRef,
                ...(args.profileId === undefined
                  ? {}
                  : { profileId: args.profileId }),
              },
            ),
          );
          if (
            !isRecord(created) ||
            typeof created.id !== "string" ||
            !Number.isSafeInteger(created.version) ||
            (created.version as number) < 1
          )
            throw new Error(
              "TaskDesk did not return a usable import run. The run may exist; check import runs before retrying.",
            );
          const chunkId = deterministicChunkId(args.idempotencyKey);
          const preview = await client.json<unknown>(
            `/api/imports/${enc(created.id)}/dry-run`,
            writeInit(
              "POST",
              scopedIdempotencyKey(args.idempotencyKey, "preview-chunk"),
              {
                chunkId,
                expectedVersion: created.version,
                records: args.records,
              },
            ),
          );
          if (
            !isRecord(preview) ||
            preview.runId !== created.id ||
            preview.chunkId !== chunkId ||
            typeof preview.previewDigest !== "string" ||
            !Number.isSafeInteger(preview.runVersion)
          )
            throw new Error(
              "TaskDesk did not return a complete import preview. Do not execute this chunk; inspect the import run before retrying.",
            );
          return {
            action: "preview",
            status: "previewed_no_items_written",
            runId: created.id,
            chunkId,
            runVersion: preview.runVersion,
            previewDigest: preview.previewDigest,
            expiresAt: preview.expiresAt ?? null,
            counts: preview.counts ?? null,
            rows: preview.rows ?? [],
            nextStep:
              "Review all preview rows. To execute, call bulk_create_work_items with action=execute, this runId/chunkId, runVersion copied to expectedVersion, this previewDigest, and the exact same records. No work items have been written yet.",
          };
        }

        const result = await client.json<unknown>(
          `/api/imports/${enc(args.runId)}/records`,
          writeInit(
            "POST",
            scopedIdempotencyKey(args.idempotencyKey, "execute-chunk"),
            {
              chunkId: args.chunkId,
              expectedVersion: args.expectedVersion,
              previewDigest: args.previewDigest,
              records: args.records,
            },
          ),
        );
        if (!isRecord(result))
          throw new Error(
            "TaskDesk returned an unreadable import result. Check the import run before retrying.",
          );
        if (result.kind === "pending_approval") {
          if (typeof result.pendingActionId !== "string")
            throw new Error(
              "TaskDesk requested approval but did not return a pending action id. Check the import run before retrying.",
            );
          return {
            status: "pending_human_approval",
            executed: false,
            pendingActionId: result.pendingActionId,
            runId: result.runId,
            chunkId: result.chunkId,
            runVersion: result.runVersion,
            nextStep:
              "No records were executed by this tool call. The API key owner must approve the pending action in TaskDesk; this MCP tool cannot approve it. After the owner responds, call get_pending_action with this pendingActionId to check the outcome.",
          };
        }
        if (result.kind !== "committed")
          throw new Error(
            "TaskDesk returned an unrecognized import result. Check the import run before retrying.",
          );
        return compact(
          {
            status: "committed",
            runId: result.runId,
            chunkId: result.chunkId,
            runVersion: result.runVersion,
            counts: result.counts,
            rows: result.rows,
          },
          false,
        );
      }),
  );

  registerTool(
    "create_import_link",
    {
      description: `Create or confirm source identity links to existing work items (POST /api/imports/{id}/links; needs instance:admin and project work_item:create on the import run). ${IMPORT_WRITE_NOTICE} Submit 1–500 links from this run; targetId must be a work item id in the run's project. The operation is idempotent for the same source and target. The tool has no confirm flag.`,
      inputSchema: z
        .object({
          idempotencyKey: importIdempotencyKeySchema,
          runId: nonEmptyString.max(128),
          links: z.array(importLinkSchema).min(1).max(500),
        })
        .strict(),
    },
    async (args) =>
      run(async () => {
        const result = await client.json<unknown>(
          `/api/imports/${enc(args.runId)}/links`,
          writeInit("POST", args.idempotencyKey, { links: args.links }),
        );
        if (isRecord(result) && result.kind === "pending_approval") {
          if (typeof result.pendingActionId !== "string")
            throw new Error(
              "TaskDesk requested approval but did not return a pending action id. Check the import run before retrying.",
            );
          return {
            status: "pending_human_approval",
            executed: false,
            pendingActionId: result.pendingActionId,
            runId: result.runId,
            chunkId: result.chunkId,
            runVersion: result.runVersion,
            nextStep:
              "No links were created by this tool call. The API key owner must approve the pending action in TaskDesk; this MCP tool cannot approve it. After the owner responds, call get_pending_action with this pendingActionId to check the outcome.",
          };
        }
        return compact(result, false);
      }),
  );

  registerTool(
    "create_work_item",
    {
      description: `Create one work item in a project (POST /api/projects/{projectId}/work-items; needs work_item:create). ${WRITE_NOTICE} The typeId comes from list_work_item_types. Description is plain text.`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        projectId: nonEmptyString,
        typeId: nonEmptyString,
        title: nonEmptyString.max(500),
        description: z.string().max(50_000).optional(),
        priority: prioritySchema.optional(),
        startDate: isoDateTimeSchema.nullable().optional(),
        dueDate: isoDateTimeSchema.nullable().optional(),
        labelIds: z.array(nonEmptyString).max(100).optional(),
        assigneeId: nonEmptyString.optional(),
        templateId: nonEmptyString.optional(),
        customFields: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    async (args) => {
      const { idempotencyKey, projectId, description, ...fields } = args;
      return run(() =>
        client.json(
          `/api/projects/${enc(projectId)}/work-items`,
          writeInit("POST", idempotencyKey, {
            ...fields,
            ...(description === undefined
              ? {}
              : { description: textToDoc(description) }),
          }),
        ),
      );
    },
  );

  registerTool(
    "update_work_item",
    {
      description: `Change a work item's title, description, priority or dates (PATCH /api/work-items/{key}; needs work_item:update, plus work_item:set_priority to change priority). ${WRITE_NOTICE} The change is refused if the item changed since expectedVersion (default: the version read just now). Use transition_work_item, assign_work_item, add_label and set_custom_field for those changes.`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        key: nonEmptyString,
        title: nonEmptyString.max(500).optional(),
        description: z.string().max(50_000).nullable().optional(),
        priority: prioritySchema.nullable().optional(),
        startDate: isoDateTimeSchema.nullable().optional(),
        dueDate: isoDateTimeSchema.nullable().optional(),
        expectedVersion: z.number().int().min(1).optional(),
      }),
    },
    async (args) => {
      const { idempotencyKey, key, expectedVersion, description, ...fields } =
        args;
      const body: Record<string, unknown> = { ...fields };
      if (description !== undefined)
        body.description = description === null ? null : textToDoc(description);
      return run(async () => {
        if (Object.keys(body).length === 0)
          throw new Error("Nothing to change: supply at least one field.");
        return patchWorkItem(key, idempotencyKey, body, expectedVersion);
      });
    },
  );

  registerTool(
    "set_custom_field",
    {
      description: `Set one custom field on a work item (PATCH /api/work-items/{key}; needs work_item:update). ${WRITE_NOTICE} A null value clears the field.`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        key: nonEmptyString,
        fieldKey: nonEmptyString,
        value: z.unknown(),
        expectedVersion: z.number().int().min(1).optional(),
      }),
    },
    async (args) =>
      run(() =>
        patchWorkItem(
          args.key,
          args.idempotencyKey,
          { customFields: { [args.fieldKey]: args.value ?? null } },
          args.expectedVersion,
        ),
      ),
  );

  registerTool(
    "add_label",
    {
      description: `Add one label to a work item without removing the others (reads GET /api/work-items/{key}/labels, then PATCH /api/work-items/{key}; needs work_item:update). ${WRITE_NOTICE} The labelId must be one the item may use: see its available labels via the work item.`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        key: nonEmptyString,
        labelId: nonEmptyString,
        expectedVersion: z.number().int().min(1).optional(),
      }),
    },
    async (args) =>
      run(async () => {
        const labels = await client.json<
          Array<{ id: string; assigned: boolean }>
        >(`/api/work-items/${enc(args.key)}/labels`, { method: "GET" });
        if (!labels.some((label) => label.id === args.labelId))
          throw new Error(
            `Label ${args.labelId} is not available on work item ${args.key}; nothing was changed.`,
          );
        const labelIds = [
          ...new Set([
            ...labels
              .filter((label) => label.assigned)
              .map((label) => label.id),
            args.labelId,
          ]),
        ];
        return patchWorkItem(
          args.key,
          args.idempotencyKey,
          { labelIds },
          args.expectedVersion,
        );
      }),
  );

  registerTool(
    "transition_work_item",
    {
      description: `Move a work item to another state (POST /api/work-items/{key}/transition; needs work_item:transition). ${WRITE_NOTICE} toStateTemplateId comes from list_work_item_transitions. A transition that needs an approval or a note is refused with the reason.`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        key: nonEmptyString,
        toStateTemplateId: nonEmptyString,
        note: z.string().max(10_000).optional(),
      }),
    },
    async (args) => {
      const { idempotencyKey, key, ...body } = args;
      return run(() =>
        client.json(
          `/api/work-items/${enc(key)}/transition`,
          writeInit("POST", idempotencyKey, body),
        ),
      );
    },
  );

  registerTool(
    "assign_work_item",
    {
      description: `Assign a work item to a person (POST /api/work-items/{key}/assign; needs work_item:assign). ${WRITE_NOTICE} Person ids come from list_people. Set expectedCurrentAssigneeId to refuse the change if someone else already holds the item.`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        key: nonEmptyString,
        assigneeId: nonEmptyString,
        expectedCurrentAssigneeId: nonEmptyString.nullable().optional(),
      }),
    },
    async (args) => {
      const { idempotencyKey, key, ...body } = args;
      return run(() =>
        client.json(
          `/api/work-items/${enc(key)}/assign`,
          writeInit("POST", idempotencyKey, body),
        ),
      );
    },
  );

  registerTool(
    "add_comment",
    {
      description: `Add a comment to a work item (POST /api/work-items/{key}/comments; needs comment:create for public, comment:create_internal for internal). ${WRITE_NOTICE} A PUBLIC comment is visible to the customer: choose visibility deliberately and never copy text from a ticket into one. Body is plain text.`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        key: nonEmptyString,
        body: nonEmptyString.max(50_000),
        visibility: z.enum(["public", "internal"]),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/work-items/${enc(args.key)}/comments`,
          writeInit("POST", args.idempotencyKey, {
            body: textToDoc(args.body),
            visibility: args.visibility,
          }),
        ),
      ),
  );

  registerTool(
    "log_time",
    {
      description: `Log time against a work item for the key's owner (POST /api/time-entries; needs time_entry:create). ${WRITE_NOTICE} Whole minutes only (1 to 1440), a calendar date that is not in the future and inside the workspace's backdating limit, and an activityId from list_time_activities. The hourly rate in force on that date is captured on the entry; the reply shows it only if the key's owner may see rates.`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        workspaceId: nonEmptyString,
        workItemId: nonEmptyString.describe(
          "The work item's id (from get_work_item), not its key",
        ),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/u, "YYYY-MM-DD")
          .describe("The day the work was done, YYYY-MM-DD"),
        minutes: z.number().int().min(1).max(1440),
        activityId: nonEmptyString,
        description: nonEmptyString.max(2000).optional(),
        billable: z.boolean().optional(),
      }),
    },
    async (args) => {
      const { idempotencyKey, ...body } = args;
      return run(() =>
        client.json(
          "/api/time-entries",
          writeInit("POST", idempotencyKey, body),
        ),
      );
    },
  );

  registerTool(
    "create_relation",
    {
      description: `Relate two work items (POST /api/work-items/{key}/relations; needs work_item:update on both). ${WRITE_NOTICE}`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        key: nonEmptyString,
        targetKey: nonEmptyString,
        type: z.enum([
          "relates",
          "blocks",
          "duplicates",
          "precedes",
          "requires",
        ]),
      }),
    },
    async (args) => {
      const { idempotencyKey, key, ...body } = args;
      return run(() =>
        client.json(
          `/api/work-items/${enc(key)}/relations`,
          writeInit("POST", idempotencyKey, body),
        ),
      );
    },
  );

  /* ---------------------------------------------------------------- *
   * Destructive tools: they only ask for a pending action (MC-7, MC-17, PA-10)
   * ---------------------------------------------------------------- */

  registerTool(
    "delete_work_item",
    {
      description: `Request deletion of a work item by key (DELETE /api/work-items/{key} → 202 pending action; needs work_item:delete). ${PENDING_DELETION_NOTICE}`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        key: nonEmptyString.describe("Work item key, e.g. PROJ-123"),
      }),
    },
    async (args) =>
      run(() =>
        requestPendingDeletion(
          client,
          `/api/work-items/${enc(args.key)}`,
          `work item ${args.key}`,
          args.idempotencyKey,
        ),
      ),
  );

  registerTool(
    "decide_approval",
    {
      description:
        "Request an approval decision through POST /api/approvals/{id}/decide (needs approval:decide; CAB approvals also need approval:decide_cab and current CAB-team membership). A read-only key is refused. This does not decide the approval yet. TaskDesk creates a pending action that the owner of this API key must approve in the web app within 15 minutes. The pending request is bound to this decision and note; a rejected approval needs its note. You cannot approve this request yourself; poll get_pending_action for the outcome.",
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        approvalId: nonEmptyString,
        action: z.enum(["approve", "reject"]),
        note: z.string().max(4000).nullable().optional(),
      }),
    },
    async (args) =>
      run(async () => {
        const body: Record<string, unknown> = { action: args.action };
        if (args.note !== undefined) body.note = args.note;
        const response = await client.json<unknown>(
          `/api/approvals/${enc(args.approvalId)}/decide`,
          writeInit("POST", args.idempotencyKey, body),
        );
        const record = isRecord(response) ? response : null;
        if (
          !record ||
          !isSafeToken(record.pendingActionId) ||
          record.action !== "mcp_destructive"
        ) {
          throw new Error(
            "TaskDesk did not confirm a pending approval-decision request. No approval decision was reported; ask the key's owner to check TaskDesk before retrying.",
          );
        }
        const expiresAt = isSafeTimestamp(record.expiresAt)
          ? record.expiresAt
          : null;
        return {
          status: "pending_human_approval",
          decided: false,
          pendingActionId: record.pendingActionId,
          approvalId: args.approvalId,
          requestedDecision: args.action,
          expiresAt,
          summary: record.summary ?? null,
          nextStep: `No approval decision has been made. TaskDesk opened pending action ${record.pendingActionId} to ${args.action} approval ${args.approvalId}. The API key owner must approve it in the TaskDesk web app${expiresAt ? ` before ${expiresAt}` : " within 15 minutes"}; poll get_pending_action with this pendingActionId for the outcome.`,
        };
      }),
  );

  registerTool(
    "delete_comment",
    {
      description: `Request deletion of a work-item comment by comment ID (DELETE /api/comments/{id} → 202 pending action; needs comment:delete_own for your own comment or comment:delete_any). The id must be a comment row id from get_work_item_activity (kind "comment"). ${PENDING_DELETION_NOTICE}`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        commentId: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        requestPendingDeletion(
          client,
          `/api/comments/${enc(args.commentId)}`,
          `comment ${args.commentId}`,
          args.idempotencyKey,
        ),
      ),
  );

  registerTool(
    "delete_relation",
    {
      description: `Request removal of a relation from a work item (DELETE /api/work-items/{key}/relations/{id} → 202 pending action; needs work_item:update on both ends). The relationId must come from list_work_item_relations. ${PENDING_DELETION_NOTICE}`,
      inputSchema: z.object({
        idempotencyKey: idempotencyKeySchema,
        key: nonEmptyString.describe("Key of a work item on either end"),
        relationId: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        requestPendingDeletion(
          client,
          `/api/work-items/${enc(args.key)}/relations/${enc(args.relationId)}`,
          `relation ${args.relationId} on work item ${args.key}`,
          args.idempotencyKey,
        ),
      ),
  );
}
