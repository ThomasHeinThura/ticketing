import { expect, test } from "@playwright/test";
import { withMfaCsrfApp } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("CAL-17 imports holidays through the editor and reads them back from PostgreSQL", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(8_000);
  await withMfaCsrfApp(async ({ origin, email, password }) => {
    await page.goto(new URL("/auth/sign-up", origin).toString());
    await page.getByLabel("Full name").fill("Disposable Calendar Admin");
    await page.getByLabel("Email").fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
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
    await expect(
      page.getByText("Must not partially import", { exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Import holidays" }),
    ).not.toBeVisible();
    const afterRejectedImport = await page.request.get(
      new URL(`/api/service-calendars/${calendarId}`, origin).toString(),
      { headers: { Origin: origin } },
    );
    expect(afterRejectedImport.status()).toBe(200);
    expect(await afterRejectedImport.json()).toMatchObject({
      version: 2,
      holidays: [{ date: "2026-12-25", name: "Browser proof holiday" }],
    });

    const screenshot = testInfo.outputPath("calendar-import-persisted.png");
    await page.screenshot({ path: screenshot, fullPage: true });
  });
});
