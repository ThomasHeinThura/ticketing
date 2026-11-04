import { expect, test } from "@playwright/test";
import {
  enterVerification,
  expectNoSeriousAxeViolations,
  installIdentityAdminFixture,
  newIdentityFixture,
} from "./helpers/identity-admin-fixture";

for (const width of [375, 820, 1440])
  for (const theme of ["light", "dark"] as const) {
    test(`inactive storage draft at ${width}px in ${theme} @a11y`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (value) =>
          localStorage.setItem(
            "user-preferences",
            JSON.stringify({ state: { theme: value }, version: 0 }),
          ),
        theme,
      );
      const admin = newIdentityFixture();
      await installIdentityAdminFixture(page, admin);
      let version = 2;
      const config = {
        connector: "external",
        endpoint: "https://s3.example.test",
        publicBaseUrl: "https://files.example.test",
        region: "region-1",
        bucket: "attachments",
        keyPrefix: "",
        forcePathStyle: true,
        maxImageUploadBytes: 10485760,
        presignTtlSeconds: 300,
      };
      const response = () => ({
        version,
        config,
        credentialConfigured: true,
        accessKeyIdConfigured: true,
        secretAccessKeyConfigured: true,
      });
      const writes: unknown[] = [];
      await page.route("**/api/instance/storage/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path.endsWith("/usage"))
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
                allowedExtensions: [],
              },
              attachments: {
                ready: { count: 0, bytes: "0" },
                pending: { count: 0, bytes: "0" },
                deleted: { count: 0, bytes: "0" },
              },
            },
          });
        if (path.endsWith("/s3-draft") && request.method() === "GET")
          return route.fulfill({ json: response() });
        if (path.endsWith("/s3-draft") && request.method() === "PUT") {
          writes.push(request.postDataJSON());
          version++;
          return route.fulfill({ json: response() });
        }
        return route.fulfill({ status: 404, json: {} });
      });
      await page.goto("/god-mode/storage");
      await expect(
        page.getByText("Inactive draft", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/does not switch storage or migrate existing files/),
      ).toBeVisible();
      await expectNoSeriousAxeViolations(page);
      await enterVerification(page);
      const save = page.getByRole("button", { name: "Save draft" });
      await save.focus();
      await expect(save).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        page.getByText("Draft saved", { exact: true }),
      ).toBeVisible();
      expect(writes).toHaveLength(1);
      expect(admin.challenges).toHaveLength(1);
      await testInfo.attach(`s3-draft-${width}-${theme}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
