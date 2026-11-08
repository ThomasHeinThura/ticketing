import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

test("direct work-list visit requests its route chunks once the entry has run, before the session resolves", async ({
  page,
}) => {
  // The download that gates the entry is bandwidth-bound on the G11 profile; the route's
  // chunks beside it delayed the entry by their own transfer time (G11 work-list LCP).
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
  const parentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(`/${parent?.file}`))
      parentRequests.push(request.url());
  });
  try {
    await page.goto(WORK_LIST_PATH, { waitUntil: "commit" });
    // The HTML's own preloads (entry closure, locale) are all requested by now.
    await expect(page.locator('link[rel="modulepreload"]')).not.toHaveCount(0);
    await page.waitForTimeout(500);
    expect(parentRequests).toEqual([]);
    await expect(
      page.locator(`link[rel="modulepreload"][href="/${parent?.file}"]`),
    ).toHaveCount(0);

    const downloaded = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/${parent?.file}`) && response.ok(),
    );
    const headerDownloaded = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/${header?.file}`) && response.ok(),
    );
    releaseEntry();
    // Requested by the HTML's script, not by the router after the session check.
    await Promise.all([downloaded, headerDownloaded]);
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

test("direct work-list visit leaves the web font to the text that first uses it", async ({
  page,
}) => {
  // The preview paints in Geist's size-matched fallback, so the font is off the first paint's
  // path; preloaded, its 29 KB competed with the entry or the route's chunks (G11 work-list LCP).
  const manifest = JSON.parse(
    readFileSync(
      new URL("../dist/agent/.vite/manifest.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, { file: string; isEntry?: boolean }>;
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  expect(
    entry,
    "built agent entry must be represented in the manifest",
  ).toBeDefined();
  await installPerformanceApiFixture(page);
  let releaseEntry: () => void = () => {};
  const heldEntry = new Promise<void>((resolve) => {
    releaseEntry = resolve;
  });
  await page.route(`**/${entry?.file}`, async (route) => {
    await heldEntry;
    await route.continue();
  });
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/geist-latin-wght-normal-[\w-]+\.woff2$/.test(request.url()))
      fontRequests.push(request.url());
  });
  try {
    await page.goto(WORK_LIST_PATH, { waitUntil: "commit" });
    await expect(page.locator('link[rel="modulepreload"]')).not.toHaveCount(0);
    await page.waitForTimeout(500);
    expect(fontRequests).toEqual([]);
  } finally {
    releaseEntry();
  }
  await expect(page.getByTestId("work-item-list-preview")).toBeVisible();
  await expect(page.getByTestId("work-item-list-populated")).toBeVisible();
  await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(0);
  // Requested once, by the stylesheet, not twice by a late preload and the stylesheet.
  await expect.poll(() => fontRequests.length).toBe(1);
});
