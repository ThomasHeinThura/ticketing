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

// Real endpoints and persistence only: the guarded fresh withMfaCsrfApp fixture owns a
// disposable `mfa_csrf_<uuid>_test` database and removes only its own containers.
test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const owner = "Disposable History Owner";
const firstName = "Synthetic Snippet Alpha";
const renamed = "Synthetic Snippet Beta";
const secondName = "Synthetic Snippet Gamma";
const bodyOne = "Synthetic body marker one";
const bodyTwo = "Synthetic body marker two";
const path = "/dashboard/settings/workspace/canned-responses";
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
] as const;

type Row = {
  at: string;
  actor: { kind: string; name: string | null };
  action: string;
  changedFields: string[];
};
type History = {
  entityType: string;
  entityId: string;
  lastChanged: { actor: Row["actor"]; at: string } | null;
  rows: Row[];
};

async function readHistory(page: Page, id: string) {
  return page.evaluate(async (entityId) => {
    const query = new URLSearchParams({
      entity_type: "canned_response",
      entity_id: entityId,
    });
    const response = await fetch(`/api/audit?${query}`, {
      credentials: "same-origin",
    });
    return {
      status: response.status,
      body: response.ok ? ((await response.json()) as unknown) : null,
    };
  }, id);
}

async function history(page: Page, id: string): Promise<History> {
  const result = await readHistory(page, id);
  expect(result.status, "Synthetic snippet history read failed").toBe(200);
  return result.body as History;
}

/** Explicit CSRF issuer 200 first; a failed issuer throws, so a later 403 is never a CSRF denial. */
async function mutate(
  page: Page,
  method: "POST" | "PATCH",
  url: string,
  body: unknown,
) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const issuer = await fetch("/api/me/csrf-token", {
        credentials: "same-origin",
      });
      if (issuer.status !== 200)
        throw new Error("CSRF issuer failed before snippet mutation");
      const { token } = (await issuer.json()) as { token?: string };
      if (!token)
        throw new Error("CSRF issuer returned no token before mutation");
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-csrf": token,
        },
        body: JSON.stringify(body),
      });
      return { status: response.status };
    },
    { method, url, body },
  );
}

// Key order is irrelevant and a failure prints no object values.
const sameHistory = (a: History, b: History) => isDeepStrictEqual(a, b);

test("canned response history records persisted snippet changes", async ({
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
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
          "Disposable Snippet History Workspace",
        );
        const route = new URL(path, origin).toString();
        await page.goto(route);
        const dialog = page.locator('[data-slot="dialog-popup"]');

        // 1. Persisted UI create.
        await page.getByRole("button", { name: "New response" }).click();
        await dialog.getByLabel("Name", { exact: true }).fill(firstName);
        await dialog
          .locator(".ProseMirror[contenteditable=true]")
          .fill(bodyOne);
        const created = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/canned-responses" &&
            response.request().method() === "POST",
        );
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        const createdResponse = await created;
        expect(createdResponse.status()).toBe(200);
        const snippetId = ((await createdResponse.json()) as { id: string }).id;
        expect(snippetId).toBeTruthy();
        await expect(dialog).toBeHidden();

        const afterCreate = await history(page, snippetId);
        expect(Object.keys(afterCreate).sort()).toEqual([
          "entityId",
          "entityType",
          "lastChanged",
          "rows",
        ]);
        expect(afterCreate.entityType).toBe("canned_response");
        expect(afterCreate.entityId).toBe(snippetId);
        expect(afterCreate.rows).toHaveLength(1);
        const createdRow = afterCreate.rows[0];
        if (!createdRow) throw new Error("Snippet created row missing");
        expect(Object.keys(createdRow).sort()).toEqual([
          "action",
          "actor",
          "at",
          "changedFields",
        ]);
        expect(createdRow.action).toBe("canned_response.created");
        expect(createdRow.changedFields).toEqual([
          "name",
          "body",
          "visibilityDefault",
        ]);
        expect(createdRow.actor).toEqual({ kind: "person", name: owner });
        expect(Number.isNaN(Date.parse(createdRow.at))).toBe(false);
        // Closed projection: no values, content or ids inside any row.
        const rowsText = JSON.stringify(afterCreate.rows);
        for (const leaked of [firstName, bodyOne, snippetId])
          expect(rowsText.includes(leaked)).toBe(false);

        // 2. Persisted UI update of the name only records only the name marker.
        await page
          .getByRole("button", { name: `Edit ${firstName}`, exact: true })
          .click();
        await expect(dialog.locator(".ProseMirror")).toContainText(bodyOne);
        await dialog.getByLabel("Name", { exact: true }).fill(renamed);
        const updated = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/canned-responses/${snippetId}` &&
            response.request().method() === "PATCH",
        );
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        expect((await updated).status()).toBe(200);
        await expect(dialog).toBeHidden();
        const afterUpdate = await history(page, snippetId);
        expect(afterUpdate.rows).toHaveLength(2);
        expect(afterUpdate.rows[0]?.action).toBe("canned_response.updated");
        expect(afterUpdate.rows[0]?.changedFields).toEqual(["name"]);
        expect(afterUpdate.rows[1]).toEqual(createdRow);

        // 3. Persisted UI update of the body, then an API update of the default visibility.
        await page
          .getByRole("button", { name: `Edit ${renamed}`, exact: true })
          .click();
        await dialog
          .locator(".ProseMirror[contenteditable=true]")
          .fill(bodyTwo);
        const bodyUpdated = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/canned-responses/${snippetId}` &&
            response.request().method() === "PATCH",
        );
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        expect((await bodyUpdated).status()).toBe(200);
        await expect(dialog).toBeHidden();
        const afterBody = await history(page, snippetId);
        expect(afterBody.rows).toHaveLength(3);
        expect(afterBody.rows[0]?.changedFields).toEqual(["body"]);
        expect(
          (
            await mutate(page, "PATCH", `/api/canned-responses/${snippetId}`, {
              visibilityDefault: "public",
            })
          ).status,
        ).toBe(200);
        const recorded = await history(page, snippetId);
        expect(recorded.rows).toHaveLength(4);
        expect(recorded.rows[0]?.action).toBe("canned_response.updated");
        expect(recorded.rows[0]?.changedFields).toEqual(["visibilityDefault"]);
        for (const row of recorded.rows) {
          expect(Object.keys(row.actor).sort()).toEqual(["kind", "name"]);
          expect(["name", "body", "visibilityDefault"]).toEqual(
            expect.arrayContaining(row.changedFields),
          );
        }
        const newest = recorded.rows[0];
        if (!newest) throw new Error("Snippet newest row missing");
        expect(recorded.lastChanged).toEqual({
          at: newest.at,
          actor: newest.actor,
        });

        // 4. No-op and invalid saves leave history untouched.
        const patchUrl = `/api/canned-responses/${snippetId}`;
        expect(
          (await mutate(page, "PATCH", patchUrl, { name: renamed })).status,
        ).toBe(200);
        expect(sameHistory(await history(page, snippetId), recorded)).toBe(
          true,
        );
        for (const invalid of [{ name: "" }, {}, { visibilityDefault: "x" }]) {
          expect((await mutate(page, "PATCH", patchUrl, invalid)).status).toBe(
            400,
          );
        }
        const second = await mutate(page, "POST", "/api/canned-responses", {
          workspaceId,
          name: secondName,
          body: { type: "doc", content: [{ type: "paragraph" }] },
        });
        expect(second.status).toBe(200);
        expect(
          (await mutate(page, "PATCH", patchUrl, { name: secondName })).status,
        ).toBe(409);
        expect(sameHistory(await history(page, snippetId), recorded)).toBe(
          true,
        );
        // An unknown snippet id is refused rather than shown as empty history.
        expect(
          (await readHistory(page, "00000000-0000-4000-8000-000000000000"))
            .status,
        ).toBe(404);

        // 5. Requesting deletion is not execution: no deleted row, the snippet stays.
        await page.goto(route);
        const requested = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === patchUrl &&
            response.request().method() === "DELETE",
        );
        await page
          .getByRole("button", { name: `Delete ${renamed}`, exact: true })
          .click();
        expect((await requested).status()).toBe(202);
        const approval = page
          .getByRole("dialog")
          .filter({ hasText: "Delete canned response" });
        await expect(approval).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(approval).toBeHidden();
        await expect(
          page.getByRole("button", { name: `Edit ${renamed}`, exact: true }),
        ).toBeVisible();
        const afterRequest = await history(page, snippetId);
        expect(sameHistory(afterRequest, recorded)).toBe(true);
        expect(
          afterRequest.rows.some((row) => row.action.endsWith("deleted")),
        ).toBe(false);

        // 6. Reload keeps the persisted values and History.
        await page.reload();
        await page
          .getByRole("button", { name: `Edit ${renamed}`, exact: true })
          .click();
        await expect(dialog.locator(".ProseMirror")).toContainText(bodyTwo);
        await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
          renamed,
        );
        expect(sameHistory(await history(page, snippetId), recorded)).toBe(
          true,
        );

        // 7. Keyboard, focus, themes and widths against bounded, masked History.
        const formattedTime = new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(new Date(newest.at));
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
            await page
              .getByRole("button", { name: `Edit ${renamed}`, exact: true })
              .click();
            const disclosure = dialog.getByRole("button", {
              name: "History",
              exact: true,
            });
            const panel = disclosure.locator("../..");
            await expect(
              panel.getByText(`Last changed by ${owner} on ${formattedTime}`, {
                exact: true,
              }),
            ).toBeVisible();
            await disclosure.scrollIntoViewIfNeeded();
            await disclosure.focus();
            await expect(disclosure).toBeFocused();
            await expect(disclosure).toHaveAttribute("aria-expanded", "false");
            await page.keyboard.press("Space");
            await expect(disclosure).toHaveAttribute("aria-expanded", "true");
            const rows = panel.locator(".border-b");
            await expect(rows).toHaveCount(4);
            await expect(rows.first()).toContainText(owner);
            await expect(rows.first()).toContainText(formattedTime);
            await expect(rows.first()).toContainText("Canned response updated");
            await expect(rows.first()).toContainText("Default visibility");
            await expect(rows.last()).toContainText("Canned response created");
            await expect(rows.last()).toContainText(
              "Name, Response body, Default visibility",
            );
            await expect(panel).not.toContainText(bodyOne);
            await expect(panel).not.toContainText(bodyTwo);
            await expect(panel).not.toContainText(snippetId);
            await panel.screenshot({
              mask: (await rows.all()).slice(1),
              path: testInfo.outputPath(
                `canned-response-history-${viewport.name}-${theme}.png`,
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
