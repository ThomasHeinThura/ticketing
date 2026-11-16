import { expect, type Page, test } from "@playwright/test";
import {
  navigateToSetup,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import {
  createFirstWorkspace,
  enrollFirstAdmin,
} from "./helpers/enroll-first-admin";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

async function requestJson<T>(
  page: Page,
  path: string,
  data?: Record<string, unknown>,
) {
  const result = await page.evaluate(
    async ({ path: url, data: body }) => {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (body !== undefined) {
        const issuer = await fetch("/api/me/csrf-token", {
          credentials: "same-origin",
        });
        if (!issuer.ok) return { status: issuer.status, body: null };
        const { token } = (await issuer.json()) as { token: string };
        headers["x-taskdesk-csrf"] = token;
      }
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    { path, data },
  );
  return { status: result.status, body: result.body as T };
}

test("team deletion requires its exact name in the shared dialog and refuses direct click bypasses", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const containers: string[] = [];
  try {
    await withMfaCsrfApp(
      async ({ origin, email, password, setupUrl }) => {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          locale: "en-GB",
          timezoneId: "UTC",
          colorScheme: "dark",
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          await navigateToSetup(page, setupUrl);
          await page
            .getByLabel("Full name")
            .fill("Team Deletion Journey Admin");
          await page.getByLabel("Email").fill(email);
          await page
            .locator('input[autocomplete="new-password"]')
            .fill(password);
          await page.getByRole("button", { name: "Create account" }).click();
          await enrollFirstAdmin(page, origin, password);
          const workspaceId = await createFirstWorkspace(
            page,
            "Team Deletion Journey Workspace",
          );
          const teamName = "Disposable Support Team";
          const created = await requestJson<{ id: string; name: string }>(
            page,
            "/api/teams",
            { workspaceId, name: teamName },
          );
          expect(created.status).toBe(200);
          expect(created.body.name).toBe(teamName);
          const teamPath = `/api/teams/${encodeURIComponent(created.body.id)}`;
          const teamsPath = `/api/teams?workspaceId=${encodeURIComponent(workspaceId)}`;
          const detailPath = `/dashboard/settings/workspace/teams/${encodeURIComponent(created.body.id)}`;
          const proofRequests: string[] = [];
          page.on("request", (request) => {
            const path = new URL(request.url()).pathname;
            if (
              request.method() === "POST" &&
              (path === "/api/me/step-up" ||
                path.startsWith("/api/me/step-up/"))
            )
              proofRequests.push(path);
          });
          await page.goto(new URL(detailPath, origin).toString());
          await expect(
            page.getByRole("heading", { name: teamName, exact: true }),
          ).toBeVisible();
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
          const trigger = page.getByRole("button", {
            name: "Delete team",
            exact: true,
          });
          await expect(trigger).toBeEnabled();
          await expect(
            page.locator('[data-slot="card"]').filter({ has: trigger }),
          ).toHaveClass(/border-destructive\/32/);
          await trigger.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: testInfo.outputPath("team-danger-zone-desktop-dark.png"),
          });

          const openDeletion = async () => {
            const pending = page.waitForResponse(
              (response) =>
                new URL(response.url()).pathname === teamPath &&
                response.request().method() === "DELETE",
            );
            await trigger.click();
            const requested = await pending;
            expect(requested.status()).toBe(202);
            const action = (await requested.json()) as {
              pendingActionId: string;
              confirmation: string;
              summary: { name: string };
            };
            expect(action.confirmation).toBe("typed_name");
            expect(action.summary.name).toBe(teamName);
            return action.pendingActionId;
          };
          const cancelledId = await openDeletion();
          const dialog = page.getByRole("dialog", {
            name: "Delete team",
            exact: true,
          });
          await expect(
            dialog.getByRole("heading", { name: "Delete team" }),
          ).toBeVisible();
          const cancelResponse = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                `/api/me/pending-actions/${cancelledId}/cancel` &&
              response.request().method() === "POST",
          );
          await dialog.getByRole("button", { name: "Cancel request" }).click();
          expect((await cancelResponse).status()).toBe(200);
          await expect(dialog).toBeHidden();
          await expect(trigger).toBeFocused();
          expect((await requestJson(page, teamPath)).status).toBe(200);
          const cancelledToast = page.getByText("Deletion request cancelled.", {
            exact: true,
          });
          await expect(cancelledToast).toBeVisible();
          await expect(cancelledToast).toBeHidden({ timeout: 10_000 });

          const pendingId = await openDeletion();
          const input = dialog.getByLabel("Type the exact name to confirm");
          const approve = dialog.getByRole("button", {
            name: "Delete",
            exact: true,
          });
          await expect(input).toHaveValue("");
          await expect(approve).toBeDisabled();
          for (const value of [teamName.toLowerCase(), `${teamName} `]) {
            await input.fill(value);
            await expect(approve).toBeDisabled();
          }
          await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
          const approvePath = `/api/me/pending-actions/${pendingId}/approve`;
          for (const bypass of [
            {},
            { click: true },
            { typedName: teamName.toLowerCase() },
            { typedName: `${teamName} ` },
          ]) {
            expect((await requestJson(page, approvePath, bypass)).status).toBe(
              400,
            );
            expect((await requestJson(page, teamPath)).status).toBe(200);
            const action = await requestJson<{ state: string }>(
              page,
              `/api/me/pending-actions/${pendingId}`,
            );
            expect(action.status).toBe(200);
            expect(action.body.state).toBe("pending");
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.emulateMedia({ colorScheme: "dark" });
          await expect(input).toBeVisible();
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
          await page.screenshot({
            path: testInfo.outputPath("team-name-required-mobile-dark.png"),
          });
          await input.fill(teamName);
          await expect(approve).toBeEnabled();
          const approved = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === approvePath &&
              response.request().method() === "POST",
          );
          await input.press("Tab");
          await expect(approve).toBeFocused();
          await expect(approve).toBeInViewport();
          await page.screenshot({
            path: testInfo.outputPath("team-exact-name-ready-mobile-dark.png"),
          });
          await page.keyboard.press("Enter");
          const response = await approved;
          expect(response.status()).toBe(200);
          expect(((await response.json()) as { state: string }).state).toBe(
            "executed",
          );
          await expect(dialog).toBeHidden();
          await expect(page).toHaveURL(
            new URL("/dashboard/settings/workspace/teams", origin).toString(),
          );
          expect((await requestJson(page, teamPath)).status).toBe(404);
          const teams = await requestJson<{
            data: Array<{ id: string }>;
          }>(page, teamsPath);
          expect(teams.status).toBe(200);
          expect(teams.body.data.map((team) => team.id)).not.toContain(
            created.body.id,
          );
          await page.reload();
          await expect(page.getByRole("link", { name: teamName })).toHaveCount(
            0,
          );
          expect((await requestJson(page, teamPath)).status).toBe(404);
          expect(proofRequests).toEqual([]);
          await page.screenshot({
            path: testInfo.outputPath("team-deleted-reloaded-mobile-dark.png"),
          });
        } finally {
          await context.close();
        }
      },
      {
        discardChildOutput: true,
        onContainerCreated: (id) => {
          containers.push(id);
          console.info(`Team deletion fixture container: ${id}`);
        },
      },
    );
  } finally {
    console.info(
      `Team deletion fixture containers created: ${containers.length ? containers.join(", ") : "none"}`,
    );
  }
});
