import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  PROJECT_ID,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

// The old Kaneo board link: it now opens the canonical work-item board, whose live updates
// come from the native work-item socket (`/api/ws`, one subscription per project topic).
const BOARD = `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`;
const SOCKET = /\/api\/ws(?:\?|$)/;

/** A healthy native socket: acknowledges every subscription and answers pings. */
async function routeHealthySocket(page: Page) {
  await page.routeWebSocket(SOCKET, (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== "string") return;
      const frame = JSON.parse(message) as { type?: string; topic?: string };
      if (frame.type === "subscribe")
        socket.send(JSON.stringify({ type: "subscribed", topic: frame.topic }));
      if (frame.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    });
  });
}

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
  await expect(page).toHaveURL(/\/agent\/projects\/WLP\/work/);
  const indicator = page.getByTestId("realtime-unavailable");
  await expect(indicator).toBeVisible();
  await expect(indicator).toContainText("Live updates are unavailable");
  // The server would accept every upgrade and close it again; the client must stop at one.
  await page.waitForTimeout(3_500);
  expect(attempts).toBe(1);
  await expect(indicator).toBeVisible();
  // The page stays usable.
  await expect(
    page.getByText("Seeded work item 1", { exact: true }).first(),
  ).toBeVisible();
});

test("a healthy socket shows no indicator", async ({ page }) => {
  await installPerformanceApiFixture(page);
  await routeHealthySocket(page);
  await page.goto(BOARD);
  await expect(page).toHaveURL(/\/agent\/projects\/WLP\/work/);
  await expect(
    page.getByText("Seeded work item 1", { exact: true }).first(),
  ).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId("realtime-unavailable")).toHaveCount(0);
});
