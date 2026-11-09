import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";
import { and, eq, inArray, isNotNull, like, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { resetTestDatabase } from "../../../tests/api-integration/helpers/database";
import { getStoredAuthPluginConfigRows } from "../src/auth/repository";
import db, { getDatabasePool, schema } from "../src/database";
import { cycleTable, moduleTable } from "../src/database/schema-p5-agile";
import { kbArticleTable } from "../src/database/schema-p5-kb";
import { projectPageTable } from "../src/database/schema-p5-pages";
import {
  announcementTable,
  changeDetailTable,
  changeFreezeTable,
  serviceTable,
} from "../src/database/schema-p5-service";
import { resolveProjectFeatures } from "../src/feature-flag/repository";
import { suggestDuplicatesForQueueRows } from "../src/intake/duplicate-suggestions";
import { snippet } from "../src/kb/logic";
import getNotificationInbox from "../src/notification/controllers/get-notification-inbox";
import { snippetOf } from "../src/pages/logic";
import { changeCalendar } from "../src/service-management/change-repository";
import { evaluatePinnedWorkItemSla } from "../src/sla-policy/evaluation";
import { countSavedView, runSavedView } from "../src/view/controllers/run-view";
import { validateWorkItemSearchQuery } from "../src/work-item/search/query";
import { searchWorkItems } from "../src/work-item/search/repository";
import {
  DEMO_FEATURE_FLAGS,
  DEMO_REVIEWER_KEY,
  DEMO_WORKSPACE_ID,
  resolveCredentialsDestination,
} from "./seed-demo-data";
import { seed } from "./seed-profile";

const execute = promisify(execFile);
const apiRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

let directory: string;
let credentials: string;

/**
 * Runs the CLI in a child process that inherits this environment (the disposable database).
 * `overrides` are `NAME=value` pairs applied through env(1), so this file reads no variables.
 */
function run(args: string[], overrides: string[] = []) {
  return execute(
    "env",
    [...overrides, "pnpm", "exec", "tsx", "scripts/seed-demo.mjs", ...args],
    { cwd: apiRoot, timeout: 180_000 },
  );
}

/** Every public table as a sorted multiset of its rows, so any write anywhere is visible. */
async function snapshot() {
  const tables = (
    await db.execute<{ name: string }>(
      sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    )
  ).rows.map((row) => row.name);
  const result: Record<string, string[]> = {};
  for (const table of tables) {
    const rows = await db.execute<{ row: string }>(
      sql`SELECT row_to_json(t)::text AS row FROM ${sql.identifier(table)} t`,
    );
    result[table] = rows.rows.map((row) => row.row).sort();
  }
  return result;
}

function missingRows(
  before: Record<string, string[]>,
  after: Record<string, string[]>,
) {
  const missing: string[] = [];
  for (const [table, rows] of Object.entries(before)) {
    const remaining = new Map<string, number>();
    for (const row of after[table] ?? [])
      remaining.set(row, (remaining.get(row) ?? 0) + 1);
    for (const row of rows) {
      const count = remaining.get(row) ?? 0;
      if (count === 0) missing.push(`${table}: ${row.slice(0, 200)}`);
      else remaining.set(row, count - 1);
    }
  }
  return missing;
}

async function demoProjects() {
  return db
    .select()
    .from(schema.projectTable)
    .where(eq(schema.projectTable.workspaceId, DEMO_WORKSPACE_ID));
}

describe("demo data seed is opt-in, additive and idempotent", () => {
  let emptySnapshot: Record<string, string[]>;
  let firstRun: Record<string, string[]>;

  beforeAll(async () => {
    // Instance flags stay at their built-in defaults (mostly off), so every feature the
    // demo needs must come on through the seed's own workspace rows.
    await resetTestDatabase({ defaultOffFeatures: false });
    directory = await mkdtemp(path.join(os.tmpdir(), "taskdesk-demo-seed-"));
    credentials = path.join(directory, "demo.json");
    emptySnapshot = await snapshot();
  }, 180_000);

  afterAll(async () => {
    await resetTestDatabase();
    await rm(directory, { recursive: true, force: true });
  });

  it("refuses without --demo, on the live database name, and for a credentials file inside the repository", async () => {
    await expect(run(["--credentials-file", credentials])).rejects.toThrow(
      /requires --demo/,
    );
    await expect(
      run(
        ["--demo", "--credentials-file", credentials],
        // A closed port: the guard must refuse before any connection is attempted.
        [
          "TASKDESK_DATABASE_URL=postgresql://nobody:nothing@127.0.0.1:9/taskdesk_browser_journey_1022_test",
        ],
      ),
    ).rejects.toThrow(/live database and must never be seeded/);
    await expect(
      run([
        "--demo",
        "--credentials-file",
        path.join(repoRoot, "demo-credentials.json"),
      ]),
    ).rejects.toThrow(/outside the source checkout/);
    await expect(stat(credentials)).rejects.toThrow();
    await expect(
      stat(path.join(repoRoot, "demo-credentials.json")),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(emptySnapshot);
  }, 240_000);

  it("seeds a fresh database, never prints a password, and a rerun changes nothing", async () => {
    const first = await run(["--demo", "--credentials-file", credentials]);
    expect((await stat(credentials)).mode & 0o077).toBe(0);
    firstRun = await snapshot();
    expect(missingRows(emptySnapshot, firstRun)).toEqual([]);

    const written = await readFile(credentials, "utf8");
    for (const account of JSON.parse(written).accounts) {
      expect(first.stdout).not.toContain(account.password);
      expect(first.stderr).not.toContain(account.password);
    }
    // Customer password sign-in is off on a fresh instance: the seed says how to turn it on
    // and, without --enable-customer-password, writes no instance row.
    expect(first.stdout).toContain("Customer password sign-in is off");
    expect(first.stdout).toContain("--enable-customer-password");
    expect(await getStoredAuthPluginConfigRows()).toEqual([]);
    const { stdout, stderr } = await run([
      "--demo",
      "--credentials-file",
      credentials,
    ]);
    for (const account of JSON.parse(written).accounts) {
      expect(stdout).not.toContain(account.password);
      expect(stderr).not.toContain(account.password);
    }
    expect(stdout).toContain(
      `Demo seed complete: workspace ${DEMO_WORKSPACE_ID}`,
    );
    expect(await readFile(credentials, "utf8")).toBe(written);
    const secondRun = await snapshot();
    expect(missingRows(firstRun, secondRun)).toEqual([]);
    expect(secondRun).toEqual(firstRun);
  }, 300_000);

  it("turns every demo feature on for every demo project through workspace flags", async () => {
    const projects = await demoProjects();
    expect(projects.length).toBeGreaterThanOrEqual(3);
    for (const required of [
      "feature.reports",
      "feature.service_catalogue",
      "feature.sla",
      "feature.cycles",
      "feature.modules",
      "feature.calendar",
      "feature.timeline",
      "feature.knowledge_base",
      "feature.pages",
    ])
      expect(DEMO_FEATURE_FLAGS).toContain(required);
    for (const project of projects) {
      const resolved = await resolveProjectFeatures(
        project.id,
        DEMO_WORKSPACE_ID,
      );
      for (const flag of DEMO_FEATURE_FLAGS)
        expect(
          resolved.find((row) => row.key === flag),
          `${project.slug} ${flag}`,
        ).toMatchObject({ enabled: true });
    }
    // Feature rows are workspace rows; instance rows are never written.
    const instanceRows = await db
      .select()
      .from(schema.instanceFeatureFlagTable);
    expect(instanceRows).toEqual([]);
  });

  it("creates realistic work: items, labels, assignees, a second Contoso engagement", async () => {
    const items = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(items.length).toBeGreaterThanOrEqual(20);
    expect(items.length).toBeLessThanOrEqual(40);
    // Items accepted from triage keep the priority the form gave them, possibly none.
    expect(new Set(items.flatMap((item) => item.priority ?? []))).toEqual(
      new Set(["low", "medium", "high", "urgent"]),
    );
    expect(
      new Set(items.flatMap((item) => item.assigneeId ?? [])).size,
    ).toBeGreaterThanOrEqual(3);
    expect(items.filter((item) => item.dueDate).length).toBeGreaterThan(15);
    const states = await db
      .select({ group: schema.stateTemplateTable.group })
      .from(schema.workItemTable)
      .innerJoin(
        schema.stateTable,
        eq(schema.stateTable.id, schema.workItemTable.stateId),
      )
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTemplateTable.id, schema.stateTable.stateTemplateId),
      )
      .where(eq(schema.workItemTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(new Set(states.map((row) => row.group)).size).toBeGreaterThanOrEqual(
      4,
    );
    const labelled = await db
      .select({ id: schema.workItemLabelTable.workItemId })
      .from(schema.workItemLabelTable)
      .where(
        inArray(
          schema.workItemLabelTable.workItemId,
          items.map((item) => item.id),
        ),
      );
    expect(labelled.length).toBeGreaterThanOrEqual(10);

    // Plain names and titles: no test leftovers, no role text in display names (PH-11).
    for (const item of items)
      expect(item.title).not.toMatch(/\[audit\]|\btest\b|^x y$/i);
    const people = await db
      .select({ name: schema.personTable.displayName })
      .from(schema.personTable)
      .where(like(schema.personTable.id, "demo-%"));
    expect(people.length).toBeGreaterThanOrEqual(8);
    for (const person of people) expect(person.name).not.toMatch(/[()]/);

    const projects = await demoProjects();
    const contoso = projects.filter(
      (project) => project.organisationId === "demo-org-contoso",
    );
    expect(contoso.length).toBe(2);
    expect(contoso.map((project) => project.kind).sort()).toEqual([
      "managed_service",
      "project",
    ]);
  });

  it("has two SLA policies on a business-hours calendar with breached and at-risk items", async () => {
    const policies = await db
      .select()
      .from(schema.slaPolicyTable)
      .where(
        and(
          eq(schema.slaPolicyTable.workspaceId, DEMO_WORKSPACE_ID),
          isNotNull(schema.slaPolicyTable.activeVersionId),
        ),
      );
    expect(policies).toHaveLength(2);
    const calendars = await db
      .select()
      .from(schema.serviceCalendarTable)
      .where(eq(schema.serviceCalendarTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(
      calendars.some(
        (calendar) =>
          Object.keys(calendar.windows as Record<string, unknown>).length === 5,
      ),
    ).toBe(true);

    const pinned = await db
      .select()
      .from(schema.workItemTable)
      .where(
        and(
          eq(schema.workItemTable.workspaceId, DEMO_WORKSPACE_ID),
          isNotNull(schema.workItemTable.slaPolicyVersionId),
        ),
      );
    const states = new Set<string>();
    const now = new Date();
    for (const item of pinned) {
      const metrics = await evaluatePinnedWorkItemSla({
        policyVersionId: item.slaPolicyVersionId,
        workspaceId: item.workspaceId,
        workItemTypeId: item.typeId,
        priority: item.priority,
        facts: {
          startedAt: item.slaStartedAt ?? item.createdAt,
          firstResponseAt: item.firstResponseAt,
          resolvedAt: item.resolvedAt,
          pauses: [],
        },
        now,
      });
      for (const metric of metrics) states.add(metric.state);
    }
    expect(states).toContain("breached");
    expect(states).toContain("at_risk");
    expect(states).toContain("ok");
  });

  it("has a service catalogue, a month of changes with a freeze and a conflict, and announcements", async () => {
    const services = await db
      .select()
      .from(serviceTable)
      .where(eq(serviceTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(services.length).toBeGreaterThanOrEqual(4);
    expect(services.length).toBeLessThanOrEqual(6);

    const freezes = await db
      .select()
      .from(changeFreezeTable)
      .where(eq(changeFreezeTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(freezes.length).toBeGreaterThanOrEqual(1);

    const changes = await db
      .select()
      .from(changeDetailTable)
      .where(eq(changeDetailTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(changes.length).toBeGreaterThanOrEqual(5);

    const now = new Date();
    const calendar = await changeCalendar({
      workspaceId: DEMO_WORKSPACE_ID,
      from: new Date(now.getTime() - 14 * 86_400_000),
      to: new Date(now.getTime() + 31 * 86_400_000),
      reachableProjectIds: (await demoProjects()).map((project) => project.id),
      now,
    });
    expect(calendar.changes.length).toBeGreaterThanOrEqual(5);
    expect(calendar.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(calendar.changes.some((change) => change.frozen)).toBe(true);
    expect(calendar.freezes.length).toBeGreaterThanOrEqual(1);

    const announcements = await db
      .select()
      .from(announcementTable)
      .where(
        and(
          eq(announcementTable.workspaceId, DEMO_WORKSPACE_ID),
          isNotNull(announcementTable.publishedAt),
        ),
      );
    expect(announcements).toHaveLength(2);
  });

  it("plans a cycle and a module with items", async () => {
    const cycles = await db
      .select()
      .from(cycleTable)
      .where(eq(cycleTable.workspaceId, DEMO_WORKSPACE_ID));
    const modules = await db
      .select()
      .from(moduleTable)
      .where(eq(moduleTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    expect(modules.length).toBeGreaterThanOrEqual(1);
    const inCycle = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(
        inArray(
          schema.workItemTable.cycleId,
          cycles.map((cycle) => cycle.id),
        ),
      );
    const inModule = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(
        inArray(
          schema.workItemTable.moduleId,
          modules.map((module) => module.id),
        ),
      );
    expect(inCycle.length).toBeGreaterThanOrEqual(4);
    expect(inModule.length).toBeGreaterThanOrEqual(3);
  });

  it("has triage submissions including a suspected duplicate, saved views, KB articles and pages", async () => {
    const waiting = await db
      .select({
        number: schema.submissionTable.number,
        summary: sql<string>`${schema.submissionTable.formData}->>'summary'`,
        organisationId: schema.submissionTable.organisationId,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .where(
        and(
          eq(schema.requestTypeTable.workspaceId, DEMO_WORKSPACE_ID),
          eq(schema.submissionTable.state, "new"),
        ),
      );
    expect(waiting.length).toBeGreaterThanOrEqual(2);
    const suggestions = await suggestDuplicatesForQueueRows(
      DEMO_WORKSPACE_ID,
      waiting.map((row) => ({
        ref: String(row.number),
        summary: row.summary,
        organisationId: row.organisationId ?? "",
      })),
      (await demoProjects()).map((project) => project.id),
    );
    expect(suggestions.size).toBeGreaterThanOrEqual(1);

    const views = await db
      .select()
      .from(schema.savedViewTable)
      .where(eq(schema.savedViewTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(views.length).toBeGreaterThanOrEqual(2);
    // Every view runs and counts through the API's own executor, as its owner sees it
    // (GET /api/views/{id} results and /count); a stored shape the API refuses answers 422.
    for (const view of views) {
      const [owner] = await db
        .select({ userId: schema.personTable.userId })
        .from(schema.personTable)
        .where(eq(schema.personTable.id, view.createdBy));
      if (!owner?.userId) throw new Error(`view ${view.id} has no owner user`);
      const caller = {
        id: view.id,
        personId: view.createdBy,
        userId: owner.userId,
      };
      const counted = await countSavedView(caller).catch((error: unknown) => {
        throw new Error(`${view.name} does not count: ${String(error)}`);
      });
      expect(counted.count, view.name).toBeGreaterThanOrEqual(0);
      await expect(
        runSavedView({ ...caller, limit: 10 }),
        view.name,
      ).resolves.toBeDefined();
    }

    const articles = await db
      .select()
      .from(kbArticleTable)
      .where(eq(kbArticleTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(articles.length).toBeGreaterThanOrEqual(4);
    for (const article of articles) {
      expect(article.title).not.toMatch(/\[|audit|\btest\b/i);
      expect(article.state).toBe("published");
    }

    const pages = await db
      .select()
      .from(projectPageTable)
      .where(eq(projectPageTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  it("starts KB article and page bodies below the title, so list excerpts do not repeat it", async () => {
    const firstNode = (body: unknown) =>
      ((body as { content?: { type: string; attrs?: { level?: number } }[] })
        .content ?? [])[0];
    const articles = await db
      .select()
      .from(kbArticleTable)
      .where(eq(kbArticleTable.workspaceId, DEMO_WORKSPACE_ID));
    const pages = await db
      .select()
      .from(projectPageTable)
      .where(eq(projectPageTable.workspaceId, DEMO_WORKSPACE_ID));
    expect(articles.length + pages.length).toBeGreaterThanOrEqual(7);
    for (const [title, body, excerpt] of [
      ...articles.map(
        (row) => [row.title, row.body, snippet(row.bodyText)] as const,
      ),
      ...pages.map(
        (row) => [row.title, row.body, snippetOf(row.bodyText)] as const,
      ),
    ]) {
      expect(excerpt.toLowerCase(), title).not.toMatch(
        new RegExp(
          `^${title.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        ),
      );
      // Sections (h2 and below) stay; a top-level heading repeating the title does not.
      const first = firstNode(body);
      expect(first?.type === "heading" && first.attrs?.level === 1, title).toBe(
        false,
      );
    }
  });

  it("gives the workspace admin assigned work in several states and an inbox written by the product", async () => {
    const personId = `demo-person-${DEMO_REVIEWER_KEY}`;
    const userId = `demo-user-${DEMO_REVIEWER_KEY}`;
    const assigned = await db
      .select({
        key: schema.workItemTable.key,
        dueDate: schema.workItemTable.dueDate,
        group: schema.stateTemplateTable.group,
      })
      .from(schema.workItemTable)
      .innerJoin(
        schema.stateTable,
        eq(schema.stateTable.id, schema.workItemTable.stateId),
      )
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTemplateTable.id, schema.stateTable.stateTemplateId),
      )
      .where(
        and(
          eq(schema.workItemTable.workspaceId, DEMO_WORKSPACE_ID),
          eq(schema.workItemTable.assigneeId, personId),
        ),
      );
    expect(assigned.length).toBeGreaterThanOrEqual(4);
    expect(assigned.length).toBeLessThanOrEqual(6);
    expect(
      new Set(assigned.map((row) => row.group)).size,
    ).toBeGreaterThanOrEqual(3);
    const now = new Date();
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const open = assigned.filter(
      (row) => row.group !== "completed" && row.group !== "cancelled",
    );
    expect(
      open.some((row) => row.dueDate && row.dueDate.getTime() < today),
      "one open item is overdue",
    ).toBe(true);
    expect(
      open.some(
        (row) =>
          row.dueDate &&
          row.dueDate.getTime() >= today &&
          row.dueDate.getTime() < today + 86_400_000,
      ),
      "one open item is due today",
    ).toBe(true);

    // My work: the same assignee search the agent app runs, through the caller's reach.
    const mine = await searchWorkItems({
      userId,
      workspaceId: DEMO_WORKSPACE_ID,
      query: validateWorkItemSearchQuery({
        entity: "work_item",
        filter: { field: "assignee", op: "eq", value: "@me" },
      }),
      limit: 50,
    });
    expect(mine.data.map((row) => row.key).sort()).toEqual(
      assigned.map((row) => row.key).sort(),
    );

    // Inbox: read back through the inbox handler, which re-checks reach and eligibility.
    const inbox = await getNotificationInbox({
      userId,
      credentialCanReadTask: true,
      filter: "all",
      limit: 50,
    });
    const kinds = inbox.data.map((row) => row.kind);
    expect(inbox.data.length).toBeGreaterThanOrEqual(3);
    expect(inbox.data.length).toBeLessThanOrEqual(5);
    for (const kind of [
      "work_item.assigned",
      "work_item.mentioned",
      "sla.at_risk",
      "approval.requested",
    ])
      expect(kinds, kind).toContain(kind);
    expect(inbox.unreadCount).toBe(inbox.data.length);
    for (const filter of ["mentions", "assignments"] as const) {
      const filtered = await getNotificationInbox({
        userId,
        credentialCanReadTask: true,
        filter,
        limit: 50,
      });
      expect(filtered.data.length, filter).toBeGreaterThanOrEqual(1);
    }
  });

  it("refuses a database with non-demo data unless told otherwise, and then changes nothing", async () => {
    const [internal] = await db
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.key, "internal"));
    if (!internal) throw new Error("internal organisation missing");
    await db.insert(schema.workspaceTable).values({
      id: "customer-real-workspace",
      organisationId: internal.id,
      name: "Real customer work",
      slug: "real-customer-work",
      createdAt: new Date(),
    });
    const before = await snapshot();
    await expect(
      run(["--demo", "--credentials-file", credentials]),
    ).rejects.toThrow(/non-demo data/);
    expect(await snapshot()).toEqual(before);

    await run([
      "--demo",
      "--allow-existing-data",
      "--credentials-file",
      credentials,
    ]);
    expect(await snapshot()).toEqual(before);
  }, 240_000);

  it("turns customer password sign-in on only with --enable-customer-password, as God Mode's canonical row, once", async () => {
    const before = await snapshot();
    const { stdout } = await run([
      "--demo",
      "--allow-existing-data",
      "--enable-customer-password",
      "--credentials-file",
      credentials,
    ]);
    expect(stdout).toContain("Customer password sign-in turned on");
    const rows = await db
      .select()
      .from(schema.instancePluginConfigTable)
      .where(eq(schema.instancePluginConfigTable.pluginId, "auth.password"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pluginId: "auth.password",
      instanceKey: "customer",
      portalScope: "customer",
      scope: "instance",
      workspaceId: null,
      enabled: true,
      configVersion: 1,
    });
    const after = await snapshot();
    expect(missingRows(before, after)).toEqual([]);

    const again = await run([
      "--demo",
      "--allow-existing-data",
      "--enable-customer-password",
      "--credentials-file",
      credentials,
    ]);
    expect(again.stdout).toContain("Customer password sign-in is already on");
    expect(await snapshot()).toEqual(after);
  }, 240_000);
});

describe("demo data seed beside existing data", () => {
  let foreignDirectory: string;
  let foreignCredentials: string;

  beforeAll(async () => {
    await resetTestDatabase({ defaultOffFeatures: false });
    foreignDirectory = await mkdtemp(
      path.join(os.tmpdir(), "taskdesk-demo-seed-existing-"),
    );
    foreignCredentials = path.join(foreignDirectory, "demo.json");
    // Someone else's data: the minimal fixture workspace with its project and items, a
    // signed-up user and a customer organisation of its own.
    await seed("minimal");
    await db.insert(schema.userTable).values({
      id: "existing-instance-admin",
      name: "Existing admin",
      email: "existing-admin@example.test",
      emailVerified: true,
    });
    await db.insert(schema.organisationTable).values({
      id: "existing-org-fabrikam",
      key: "fabrikam",
      name: "Fabrikam Inc",
      isInternal: false,
      domain: ["fabrikam.example.test"],
      active: true,
      portalAccess: true,
      defaultCustomerVisibility: "organisation",
    });
  }, 180_000);

  afterAll(async () => {
    await resetTestDatabase();
    await rm(foreignDirectory, { recursive: true, force: true });
  });

  it("refuses on a first run, then adds the demo beside it without changing a row, and a rerun changes nothing", async () => {
    const before = await snapshot();
    await expect(
      run(["--demo", "--credentials-file", foreignCredentials]),
    ).rejects.toThrow(/non-demo data/);
    expect(await snapshot()).toEqual(before);
    await expect(stat(foreignCredentials)).rejects.toThrow();

    await run([
      "--demo",
      "--allow-existing-data",
      "--credentials-file",
      foreignCredentials,
    ]);
    const after = await snapshot();
    expect(missingRows(before, after)).toEqual([]);
    expect(
      (after.work_item?.length ?? 0) - (before.work_item?.length ?? 0),
    ).toBeGreaterThanOrEqual(20);

    await run([
      "--demo",
      "--allow-existing-data",
      "--credentials-file",
      foreignCredentials,
    ]);
    expect(await snapshot()).toEqual(after);
  }, 300_000);

  it("never overrides an administrator who turned customer password sign-in off", async () => {
    await db.insert(schema.instancePluginConfigTable).values({
      id: "existing-auth-password-customer",
      pluginId: "auth.password",
      instanceKey: "customer",
      displayName: "Password (customer)",
      enabled: false,
      config: {},
      scope: "instance",
      workspaceId: null,
      portalScope: "customer",
      configVersion: 3,
    });
    const before = await snapshot();
    const { stdout } = await run([
      "--demo",
      "--allow-existing-data",
      "--enable-customer-password",
      "--credentials-file",
      foreignCredentials,
    ]);
    expect(stdout).toContain(
      "Customer password sign-in was turned off by an administrator",
    );
    expect(await snapshot()).toEqual(before);
  }, 240_000);
});

/** The CLI with a closed database port: anything it does before connecting, nothing after. */
const UNREACHABLE_DATABASE = [
  "TASKDESK_DATABASE_URL=postgresql://nobody:nothing@127.0.0.1:9/taskdesk_demo_unreachable_test",
];
const BCRYPT_HASH = /\$2[aby]\$\d{2}\$/;

function swapCase(text: string) {
  return [...text]
    .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
    .join("");
}

/**
 * Whether the volume holding the checkout ignores letter case, found at runtime: a probe file
 * on that volume is stat'ed under a different case. Never inferred from the platform.
 */
function checkoutVolumeIsCaseInsensitive() {
  const probeDirectory = mkdtempSync(path.join(os.tmpdir(), "taskdesk-case-"));
  try {
    if (statSync(probeDirectory).dev !== statSync(repoRoot).dev) return false;
    const probe = path.join(probeDirectory, "Case-Probe");
    writeFileSync(probe, "");
    try {
      return (
        statSync(path.join(probeDirectory, swapCase("Case-Probe"))).ino ===
        statSync(probe).ino
      );
    } catch {
      return false;
    }
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true });
  }
}
const caseInsensitive = checkoutVolumeIsCaseInsensitive();
const checkoutInOtherCase = path.join(
  path.dirname(path.resolve(repoRoot)),
  swapCase(path.basename(path.resolve(repoRoot))),
);

describe("demo credentials destination", () => {
  it.skipIf(!caseInsensitive)(
    "refuses the checkout spelt in another letter case (skipped when the checkout's filesystem is case-sensitive)",
    async () => {
      const typed = path.join(checkoutInOtherCase, "demo-credentials.json");
      const real = path.join(repoRoot, "demo-credentials.json");
      expect(() => resolveCredentialsDestination(typed)).toThrow(
        /outside the source checkout/,
      );
      await expect(
        run(["--demo", "--credentials-file", typed], UNREACHABLE_DATABASE),
      ).rejects.toThrow(/outside the source checkout/);
      await expect(stat(real)).rejects.toThrow();
    },
    120_000,
  );

  it("refuses a credentials file that is not a private regular file", async () => {
    const scratch = await mkdtemp(
      path.join(os.tmpdir(), "taskdesk-demo-cred-"),
    );
    try {
      const open = path.join(scratch, "open.json");
      await writeFile(open, "{}", { mode: 0o644 });
      await chmod(open, 0o644);
      const target = path.join(scratch, "target.json");
      await writeFile(target, "{}", { mode: 0o600 });
      const link = path.join(scratch, "link.json");
      await symlink(target, link);
      const fifo = path.join(scratch, "fifo.json");
      await execute("mkfifo", ["-m", "600", fifo]);
      for (const file of [open, link, fifo])
        await expect(
          run(["--demo", "--credentials-file", file], UNREACHABLE_DATABASE),
          file,
        ).rejects.toThrow(/private regular file/);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 180_000);
});

describe("demo data seed never takes over rows it does not own", () => {
  let scratch: string;
  let file: string;

  beforeEach(async () => {
    await resetTestDatabase({ defaultOffFeatures: false });
    scratch = await mkdtemp(path.join(os.tmpdir(), "taskdesk-demo-owned-"));
    file = path.join(scratch, "demo.json");
  }, 180_000);

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  afterAll(async () => {
    await resetTestDatabase();
  });

  async function otherUserAndOrganisation() {
    await db.insert(schema.userTable).values({
      id: "someone-else",
      name: "Someone Else",
      email: "someone-else@example.test",
      emailVerified: true,
    });
    await db.insert(schema.organisationTable).values({
      id: "existing-org-fabrikam",
      key: "fabrikam",
      name: "Fabrikam Inc",
      isInternal: false,
      domain: ["fabrikam.example.test"],
      active: true,
      portalAccess: true,
      defaultCustomerVisibility: "organisation",
    });
  }

  it("refuses, and changes nothing, when the global customer role is not a system role", async () => {
    await db.insert(schema.roleTable).values({
      id: "existing-customer-role",
      scope: "organisation",
      workspaceId: null,
      key: "customer",
      name: "Our customers",
      rank: 5,
      capabilities: ["custom.capability"],
      isSystem: false,
      isEditable: true,
    });
    const before = await snapshot();
    await expect(
      run(["--demo", "--allow-existing-data", "--credentials-file", file]),
    ).rejects.toThrow(/Demo seed refused: the global customer role is missing/);
    expect(await snapshot()).toEqual(before);
    await expect(stat(file)).rejects.toThrow();
  }, 180_000);

  it("refuses, and changes nothing, when a demo person id belongs to another user or to none", async () => {
    await otherUserAndOrganisation();
    const personId = `demo-person-${DEMO_REVIEWER_KEY}`;
    for (const userId of ["someone-else", null]) {
      await db
        .delete(schema.personTable)
        .where(eq(schema.personTable.id, personId));
      await db.insert(schema.personTable).values({
        id: personId,
        userId,
        organisationId: "existing-org-fabrikam",
        side: "customer",
        displayName: "Somebody",
      });
      const before = await snapshot();
      await expect(
        run(["--demo", "--allow-existing-data", "--credentials-file", file]),
        String(userId),
      ).rejects.toThrow(new RegExp(`existing person \\(${personId}\\)`));
      expect(await snapshot()).toEqual(before);
      await expect(stat(file)).rejects.toThrow();
    }
  }, 240_000);

  it("never prints a password hash when a database write fails", async () => {
    await otherUserAndOrganisation();
    // The id the seed gives the first demo account's password row, held by someone else, so
    // that insert fails with the new bcrypt hash among the statement's parameters.
    await db.insert(schema.accountTable).values({
      id: "demo-cred-demo-user-owner",
      accountId: "someone-else",
      providerId: "credential",
      userId: "someone-else",
    });
    const before = await snapshot();
    const failure = await run(["--demo", "--credentials-file", file]).then(
      () => null,
      (error: { stdout: string; stderr: string }) => error,
    );
    expect(failure).not.toBeNull();
    expect(failure?.stderr).not.toMatch(BCRYPT_HASH);
    expect(failure?.stdout).not.toMatch(BCRYPT_HASH);
    expect(failure?.stderr).toContain("Demo seed failed");
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("waits for the demo seed lock before checking accounts or writing anything", async () => {
    const client = await getDatabasePool().connect();
    let settled = false;
    let run1: Promise<unknown> | undefined;
    try {
      await client.query(
        "SELECT pg_advisory_lock(hashtext('taskdesk:demo-seed'))",
      );
      run1 = run(["--demo", "--credentials-file", file]).finally(() => {
        settled = true;
      });
      run1.catch(() => {});
      let waiting = false;
      const deadline = Date.now() + 90_000;
      while (!settled && Date.now() < deadline) {
        const { rows } = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
        );
        if ((rows[0]?.count ?? 0) > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(waiting, "the seed waits on the demo seed lock").toBe(true);
      await expect(stat(file)).rejects.toThrow();
      expect(
        await db
          .select({ id: schema.userTable.id })
          .from(schema.userTable)
          .where(like(schema.userTable.id, "demo-%")),
      ).toEqual([]);
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('taskdesk:demo-seed'))",
      );
      client.release();
    }
    await run1;
    const written = JSON.parse(await readFile(file, "utf8")) as {
      accounts: { email: string; password: string }[];
    };
    for (const account of written.accounts) {
      const [row] = await db
        .select({ password: schema.accountTable.password })
        .from(schema.accountTable)
        .innerJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.accountTable.userId),
        )
        .where(eq(schema.userTable.email, account.email));
      expect(
        await bcrypt.compare(account.password, row?.password ?? ""),
        account.email,
      ).toBe(true);
    }
  }, 300_000);
});
