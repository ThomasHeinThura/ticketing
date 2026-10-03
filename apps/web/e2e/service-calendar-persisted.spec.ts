import { chmod, mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { withMfaCsrfApp } from "./helpers/mfa-csrf-app-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("CAL-17 imports holidays through the editor and reads them back from PostgreSQL", async ({
  page,
}) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(8_000);
  await withMfaCsrfApp(async ({ origin, email, password }) => {
    const signup = await page.request.post(
      new URL("/api/auth/sign-up/email", origin).toString(),
      {
        headers: { Origin: origin },
        data: { name: "Disposable Calendar Admin", email, password },
      },
    );
    expect(signup.status()).toBe(200);
    await page.goto(new URL("/onboarding", origin).toString());
    await page
      .getByLabel("Workspace name")
      .fill("Disposable Calendar Workspace");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/dashboard\/workspace\//);

    await page.goto(
      new URL("/agent/settings/calendars/new", origin).toString(),
    );
    await page.getByLabel("Name").fill("Persisted holiday calendar");
    await page.getByLabel("IANA timezone").fill("UTC");
    await page.getByRole("button", { name: "Create calendar" }).click();
    await expect(page).toHaveURL(/\/agent\/settings\/calendars\/[a-z0-9]+/);
    await expect(
      page.getByRole("heading", { name: "Persisted holiday calendar" }),
    ).toBeVisible();

    const input = page.locator(
      'input[type="file"][accept=".ics,text/calendar"]',
    );
    await input.setInputFiles({
      name: "holidays.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(
        [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//TaskDesk//Browser proof//EN",
          "BEGIN:VEVENT",
          "UID:browser-proof-2026",
          "DTSTAMP:20261003T120000Z",
          "DTSTART;VALUE=DATE:20261225",
          "SUMMARY:Browser proof holiday",
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
        "utf8",
      ),
    });
    await expect(
      page.getByText("Browser proof holiday", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Import holidays" }).click();
    await expect(
      page.getByRole("status").getByText(/Added 1 holidays/),
    ).toBeVisible();

    const detailPath = new URL(page.url()).pathname;
    const calendarId = detailPath.split("/").at(-1);
    expect(calendarId).toBeTruthy();
    const persisted = await page.request.get(
      new URL(`/api/service-calendars/${calendarId}`, origin).toString(),
      {
        headers: { Origin: origin },
      },
    );
    expect(persisted.status()).toBe(200);
    const calendar = (await persisted.json()) as {
      holidays: Array<{ date: string; name?: string }>;
      version: number;
    };
    expect(calendar.holidays).toContainEqual({
      date: "2026-12-25",
      name: "Browser proof holiday",
    });
    expect(calendar.version).toBe(2);

    await input.setInputFiles({
      name: "partially-invalid.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(
        [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//TaskDesk//Browser proof//EN",
          "BEGIN:VEVENT",
          "UID:valid-before-invalid",
          "DTSTAMP:20261003T120000Z",
          "DTSTART;VALUE=DATE:20261226",
          "SUMMARY:Must not partially import",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:unsupported-recurrence",
          "DTSTAMP:20261003T120000Z",
          "DTSTART;VALUE=DATE:20261227",
          "RRULE:FREQ=YEARLY",
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
        "utf8",
      ),
    });
    await expect(
      page.getByText("Must not partially import", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Import holidays" }).click();
    await expect(
      page
        .getByRole("region", { name: "Import holidays from an iCalendar file" })
        .getByRole("alert"),
    ).toContainText(/RRULE/);
    const afterRejectedImport = await page.request.get(
      new URL(`/api/service-calendars/${calendarId}`, origin).toString(),
      { headers: { Origin: origin } },
    );
    expect(afterRejectedImport.status()).toBe(200);
    expect(await afterRejectedImport.json()).toMatchObject({
      version: 2,
      holidays: [{ date: "2026-12-25", name: "Browser proof holiday" }],
    });

    const evidenceDir =
      "/Users/heinthura/.codex/taskdesk-evidence/2026-10-03/p2-holiday-import";
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    await chmod(evidenceDir, 0o700);
    const screenshot = `${evidenceDir}/calendar-import-persisted.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    await chmod(screenshot, 0o600);
  });
});
