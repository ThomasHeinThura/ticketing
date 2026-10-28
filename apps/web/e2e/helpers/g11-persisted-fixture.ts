import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
} from "@playwright/test";
import {
  loadManifest,
  type PersistedFixture,
  type PersistedManifest,
  readPrivateJson,
} from "../../../../scripts/perf/laptop-sit.mjs";

export const CANONICAL_SELECTORS = {
  list: '[data-testid="work-item-list-populated"] [data-task-id]',
  board: '[data-testid="work-item-board-card"] [data-task-id]',
  more: '[data-testid="work-item-list-load-more"]',
} as const;

/** Accept only the exact isolated receipt, never merely a matching number of rows. */
export function assertExactFixtureIds(actual: string[], expected: string[]) {
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    new Set(expected).size !== expected.length ||
    expected.some((id) => !actual.includes(id))
  ) {
    throw new Error(
      "Persisted fixture membership differs from the private receipt.",
    );
  }
}

export function readPersistedInput(filename: string) {
  return loadManifest(filename);
}

export async function authenticatedContext(
  browser: Browser,
  input: PersistedManifest,
) {
  const credentials = readPrivateJson(input.credentialsFile) as {
    accounts?: { email: string; password: string }[];
  };
  const account = credentials.accounts?.find(
    (row) => row.email === input.staffEmail,
  );
  if (
    !account ||
    typeof account.password !== "string" ||
    account.password.length < 16
  ) {
    throw new Error("Missing private synthetic staff account.");
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  try {
    const response = await context.request.post(
      new URL("/api/auth/sign-in/email", input.agentOrigin).href,
      {
        headers: { Origin: input.agentOrigin },
        data: { email: account.email, password: account.password },
      },
    );
    if (!response.ok())
      throw new Error("Synthetic staff authentication failed.");
    return context;
  } catch {
    await context.close();
    // Never propagate request errors: Playwright may embed posted credentials in them.
    throw new Error(
      "Synthetic staff authentication failed; request details omitted.",
    );
  }
}

/** Read only. All pages are verified before measurement in separate contexts. */
export async function verifyPersistedFixture(
  request: APIRequestContext,
  input: PersistedManifest,
  fixture: PersistedFixture,
) {
  const projectResponse = await request.get(
    new URL(
      `/api/project/${encodeURIComponent(fixture.projectId)}`,
      input.agentOrigin,
    ).href,
  );
  if (!projectResponse.ok()) throw new Error("Fixture project read failed.");
  const project = (await projectResponse.json()) as {
    workspaceId: string;
    organisationId: string;
    slug: string;
    name: string;
  };
  if (
    project.workspaceId !== input.workspaceId ||
    project.organisationId !== input.organisationId ||
    project.slug !== fixture.projectKey ||
    !project.name.startsWith(`G11 ${input.runId} `)
  ) {
    throw new Error(
      "Fixture project ownership does not match the synthetic receipt.",
    );
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page <= fixture.items.length; page++) {
    const url = new URL(
      `/api/projects/${encodeURIComponent(fixture.projectId)}/work-items`,
      input.agentOrigin,
    );
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await request.get(url.href);
    if (!response.ok()) throw new Error("Persisted fixture read failed.");
    const body = (await response.json()) as {
      data: { id: string; projectId: string }[];
      page: { hasMore: boolean; nextCursor: string | null };
    };
    if (
      !Array.isArray(body.data) ||
      body.data.some((item) => item.projectId !== fixture.projectId)
    )
      throw new Error("Fixture project isolation failed.");
    ids.push(...body.data.map((item) => item.id));
    if (!body.page?.hasMore) {
      assertExactFixtureIds(
        ids,
        fixture.items.map((item) => item.id),
      );
      return;
    }
    if (!body.page.nextCursor || seen.has(body.page.nextCursor))
      throw new Error("Fixture cursor did not advance.");
    cursor = body.page.nextCursor;
    seen.add(cursor);
  }
  throw new Error("Fixture pagination exceeded its bounded receipt.");
}

export async function appendAllListPages(page: Page, expectedIds: string[]) {
  for (let attempt = 0; attempt < expectedIds.length; attempt++) {
    const rows = page.locator(CANONICAL_SELECTORS.list);
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    if (count >= expectedIds.length) {
      assertExactFixtureIds(
        await rows.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-task-id") ?? ""),
        ),
        expectedIds,
      );
      return;
    }
    const more = page.locator(CANONICAL_SELECTORS.more);
    await expect(more).toBeEnabled();
    await more.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(count);
  }
  throw new Error("List paging did not finish within the receipt bound.");
}
