import { expect, type Page, test } from "@playwright/test";
import { fillSensitive } from "../../../tests/e2e/helpers/fill-sensitive";
import {
  navigateToSetup,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "../../../tests/e2e/helpers/project-key";
import {
  createFirstWorkspace,
  enrollFirstAdmin,
} from "./helpers/enroll-first-admin";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

type Item = { id: string; key: string; title: string };
type Detail = Item & {
  customFields: Array<{ key: string; value: unknown }>;
};
type ItemList = { data: Item[]; meta: { total: number } };
type CreateObservation = {
  templateId: string | null;
  customFields: Record<string, unknown>;
};

async function observedCreate(page: Page): Promise<CreateObservation> {
  const observed = await page.evaluate(
    () =>
      (
        window as typeof window & {
          templateCreateObservation?: CreateObservation | null;
        }
      ).templateCreateObservation,
  );
  expect(observed, "Synthetic create payload was observed").toBeTruthy();
  if (!observed) throw new Error("Create payload observation unavailable");
  return observed;
}

async function requestJson<T>(
  page: Page,
  path: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const result = await page.evaluate(
    async ({ path: url, data: body }) => {
      const issuer = await fetch("/api/me/csrf-token", {
        credentials: "same-origin",
      });
      if (!issuer.ok) return { status: issuer.status, body: null };
      const { token } = (await issuer.json()) as { token: string };
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-csrf": token,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, data },
  );
  expect(result.status, `Unexpected HTTP status for ${path}`).toBe(200);
  return result.body as T;
}

test("template custom fields persist from the real create dialog, allow overrides and refuse a cleared required value", async ({
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
          colorScheme: "light",
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          await navigateToSetup(page, setupUrl);
          await page.getByLabel("Full name").fill("Template Journey Admin");
          await page.getByLabel("Email").fill(email);
          await fillSensitive(
            page.locator('input[autocomplete="new-password"]'),
            password,
          );
          await page.getByRole("button", { name: "Create account" }).click();
          await enrollFirstAdmin(page, origin, password);
          const workspaceId = await createFirstWorkspace(
            page,
            "Template Journey Workspace",
          );
          const slug = uniqueProjectKey(8);
          const project = await requestJson<{ id: string }>(
            page,
            "/api/project",
            {
              name: "Template Journey",
              icon: "Folder",
              slug,
              workspaceId,
            },
          );
          const types = await requestJson<Array<{ id: string; key: string }>>(
            page,
            `/api/workspace/${encodeURIComponent(workspaceId)}/work-item-types`,
          );
          const type = types.find((entry) => entry.key === "task");
          if (!type) throw new Error("Task type missing");
          const section = await requestJson<{ id: string }>(
            page,
            "/api/custom-field-sections",
            { workspaceId, name: "Template defaults" },
          );
          const fieldKey = "template_reference";
          const fieldName = "Template reference";
          await requestJson(page, "/api/custom-fields", {
            workspaceId,
            sectionId: section.id,
            key: fieldKey,
            name: fieldName,
            format: "text",
            visibility: [
              { workItemTypeId: type.id, visible: true, required: true },
            ],
          });
          const template = await requestJson<{ id: string }>(
            page,
            `/api/workspace/${encodeURIComponent(workspaceId)}/work-item-templates`,
            {
              name: "Required reference template",
              typeId: type.id,
              title: "Template task",
              customFieldValues: { [fieldKey]: "Stored template reference" },
            },
          );
          const createPath = `/api/projects/${encodeURIComponent(project.id)}/work-items`;
          // Chromium may omit a streamed Request body from Playwright's protocol events.
          // Observe only synthetic create fields, then pass the original fetch through.
          await page.addInitScript(
            ({ path, keys }) => {
              const nativeFetch = window.fetch.bind(window);
              const observedWindow = window as typeof window & {
                templateCreateObservation?: CreateObservation | null;
              };
              window.fetch = async (input, init) => {
                const url = new URL(
                  input instanceof Request ? input.url : String(input),
                  window.location.href,
                );
                const method =
                  init?.method ??
                  (input instanceof Request ? input.method : "GET");
                if (
                  url.origin === window.location.origin &&
                  url.pathname === path &&
                  method.toUpperCase() === "POST"
                ) {
                  try {
                    const request =
                      input instanceof Request
                        ? input.clone()
                        : new Request(input, init);
                    const body = (await request.json()) as {
                      templateId?: string;
                      customFields?: Record<string, unknown>;
                    };
                    observedWindow.templateCreateObservation = {
                      templateId: body.templateId ?? null,
                      customFields: Object.fromEntries(
                        keys
                          .filter((key) =>
                            Object.hasOwn(body.customFields ?? {}, key),
                          )
                          .map((key) => [key, body.customFields?.[key]]),
                      ),
                    };
                  } catch {
                    observedWindow.templateCreateObservation = null;
                  }
                }
                return nativeFetch(input, init);
              };
            },
            { path: createPath, keys: [fieldKey, "controller", "dependent"] },
          );
          const listUrl = new URL(
            `/agent/projects/${encodeURIComponent(slug)}/work?layout=list`,
            origin,
          ).toString();
          const dialog = page.getByTestId("create-work-item-dialog");
          const input = dialog.locator(`#create-work-item-cf-${fieldKey}`);
          const submit = dialog.getByTestId("create-work-item-submit");
          const openTemplate = async (
            title: string,
            templateName = "Required reference template",
          ) => {
            await page.goto(listUrl);
            await page.getByTestId("create-work-item-trigger").click();
            await expect(dialog).toBeVisible();
            await dialog
              .getByTestId("create-work-item-template-trigger")
              .click();
            await page
              .getByRole("button", {
                name: templateName,
                exact: true,
              })
              .click();
            await dialog.getByTestId("create-work-item-title").fill(title);
            await expect(input).toBeVisible();
            await expect(input).toHaveValue("");
            await expect(submit).toBeEnabled();
          };
          const createFromDialog = async (templateId = template.id) => {
            const pending = page.waitForResponse(
              (response) =>
                new URL(response.url()).pathname === createPath &&
                response.request().method() === "POST",
            );
            await submit.click();
            const response = await pending;
            expect(response.status()).toBe(200);
            const request = await observedCreate(page);
            expect(request.templateId).toBe(templateId);
            const created = (await response.json()) as Item;
            await expect(dialog).toBeHidden();
            return { created, request };
          };
          const verifySaved = async (item: Item, expected: string) => {
            const detail = await requestJson<Detail>(
              page,
              `/api/work-items/${encodeURIComponent(item.key)}`,
            );
            expect(
              detail.customFields.find((field) => field.key === fieldKey)
                ?.value,
            ).toBe(expected);
            await page.goto(
              new URL(
                `/agent/work-items/${encodeURIComponent(item.key)}`,
                origin,
              ).toString(),
            );
            const persisted = page.locator(`#work-item-cf-${fieldKey}`);
            await expect(persisted).toHaveValue(expected);
            await page.reload();
            await expect(persisted).toHaveValue(expected);
          };

          await openTemplate("Untouched template default");
          await page.screenshot({
            path: testInfo.outputPath("template-default-before-create.png"),
          });
          const untouched = await createFromDialog();
          expect(untouched.request.customFields).not.toHaveProperty(fieldKey);
          await verifySaved(untouched.created, "Stored template reference");
          await page.screenshot({
            path: testInfo.outputPath("template-default-persisted.png"),
          });

          await openTemplate("Explicit template override");
          await input.fill("Caller supplied reference");
          const overridden = await createFromDialog();
          expect(overridden.request.customFields[fieldKey]).toBe(
            "Caller supplied reference",
          );
          await verifySaved(overridden.created, "Caller supplied reference");

          await openTemplate("Cleared required reference");
          await input.fill("Temporary explicit value");
          await input.fill("");
          const refused = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === createPath &&
              response.request().method() === "POST",
          );
          await submit.click();
          const refusal = await refused;
          expect(refusal.status()).toBe(400);
          const clearedRequest = await observedCreate(page);
          expect(clearedRequest.templateId).toBe(template.id);
          expect(clearedRequest.customFields[fieldKey]).toBe("");
          await expect(
            dialog.getByTestId("create-work-item-error"),
          ).toBeVisible();
          await expect(dialog).toBeVisible();
          const items = await requestJson<ItemList>(page, createPath);
          expect(items.meta.total).toBe(2);
          expect(items.data.map((item) => item.key).sort()).toEqual(
            [untouched.created.key, overridden.created.key].sort(),
          );
          await page.screenshot({
            path: testInfo.outputPath("template-required-clear-refused.png"),
          });

          await requestJson(page, "/api/custom-fields", {
            workspaceId,
            sectionId: section.id,
            key: "controller",
            name: "Template controller",
            format: "text",
            visibility: [
              { workItemTypeId: type.id, visible: true, required: false },
            ],
          });
          await requestJson(page, "/api/custom-fields", {
            workspaceId,
            sectionId: section.id,
            key: "dependent",
            name: "Conditional reference",
            format: "text",
            visibilityCondition: {
              field_key: "controller",
              op: "eq",
              value: "show",
            },
            visibility: [
              { workItemTypeId: type.id, visible: true, required: true },
            ],
          });
          const conditionalTemplate = await requestJson<{ id: string }>(
            page,
            `/api/workspace/${encodeURIComponent(workspaceId)}/work-item-templates`,
            {
              name: "Conditional reference template",
              typeId: type.id,
              title: "Conditional template task",
              customFieldValues: {
                [fieldKey]: "Stored template reference",
                controller: "show",
              },
            },
          );
          await openTemplate(
            "Recover conditional required reference",
            "Conditional reference template",
          );
          const dependent = dialog.locator("#create-work-item-cf-dependent");
          await expect(dependent).toBeHidden();
          const conditionalRefusal = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === createPath &&
              response.request().method() === "POST",
          );
          await submit.click();
          expect((await conditionalRefusal).status()).toBe(400);
          const conditionalRequest = await observedCreate(page);
          expect(conditionalRequest.templateId).toBe(conditionalTemplate.id);
          expect(conditionalRequest.customFields).toEqual({});
          await expect(dependent).toBeVisible();
          await expect(
            dialog.getByTestId("create-work-item-error"),
          ).toContainText("Conditional reference");
          expect(
            (await requestJson<ItemList>(page, createPath)).meta.total,
          ).toBe(2);
          await dependent.fill("Resolved conditional reference");
          const recovered = await createFromDialog(conditionalTemplate.id);
          expect(recovered.request.customFields).toEqual({
            dependent: "Resolved conditional reference",
          });
          await verifySaved(recovered.created, "Stored template reference");
          await expect(page.locator("#work-item-cf-controller")).toHaveValue(
            "show",
          );
          await expect(page.locator("#work-item-cf-dependent")).toHaveValue(
            "Resolved conditional reference",
          );
          const recoveredDetail = await requestJson<Detail>(
            page,
            `/api/work-items/${encodeURIComponent(recovered.created.key)}`,
          );
          expect(
            recoveredDetail.customFields.find(
              (field) => field.key === "dependent",
            )?.value,
          ).toBe("Resolved conditional reference");
          expect(
            (await requestJson<ItemList>(page, createPath)).meta.total,
          ).toBe(3);
          await page.screenshot({
            path: testInfo.outputPath("template-conditional-recovered.png"),
          });
        } finally {
          await context.close();
        }
      },
      {
        discardChildOutput: true,
        onContainerCreated: (id) => {
          containers.push(id);
          console.info(`Template fixture container: ${id}`);
        },
      },
    );
  } finally {
    console.info(
      `Template fixture containers created: ${containers.length ? containers.join(", ") : "none"}`,
    );
  }
});
