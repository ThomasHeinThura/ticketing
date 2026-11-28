import { expect, test } from "@playwright/test";
import {
  expectNoSeriousAxeViolations,
  installIdentityAdminFixture,
  newIdentityFixture,
} from "./helpers/identity-admin-fixture";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

test.use({ trace: "off", video: "off", screenshot: "off" });

const row = (index: number) => ({
  id: `webhook-${index}`,
  name: `Incident receiver ${index}`,
  workspaceId: "workspace-1",
  workspaceName: "Support",
  ownerPersonId: "person-1",
  ownerName: "A. Agent",
  receivesEverythingBecause: "sees_all",
  events: ["work_item.updated", "sla.breached", "work_item.created"],
  active: true,
  disabledAt: null,
  disabledReason: null,
  secretRotatedAt: "2026-10-25T12:00:00.000Z",
});

// #1279: at phone width the seven-column table scrolls sideways; that region must be
// named and reachable by keyboard.
test("the webhook security table scrolls in a named, focusable region @a11y", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installIdentityAdminFixture(page, newIdentityFixture());
  await page.route("**/api/instance/webhooks/security-posture**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [row(1), row(2), row(3)],
        page: { nextCursor: null, hasMore: false },
      }),
    }),
  );
  await page.goto("/god-mode/webhooks");
  const region = page.getByRole("region", { name: "Webhook security posture" });
  await expect(region.getByText("Incident receiver 1")).toBeVisible();
  const viewport = region.locator('[data-slot="scroll-area-viewport"]');
  await viewport.focus();
  await expect(viewport).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  await expectNoSeriousAxeViolations(page);
});
