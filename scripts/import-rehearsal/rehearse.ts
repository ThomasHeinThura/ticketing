/**
 * P6 cutover rehearsal: runs the whole import/cutover/rollback cycle against a restored COPY
 * database and records evidence. It is a rehearsal, not a cutover: it never touches a source
 * system and never runs against the live browser database (see ./guard.ts).
 *
 * Usage (from the repository root; the database must already be migrated, including 0199):
 *
 *   TASKDESK_DATABASE_URL=<owner url of the COPY> TASKDESK_AUTH_SECRET=... TASKDESK_ENCRYPTION_KEY=... \
 *     pnpm --filter @taskdesk/api exec tsx ../../scripts/import-rehearsal/rehearse.ts \
 *       --confirm-copy=<database name> [--report-dir docs/report/audit] [--work-dir <dir>] \
 *       [--rows 48] [--chunk 4] [--kill-after-chunks 2]
 *
 * Steps (each timed and recorded):
 *   1 guard + migration check          6 delta re-import, worker killed (SIGKILL) mid-run
 *   2 provision throwaway workspace    7 resume through the API from the last committed chunk
 *   3 backup (pg_dump + attachments)   8 rerun: 0 duplicates, 0 writes
 *   4 baseline counts                  9 reconciliation (API route when mounted, else service)
 *   5 staged CSV import via the API   10 rollback: restore from the backup, prove baseline again
 *                                     11 record cutover_rehearsal row + JSON report
 *
 * The backup/restore steps mirror scripts/backup.sh and scripts/restore.sh (dump, list check,
 * SHA-256, attachment tar; drop/create, restore, attachment replace) against a native PostgreSQL,
 * because those scripts drive `docker compose`. Production still uses the real scripts.
 *
 * What this does NOT prove (docs/technical/import-and-cutover.md): there is no whole-run undo,
 * no atomic cross-system cutover and no product freeze contract. The freeze boundary recorded
 * here is rehearsal-defined. Recovery is restore from backup, which this proves on the copy.
 */
import "./guard";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { genericCsvProfile } from "../../apps/api/src/imports/adapters/csv";
import { createCsvFamilyAdapter } from "../../apps/api/src/imports/adapters/csv/core";
import {
  registerImportAdapter,
  unregisterImportAdapter,
} from "../../apps/api/src/imports/engine/adapter";
import {
  runImportRunJob,
  setImportEngineAutoStart,
} from "../../apps/api/src/imports/engine/runner";
import { loadEngineRun } from "../../apps/api/src/imports/engine/store";
import {
  computeAndStoreReconciliation,
  reconciliationDto,
} from "../../apps/api/src/imports/reconciliation/service";
import { createApp } from "../../apps/api/src/index";
import { withConfiguredAgentAuthority } from "../../tests/api-integration/helpers/agent-authority";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
} from "../../tests/api-integration/helpers/fixtures";
import { ensureCreationWorkflow } from "../../tests/api-integration/helpers/workflow";
import { pgToolEnv, target } from "./guard";

// biome-ignore lint/suspicious/noExplicitAny: loose API bodies
type Json = Record<string, any>;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const apiDir = join(repoRoot, "apps/api");
/** The scripts directory has no node_modules; `pg` is resolved from the API package. */
type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};
const { Client } = createRequire(join(apiDir, "package.json"))("pg") as {
  Client: new (options: { connectionString: string }) => PgClient;
};
/** Plain parameterised SQL through the application's own pool. */
const q = async (text: string, params: unknown[] = []) =>
  (await getDatabasePool().query(text, params)).rows as Record<
    string,
    unknown
  >[];
const count = async (text: string, params: unknown[] = []) =>
  Number(((await q(text, params))[0] as { n: string }).n);

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1]
    ? (process.argv[i + 1] as string)
    : fallback;
};
const ROWS = Number(arg("--rows", "48"));
const CHUNK = Number(arg("--chunk", "4"));
const KILL_AFTER = Number(arg("--kill-after-chunks", "2"));
const SOURCE_REF = "rehearsal.csv";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

// --- adapter ------------------------------------------------------------------------------------

function registerRehearsalAdapter(delayMs: number) {
  unregisterImportAdapter("import.csv");
  registerImportAdapter("import.csv", () => {
    const base = createCsvFamilyAdapter(genericCsvProfile, CHUNK);
    if (!delayMs) return base;
    // A per-page delay only widens the window in which the worker is killed.
    return {
      ...base,
      readPage: async (...args: Parameters<typeof base.readPage>) => {
        await sleep(delayMs);
        return base.readPage(...args);
      },
    };
  });
}

// --- worker mode: the process that gets killed ---------------------------------------------------

if (process.argv.includes("--worker")) {
  const runId = process.argv[process.argv.indexOf("--worker") + 1] as string;
  setImportEngineAutoStart(false);
  registerRehearsalAdapter(Number(arg("--page-delay-ms", "0")));
  await runImportRunJob(runId);
  process.exit(0);
}

// --- fixtures -----------------------------------------------------------------------------------

const HEADER =
  "external_id,title,description,type,state,priority,parent_external_id";
function csvRow(i: number, over: { description?: string } = {}) {
  const id = `SRC-${i}`;
  const parent = i > 10 && i <= 20 ? `SRC-${i - 10}` : "";
  const state = i % 3 === 0 ? "Done" : i % 3 === 1 ? "In Progress" : "Backlog";
  const description = over.description ?? `Rehearsal item ${i}`;
  return `${id},Rehearsal item ${i},${description},task,${state},medium,${parent}`;
}
/** Base snapshot: ROWS-1 valid rows plus one row with an empty title (a rejected row). */
function baseCsv() {
  const rows = Array.from({ length: ROWS - 1 }, (_, i) => csvRow(i + 1));
  rows.push("SRC-BAD,,No title,task,Backlog,low,");
  return [HEADER, ...rows].join("\n");
}
/** Delta snapshot: 5 changed rows, 3 new rows, the last 2 base rows removed (stale). */
function deltaCsv() {
  const valid = ROWS - 1;
  const rows: string[] = [];
  for (let i = 1; i <= valid - 2; i += 1)
    rows.push(
      csvRow(
        i,
        i >= 5 && i <= 9 ? { description: `Changed in delta ${i}` } : {},
      ),
    );
  for (let i = valid + 1; i <= valid + 3; i += 1) rows.push(csvRow(i));
  rows.push("SRC-BAD,,No title,task,Backlog,low,");
  return [HEADER, ...rows].join("\n");
}

// --- bookkeeping --------------------------------------------------------------------------------

type Step = {
  name: string;
  status: "passed" | "failed";
  ms: number;
  detail?: Record<string, unknown>;
};
const steps: Step[] = [];
const timings: Record<string, number> = {};
const startedAt = new Date();

async function step<T>(
  name: string,
  fn: () => Promise<T>,
  detail?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const t0 = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - t0);
    steps.push({
      name,
      status: "passed",
      ms,
      ...(detail ? { detail: detail(result) } : {}),
    });
    timings[name] = ms;
    process.stdout.write(`ok   ${name} (${ms} ms)\n`);
    return result;
  } catch (error) {
    const ms = Math.round(performance.now() - t0);
    steps.push({
      name,
      status: "failed",
      ms,
      detail: {
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      },
    });
    timings[name] = ms;
    process.stdout.write(`FAIL ${name}\n`);
    throw error;
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- pg tooling (mirrors scripts/backup.sh and scripts/restore.sh) ------------------------------

function tool(command: string, args: string[], input?: Buffer) {
  const result = spawnSync(command, args, {
    env: pgToolEnv(),
    ...(input ? { input } : {}),
    maxBuffer: 1 << 28,
  });
  if (result.status !== 0)
    throw new Error(
      `${command} failed (${result.status}): ${String(result.stderr).slice(0, 300)}`,
    );
  return result.stdout;
}

function manifest(dir: string) {
  const entries: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else entries.push(`${relative(dir, full)}:${sha256(readFileSync(full))}`);
    }
  };
  if (existsSync(dir)) walk(dir);
  return { files: entries.length, sha256: sha256(entries.join("\n")) };
}

// --- main ---------------------------------------------------------------------------------------

type Counts = {
  workItems: number;
  importRuns: number;
  importLinks: number;
  importedProvenance: number;
  importLosses: number;
  migrations: number;
};
async function countsOf(): Promise<Counts> {
  return {
    workItems: await count("SELECT count(*) AS n FROM work_item"),
    importRuns: await count("SELECT count(*) AS n FROM import_run"),
    importLinks: await count("SELECT count(*) AS n FROM import_record_link"),
    importedProvenance: await count(
      "SELECT count(*) AS n FROM external_link WHERE origin = 'imported'",
    ),
    importLosses: await count("SELECT count(*) AS n FROM import_loss"),
    migrations: await count(
      "SELECT count(*) AS n FROM drizzle.__drizzle_migrations",
    ),
  };
}

const rehearsalId = `rehearsal-${startedAt.toISOString().replace(/[:.]/gu, "-")}`;
const workDir = resolve(
  arg("--work-dir", join(tmpdir(), `taskdesk-${rehearsalId}`)),
);
const reportDir = resolve(repoRoot, arg("--report-dir", "docs/report/audit"));
const backupDir = join(workDir, "backup");
const attachmentsDir = join(workDir, "attachments");

const { app } = createApp();
let apiKey = "";
async function api(
  path: string,
  init: RequestInit = {},
  expected = 200,
): Promise<Json> {
  const headers = new Headers(init.headers);
  headers.set("x-api-key", apiKey);
  if (init.method === "POST") {
    headers.set("content-type", "application/json");
    headers.set("Idempotency-Key", randomUUID());
  }
  const configured = withConfiguredAgentAuthority(path, { ...init, headers });
  const response = await app.request(configured.input, configured.init);
  const text = await response.text();
  if (response.status !== expected)
    throw new Error(
      `${init.method ?? "GET"} ${path.replace(/[a-z0-9]{20,}/gu, ":id")} -> ${response.status} (expected ${expected})`,
    );
  return text ? (JSON.parse(text) as Json) : {};
}
const post = (body: unknown = {}): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

type Ctx = {
  userId: string;
  workspaceId: string;
  projectId: string;
  typeId: string;
};

async function provision(): Promise<Ctx> {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  await q("UPDATE \"user\" SET role = 'admin' WHERE id = $1", [user.id]);
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  await grantWorkItemProjectAccess(user.id, project.id);
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId: workspace.id,
      key: "task",
      name: "Task",
      category: "delivery",
    })
    .returning();
  assert(type, "provisioning failed");
  // One state per group the fixture uses, so state-group rows can reconcile.
  for (const [group, name, isDefault] of [
    ["backlog", "Backlog", true],
    ["started", "In Progress", false],
    ["completed", "Done", false],
  ] as const) {
    const [template] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: workspace.id,
        key: `rehearsal-${group}`,
        name,
        group,
      })
      .returning();
    assert(template, "provisioning failed");
    await db.insert(schema.stateTable).values({
      projectId: project.id,
      stateTemplateId: template.id,
      isDefault,
    });
  }
  await ensureCreationWorkflow({
    workspaceId: workspace.id,
    projectId: project.id,
    typeId: type.id,
  });
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.mcp", enabled: true })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true },
    });
  const key = await createPersonalApiKey(
    { userId: user.id },
    {
      name: "rehearsal",
      capabilities: [
        "instance:admin",
        "work_item:create",
        "work_item:read",
        "work_item:update",
      ],
      isMcp: true,
    },
  );
  apiKey = key.key;
  return {
    userId: user.id,
    workspaceId: workspace.id,
    projectId: project.id,
    typeId: type.id,
  };
}

/** Source connection + run + discovery + the operator's mapping decisions. */
async function prepareRun(ctx: Ctx, csvText: string, name: string) {
  const source = await api(
    "/api/import-sources",
    post({
      workspaceId: ctx.workspaceId,
      pluginId: "import.csv",
      name,
      config: { csvText },
    }),
  );
  const run = await api(
    `/api/import-sources/${source.id}/runs`,
    post({ projectId: ctx.projectId, sourceRef: SOURCE_REF }),
  );
  const mapping = await api(`/api/imports/${run.id}/discover`, post());
  const edits = (mapping.entries as Json[])
    .filter((e) => e.target === null || e.domain === "type")
    .map((e) => ({
      domain: e.domain,
      value: e.value,
      target:
        e.domain === "type"
          ? { kind: "target", id: ctx.typeId }
          : e.domain === "state"
            ? { kind: "group", group: "started" }
            : { kind: "ignore" },
    }));
  const confirmed = await api(
    `/api/imports/${run.id}/mapping`,
    post({
      expectedMappingVersion: mapping.mappingVersion,
      entries: edits,
      confirmProposals: true,
    }),
  );
  assert(confirmed.completeness?.complete, "mapping is not complete");
  const dry = await api(`/api/imports/${run.id}/dry-run-all`, post());
  return { source, run, dry };
}
async function startExecution(runId: string, dry: Json) {
  await api(
    `/api/imports/${runId}/execute`,
    post({
      dryRunDigest: dry.digest,
      mappingVersion: dry.mappingVersion,
      totalCount: dry.counts.processed,
    }),
    202,
  );
}
async function runRow(runId: string) {
  return db.transaction((tx) => loadEngineRun(tx, runId, "share"));
}
async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null>,
  ms = 90_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null) return value;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function duplicates(ctx: Ctx) {
  const scope =
    "workspace_id = $1 AND plugin_id = 'import.csv' AND source_ref = $2 AND target_type = 'work_item'";
  const args = [ctx.workspaceId, SOURCE_REF];
  const prov =
    "FROM external_link WHERE workspace_id = $1 AND system = $2 AND origin = 'imported' AND entity_type = 'work_item'";
  return {
    links: await count(
      `SELECT count(*) AS n FROM import_record_link WHERE ${scope}`,
      args,
    ),
    distinctSources: await count(
      `SELECT count(DISTINCT (source_type, source_id)) AS n FROM import_record_link WHERE ${scope}`,
      args,
    ),
    distinctTargets: await count(
      `SELECT count(DISTINCT target_id) AS n FROM import_record_link WHERE ${scope}`,
      args,
    ),
    prov: await count(`SELECT count(*) AS n ${prov}`, args),
    provDistinct: await count(
      `SELECT count(DISTINCT external_id) AS n ${prov}`,
      args,
    ),
    items: await count(
      `SELECT count(*) AS n FROM work_item WHERE id IN (SELECT target_id FROM import_record_link WHERE ${scope})`,
      args,
    ),
    duplicateKeys: await count(
      `SELECT count(*) AS n FROM (SELECT source_type, source_id FROM import_record_link WHERE ${scope} GROUP BY 1, 2 HAVING count(*) > 1) d`,
      args,
    ),
  };
}

async function reconcile(runId: string) {
  let via = "service";
  let httpStatus = 0;
  let dto: Json | null = null;
  try {
    const configured = withConfiguredAgentAuthority(
      `/api/imports/${runId}/reconciliation`,
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Idempotency-Key": randomUUID(),
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    const response = await app.request(configured.input, configured.init);
    httpStatus = response.status;
    // An unmounted route can fall through to the SPA shell, so require the JSON shape.
    const parsed = (await response.json().catch(() => null)) as Json | null;
    if (response.status === 200 && parsed?.reconciliation?.runId === runId) {
      via = "api";
      dto = parsed.reconciliation as Json;
    }
  } catch {
    httpStatus = -1;
  }
  if (!dto) {
    const run = await runRow(runId);
    const row = await db.transaction((tx) =>
      computeAndStoreReconciliation(tx, run, null),
    );
    dto = reconciliationDto(row) as unknown as Json;
  }
  const body = dto;
  return {
    via,
    httpStatus,
    status: body.status as string,
    version: body.version as number,
    rows: body.rows as Json[],
    failedChecks: (body.checks as Json[])
      .filter((c) => !c.ok)
      .map((c) => ({ code: c.code, severity: c.severity })),
    losses: (body.losses as Json).byCode.map((g: Json) => ({
      code: g.code,
      count: g.count,
    })),
    rejections: body.rejections as Json[],
    staleLinks: (body.staleLinks as Json).links,
    spotCheck: {
      seed: (body.spotCheck as Json).seed,
      items: (body.spotCheck as Json).items.length,
    },
  };
}

async function main() {
  mkdirSync(workDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  const report: Json = {
    rehearsalId,
    database: target.database,
    startedAt: startedAt.toISOString(),
  };
  let status: "passed" | "failed" = "failed";
  let ctx: Ctx | null = null;
  let finalRunId: string | null = null;
  try {
    await step("guard and migration check", async () => {
      const pool = getDatabasePool();
      assert(
        new URL(String(pool.options.connectionString)).pathname.slice(1) ===
          target.database,
        "application pool does not point at the confirmed copy",
      );
      await q("SELECT 1 FROM cutover_rehearsal LIMIT 1");
      await q("SELECT 1 FROM import_reconciliation LIMIT 1");
    });

    ctx = await step("provision throwaway workspace", provision, (c) => ({
      workspaceProvisioned: true,
      projectProvisioned: Boolean(c.projectId),
    }));

    mkdirSync(attachmentsDir, { recursive: true });
    writeFileSync(
      join(attachmentsDir, "rehearsal-marker.txt"),
      `marker ${rehearsalId}\n`,
    );
    const baseline = await step("baseline counts", countsOf, (c) => ({ ...c }));
    const attachmentsBefore = manifest(attachmentsDir);

    const backup = await step(
      "backup database and attachments",
      async () => {
        const dump = join(backupDir, "postgres.dump");
        tool("pg_dump", ["-Fc", "-f", dump]);
        const listed = String(tool("pg_restore", ["--list", dump]))
          .split("\n")
          .filter((l) => l && !l.startsWith(";")).length;
        assert(listed > 0, "pg_restore --list returned no entries");
        const tar = join(backupDir, "attachments.tar");
        const packed = spawnSync("tar", [
          "-C",
          attachmentsDir,
          "-cf",
          tar,
          ".",
        ]);
        assert(packed.status === 0, "attachment archive failed");
        const sums = [
          `${sha256(readFileSync(dump))}  postgres.dump`,
          `${sha256(readFileSync(tar))}  attachments.tar`,
        ];
        writeFileSync(join(backupDir, "SHA256SUMS"), `${sums.join("\n")}\n`, {
          mode: 0o600,
        });
        return {
          takenAt: new Date().toISOString(),
          dumpBytes: statSync(dump).size,
          dumpSha256: sums[0]?.slice(0, 64),
          restoreListEntries: listed,
          attachmentsTarBytes: statSync(tar).size,
        };
      },
      (b) => ({ ...b }),
    );

    // ---- staged base import -------------------------------------------------------------------
    setImportEngineAutoStart(false);
    registerRehearsalAdapter(0);
    const c = ctx;
    const base = await step(
      "staged CSV import (dry run, approve, execute)",
      async () => {
        const prepared = await prepareRun(
          c,
          baseCsv(),
          `base-${randomUUID().slice(0, 8)}`,
        );
        await startExecution(prepared.run.id, prepared.dry);
        await runImportRunJob(prepared.run.id);
        const done = await runRow(prepared.run.id);
        assert(done.state === "completed", `base run ended ${done.state}`);
        return { runId: prepared.run.id, dry: prepared.dry, stats: done.stats };
      },
      (r) => ({ dryRun: r.dry.counts, stats: r.stats }),
    );

    // Reconciled right after the base import, before the delta changes the target scope.
    const baseReconciliation = await reconcile(base.runId);

    // ---- freeze boundary (rehearsal-defined) --------------------------------------------------
    const deltaText = deltaCsv();
    const freezeBoundary = {
      definition:
        "rehearsal-defined; no product freeze contract exists (import-and-cutover.md)",
      sourceFrozenAt: new Date().toISOString(),
      baseSnapshotSha256: sha256(baseCsv()),
      deltaSnapshotSha256: sha256(deltaText),
      backupTakenAt: backup.takenAt,
      baseRunId: base.runId,
      writesToSourceAfterFreeze: 0,
    };

    // ---- delta re-import with a real SIGKILL --------------------------------------------------
    const delta = await step(
      "delta re-import prepared",
      () => prepareRun(c, deltaText, `delta-${randomUUID().slice(0, 8)}`),
      (r) => ({ dryRun: r.dry.counts, writes: r.dry.writes }),
    );
    finalRunId = delta.run.id;
    await startExecution(delta.run.id, delta.dry);
    const kill = await step(
      "worker killed mid-run (SIGKILL)",
      async () => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            join(here, "rehearse.ts"),
            "--worker",
            delta.run.id,
            `--confirm-copy=${target.database}`,
            "--page-delay-ms=400",
          ],
          {
            cwd: apiDir,
            stdio: "ignore",
          },
        );
        let exited = false;
        child.on("exit", () => {
          exited = true;
        });
        const committed = await waitFor("worker to commit chunks", async () => {
          if (exited) return -2;
          const row = await runRow(delta.run.id);
          return row.lastCommittedChunk >= KILL_AFTER
            ? row.lastCommittedChunk
            : null;
        });
        assert(
          committed >= 0 && !exited,
          "worker finished before it could be killed",
        );
        child.kill("SIGKILL");
        await waitFor(
          "worker exit",
          async () => (exited ? true : null),
          10_000,
        );
        const after = await runRow(delta.run.id);
        assert(
          after.state === "running",
          `run state after kill is ${after.state}`,
        );
        // The killed worker still holds its per-run lease; releasing it is what lease expiry does.
        const released = await getDatabasePool().query(
          "DELETE FROM job_lease WHERE name = $1",
          [`import-run:${delta.run.id}`],
        );
        return {
          committedChunksAtKill: committed,
          lastCommittedChunk: after.lastCommittedChunk,
          cursor: after.sourceCursor,
          leaseReleasedBySql: (released.rowCount ?? 0) > 0,
        };
      },
      (k) => ({ ...k }),
    );
    (freezeBoundary as Json).lastCommittedChunkAtKill = kill.lastCommittedChunk;

    const resumed = await step(
      "resume from the last committed chunk (API)",
      async () => {
        registerRehearsalAdapter(0);
        setImportEngineAutoStart(true);
        await api(`/api/imports/${delta.run.id}/resume`, post());
        const done = await waitFor("resumed run to complete", async () => {
          const row = await runRow(delta.run.id);
          return row.state === "completed"
            ? row
            : row.state === "paused" || row.state === "failed"
              ? row
              : null;
        });
        setImportEngineAutoStart(false);
        assert(
          done.state === "completed",
          `resumed run ended ${done.state} (${done.pausedReason ?? "-"})`,
        );
        return { stats: done.stats };
      },
      (r) => ({ stats: r.stats }),
    );

    // ---- rerun: zero duplicates, zero writes -------------------------------------------------
    const rerun = await step(
      "rerun proves 0 duplicates",
      async () => {
        const before = await duplicates(c);
        const prepared = await prepareRun(
          c,
          deltaText,
          `rerun-${randomUUID().slice(0, 8)}`,
        );
        await startExecution(prepared.run.id, prepared.dry);
        await runImportRunJob(prepared.run.id);
        const done = await runRow(prepared.run.id);
        assert(done.state === "completed", `rerun ended ${done.state}`);
        const afterwards = await duplicates(c);
        assert(afterwards.duplicateKeys === 0, "duplicate source identities");
        assert(
          afterwards.links === afterwards.distinctSources &&
            afterwards.links === afterwards.distinctTargets,
          "links are not 1:1 with sources and targets",
        );
        assert(
          afterwards.prov === afterwards.provDistinct,
          "duplicate provenance rows",
        );
        assert(
          afterwards.items === afterwards.links,
          "linked work items differ from links",
        );
        assert(
          afterwards.links === before.links,
          "the rerun changed the number of linked items",
        );
        assert(
          (done.stats.created ?? 0) === 0 && (done.stats.updated ?? 0) === 0,
          "the rerun wrote records",
        );
        finalRunId = prepared.run.id;
        return {
          runId: prepared.run.id,
          before,
          after: afterwards,
          stats: done.stats,
        };
      },
      (r) => ({
        stats: r.stats,
        duplicates: r.after,
        linksBefore: r.before.links,
      }),
    );

    // ---- reconciliation -----------------------------------------------------------------------
    const reconciliations = await step(
      "reconciliation",
      async () => {
        const out: Json = {};
        out.base = baseReconciliation;
        out.delta = await reconcile(delta.run.id);
        out.rerun = await reconcile(rerun.runId);
        for (const [name, r] of Object.entries(out) as [
          string,
          Awaited<ReturnType<typeof reconcile>>,
        ][]) {
          const failing = r.failedChecks.filter((x) => x.severity === "fail");
          assert(
            r.status !== "fail" && failing.length === 0,
            `reconciliation of the ${name} run failed: ${failing.map((x) => x.code).join(",")}`,
          );
        }
        return out;
      },
      (r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k,
            {
              via: (v as Json).via,
              status: (v as Json).status,
              failedChecks: (v as Json).failedChecks,
            },
          ]),
        ),
    );

    // ---- rollback: restore from backup --------------------------------------------------------
    await getDatabasePool().end();
    const rollback = await step("rollback: restore from backup", async () => {
      // 1 verify checksums before touching anything (as scripts/restore.sh does)
      const sums = readFileSync(join(backupDir, "SHA256SUMS"), "utf8")
        .trim()
        .split("\n");
      for (const line of sums) {
        const [hash, file] = line.split(/\s+/u) as [string, string];
        assert(
          sha256(readFileSync(join(backupDir, file))) === hash,
          `checksum mismatch: ${file}`,
        );
      }
      tool("pg_restore", ["--list", join(backupDir, "postgres.dump")]);
      // 2 drop and recreate, 3 restore, 4 replace attachments
      const admin = new Client({ connectionString: target.adminUrl });
      await admin.connect();
      try {
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [target.database],
        );
        await admin.query(`DROP DATABASE IF EXISTS "${target.database}"`);
        await admin.query(`CREATE DATABASE "${target.database}"`);
      } finally {
        await admin.end();
      }
      tool("pg_restore", [
        "--single-transaction",
        "--no-owner",
        "-d",
        target.database,
        join(backupDir, "postgres.dump"),
      ]);
      for (const name of readdirSync(attachmentsDir))
        rmSync(join(attachmentsDir, name), { recursive: true, force: true });
      const unpacked = spawnSync("tar", [
        "-C",
        attachmentsDir,
        "-xf",
        join(backupDir, "attachments.tar"),
      ]);
      assert(unpacked.status === 0, "attachment restore failed");
      return null;
    });
    void rollback;
    const client = new Client({ connectionString: target.url });
    await client.connect();
    try {
      const num = async (query: string) =>
        Number(((await client.query(query)).rows[0] as { n: string }).n);
      const restored: Counts = {
        workItems: await num("SELECT count(*) AS n FROM work_item"),
        importRuns: await num("SELECT count(*) AS n FROM import_run"),
        importLinks: await num("SELECT count(*) AS n FROM import_record_link"),
        importedProvenance: await num(
          "SELECT count(*) AS n FROM external_link WHERE origin = 'imported'",
        ),
        importLosses: await num("SELECT count(*) AS n FROM import_loss"),
        migrations: await num(
          "SELECT count(*) AS n FROM drizzle.__drizzle_migrations",
        ),
      };
      const attachmentsAfter = manifest(attachmentsDir);
      const proven =
        JSON.stringify(restored) === JSON.stringify(baseline) &&
        attachmentsAfter.sha256 === attachmentsBefore.sha256;
      steps.push({
        name: "rollback proof: baseline counts and attachments restored",
        status: proven ? "passed" : "failed",
        ms: 0,
        detail: { baseline, restored, attachmentsBefore, attachmentsAfter },
      });
      assert(proven, "restored database differs from the pre-import baseline");

      status = "passed";
      Object.assign(report, {
        baseline,
        restored,
        attachmentsBefore,
        attachmentsAfter,
      });
      await writeOutcome(
        client,
        status,
        ctx,
        finalRunId,
        freezeBoundary,
        {
          base: {
            runId: base.runId,
            dryRun: base.dry.counts,
            stats: base.stats,
          },
          delta: {
            runId: delta.run.id,
            dryRun: delta.dry.counts,
            killed: kill,
            resumed: resumed.stats,
          },
          rerun: {
            runId: rerun.runId,
            stats: rerun.stats,
            duplicates: rerun.after,
          },
          reconciliations,
        },
        report,
      );
    } finally {
      await client.end();
    }
  } catch (error) {
    process.stderr.write(
      `rehearsal failed: ${error instanceof Error ? error.message : "unknown"}\n`,
    );
    process.exitCode = 1;
    const client = new Client({ connectionString: target.url });
    try {
      await client.connect();
      await writeOutcome(client, "failed", ctx, finalRunId, {}, {}, report);
    } catch {
      writeReportFile({
        ...report,
        status: "failed",
        steps,
        timings,
        note: "database row not written",
      });
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  process.exit(process.exitCode ?? 0);
}

function writeReportFile(report: Json) {
  mkdirSync(reportDir, { recursive: true });
  const file = join(reportDir, `p6-cutover-rehearsal-${rehearsalId}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`report: ${relative(repoRoot, file)}\n`);
}

/** Written AFTER the restore, so it survives the rollback it describes. */
async function writeOutcome(
  client: PgClient,
  status: "passed" | "failed",
  ctx: Ctx | null,
  runId: string | null,
  freezeBoundary: Json,
  evidence: Json,
  report: Json,
) {
  const finishedAt = new Date();
  const full: Json = {
    ...report,
    status,
    finishedAt: finishedAt.toISOString(),
    totalMs: finishedAt.getTime() - startedAt.getTime(),
    freezeBoundary,
    steps,
    timings,
    evidence,
    limitations: [
      "Rehearsal on a restored copy; no source system was contacted and no cutover occurred.",
      "The worker interruption is a real SIGKILL; the per-run lease it held was released by SQL, which stands in for lease expiry (one hour in production).",
      "The freeze boundary is rehearsal-defined; the product has no freeze or atomic-cutover contract.",
      "Recovery is restore from backup; there is no whole-run undo.",
    ],
  };
  await client.query(
    `INSERT INTO cutover_rehearsal (id, rehearsal_key, workspace_id, import_run_id, status, database_name, freeze_boundary, steps, timings, report, started_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)`,
    [
      randomUUID(),
      rehearsalId,
      ctx?.workspaceId ?? null,
      runId,
      status,
      target.database,
      JSON.stringify(freezeBoundary),
      JSON.stringify(steps),
      JSON.stringify(timings),
      JSON.stringify(full),
      startedAt,
      finishedAt,
    ],
  );
  writeReportFile(full);
}

await main();
