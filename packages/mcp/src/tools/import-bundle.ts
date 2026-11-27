import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { TaskDeskClient } from "../taskdesk/client.js";
import {
  MAX_BUNDLE_BYTES,
  type ParsedBundle,
  parseBundleText,
} from "../utils/import-bundle-schema.js";
import { isSafeToken } from "../utils/untrusted.js";

/**
 * TaskDesk import bundle tools (import-and-cutover.md "import.bundle"). Each tool is a thin wrapper
 * over routes that already exist (`/api/import-sources`, `/api/imports/{id}/...`), so their
 * policies, `instance:admin` check, destination project capability, the more-than-50-writes
 * approval and audit apply unchanged. The bundle file is read here, from `TASKDESK_IMPORT_DIR`, and
 * sent to the API by the server: its contents never pass through the model. No tool approves a
 * pending action, and none sets `confirmProposals`.
 */

const nonEmptyString = z.string().trim().min(1);
const idempotencyKey = z
  .string()
  .regex(/^[\x21-\x7E]{1,200}$/, "1 to 200 printable characters, no spaces")
  .describe(
    "Required. A unique id you choose for this change, e.g. a UUID. Retrying the same change (after a timeout, say) with the SAME key returns the original result instead of doing it twice. Use a NEW key for a different change.",
  );
const runId = nonEmptyString.max(128);
const filePath = nonEmptyString
  .max(1024)
  .describe(
    "Path of the bundle file, relative to TASKDESK_IMPORT_DIR (or absolute and inside it). Symbolic links and files over 8 MB are refused.",
  );

const IMPORT_BUNDLE_WRITE_NOTICE =
  "This changes data. It needs instance:admin and work_item:create on the destination project, and a write-enabled key (keys are read-only by default; a read-only key is refused). It is audited as an agent action. A run that writes more than 50 records needs approval by the key owner in TaskDesk; this tool cannot approve it.";

const POLL_ATTEMPTS = 20;
const POLL_DELAY_MS = 1500;
const MAX_ROWS = 50;

/** A failure with a fixed, trusted message; never carries file content or a full path. */
class BundleToolError extends Error {}

export type ImportBundleDeps = {
  client: Pick<TaskDeskClient, "json">;
  /** Registers a tool with the package's tracking and untrusted-output notice. */
  registerTool: McpServer["registerTool"];
  /** MC-15: wraps the result as untrusted output and turns API errors into guidance. */
  run: (fn: () => Promise<unknown>) => Promise<CallToolResult>;
  writeInit: (
    method: "POST" | "PATCH" | "DELETE",
    idempotencyKey: string,
    body?: unknown,
  ) => RequestInit;
  scopedKey: (key: string, operation: string) => string;
  /** Defaults to `process.env.TASKDESK_IMPORT_DIR`. */
  importDir?: () => string | undefined;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Reads one bundle file. The path must resolve under the import directory; a symbolic link (the file
 * itself, or any directory on the way out of the import directory), a non-regular file and a file
 * over the bundle limit are refused. The file is opened with O_NOFOLLOW and checked on the open
 * descriptor, so a swap after the check cannot change what is read.
 */
export async function readBundleFile(
  path: string,
  importDir: string | undefined,
): Promise<string> {
  if (!importDir)
    throw new BundleToolError(
      "TASKDESK_IMPORT_DIR is not set. Set it to the directory that holds your bundle files in the MCP server's environment.",
    );
  const name = basename(path);
  let base: string;
  try {
    base = await realpath(importDir);
  } catch {
    throw new BundleToolError("TASKDESK_IMPORT_DIR does not exist.");
  }
  // The import dir may be given through a link (macOS /var -> /private/var): accept either spelling.
  const configured = resolve(importDir);
  const candidate = isAbsolute(path)
    ? resolve(path)
    : resolve(configured, path);
  const root = [configured, base].find((r) => candidate.startsWith(r + sep));
  if (!root)
    throw new BundleToolError(
      `${name}: the file must be inside TASKDESK_IMPORT_DIR.`,
    );
  const expected = resolve(base, relative(root, candidate));
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    throw new BundleToolError(`${name}: file not found.`);
  }
  // realpath resolves links: a different result means a link somewhere under the import directory.
  if (real !== expected)
    throw new BundleToolError(
      `${name}: symbolic links are not allowed in the bundle path.`,
    );
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new BundleToolError(`${name}: the file could not be opened.`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile())
      throw new BundleToolError(`${name}: not a regular file.`);
    if (info.size > MAX_BUNDLE_BYTES) throw tooLarge(name);
    const text = await handle.readFile("utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_BUNDLE_BYTES)
      throw tooLarge(name);
    return text;
  } catch (error) {
    // Node's own messages carry the full path; only fixed text leaves this function.
    throw error instanceof BundleToolError
      ? error
      : new BundleToolError(`${name}: the file could not be read.`);
  } finally {
    await handle.close();
  }
}

const tooLarge = (name: string) =>
  new BundleToolError(
    `${name}: larger than the ${MAX_BUNDLE_BYTES / 1_000_000} MB bundle limit.`,
  );

function summarize(bundle: ParsedBundle) {
  let comments = 0;
  let attachments = 0;
  let relations = 0;
  let history = 0;
  const perProject = new Map<string, number>();
  for (const item of bundle.items) {
    comments += item.comments?.length ?? 0;
    attachments += item.attachments?.length ?? 0;
    relations += item.relations?.length ?? 0;
    history += item.history?.length ?? 0;
    perProject.set(item.project, (perProject.get(item.project) ?? 0) + 1);
  }
  return {
    counts: {
      people: bundle.people.size,
      projects: bundle.projects.size,
      memberships: bundle.memberships.length,
      states: bundle.states.size,
      labels: bundle.labels.size,
      items: bundle.items.length,
      comments,
      attachments,
      relations,
      history,
    },
    projects: [...bundle.projects.values()].map((p) => ({
      key: p.key,
      name: p.name,
      items: perProject.get(p.id) ?? 0,
    })),
  };
}

const target = z.union([
  z.object({ kind: z.literal("target"), id: nonEmptyString.max(128) }).strict(),
  z
    .object({
      kind: z.literal("group"),
      group: z.enum([
        "backlog",
        "unstarted",
        "started",
        "completed",
        "cancelled",
      ]),
      stateId: nonEmptyString.max(128).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("priority"),
      value: z.enum(["low", "medium", "high", "urgent"]),
    })
    .strict(),
  z.object({ kind: z.literal("placeholder") }).strict(),
  z.object({ kind: z.literal("ignore") }).strict(),
]);
const mappingEntry = z
  .object({
    domain: z.enum([
      "type",
      "state",
      "priority",
      "person",
      "label",
      "module",
      "cycle",
      "custom_field",
      "project",
    ]),
    value: nonEmptyString.max(512),
    target: target.nullable(),
  })
  .strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function registerImportBundleTools(deps: ImportBundleDeps): void {
  const { client, registerTool, run, writeInit, scopedKey } = deps;
  const importDir = deps.importDir ?? (() => process.env.TASKDESK_IMPORT_DIR);
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const enc = encodeURIComponent;

  /** Polls the run until its background setup step (`kind`) is no longer running. */
  async function waitForJob(id: string, kind: "discover" | "dry_run") {
    let engine: unknown;
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      engine = await client.json<unknown>(`/api/imports/${enc(id)}/engine`, {
        method: "GET",
      });
      const job = isRecord(engine) && isRecord(engine.job) ? engine.job : null;
      if (job && job.kind === kind && job.status !== "running")
        return { engine, finished: true };
      await sleep(POLL_DELAY_MS);
    }
    return { engine, finished: false };
  }

  const jobOf = (engine: unknown) =>
    isRecord(engine) && isRecord(engine.job)
      ? {
          status: engine.job.status,
          failure: engine.job.failure ?? null,
          pagesRead: engine.job.pagesRead,
          recordsProcessed: engine.job.recordsProcessed,
        }
      : null;

  registerTool(
    "validate_import_bundle",
    {
      description:
        "Validate a TaskDesk import bundle (NDJSON, bundleVersion 1) from TASKDESK_IMPORT_DIR. Makes no API call and changes nothing: it returns counts, the projects in the file and the first line-addressed errors and warnings. Run it before import_bundle_start.",
      inputSchema: z.object({ path: filePath }).strict(),
    },
    async (args) =>
      run(async () => {
        const bundle = parseBundleText(
          await readBundleFile(args.path, importDir()),
          { maxIssues: 20 },
        );
        return {
          valid: bundle.errorCount === 0,
          source: bundle.header?.source ?? null,
          ...summarize(bundle),
          errorCount: bundle.errorCount,
          errors: bundle.errors,
          warnings: bundle.warnings,
        };
      }),
  );

  registerTool(
    "import_bundle_start",
    {
      description: `Start an import of one project of a bundle file (POST /api/import-sources, /api/import-sources/{id}/runs, /api/imports/{id}/discover). ${IMPORT_BUNDLE_WRITE_NOTICE} projectId is an existing TaskDesk project (nothing is created); a bundle with several projects needs one run per projectKey. sourceRef defaults to "<system>:<instance>:<workspace>" from the file header, so a re-run of the same source updates the records it created instead of duplicating them. Returns the runId and the mapping that still needs a decision.`,
      inputSchema: z
        .object({
          idempotencyKey,
          workspaceId: nonEmptyString.max(128),
          projectId: nonEmptyString.max(128),
          projectKey: nonEmptyString
            .max(64)
            .optional()
            .describe(
              "Which project of the bundle to import. Optional when the file holds exactly one.",
            ),
          sourceRef: nonEmptyString.max(200).optional(),
          path: filePath,
        })
        .strict(),
    },
    async (args) =>
      run(async () => {
        const text = await readBundleFile(args.path, importDir());
        const bundle = parseBundleText(text, { maxIssues: 5 });
        if (bundle.errorCount > 0)
          throw new BundleToolError(
            `The bundle has ${bundle.errorCount} error(s). Run validate_import_bundle and fix them first. Nothing was sent to TaskDesk.`,
          );
        const projects = [...bundle.projects.values()];
        const project = args.projectKey
          ? projects.find(
              (p) => p.key.toLowerCase() === args.projectKey?.toLowerCase(),
            )
          : projects.length === 1
            ? projects[0]
            : undefined;
        if (!project)
          throw new BundleToolError(
            args.projectKey
              ? "That projectKey is not in the bundle. Nothing was sent to TaskDesk."
              : "The bundle holds several projects: pass projectKey (one run per project). Nothing was sent to TaskDesk.",
          );
        const source = bundle.header?.source;
        const sourceRef =
          args.sourceRef ??
          `${source?.system}:${source?.instance}:${source?.workspace}`;
        if (sourceRef.length > 200)
          throw new BundleToolError(
            "The default sourceRef is longer than 200 characters. Pass a shorter sourceRef.",
          );
        const created = await client.json<unknown>(
          "/api/import-sources",
          writeInit("POST", scopedKey(args.idempotencyKey, "bundle-source"), {
            workspaceId: args.workspaceId,
            pluginId: "import.bundle",
            name: `bundle ${project.key} ${scopedKey(args.idempotencyKey, "bundle-name").slice(-12)}`,
            config: { bundleText: text, projectKey: project.key },
          }),
        );
        if (!isRecord(created) || typeof created.id !== "string")
          throw new BundleToolError(
            "TaskDesk did not return a usable import source. It may exist; list import sources before retrying.",
          );
        const run2 = await client.json<unknown>(
          `/api/import-sources/${enc(created.id)}/runs`,
          writeInit("POST", scopedKey(args.idempotencyKey, "bundle-run"), {
            projectId: args.projectId,
            sourceRef,
          }),
        );
        if (!isRecord(run2) || typeof run2.id !== "string")
          throw new BundleToolError(
            "TaskDesk did not return a usable import run. It may exist; check the import runs before retrying.",
          );
        const id = run2.id;
        await client.json(
          `/api/imports/${enc(id)}/discover`,
          writeInit("POST", scopedKey(args.idempotencyKey, "bundle-discover")),
        );
        const waited = await waitForJob(id, "discover");
        const base = {
          runId: id,
          sourceId: created.id,
          projectKey: project.key,
          job: jobOf(waited.engine),
        };
        if (!waited.finished)
          return {
            ...base,
            status: "discovery_running",
            nextStep:
              "Discovery is still running. Call import_bundle_mapping with action=read in a moment.",
          };
        const mapping = await client.json<unknown>(
          `/api/imports/${enc(id)}/mapping`,
          { method: "GET" },
        );
        return {
          ...base,
          status: "discovered",
          ...mappingSummary(mapping),
          nextStep:
            "Decide every blocking mapping entry with import_bundle_mapping (action=update; one explicit target per entry, including the ones proposed), then call import_bundle_dry_run.",
        };
      }),
  );

  /** What the agent needs to decide: version, completeness and the blocking entries. */
  function mappingSummary(mapping: unknown) {
    if (!isRecord(mapping))
      throw new BundleToolError(
        "TaskDesk returned an unreadable mapping. Check the import run before retrying.",
      );
    const completeness = isRecord(mapping.completeness)
      ? mapping.completeness
      : null;
    const blocking = Array.isArray(completeness?.blocking)
      ? completeness.blocking
      : [];
    const entries = Array.isArray(mapping.entries) ? mapping.entries : [];
    return {
      mappingVersion: mapping.mappingVersion,
      complete: completeness?.complete ?? null,
      entryCount: entries.length,
      blockingCount: blocking.length,
      blocking: blocking.slice(0, MAX_ROWS),
      proposals: entries
        .filter((e) => isRecord(e) && e.status === "proposed")
        .slice(0, MAX_ROWS),
      discovery: mapping.discovery ?? null,
    };
  }

  registerTool(
    "import_bundle_mapping",
    {
      description: `Read or edit the mapping of a bundle import run (GET/POST /api/imports/{id}/mapping). Use action "read" to see what is decided and what still blocks the run. Use action "update" with explicit entries: each entry names a domain, the value exactly as read, and a target (state -> {kind:"group",group}, priority -> {kind:"priority",value}, type/person/label -> {kind:"target",id} with an existing TaskDesk id, person -> {kind:"placeholder"} for a person with no TaskDesk account, or {kind:"ignore"}). Proposed entries are not decided until you send them back explicitly; this tool cannot confirm proposals in bulk. Editing needs instance:admin and work_item:create on the destination project and a write-enabled key (a read-only key is refused); reading needs only read access.`,
      inputSchema: z.discriminatedUnion("action", [
        z.object({ action: z.literal("read"), runId }).strict(),
        z
          .object({
            action: z.literal("update"),
            idempotencyKey,
            runId,
            expectedMappingVersion: z.number().int().min(0).safe(),
            entries: z.array(mappingEntry).min(1).max(500),
          })
          .strict(),
      ]),
    },
    async (args) =>
      run(async () => {
        if (args.action === "read")
          return mappingSummary(
            await client.json<unknown>(
              `/api/imports/${enc(args.runId)}/mapping`,
              { method: "GET" },
            ),
          );
        return mappingSummary(
          await client.json<unknown>(
            `/api/imports/${enc(args.runId)}/mapping`,
            writeInit(
              "POST",
              scopedKey(args.idempotencyKey, "bundle-mapping"),
              {
                expectedMappingVersion: args.expectedMappingVersion,
                entries: args.entries,
              },
            ),
          ),
        );
      }),
  );

  registerTool(
    "import_bundle_dry_run",
    {
      description: `Run the whole-run dry run of a bundle import (POST /api/imports/{id}/dry-run-all, then GET). It writes nothing. ${IMPORT_BUNDLE_WRITE_NOTICE} The report has the counts, the losses (what the bundle carries that TaskDesk does not store) and the dryRunDigest, mappingVersion and totalCount that import_bundle_apply needs. Show the losses to the owner before applying.`,
      inputSchema: z.object({ idempotencyKey, runId }).strict(),
    },
    async (args) =>
      run(async () => {
        await client.json(
          `/api/imports/${enc(args.runId)}/dry-run-all`,
          writeInit("POST", scopedKey(args.idempotencyKey, "bundle-dry-run")),
        );
        const waited = await waitForJob(args.runId, "dry_run");
        const job = jobOf(waited.engine);
        if (!waited.finished)
          return {
            status: "dry_run_running",
            runId: args.runId,
            job,
            nextStep:
              "The dry run is still running. Call import_bundle_dry_run again with the SAME idempotencyKey: the repeat does not start a second dry run, it waits for this one and then returns the report. import_bundle_status shows progress.",
          };
        if (job?.status === "failed")
          return { status: "dry_run_failed", runId: args.runId, job };
        const report = await client.json<unknown>(
          `/api/imports/${enc(args.runId)}/dry-run-all`,
          { method: "GET" },
        );
        if (!isRecord(report) || typeof report.digest !== "string")
          throw new BundleToolError(
            "TaskDesk did not return a complete dry-run report. Check the import run before retrying.",
          );
        const counts = isRecord(report.counts) ? report.counts : {};
        const losses = Array.isArray(report.losses) ? report.losses : [];
        return {
          status: "dry_run_ready",
          runId: args.runId,
          dryRunDigest: report.digest,
          mappingVersion: report.mappingVersion,
          totalCount: counts.processed ?? null,
          counts,
          writes: report.writes,
          approvalRequired: report.approvalRequired,
          complete: report.complete,
          rejectionCodes: report.rejectionCodes ?? {},
          lossRecords: report.lossRecords,
          lossCount: losses.length,
          losses: losses.slice(0, MAX_ROWS),
          samples: report.samples ?? null,
          nextStep:
            "Show the losses and rejections to the owner. To import, call import_bundle_apply with the dryRunDigest, mappingVersion and totalCount from this report.",
        };
      }),
  );

  registerTool(
    "import_bundle_apply",
    {
      description: `Execute a dry-run-approved bundle import (POST /api/imports/{id}/execute). ${IMPORT_BUNDLE_WRITE_NOTICE} Pass the dryRunDigest, mappingVersion and totalCount from import_bundle_dry_run exactly. Unmapped entries or a stale dry run are refused. Returns "pending_human_approval" with a pendingActionId when the run writes more than 50 records: the owner approves it in TaskDesk, then poll get_pending_action and import_bundle_status.`,
      inputSchema: z
        .object({
          idempotencyKey,
          runId,
          dryRunDigest: z.string().regex(/^[a-f0-9]{64}$/),
          mappingVersion: z.number().int().positive().safe(),
          totalCount: z.number().int().min(0).safe(),
        })
        .strict(),
    },
    async (args) =>
      run(async () => {
        const result = await client.json<unknown>(
          `/api/imports/${enc(args.runId)}/execute`,
          writeInit("POST", scopedKey(args.idempotencyKey, "bundle-apply"), {
            dryRunDigest: args.dryRunDigest,
            mappingVersion: args.mappingVersion,
            totalCount: args.totalCount,
          }),
        );
        if (!isRecord(result))
          throw new BundleToolError(
            "TaskDesk returned an unreadable result. Check the import run before retrying.",
          );
        if (result.status === "pending_approval") {
          if (!isSafeToken(result.pendingActionId))
            throw new BundleToolError(
              "TaskDesk requested approval but did not return a pending action id. Check the import run before retrying.",
            );
          return {
            status: "pending_human_approval",
            executed: false,
            runId: args.runId,
            pendingActionId: result.pendingActionId,
            nextStep:
              "Nothing has been imported. The API key owner must approve the pending action in the TaskDesk web app; this tool cannot approve it. Then poll get_pending_action with this pendingActionId and import_bundle_status for the run.",
          };
        }
        if (result.status !== "started")
          throw new BundleToolError(
            "TaskDesk returned an unrecognized result. Check the import run before retrying.",
          );
        return {
          status: "started",
          runId: args.runId,
          nextStep: "The import is running. Poll import_bundle_status.",
        };
      }),
  );

  registerTool(
    "import_bundle_status",
    {
      description:
        "Read-only status of a bundle import run (GET /api/imports/{id}/engine and /losses): phase, state, paused reason, progress, the approval binding and the loss summary. Use it after import_bundle_apply, and with get_pending_action while an approval is waiting.",
      inputSchema: z.object({ runId }).strict(),
    },
    async (args) =>
      run(async () => {
        const [engine, losses] = await Promise.all([
          client.json<unknown>(`/api/imports/${enc(args.runId)}/engine`, {
            method: "GET",
          }),
          client.json<unknown>(
            `/api/imports/${enc(args.runId)}/losses?limit=1`,
            { method: "GET" },
          ),
        ]);
        return {
          run: engine,
          lossSummary: isRecord(losses) ? (losses.summary ?? []) : [],
        };
      }),
  );
}
