import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { withApprovalRuntime } from "../../../tests/e2e/helpers/approval-runtime";
import type { MfaCsrfAppFixture } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import type { PortalCanonicalPreference } from "../src/fetchers/notification-preferences/portal-canonical-preference";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

// Disposable candidate browser evidence; the fixture never targets Local SIT.
test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});
const events = [
  "work_item.mentioned",
  "work_item.commented",
  "work_item.transitioned",
  "submission.replied",
  "submission.declined",
  "submission.accepted",
  "approval.requested",
  "approval.expiring",
  "approval.withdrawn",
] as const;
const root = fileURLToPath(new URL("../../..", import.meta.url));
const canonicalPath = "/api/portal/notification-preferences/canonical";
const quietPath = `${canonicalPath}/quiet-hours`;

async function handoffTokens(
  fixture: MfaCsrfAppFixture,
  customerUserId: string,
) {
  const output = resolve(fixture.fixtureDir, "portal-preference-links.json");
  const scriptPath = resolve(fixture.fixtureDir, "portal-preference-links.mts");
  const script = `
    import { createRequire } from 'node:module';
    import { writeFile } from 'node:fs/promises';
    import { signNotificationPreferenceLink } from ${JSON.stringify(resolve(root, "apps/api/src/notification/preference-link.ts"))};
    async function main() {
    const requireApi = createRequire(${JSON.stringify(resolve(root, "apps/api/package.json"))});
    const { Client } = requireApi('pg');
    const url = new URL(process.env.TASKDESK_DATABASE_URL);
    if (!/^\\/mfa_csrf_[a-f0-9]{32}_test$/.test(url.pathname) || !['localhost','127.0.0.1'].includes(url.hostname) || url.port === '62870')
      throw new Error('Preference signer requires its disposable fixture');
    const client = new Client({connectionString: url.toString()});
    await client.connect();
    try {
      const result = await client.query('SELECT id FROM person WHERE user_id = $1 AND side = $2', [${JSON.stringify(customerUserId)}, 'customer']);
      if (result.rows.length !== 1) throw new Error('Customer signer identity missing');
      const tokens = Object.fromEntries(${JSON.stringify(events)}.map(eventKind => [eventKind, signNotificationPreferenceLink({
        audience: 'customer', recipientPersonId: result.rows[0].id,
        selector: {eventKind,channel:'notify.email',scope:'global',scopeId:null}
      })]));
      await writeFile(${JSON.stringify(output)}, JSON.stringify(tokens), {mode:0o600});
    } finally { await client.end(); }
    }
    await main().catch(() => { process.exitCode = 1; });
  `;
  try {
    // Match the fixture's file-based seeders; tsx's eval parser mishandles a preceding tsconfig.
    await writeFile(scriptPath, script, { mode: 0o600 });
    const child = await fixture.spawnChild(
      process.execPath,
      [
        resolve(root, "apps/api/node_modules/tsx/dist/cli.mjs"),
        "--tsconfig",
        resolve(root, "apps/api/tsconfig.tests.json"),
        scriptPath,
      ],
      "portal-preference-links",
    );
    await new Promise<void>((done, reject) =>
      child.once("close", (code) =>
        code === 0
          ? done()
          : reject(new Error("Private preference signing failed")),
      ),
    );
    return JSON.parse(await readFile(output, "utf8")) as Record<
      (typeof events)[number],
      string
    >;
  } finally {
    await Promise.allSettled([
      rm(output, { force: true }),
      rm(scriptPath, { force: true }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    });
  }
}

async function chooseTime(page: Page, label: "From" | "Until", value: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  for (const [name, part] of [
    ["Hour", value.slice(0, 2)],
    ["Minute", value.slice(3)],
  ]) {
    await page.getByRole("combobox", { name, exact: true }).click();
    await page.getByRole("option", { name: part, exact: true }).click();
  }
  await page
    .getByRole("dialog", { name: label, exact: true })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toContainText(value);
}

test("customer persists all nine email preferences and quiet hours, retries failures and follows signed event selectors", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  await withApprovalRuntime(async (app, fixture) => {
    const journal = await readFile(
      resolve(app.fixtureDir, "container-ownership.jsonl"),
      "utf8",
    );
    for (const line of journal.trim().split("\n")) {
      const entry = JSON.parse(line) as { id?: string };
      if (entry.id && /^[0-9a-f]{64}$/.test(entry.id))
        console.info(`Portal preference fixture container: ${entry.id}`);
    }
    const tokens = await handoffTokens(app, fixture.tenant.customer.id);
    for (const name of [
      "portal-preference-links.json",
      "portal-preference-links.mts",
    ]) {
      await expect(lstat(resolve(app.fixtureDir, name))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    const context = await browser.newContext({
      storageState: fixture.storageStates.customer,
      viewport: { width: 1440, height: 1000 },
      locale: "en-GB",
      timezoneId: "UTC",
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      const origin = new URL(fixture.portalOrigin).origin;
      expect(new URL(origin).hostname).toBe("portal.localhost");
      const account = new URL("/account", origin).toString();
      const get = async <T>(path: string): Promise<T> => {
        const response = await context.request.get(
          new URL(path, origin).toString(),
        );
        expect(response.status()).toBe(200);
        return response.json() as Promise<T>;
      };
      const put = async (path: string, data: unknown) => {
        const csrfResponse = await context.request.get(
          new URL("/api/portal/csrf-token", origin).toString(),
          { headers: { Origin: origin } },
        );
        expect(csrfResponse.status()).toBe(200);
        const { token } = (await csrfResponse.json()) as { token: string };
        return context.request.put(new URL(path, origin).toString(), {
          data,
          headers: { Origin: origin, "x-taskdesk-csrf": token },
        });
      };
      await page.goto(account);
      await expect(page.locator("[data-event-kind]")).toHaveCount(9);
      await expect(
        page.getByText("In-app notifications stay on.", { exact: false }),
      ).toBeVisible();
      for (const urgent of ["work_item.mentioned", "approval.expiring"]) {
        await expect(
          page.locator(`[data-event-kind="${urgent}"]`).getByRole("combobox"),
        ).toHaveCount(0);
      }
      const accepted = page.locator('[data-event-kind="submission.accepted"]');
      await expect(accepted.getByRole("switch")).not.toBeChecked();
      await accepted.getByRole("switch").click();
      await accepted.getByRole("combobox").click();
      await page
        .getByRole("option", { name: "Daily digest", exact: true })
        .click();
      let refused = false;
      await page.route(`**${canonicalPath}`, (route) => {
        if (route.request().method() === "PUT" && !refused) {
          refused = true;
          return route.abort("failed");
        }
        return route.continue();
      });
      await accepted
        .getByRole("button", { name: "Save preferences", exact: true })
        .click();
      await expect(accepted.getByRole("alert")).toHaveText(
        "Unable to save preferences. Try again.",
      );
      expect(
        (await get<PortalCanonicalPreference[]>(canonicalPath)).find(
          (row) => row.eventKind === "submission.accepted",
        )?.enabled,
      ).toBe(false);
      await expect(accepted.getByRole("switch")).toBeChecked();
      const saved = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === canonicalPath &&
          response.request().method() === "PUT",
      );
      await accepted
        .getByRole("button", { name: "Save preferences", exact: true })
        .click();
      expect((await saved).status()).toBe(200);
      await page.reload();
      await expect(accepted.getByRole("switch")).toBeChecked();
      await expect(accepted.getByRole("combobox")).toContainText(
        "Daily digest",
      );
      expect(
        (await get<PortalCanonicalPreference[]>(canonicalPath)).find(
          (row) => row.eventKind === "submission.accepted",
        ),
      ).toMatchObject({
        enabled: true,
        digest: "daily",
        scope: "global",
        scopeId: null,
        channel: "notify.email",
      });

      const expected = await get<PortalCanonicalPreference[]>(canonicalPath);
      for (const eventKind of events.filter(
        (kind) => kind !== "submission.accepted",
      )) {
        const row = expected.find((value) => value.eventKind === eventKind);
        if (!row) throw new Error("Expected event preference missing");
        const eventCard = page.locator(`[data-event-kind="${eventKind}"]`);
        await eventCard.getByRole("switch").click();
        row.enabled = !row.enabled;
        const savedEvent = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === canonicalPath &&
            response.request().method() === "PUT",
        );
        await eventCard
          .getByRole("button", { name: "Save preferences", exact: true })
          .click();
        expect((await savedEvent).status()).toBe(200);
        row.source = "global";
      }
      await page.reload();
      for (const row of expected) {
        const control = page
          .locator(`[data-event-kind="${row.eventKind}"]`)
          .getByRole("switch");
        if (row.enabled) await expect(control).toBeChecked();
        else await expect(control).not.toBeChecked();
      }
      expect(await get(canonicalPath)).toEqual(expected);

      for (const invalid of [
        {
          eventKind: "sla.breached",
          channel: "notify.email",
          scope: "global",
          scopeId: null,
          enabled: false,
          digest: "off",
        },
        {
          eventKind: "submission.accepted",
          channel: "notify.in_app",
          scope: "global",
          scopeId: null,
          enabled: false,
          digest: "off",
        },
        ...["work_item.mentioned", "approval.expiring"].map((eventKind) => ({
          eventKind,
          channel: "notify.email",
          scope: "global",
          scopeId: null,
          enabled: true,
          digest: "daily",
        })),
      ])
        expect((await put(canonicalPath, invalid)).status()).toBe(400);
      expect(await get(canonicalPath)).toEqual(expected);

      await chooseTime(page, "From", "21:30");
      await chooseTime(page, "Until", "06:15");
      const quietSaved = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === quietPath &&
          response.request().method() === "PUT",
      );
      await page
        .getByRole("button", { name: "Save quiet hours", exact: true })
        .click();
      expect((await quietSaved).status()).toBe(200);
      await page.reload();
      await expect(
        page.getByRole("button", { name: "From", exact: true }),
      ).toContainText("21:30");
      await expect(
        page.getByRole("button", { name: "Until", exact: true }),
      ).toContainText("06:15");
      expect(await get(quietPath)).toEqual({
        start: "21:30",
        end: "06:15",
        timezone: "UTC",
      });
      expect(
        (
          await put(quietPath, {
            quietHours: { start: "22:00", end: "22:00", timezone: "UTC" },
          })
        ).status(),
      ).toBe(400);
      expect(await get(quietPath)).toEqual({
        start: "21:30",
        end: "06:15",
        timezone: "UTC",
      });
      const cleared = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === quietPath &&
          response.request().method() === "PUT",
      );
      await page
        .getByRole("button", { name: "Turn off quiet hours", exact: true })
        .click();
      expect((await cleared).status()).toBe(200);
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Turn off quiet hours", exact: true }),
      ).toHaveCount(0);
      expect(await get(quietPath)).toBeNull();

      const before = await get<PortalCanonicalPreference[]>(canonicalPath);
      for (const eventKind of events) {
        const exchange = await page.evaluate(async (token) => {
          const csrf = await fetch("/api/portal/csrf-token", {
            credentials: "same-origin",
          });
          if (!csrf.ok) return csrf.status;
          const { token: csrfToken } = (await csrf.json()) as { token: string };
          return (
            await fetch("/api/public/portal/notification-preference-handoffs", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "content-type": "application/json",
                "x-taskdesk-csrf": csrfToken,
              },
              body: JSON.stringify({ token }),
            })
          ).status;
        }, tokens[eventKind]);
        expect(exchange).toBe(202);
        await page.goto(account);
        await expect(
          page.locator(`[data-event-kind="${eventKind}"]`),
        ).toBeFocused();
        expect(await get(canonicalPath)).toEqual(before);
        expect(new URL(page.url()).hash).toBe("");
      }
      for (const theme of ["light", "dark"] as const) {
        // Use the product's persisted preference; checking the class proves the actual theme.
        await page.evaluate((value) => {
          const stored = JSON.parse(
            localStorage.getItem("user-preferences") ?? "{}",
          );
          localStorage.setItem(
            "user-preferences",
            JSON.stringify({
              ...stored,
              state: { ...(stored.state ?? {}), theme: value },
              version: stored.version ?? 0,
            }),
          );
        }, theme);
        for (const viewport of [
          { name: "desktop", width: 1440, height: 1000 },
          { name: "tablet", width: 768, height: 1024 },
          { name: "mobile", width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport);
          await page.goto(account);
          await expect(page.locator("html")).toHaveClass(
            new RegExp(`\\b${theme}\\b`),
          );
          await expect(page.locator("[data-event-kind]")).toHaveCount(9);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - window.innerWidth,
            ),
          ).toBeLessThanOrEqual(0);
          await page
            .getByRole("heading", {
              name: "Notification preferences",
              exact: true,
            })
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: testInfo.outputPath(
              `portal-preferences-${viewport.name}-${theme}.png`,
            ),
          });
          await page
            .getByRole("button", { name: "Save quiet hours", exact: true })
            .scrollIntoViewIfNeeded();
          await expect(
            page.getByRole("button", { name: "Save quiet hours", exact: true }),
          ).toBeInViewport();
          await page.screenshot({
            path: testInfo.outputPath(
              `portal-preferences-quiet-${viewport.name}-${theme}.png`,
            ),
          });
        }
      }

      const staff = await browser.newContext({
        storageState: fixture.storageStates.requester,
      });
      try {
        const staffOrigin = new URL(fixture.origin).origin;
        expect(
          (
            await staff.request.get(
              new URL("/api/me/identity", staffOrigin).toString(),
            )
          ).status(),
        ).toBe(200);
        // Send the existing real staff session to the actual portal host; the side boundary must refuse it.
        const cookie = fixture.storageStates.requester.cookies
          .map((value) => `${value.name}=${value.value}`)
          .join("; ");
        for (const path of [canonicalPath, quietPath]) {
          expect(
            (
              await staff.request.get(new URL(path, staffOrigin).toString())
            ).status(),
          ).toBe(404);
          expect(
            (
              await staff.request.get(new URL(path, origin).toString(), {
                headers: { Cookie: cookie },
              })
            ).status(),
          ).toBe(401);
          expect(
            (
              await staff.request.put(new URL(path, origin).toString(), {
                headers: { Cookie: cookie, Origin: origin },
                data:
                  path === quietPath
                    ? { quietHours: null }
                    : {
                        eventKind: "submission.accepted",
                        channel: "notify.email",
                        scope: "global",
                        scopeId: null,
                        enabled: false,
                        digest: "off",
                      },
              })
            ).status(),
          ).toBe(401);
        }
      } finally {
        await staff.close();
      }
      expect(await get(canonicalPath)).toEqual(before);
    } finally {
      await context.close();
    }
  });
});
