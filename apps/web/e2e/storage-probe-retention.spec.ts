import { expect, type Page, test } from "@playwright/test";
import {
  expectNoSeriousAxeViolations,
  installIdentityAdminFixture,
  newIdentityFixture,
} from "./helpers/identity-admin-fixture";

type ProbeStatus = "verified" | "read_failed" | "timed_out";

async function installStorageFixture(page: Page) {
  const admin = newIdentityFixture();
  await installIdentityAdminFixture(page, admin);
  let status: ProbeStatus = "verified";
  const requests: string[] = [];
  // Registered last so storage requests are handled before the shared API fixture.
  await page.route("**/api/instance/storage/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(`${request.method()} ${path}`);
    if (request.method() === "GET" && path === "/api/instance/storage/usage") {
      return route.fulfill({
        json: {
          checkedAt: "2026-10-25T12:00:00.000Z",
          backend: {
            source: "bootstrap",
            driver: "filesystem",
            configuration: "configured",
            connectivity: "not_checked",
            probeAvailable: true,
          },
          usageBasis: "attachment_metadata",
          physicalUsageAvailable: false,
          limits: {
            maxAttachmentBytes: 10485760,
            maxAttachmentsPerItem: 10,
            allowedExtensions: [".png", ".pdf"],
          },
          attachments: {
            ready: { count: 3, bytes: "2048" },
            pending: { count: 1, bytes: "128" },
            deleted: { count: 2, bytes: "4096" },
          },
        },
      });
    }
    if (request.method() === "POST" && path === "/api/instance/storage/test") {
      return route.fulfill({
        json: {
          status,
          cleanup: "not_attempted",
          diagnosticObjectMayRemain: true,
          durationMs: 42,
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return {
    requests,
    setStatus: (value: ProbeStatus) => {
      status = value;
    },
  };
}

for (const theme of ["light", "dark"] as const) {
  test(`storage probe explains retained objects at mobile width in ${theme} mode @a11y`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript((value) => {
      localStorage.setItem(
        "user-preferences",
        JSON.stringify({ state: { theme: value }, version: 0 }),
      );
    }, theme);
    const fixture = await installStorageFixture(page);
    await page.goto("/god-mode/storage");
    await expect(page.locator("html")).toHaveClass(
      new RegExp(`\\b${theme}\\b`),
    );
    await expect(
      page.getByRole("heading", { name: "Storage", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Each test attempts to write a small diagnostic object. Diagnostic objects may remain in storage and are excluded from attachment metadata totals.",
      ),
    ).toBeVisible();
    expect(
      fixture.requests.filter((request) => request.startsWith("POST ")),
    ).toEqual([]);

    const probe = page.getByRole("button", { name: "Run storage probe" });
    await probe.focus();
    await expect(probe).toBeFocused();
    await page.keyboard.press("Enter");
    const result = page
      .getByRole("alert")
      .filter({ hasText: "Storage write and read verified" });
    await expect(result).toBeVisible();
    await expect(result).toContainText("Cleanup: not verified (not attempted)");
    await expect(result).toContainText(
      "A diagnostic object may remain in storage.",
    );
    await expect(result).not.toContainText("Cleanup: confirmed");
    await expect(result).toHaveClass(/border-warning/);
    expect(
      fixture.requests.filter(
        (request) => request === "POST /api/instance/storage/test",
      ),
    ).toHaveLength(1);
    await expectNoSeriousAxeViolations(page);
    await testInfo.attach(`storage-probe-${theme}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}

test("storage probe displays read failure and timeout separately", async ({
  page,
}) => {
  const fixture = await installStorageFixture(page);
  await page.goto("/god-mode/storage");
  const probe = page.getByRole("button", { name: "Run storage probe" });
  fixture.setStatus("read_failed");
  await probe.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Storage read failed" }),
  ).toBeVisible();
  fixture.setStatus("timed_out");
  await probe.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Storage operation timed out" }),
  ).toBeVisible();
  await expect(
    page.getByText("Storage read failed", { exact: true }),
  ).not.toBeVisible();
  expect(
    fixture.requests.filter(
      (request) => request === "POST /api/instance/storage/test",
    ),
  ).toHaveLength(2);
});
