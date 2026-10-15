import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  PROJECT_ID,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

const BOARD = `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`;
const SOCKET = new RegExp(`/api/ws/${PROJECT_ID}(?:\\?|$)`);

test("a connection-limit close shows the live-updates-unavailable indicator and is not retried", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  let attempts = 0;
  // Registered after the fixture's own handler, so it takes precedence.
  await page.routeWebSocket(SOCKET, (socket) => {
    attempts += 1;
    socket.close({ code: 1008, reason: "connection limit" });
  });
  await page.goto(BOARD);
  const indicator = page.getByTestId("realtime-unavailable");
  await expect(indicator).toBeVisible();
  await expect(indicator).toContainText("Live updates are unavailable");
  // The server would accept every upgrade and close it again; the client must stop at one.
  await page.waitForTimeout(3_500);
  expect(attempts).toBe(1);
  await expect(indicator).toBeVisible();
  // The page stays usable.
  await expect(
    page.getByText("Seeded legacy task 1", { exact: true }),
  ).toBeVisible();
});

test("a healthy socket shows no indicator", async ({ page }) => {
  await installPerformanceApiFixture(page);
  await page.goto(BOARD);
  await expect(
    page.getByText("Seeded legacy task 1", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId("realtime-unavailable")).toHaveCount(0);
});
