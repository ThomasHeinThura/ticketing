import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type APIResponse, expect, type Page, test } from "@playwright/test";

const origin = "https://ticketing.localhost";
const epicKey = "CCY-5";
const docxFixtureKey = "CCY-4";
const viewName = "QA Epic Roll-up 20261026";
const stateRoot = path.join(
  os.homedir(),
  "Library/Application Support/TaskDesk/codex-sit-20261025",
);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const artifactRoot = path.join(repoRoot, "docs/report");

type WorkItem = {
  id: string;
  key: string;
  title: string;
  workspaceId: string;
  projectId: string;
  typeId: string;
  stateId: string;
  stateCategory: string;
  priority: string | null;
  parentId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  description: unknown | null;
  requesterId: string | null;
  assigneeId: string | null;
  startDate: string | null;
  dueDate: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  position: string;
  customerVisibility: string;
  cycleId?: string | null;
  moduleId?: string | null;
  estimatePointId?: string | null;
  stateName: string;
  assigneeName: string | null;
  defaultCommentVisibility: string;
  customFields: unknown[];
};

type ReportResponse = {
  rows: Array<Record<string, unknown> & { _drill?: string }>;
  columns: Array<{ key: string; label: string; kind: string }>;
  drill: boolean;
  notes: string[];
};

type DrillRequestProbe = {
  method: string;
  pathname: string;
  contentType: string | null;
  bodyAvailable: boolean;
  handle: string | null;
  playwrightBodyAvailable: boolean;
};

async function readJson<T>(response: APIResponse, label: string) {
  if (!response.ok())
    throw new Error(`${label} returned HTTP ${response.status()}`);
  return (await response.json()) as T;
}

async function csrfHeaders(page: Page) {
  const issued = await page.request.get(`${origin}/api/me/csrf-token`, {
    headers: { Origin: origin },
  });
  if (issued.status() !== 200) throw new Error("CSRF token request failed.");
  const { token } = (await issued.json()) as { token: string };
  if (!token) throw new Error("CSRF token response was empty.");
  return {
    Origin: origin,
    "X-TaskDesk-CSRF": token,
    "X-TaskDesk-Window-Id": randomUUID(),
    "Content-Type": "application/json",
  };
}

async function getItem(page: Page, key: string) {
  return readJson<WorkItem>(
    await page.request.get(
      `${origin}/api/work-items/${encodeURIComponent(key)}`,
      {
        headers: { Origin: origin },
      },
    ),
    `Work item ${key}`,
  );
}

async function transitionToGroup(
  page: Page,
  key: string,
  wanted: "unstarted" | "completed",
  stateGroups: Map<string, string>,
) {
  for (let hop = 0; hop < 4; hop += 1) {
    let item = await getItem(page, key);
    if (item.stateCategory === wanted) return item;
    const offers = await readJson<
      Array<{
        toStateTemplateId: string;
        toStateId: string;
        toStateCategory?: string;
        notePolicy: "none" | "optional" | "required";
        requiresApproval: boolean;
        requiresCab: boolean;
        available: boolean;
        blockedBy: Array<{ reasonCode: string }>;
      }>
    >(
      await page.request.get(
        `${origin}/api/work-items/${encodeURIComponent(key)}/transitions`,
        { headers: { Origin: origin } },
      ),
      `Transitions for ${key}`,
    );
    const groupOf = (offer: (typeof offers)[number]) =>
      offer.toStateCategory ?? stateGroups.get(offer.toStateId);
    const eligible = (offer: (typeof offers)[number]) => {
      const reasons = offer.blockedBy.map((reason) => reason.reasonCode);
      const noteOnly =
        offer.notePolicy === "required" &&
        reasons.length > 0 &&
        reasons.every((reason) => reason === "note.required");
      return (
        !offer.requiresApproval &&
        !offer.requiresCab &&
        (offer.available || noteOnly)
      );
    };
    let offer = offers.find(
      (candidate) => groupOf(candidate) === wanted && eligible(candidate),
    );
    if (!offer && wanted === "completed" && item.stateCategory !== "started") {
      offer = offers.find(
        (candidate) => groupOf(candidate) === "started" && eligible(candidate),
      );
    }
    if (!offer)
      throw new Error(`No normal workflow offer reaches ${wanted} for ${key}.`);
    const body = {
      toStateTemplateId: offer.toStateTemplateId,
      ...(offer.notePolicy === "required"
        ? { note: "Controlled RH15 QA fixture transition." }
        : {}),
    };
    const transitioned = await page.request.post(
      `${origin}/api/work-items/${encodeURIComponent(key)}/transition`,
      { headers: await csrfHeaders(page), data: body },
    );
    if (transitioned.status() !== 200)
      throw new Error(
        `Normal workflow transition for ${key} returned HTTP ${transitioned.status()}.`,
      );
    item = await getItem(page, key);
    if (item.stateCategory === wanted) return item;
  }
  throw new Error(`Workflow did not reach ${wanted} for ${key}.`);
}

async function createLeaf(
  page: Page,
  input: {
    projectId: string;
    typeId: string;
    title: string;
    priority: "high" | "low";
    stateGroups: Map<string, string>;
    targetGroup: "unstarted" | "completed";
  },
) {
  const created = await page.request.post(
    `${origin}/api/projects/${encodeURIComponent(input.projectId)}/work-items`,
    {
      headers: await csrfHeaders(page),
      data: {
        typeId: input.typeId,
        title: input.title,
        priority: input.priority,
      },
    },
  );
  if (created.status() !== 200)
    throw new Error(
      `Controlled work-item create returned HTTP ${created.status()}.`,
    );
  const body = (await created.json()) as { key: string };
  const initial = await getItem(page, body.key);
  const parented = await page.request.post(
    `${origin}/api/work-items/${encodeURIComponent(body.key)}/parent`,
    {
      headers: {
        ...(await csrfHeaders(page)),
        "If-Match": `"${initial.version}"`,
      },
      data: { parentKey: epicKey },
    },
  );
  if (parented.status() !== 200)
    throw new Error(
      `Controlled work-item parent update returned HTTP ${parented.status()}.`,
    );
  const parentedItem = await getItem(page, body.key);
  if (parentedItem.parentId !== (await getItem(page, epicKey)).id)
    throw new Error("Controlled work item did not attach to CCY-5.");
  return transitionToGroup(
    page,
    body.key,
    input.targetGroup,
    input.stateGroups,
  );
}

async function choose(page: Page, selector: string, option: string) {
  await page.locator(selector).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function preview(
  page: Page,
  input: {
    workspaceId: string;
    query: {
      entity: "work_item";
      filter: Record<string, string>;
      groupBy: "epic";
      aggregate: { fn: "count" };
    };
  },
) {
  const response = await page.request.post(
    `${origin}/api/reports/custom/preview`,
    {
      headers: await csrfHeaders(page),
      data: {
        workspaceId: input.workspaceId,
        name: viewName,
        query: input.query,
        chartType: "table",
      },
    },
  );
  if (response.status() !== 200)
    throw new Error(
      `Custom report preview returned HTTP ${response.status()}.`,
    );
  return (await response.json()) as ReportResponse;
}

function epicRow(report: ReportResponse, id: string) {
  return report.rows.find((row) => row._drill === `epic:${id}`);
}

async function clickEpicGroupAndVerifyDrill(
  page: Page,
  handle: string,
  expectedKeys: string[],
  requestHandles: string[],
  requestMetadata: DrillRequestProbe[],
  stage: (name: string) => void,
) {
  const table = page.getByRole("table").filter({
    has: page.getByRole("columnheader", { name: "Matching work items" }),
  });
  const row = table.getByRole("row").filter({ hasText: epicKey }).first();
  stage("drill: prepare request observation");
  const drillResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/reports/custom/items",
    { timeout: 15_000 },
  );
  try {
    await row
      .getByRole("button", { name: "View items", exact: true })
      .click({ timeout: 15_000 });
  } catch (error) {
    await page.screenshot({
      path: path.join(
        artifactRoot,
        "screens/codex-20261026-rh15-drill-action-error.png",
      ),
    });
    throw error;
  }
  stage("drill: click completed; wait for items request");
  const response = await drillResponse;
  if (response.status() !== 200)
    throw new Error(`Custom drill returned HTTP ${response.status()}.`);
  const playwrightRequestBody = response.request().postDataJSON();
  const probe = await page.evaluate(() => {
    const targetWindow = window as typeof window & {
      __rh15DrillProbe?: DrillRequestProbe[];
    };
    return targetWindow.__rh15DrillProbe ?? [];
  });
  const metadata = probe.at(-1);
  if (!metadata) throw new Error("The narrow drill fetch probe did not run.");
  expect(metadata?.method).toBe("POST");
  expect(metadata?.pathname).toBe("/api/reports/custom/items");
  expect(metadata?.bodyAvailable).toBe(true);
  expect(metadata?.handle).toBe(handle);
  requestHandles.push(metadata?.handle ?? "");
  requestMetadata.push({
    ...metadata,
    playwrightBodyAvailable: playwrightRequestBody !== null,
  });
  const dialog = page.getByRole("dialog");
  stage("drill: request observed; wait for dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  for (const key of expectedKeys) {
    stage(`drill: wait for ${key}`);
    await expect(dialog).toContainText(key, { timeout: 15_000 });
  }
  const actualKeys = await dialog.getByRole("row").evaluateAll((rows) =>
    rows
      .slice(1)
      .map((itemRow) => itemRow.querySelector("td")?.textContent?.trim())
      .filter((key): key is string => Boolean(key)),
  );
  expect(actualKeys.sort()).toEqual([...expectedKeys].sort());
  await page.screenshot({
    path: path.join(
      artifactRoot,
      "screens/codex-20261026-rh15-drill-dialog.png",
    ),
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click({
    timeout: 15_000,
  });
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
}

test("persisted RH-15 epic grouping, subtree progress and stable drills", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({
    storageState: path.join(stateRoot, "lead-state.json"),
    ignoreHTTPSErrors: false,
    locale: "en-US",
    colorScheme: "light",
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(15_000);
  await page.addInitScript(() => {
    const targetWindow = window as typeof window & {
      __rh15DrillProbe?: Array<{
        method: string;
        pathname: string;
        contentType: string | null;
        bodyAvailable: boolean;
        handle: string | null;
        playwrightBodyAvailable: boolean;
      }>;
    };
    targetWindow.__rh15DrillProbe ??= [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const target = new URL(request.url, window.location.href);
      if (
        request.method === "POST" &&
        target.pathname === "/api/reports/custom/items"
      ) {
        let bodyAvailable = false;
        let handle: string | null = null;
        try {
          const body = (await request.clone().json()) as {
            handle?: unknown;
          };
          bodyAvailable = true;
          handle = typeof body.handle === "string" ? body.handle : null;
        } catch {
          bodyAvailable = false;
        }
        targetWindow.__rh15DrillProbe?.push({
          method: request.method,
          pathname: target.pathname,
          contentType: request.headers.get("content-type"),
          bodyAvailable,
          handle,
          playwrightBodyAvailable: false,
        });
      }
      return nativeFetch(input, init);
    };
  });
  const runStamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const titles = {
    unstarted: `RH15 QA ${runStamp} unstarted child`,
    completed: `RH15 QA ${runStamp} completed child`,
  };
  const summary = {
    status: "running",
    tlsVerification: "strict",
    fixture: epicKey,
    createdItems: [] as Array<{
      key: string;
      stateCategory: string;
      parent: string;
    }>,
    savedViewCreated: false,
    savedViewReused: false,
    savedViewPrivate: false,
    reportFlagStatus: 0,
    reportScope: "unknown",
    canExport: false,
    parentEpicVerified: false,
    noPreexistingChildren: false,
    controlledFixturesReused: false,
    lastStage: "starting",
    matchingCountUnfiltered: null as number | null,
    matchingCountFiltered: null as number | null,
    progressCompleted: null as number | null,
    progressTotal: null as number | null,
    progressPercent: null as number | null,
    epicDrillHandleVerified: false,
    drillHandles: [] as string[],
    drillRequestMetadata: [] as DrillRequestProbe[],
    playwrightRequestBodyAvailable: null as boolean | null,
    reloadedSavedViewVerified: false,
    csvHeadersHumanReadable: false,
    noneBucketPresent: false,
    unavailableBucketPresent: false,
    featureAndReach: {
      reportFeatureEnabled: false,
      projectReachVerified: false,
      workspaceScope: "unknown",
    },
    originalEpicFieldsUnchanged: false,
    existingCommentsUnchanged: false,
    commentActions: "none",
    priorHarnessAttempts: [
      {
        attempt: 1,
        outcome: "harness_timeout",
        cause:
          "Save locator expected Save; the live Kaneo label is Save report.",
        productOutcome: "No saved view was created in this attempt.",
      },
      {
        attempt: 2,
        outcome: "harness_timeout",
        cause:
          "Drill locator expected Open; the live Kaneo label is View items.",
        productOutcome:
          "The ordinary save flow returned HTTP 200 and persisted the one private view; rollup table displayed 3 matching items and 1/2 (50%) subtree progress.",
      },
    ],
    captures: [] as string[],
    errors: [] as string[],
  };
  let originalEpic: WorkItem | null = null;
  let originalEpicSnapshot = "";
  let originalCommentSnapshot = "";
  let originalPreferences: string | null = null;
  let preferencesCaptured = false;
  let savedViewId: string | null = null;
  let thrownError: unknown;

  const stage = (name: string) => {
    summary.lastStage = name;
    console.log(`[RH15 browser] ${name}`);
  };

  try {
    stage("preflight epic and workspace");
    const epic = await getItem(page, epicKey);
    originalEpic = epic;
    originalEpicSnapshot = JSON.stringify(epic);
    const project = await readJson<{
      id: string;
      workspaceId: string;
      slug: string;
    }>(
      await page.request.get(
        `${origin}/api/project/${encodeURIComponent(epic.projectId)}`,
        {
          headers: { Origin: origin },
        },
      ),
      "CCY project",
    );
    if (project.workspaceId !== epic.workspaceId || project.slug !== "CCY")
      throw new Error("CCY-5 is outside the authorized CCY workspace/project.");
    if (Date.now() - new Date(epic.createdAt).getTime() > 90 * 86_400_000)
      throw new Error(
        "CCY-5 is outside the builder's maximum 90-day matching window; stopping before fixture writes.",
      );

    const workspaces = await readJson<
      Array<{ id: string; name: string; role: string }>
    >(
      await page.request.get(`${origin}/api/workspace`, {
        headers: { Origin: origin },
      }),
      "Lead workspace list",
    );
    const workspace = workspaces.find((entry) => entry.id === epic.workspaceId);
    if (!workspace)
      throw new Error("Lead session cannot reach the CCY workspace.");
    summary.featureAndReach.projectReachVerified = true;

    const types = await readJson<
      Array<{ id: string; name: string; isEpic: boolean; category: string }>
    >(
      await page.request.get(
        `${origin}/api/workspace/${encodeURIComponent(epic.workspaceId)}/work-item-types`,
        {
          headers: { Origin: origin },
        },
      ),
      "Workspace work-item types",
    );
    const epicType = types.find((type) => type.id === epic.typeId);
    if (!epicType?.isEpic)
      throw new Error("CCY-5 is not a configured epic type.");
    summary.parentEpicVerified = true;

    const children = await readJson<{
      data: Array<{ key: string }>;
      meta: { total: number };
    }>(
      await page.request.get(
        `${origin}/api/work-items/${encodeURIComponent(epicKey)}/children?limit=200`,
        {
          headers: { Origin: origin },
        },
      ),
      "CCY-5 children",
    );
    if (children.meta.total !== 0 && children.meta.total !== 2)
      throw new Error("CCY-5 children are not the two authorized QA fixtures.");

    const states = await readJson<
      Array<{ id: string; group: string; isDefault: boolean }>
    >(
      await page.request.get(
        `${origin}/api/projects/${encodeURIComponent(epic.projectId)}/states`,
        {
          headers: { Origin: origin },
        },
      ),
      "CCY project states",
    );
    if (!states.some((state) => state.isDefault))
      throw new Error("CCY project has no default state.");
    const stateGroups = new Map(states.map((state) => [state.id, state.group]));

    const reportCatalogue = await page.request.get(
      `${origin}/api/reports?workspaceId=${encodeURIComponent(epic.workspaceId)}`,
      { headers: { Origin: origin } },
    );
    summary.reportFlagStatus = reportCatalogue.status();
    if (reportCatalogue.status() !== 200)
      throw new Error(
        "Reports are unavailable for the lead session/workspace.",
      );
    const catalogue = (await reportCatalogue.json()) as {
      meta: { scope: "all" | "reach"; canExport: boolean };
    };
    summary.reportScope = catalogue.meta.scope;
    summary.canExport = catalogue.meta.canExport;
    summary.featureAndReach.reportFeatureEnabled = true;
    summary.featureAndReach.workspaceScope = catalogue.meta.scope;

    const existingViews = await readJson<
      Array<{ id: string; name: string; visibility: string }>
    >(
      await page.request.get(
        `${origin}/api/views?workspaceId=${encodeURIComponent(epic.workspaceId)}`,
        {
          headers: { Origin: origin },
        },
      ),
      "Existing saved views",
    );
    const controlledViews = existingViews.filter(
      (view) => view.name === viewName,
    );
    if (controlledViews.length > 1)
      throw new Error("Multiple views use the controlled QA report name.");
    if (controlledViews.length === 1) {
      const controlledView = controlledViews[0];
      if (controlledView.visibility !== "private")
        throw new Error("The existing controlled view is not private.");
      savedViewId = controlledView.id;
      summary.savedViewReused = true;
      summary.savedViewPrivate = true;
    }

    const existingReportItem = await getItem(page, docxFixtureKey);
    if (existingReportItem.projectId !== epic.projectId)
      throw new Error("Read-only task-type probe is outside the CCY project.");
    const existingType = types.find(
      (type) => type.id === existingReportItem.typeId,
    );
    if (!existingType || existingType.isEpic)
      throw new Error(
        "The existing CCY type probe is not a safe non-epic type.",
      );

    let unstarted: WorkItem;
    let completed: WorkItem;
    if (children.meta.total === 0) {
      summary.noPreexistingChildren = true;
      stage("create the two authorized QA children");
      unstarted = await createLeaf(page, {
        projectId: epic.projectId,
        typeId: existingReportItem.typeId,
        title: titles.unstarted,
        priority: "high",
        stateGroups,
        targetGroup: "unstarted",
      });
      summary.createdItems.push({
        key: unstarted.key,
        stateCategory: unstarted.stateCategory,
        parent: epicKey,
      });
      completed = await createLeaf(page, {
        projectId: epic.projectId,
        typeId: existingReportItem.typeId,
        title: titles.completed,
        priority: "low",
        stateGroups,
        targetGroup: "completed",
      });
      summary.createdItems.push({
        key: completed.key,
        stateCategory: completed.stateCategory,
        parent: epicKey,
      });
    } else {
      const fixtureItems = await Promise.all(
        children.data.map((child) => getItem(page, child.key)),
      );
      const safeFixture = (item: WorkItem) =>
        item.title.startsWith("RH15 QA 2026-10-25T18-14-52-110Z ") &&
        item.projectId === epic.projectId &&
        item.workspaceId === epic.workspaceId &&
        item.typeId === existingReportItem.typeId &&
        item.parentId === epic.id &&
        item.archivedAt === null &&
        item.deletedAt === null;
      const reusedUnstarted = fixtureItems.find(
        (item) => item.stateCategory === "unstarted" && safeFixture(item),
      );
      const reusedCompleted = fixtureItems.find(
        (item) => item.stateCategory === "completed" && safeFixture(item),
      );
      if (
        fixtureItems.length !== 2 ||
        fixtureItems.some((item) => !safeFixture(item)) ||
        !reusedUnstarted ||
        !reusedCompleted
      )
        throw new Error("CCY-5 children do not match the owned QA fixtures.");
      unstarted = reusedUnstarted;
      completed = reusedCompleted;
      summary.controlledFixturesReused = true;
      summary.createdItems.push(
        ...fixtureItems.map((item) => ({
          key: item.key,
          stateCategory: item.stateCategory,
          parent: epicKey,
        })),
      );
    }

    stage("snapshot existing CCY-5 comments");
    const existingActivity = await readJson<{
      data: Array<{ id: string; kind: string; body?: unknown }>;
    }>(
      await page.request.get(
        `${origin}/api/work-items/${encodeURIComponent(epicKey)}/activity?limit=50`,
        {
          headers: { Origin: origin },
        },
      ),
      "Existing CCY-5 activity",
    );
    originalCommentSnapshot = JSON.stringify(
      existingActivity.data
        .filter((row) => row.kind === "comment")
        .map((row) => ({ id: row.id, body: row.body })),
    );

    stage("verify canonical 1-of-2 subtree progress");

    const afterChildren = await readJson<{
      data: Array<{ key: string }>;
      meta: { total: number };
      progress: { total: number; completed: number };
    }>(
      await page.request.get(
        `${origin}/api/work-items/${encodeURIComponent(epicKey)}/children?limit=200`,
        {
          headers: { Origin: origin },
        },
      ),
      "CCY-5 children after fixture creation",
    );
    if (
      afterChildren.meta.total !== 2 ||
      afterChildren.progress.total !== 2 ||
      afterChildren.progress.completed !== 1
    )
      throw new Error("CCY-5 canonical subtree fixture is not exactly 1/2.");

    stage("open the persisted report builder");
    await page.goto(`${origin}/agent`);
    const workspaceButton = page.getByRole("button", {
      name: /TaskDesk Service Desk|Codex Cost Cycle 20261025/,
    });
    if (!(await workspaceButton.isVisible()))
      await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await workspaceButton.waitFor({ state: "visible" });
    const activeWorkspace = await workspaceButton.innerText();
    if (!activeWorkspace.includes(workspace.name)) {
      await workspaceButton.click();
      await page
        .getByRole("menuitem", { name: workspace.name, exact: true })
        .click();
    }
    stage("configure epic grouping in the builder");
    await page.goto(`${origin}/agent/reports/new`, {
      waitUntil: "domcontentloaded",
    });
    originalPreferences = await page.evaluate(() =>
      localStorage.getItem("user-preferences"),
    );
    preferencesCaptured = true;

    await page.locator("#builder-name").fill(viewName);
    await choose(page, "#builder-entity", "Work items");
    await choose(page, "#builder-group", "Epic");
    await page.getByRole("button", { name: "90 days", exact: true }).click();
    await choose(page, "#builder-priority", "All priorities");
    await page.getByRole("button", { name: "Table", exact: true }).click();
    const resultsTable = page.getByRole("table").filter({
      has: page.getByRole("columnheader", { name: "Matching work items" }),
    });
    await expect(resultsTable).toBeVisible();
    await expect(
      resultsTable.getByRole("columnheader", {
        name: "Progress (all descendants)",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Epic progress includes all live descendants, regardless of these filters or dates.",
      ),
    ).toBeVisible();

    stage("verify unfiltered and filtered rollups");
    const baseQuery = {
      entity: "work_item" as const,
      filter: { window: "90" },
      groupBy: "epic" as const,
      aggregate: { fn: "count" as const },
    };
    const baseReport = await preview(page, {
      workspaceId: epic.workspaceId,
      query: baseQuery,
    });
    const currentEpicRow = epicRow(baseReport, epic.id);
    if (!currentEpicRow)
      throw new Error("Epic row has no stable typed drill handle.");
    summary.epicDrillHandleVerified =
      currentEpicRow._drill === `epic:${epic.id}`;
    summary.matchingCountUnfiltered = Number(currentEpicRow.value);
    summary.progressCompleted = Number(currentEpicRow.progressCompleted);
    summary.progressTotal = Number(currentEpicRow.progressTotal);
    summary.progressPercent = Number(currentEpicRow.progressPercent);
    summary.noneBucketPresent = baseReport.rows.some(
      (row) => row._drill === "epic-none",
    );
    summary.unavailableBucketPresent = baseReport.rows.some(
      (row) => row._drill === "epic-unavailable",
    );
    expect(currentEpicRow.value).toBe(3);
    expect(currentEpicRow.progressCompleted).toBe(1);
    expect(currentEpicRow.progressTotal).toBe(2);
    expect(currentEpicRow.progressPercent).toBe(50);
    expect(baseReport.notes).toContain("epic_progress_all_descendants");
    const visibleEpicRow = resultsTable
      .getByRole("row")
      .filter({ hasText: epicKey })
      .first();
    await expect(visibleEpicRow).toContainText("3");
    await expect(visibleEpicRow).toContainText("50%");

    const filteredQuery = {
      ...baseQuery,
      filter: { window: "90", priority: "high" },
    };
    await choose(page, "#builder-priority", "High");
    const filteredReport = await preview(page, {
      workspaceId: epic.workspaceId,
      query: filteredQuery,
    });
    const filteredEpicRow = epicRow(filteredReport, epic.id);
    if (!filteredEpicRow)
      throw new Error("Filtered epic row disappeared unexpectedly.");
    summary.matchingCountFiltered = Number(filteredEpicRow.value);
    expect(Number(filteredEpicRow.value)).toBeLessThan(
      Number(currentEpicRow.value),
    );
    expect(filteredEpicRow.progressCompleted).toBe(
      currentEpicRow.progressCompleted,
    );
    expect(filteredEpicRow.progressTotal).toBe(currentEpicRow.progressTotal);
    expect(filteredEpicRow.progressPercent).toBe(
      currentEpicRow.progressPercent,
    );

    await choose(page, "#builder-priority", "All priorities");
    if (savedViewId) {
      stage("reuse the one existing private view");
      await page.goto(
        `${origin}/agent/reports/new?view=${encodeURIComponent(savedViewId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page).toHaveURL(/view=/u);
      const readBack = await readJson<{
        id: string;
        name: string;
        visibility: string;
        query: { groupBy?: string; filter?: Record<string, string> };
      }>(
        await page.request.get(
          `${origin}/api/views/${encodeURIComponent(savedViewId)}`,
          { headers: { Origin: origin } },
        ),
        "Saved report read-back",
      );
      if (
        readBack.name !== viewName ||
        readBack.visibility !== "private" ||
        readBack.query.groupBy !== "epic" ||
        readBack.query.filter?.window !== "90"
      )
        throw new Error("Saved private report did not persist the epic query.");
    } else {
      stage("save the one private view");
      const saveResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/views",
        { timeout: 15_000 },
      );
      await page
        .getByRole("button", { name: "Save report", exact: true })
        .click();
      stage("save control activated; waiting for POST /api/views");
      const saveResponse = await saveResponsePromise;
      stage(`POST /api/views returned ${saveResponse.status()}`);
      if (saveResponse.status() !== 200)
        throw new Error(
          `Private saved report save returned HTTP ${saveResponse.status()}.`,
        );
      const savedView = (await saveResponse.json()) as {
        id: string;
        name: string;
        visibility: string;
      };
      savedViewId = savedView.id;
      summary.savedViewCreated = savedView.name === viewName;
      summary.savedViewPrivate = savedView.visibility === "private";
      if (!summary.savedViewCreated || !summary.savedViewPrivate)
        throw new Error("Saved report is not the authorized private view.");
      await expect(page).toHaveURL(/view=/u);
    }
    if (!savedViewId) throw new Error("Private view ID was not retained.");
    await page.reload({ waitUntil: "domcontentloaded" });
    const tableButton = page.getByRole("button", {
      name: "Table",
      exact: true,
    });
    if ((await tableButton.getAttribute("aria-pressed")) !== "true")
      await tableButton.click();
    await expect(resultsTable).toBeVisible();
    const reloadedReport = await preview(page, {
      workspaceId: epic.workspaceId,
      query: baseQuery,
    });
    const reloadedEpicRow = epicRow(reloadedReport, epic.id);
    expect(reloadedEpicRow?.value).toBe(3);
    expect(reloadedEpicRow?.progressPercent).toBe(50);
    expect(reloadedEpicRow?._drill).toBe(`epic:${epic.id}`);
    summary.reloadedSavedViewVerified = true;
    stage("verify typed epic drill");
    await clickEpicGroupAndVerifyDrill(
      page,
      `epic:${epic.id}`,
      [epicKey, unstarted.key, completed.key],
      summary.drillHandles,
      summary.drillRequestMetadata,
      stage,
    );
    summary.playwrightRequestBodyAvailable =
      summary.drillRequestMetadata.at(-1)?.playwrightBodyAvailable ?? null;

    if (summary.canExport) {
      await choose(page, "#builder-priority", "All priorities");
      const downloadPromise = page.waitForEvent("download", {
        timeout: 15_000,
      });
      const exportResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/reports/custom/export",
        { timeout: 15_000 },
      );
      await page
        .getByRole("button", { name: "Export CSV", exact: true })
        .click({ timeout: 15_000 });
      const [download, exportResponse] = await Promise.all([
        downloadPromise,
        exportResponsePromise,
      ]);
      if (exportResponse.status() !== 200)
        throw new Error(
          `Custom report export returned HTTP ${exportResponse.status()}.`,
        );
      const csvPath = await download.path();
      if (!csvPath)
        throw new Error("CSV export did not produce a local download.");
      const csv = await readFile(csvPath, "utf8");
      summary.csvHeadersHumanReadable =
        csv.includes("Matching work items") &&
        csv.includes("Completed descendants") &&
        csv.includes("All descendants") &&
        csv.includes("Progress (all descendants)") &&
        !csv.includes(`epic:${epic.id}`);
      expect(summary.csvHeadersHumanReadable).toBe(true);
    }

    stage("capture responsive light and dark views");
    for (const theme of ["light", "dark"] as const) {
      stage(`set ${theme} theme`);
      await page.evaluate((nextTheme) => {
        const key = "user-preferences";
        const raw = localStorage.getItem(key);
        const current = raw ? JSON.parse(raw) : { state: {} };
        current.state ??= {};
        current.state.theme = nextTheme;
        localStorage.setItem(key, JSON.stringify(current));
      }, theme);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${theme}\\b`),
      );
      const chartTableButton = page.getByRole("button", {
        name: "Table",
        exact: true,
      });
      if ((await chartTableButton.getAttribute("aria-pressed")) !== "true")
        await chartTableButton.click();
      await expect(resultsTable).toBeVisible();
      for (const width of [375, 768, 1440] as const) {
        stage(`capture ${theme} ${width}px`);
        await page.setViewportSize({ width, height: 960 });
        await expect(
          resultsTable.getByRole("row").filter({ hasText: epicKey }).first(),
        ).toContainText("50%");
        const filename = `codex-20261026-rh15-epic-${theme}-${width}.png`;
        const capturePath = path.join(artifactRoot, "screens", filename);
        await mkdir(path.dirname(capturePath), { recursive: true });
        await page.screenshot({ path: capturePath, fullPage: false });
        summary.captures.push(filename);
      }
    }
    summary.status = "passed";
  } catch (error) {
    summary.status = "failed";
    summary.errors.push(error instanceof Error ? error.name : "Error");
    thrownError = error;
  } finally {
    stage("verify fixture preservation and write evidence");
    if (originalEpic) {
      try {
        const after = await getItem(page, epicKey);
        summary.originalEpicFieldsUnchanged =
          JSON.stringify(after) === originalEpicSnapshot;
        const activity = await readJson<{
          data: Array<{ id: string; kind: string; body?: unknown }>;
        }>(
          await page.request.get(
            `${origin}/api/work-items/${encodeURIComponent(epicKey)}/activity?limit=50`,
            {
              headers: { Origin: origin },
            },
          ),
          "Final CCY-5 activity",
        );
        const finalComments = JSON.stringify(
          activity.data
            .filter((row) => row.kind === "comment")
            .map((row) => ({ id: row.id, body: row.body })),
        );
        summary.existingCommentsUnchanged =
          finalComments === originalCommentSnapshot;
      } catch {
        summary.errors.push("fixture_restoration_check_failed");
      }
    }
    if (preferencesCaptured) {
      try {
        await page.evaluate((raw) => {
          if (raw === null) localStorage.removeItem("user-preferences");
          else localStorage.setItem("user-preferences", raw);
        }, originalPreferences);
      } catch {
        summary.errors.push("browser_closed_before_preferences_restore");
      }
    }
    if (
      !summary.originalEpicFieldsUnchanged ||
      !summary.existingCommentsUnchanged
    )
      summary.status = "fixture_preservation_failed";
    await mkdir(path.join(artifactRoot, "audit"), { recursive: true });
    await writeFile(
      path.join(artifactRoot, "audit/codex-20261026-rh15-epic-browser.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      { mode: 0o600 },
    );
    await context.close();
  }
  if (summary.status === "fixture_preservation_failed")
    throw new Error("The CCY-5 fixture preservation check failed.");
  if (thrownError) throw thrownError;
});
