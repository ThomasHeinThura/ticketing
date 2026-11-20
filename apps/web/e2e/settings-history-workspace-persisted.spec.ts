import { isDeepStrictEqual } from "node:util";
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

const owner = "Disposable History Owner";
const renamed = "Disposable Renamed Workspace";
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
] as const;

type History = {
  entityType: string;
  entityId: string;
  lastChanged: {
    actor: { kind: string; name: string | null };
    at: string;
  } | null;
  rows: Array<{
    at: string;
    actor: { kind: string; name: string | null };
    action: string;
    changedFields: string[];
  }>;
};

async function history(page: Page, workspaceId: string): Promise<History> {
  const result = await page.evaluate(async (id) => {
    const query = new URLSearchParams({
      entity_type: "workspace",
      entity_id: id,
    });
    const response = await fetch(`/api/audit?${query}`, {
      credentials: "same-origin",
    });
    return {
      status: response.status,
      body: response.ok ? await response.json() : null,
    };
  }, workspaceId);
  expect(result.status, "Synthetic workspace history read failed").toBe(200);
  return result.body as History;
}

async function patchName(page: Page, workspaceId: string, name: string) {
  return page.evaluate(
    async ({ id, value }) => {
      const issuer = await fetch("/api/me/csrf-token", {
        credentials: "same-origin",
      });
      if (!issuer.ok)
        throw new Error("CSRF issuer failed before workspace mutation");
      const { token } = (await issuer.json()) as { token?: string };
      if (!token)
        throw new Error(
          "CSRF issuer returned no token before workspace mutation",
        );
      const response = await fetch(`/api/workspace/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-csrf": token,
        },
        body: JSON.stringify({ name: value }),
      });
      return response.status;
    },
    { id: workspaceId, value: name },
  );
}

test("workspace general history records a persisted name change", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  await withMfaCsrfApp(
    async ({ origin, email, password, setupUrl }) => {
      const context = await browser.newContext({
        viewport: viewports[0],
        locale: "en-US",
        timezoneId: "UTC",
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        await navigateToSetup(page, setupUrl);
        await page.getByLabel("Full name").fill(owner);
        await page.getByLabel("Email").fill(email);
        await page.locator('input[autocomplete="new-password"]').fill(password);
        await page.getByRole("button", { name: "Create account" }).click();
        await enrollFirstAdmin(page, origin, password);
        const workspaceId = await createFirstWorkspace(
          page,
          "Disposable History Workspace",
        );
        const route = new URL(
          "/dashboard/settings/workspace/general",
          origin,
        ).toString();
        await page.goto(route);
        const name = page.getByRole("textbox", { name: "Workspace name" });
        await expect(name).toHaveValue("Disposable History Workspace");
        const before = await history(page, workspaceId);
        const saved = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/workspace/${workspaceId}` &&
            response.request().method() === "PATCH",
        );
        await name.fill(renamed);
        expect((await saved).status()).toBe(200);
        await expect
          .poll(async () => (await history(page, workspaceId)).rows.length)
          .toBe(before.rows.length + 1);
        const recorded = await history(page, workspaceId);
        expect(Object.keys(recorded).sort()).toEqual([
          "entityId",
          "entityType",
          "lastChanged",
          "rows",
        ]);
        expect(recorded.entityType).toBe("workspace");
        expect(recorded.entityId).toBe(workspaceId);
        const row = recorded.rows[0];
        if (!row) throw new Error("Workspace history row missing");
        for (const item of recorded.rows) {
          expect(Object.keys(item).sort()).toEqual([
            "action",
            "actor",
            "at",
            "changedFields",
          ]);
          expect(Object.keys(item.actor).sort()).toEqual(["kind", "name"]);
        }
        expect(Object.keys(row).sort()).toEqual([
          "action",
          "actor",
          "at",
          "changedFields",
        ]);
        expect(Object.keys(row.actor).sort()).toEqual(["kind", "name"]);
        expect(row.action === "workspace.settings_updated").toBe(true);
        expect(row.actor.kind === "person" && row.actor.name === owner).toBe(
          true,
        );
        expect(isDeepStrictEqual(row.changedFields, ["name"])).toBe(true);
        expect(Number.isNaN(Date.parse(row.at))).toBe(false);
        // Deep equality: the API's property order is not part of the contract.
        expect(
          isDeepStrictEqual(recorded.lastChanged, {
            at: row.at,
            actor: row.actor,
          }),
        ).toBe(true);
        expect(Object.keys(recorded.lastChanged ?? {}).sort()).toEqual([
          "actor",
          "at",
        ]);
        expect(await patchName(page, workspaceId, renamed)).toBe(200);
        expect(
          isDeepStrictEqual(await history(page, workspaceId), recorded),
        ).toBe(true);
        expect(await patchName(page, workspaceId, "")).toBe(400);
        expect(
          isDeepStrictEqual(await history(page, workspaceId), recorded),
        ).toBe(true);
        await page.reload();
        await expect(name).toHaveValue(renamed);
        const formattedTime = new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(new Date(row.at));
        for (const theme of ["light", "dark"] as const) {
          for (const viewport of viewports) {
            await page.setViewportSize({
              width: viewport.width,
              height: viewport.height,
            });
            await page.evaluate((value) => {
              const stored = JSON.parse(
                localStorage.getItem("user-preferences") ?? "{}",
              ) as { state?: Record<string, unknown>; version?: number };
              localStorage.setItem(
                "user-preferences",
                JSON.stringify({
                  ...stored,
                  state: { ...(stored.state ?? {}), theme: value },
                  version: stored.version ?? 0,
                }),
              );
            }, theme);
            await page.goto(route);
            await expect(page.locator("html")).toHaveClass(new RegExp(theme));
            await expect(
              page.getByRole("textbox", { name: "Workspace name" }),
            ).toHaveValue(renamed);
            const disclosure = page.getByRole("button", {
              name: "History",
              exact: true,
            });
            const panel = disclosure.locator("../..");
            await expect(
              panel.getByText(`Last changed by ${owner} on ${formattedTime}`, {
                exact: true,
              }),
            ).toBeVisible();
            await disclosure.focus();
            await expect(disclosure).toBeFocused();
            await expect(disclosure).toHaveAttribute("aria-expanded", "false");
            await page.keyboard.press("Space");
            await expect(disclosure).toHaveAttribute("aria-expanded", "true");
            const historyRow = panel.locator(".border-b").first();
            await expect(historyRow).toContainText(owner);
            await expect(historyRow).toContainText(formattedTime);
            await expect(
              historyRow.getByText("Name", { exact: true }),
            ).toBeVisible();
            await expect(disclosure).toBeInViewport();
            await panel.screenshot({
              mask: (await panel.locator(".border-b").all()).slice(1),
              path: testInfo.outputPath(
                `workspace-history-${viewport.name}-${theme}.png`,
              ),
            });
            await page.keyboard.press("Enter");
            await expect(disclosure).toHaveAttribute("aria-expanded", "false");
          }
        }
      } finally {
        await context.close();
      }
    },
    { discardChildOutput: true },
  );
});
