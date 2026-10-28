import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

test("direct work-list visit downloads its parent outlet before the session resolves", async ({
  page,
}) => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../dist/agent/.vite/manifest.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, { file: string; name?: string; isEntry?: boolean }>;
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  expect(
    entry,
    "built agent entry must be represented in the manifest",
  ).toBeDefined();
  const parent = Object.entries(manifest).find(([key]) =>
    key.endsWith("/projects/$projectKey.tsx?tsr-split=component"),
  )?.[1];
  expect(
    parent,
    "built project outlet must be represented in the manifest",
  ).toBeDefined();
  const header = Object.entries(manifest).find(
    ([key, entry]) =>
      entry.name === "project-layout" ||
      key.endsWith("src/components/common/project-layout.tsx"),
  )?.[1];
  expect(
    header,
    "Kaneo project frame must be represented in the manifest",
  ).toBeDefined();
  const terminology = Object.entries(manifest).find(
    ([key, chunk]) =>
      chunk.name === "agent-translation" ||
      key.endsWith("src/lib/i18n/agent-translation.ts"),
  )?.[1];
  expect(
    terminology,
    "agent terminology must be represented in the manifest",
  ).toBeDefined();
  await installPerformanceApiFixture(page);
  let releaseSession: () => void = () => {};
  const heldSession = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  let releaseEntry: () => void = () => {};
  const heldEntry = new Promise<void>((resolve) => {
    releaseEntry = resolve;
  });
  await page.route(`**/${entry?.file}`, async (route) => {
    await heldEntry;
    await route.continue();
  });
  await page.route("**/api/auth/get-session**", async (route) => {
    await heldSession;
    await route.fallback();
  });
  const downloaded = page.waitForResponse(
    (response) => response.url().endsWith(`/${parent?.file}`) && response.ok(),
  );
  const headerDownloaded = page.waitForResponse(
    (response) => response.url().endsWith(`/${header?.file}`) && response.ok(),
  );
  const terminologyDownloaded = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/${terminology?.file}`) && response.ok(),
  );
  try {
    // HTML must start the entire frame closure without executing the application.
    // A lazy import during entry evaluation is too late on a cold network.
    await page.goto(WORK_LIST_PATH, { waitUntil: "commit" });
    await Promise.all([downloaded, headerDownloaded, terminologyDownloaded]);
    await expect(
      page.locator(`link[rel="modulepreload"][href="/${header?.file}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`link[rel="modulepreload"][href="/${parent?.file}"]`),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "WLP · Work items" }),
    ).not.toBeVisible();
  } finally {
    releaseEntry();
    releaseSession();
  }
  await expect(page.getByTestId("work-item-list-populated")).toBeVisible();
});

test("opening a row paints its pane while the detail body is still downloading", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  let releaseBody: () => void = () => {};
  const heldBody = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  let detailReads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/api/work-items/WLP-1"
    )
      detailReads += 1;
  });
  await page.route(
    (url) =>
      url.pathname.includes("work-item-side-pane-body-") &&
      url.pathname.endsWith(".js"),
    async (route) => {
      await heldBody;
      await route.continue();
    },
  );
  try {
    await page.goto(WORK_LIST_PATH);
    const list = page.locator("div[data-testid=work-item-list-populated]");
    await expect(
      list
        .locator("[data-virtual-item-id]")
        .first()
        .getByTestId("work-item-inline-assignee"),
    ).toBeVisible();
    expect(detailReads).toBe(0);
    await list.locator('a[href="/agent/work-items/WLP-1"]').click();
    await expect(page.getByTestId("work-item-detail-loading")).toBeVisible();
    await expect(page.getByTestId("work-item-detail")).toHaveCount(0);
    expect(detailReads).toBe(0);
    releaseBody();
    await expect(page.getByTestId("work-item-detail")).toBeVisible();
    expect(detailReads).toBeGreaterThan(0);
  } finally {
    releaseBody();
  }
});
