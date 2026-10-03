import { chmod, mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { withMfaCsrfApp } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("SLA policy publishes and reloads its persisted eight-goal snapshot", async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await withMfaCsrfApp(async ({ origin, email, password }) => {
    await page.goto(new URL("/auth/sign-up", origin).toString());
    await page.getByLabel("Full name").fill("Disposable SLA Admin");
    await page.getByLabel("Email").fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
    await page.getByLabel("Workspace name").fill("Persisted SLA Workspace");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/dashboard\/workspace\//);
    const workspaceId = new URL(page.url()).pathname
      .split("/")
      .filter(Boolean)
      .at(-1);
    expect(workspaceId).toBeTruthy();

    const csrf = await page.request.get(
      new URL("/api/me/csrf-token", origin).toString(),
      { headers: { Origin: origin } },
    );
    expect(csrf.status()).toBe(200);
    const csrfBody = (await csrf.json()) as { token: string };
    const calendarResponse = await page.request.post(
      new URL("/api/service-calendars", origin).toString(),
      {
        headers: {
          Origin: origin,
          "X-TaskDesk-CSRF": csrfBody.token,
        },
        data: {
          workspaceId,
          name: "Persisted SLA coverage",
          timezone: "UTC",
          windows: { mon: [{ from: 540, to: 1020 }] },
          holidays: [],
        },
      },
    );
    expect(calendarResponse.status()).toBe(200);
    const calendar = (await calendarResponse.json()) as { id: string };

    const typesResponse = await page.request.get(
      new URL(
        `/api/workspace/${workspaceId}/work-item-types`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    expect(typesResponse.status()).toBe(200);
    const types = (await typesResponse.json()) as Array<{
      id: string;
      name: string;
    }>;
    expect(types.length).toBeGreaterThan(0);
    const workItemType = types[0];
    if (!workItemType)
      throw new Error("No seeded work item type was returned.");

    await page.goto(
      new URL("/agent/settings/sla-policies/new", origin).toString(),
    );
    await expect(
      page.getByRole("heading", { name: "New SLA policy" }),
    ).toBeVisible();
    await page.getByLabel("Policy name").fill("Persisted response goals");
    await page.getByRole("combobox", { name: "Service calendar" }).click();
    await page
      .getByRole("option", { name: "Persisted SLA coverage · UTC" })
      .click();
    await page.getByRole("checkbox", { name: workItemType.name }).click();

    const metrics = ["first_response", "resolution"] as const;
    const priorities = ["low", "medium", "high", "urgent"] as const;
    for (const metric of metrics) {
      for (const priority of priorities) {
        await page
          .locator(`#sla-goal-${workItemType.id}-${metric}-${priority}`)
          .fill("240");
      }
    }
    await page.getByLabel("At-risk threshold (%)").fill("80");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/agent\/settings\/sla-policies\/[a-z0-9]+$/);
    await expect(
      page.getByRole("button", { name: "Publish version" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Publish version" }).click();
    await expect(page.getByText("Active version 1")).toBeVisible();

    const policyId = new URL(page.url()).pathname.split("/").at(-1);
    expect(policyId).toBeTruthy();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Persisted response goals" }),
    ).toBeVisible();
    await expect(page.getByText("Active version 1")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish version" }),
    ).not.toBeVisible();

    const persisted = await page.request.get(
      new URL(`/api/sla-policies/${policyId}`, origin).toString(),
      { headers: { Origin: origin } },
    );
    expect(persisted.status()).toBe(200);
    const persistedPolicy = (await persisted.json()) as {
      id: string;
      activeVersion: {
        number: number;
        calendarId: string;
        atRiskThresholdPct: number;
        goals: Array<Record<string, unknown>>;
      };
      draftVersion: unknown;
    };
    expect(persistedPolicy).toMatchObject({
      id: policyId,
      activeVersion: {
        number: 1,
        calendarId: calendar.id,
        atRiskThresholdPct: 80,
        goals: expect.arrayContaining(
          metrics.flatMap((metric) =>
            priorities.map((priority) =>
              expect.objectContaining({
                metric,
                priority,
                workItemTypeId: workItemType.id,
                targetMinutes: 240,
              }),
            ),
          ),
        ),
      },
      draftVersion: null,
    });
    expect(persistedPolicy.activeVersion.goals).toHaveLength(8);

    const evidenceDir =
      "/Users/heinthura/.codex/taskdesk-evidence/2026-10-03/p2-domain-integration";
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    await chmod(evidenceDir, 0o700);
    const screenshot = `${evidenceDir}/sla-policy-published-persisted.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    await chmod(screenshot, 0o600);
  });
});
