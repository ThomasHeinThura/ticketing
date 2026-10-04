import { expect, test } from "@playwright/test";

const requestType = {
  key: "request-key-opaque",
  name: "Report an access issue",
  description: "Tell the service desk what you need.",
  version: 3,
  formSchema: {
    fields: [
      { key: "summary", type: "text", label: "What happened?", required: true },
      {
        key: "impact",
        type: "select",
        label: "Who is affected?",
        options: ["Just me", "My team"],
        required: true,
      },
      {
        key: "details",
        type: "textarea",
        label: "More detail",
        showIf: { field_key: "impact", op: "eq", value: "My team" },
      },
    ],
  },
};

test("customer can find a request type, submit its form, and receive a durable reference", async ({
  page,
}) => {
  let submittedFormData: Record<string, unknown> | undefined;
  await page.route("**/api/portal/catalogue", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            key: requestType.key,
            name: requestType.name,
            description: requestType.description,
            icon: null,
            group: "Access",
            position: 0,
          },
        ],
      },
    });
  });
  await page.route(
    "**/api/portal/catalogue/request-key-opaque",
    async (route) => {
      await route.fulfill({ json: requestType });
    },
  );
  await page.route("**/api/me/csrf-token", async (route) => {
    await route.fulfill({
      json: { token: "test-csrf-token", expiresAt: "2099-01-01T00:00:00.000Z" },
    });
  });
  await page.route("**/api/portal/submissions", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        formData: Record<string, unknown>;
      };
      submittedFormData = body.formData;
      await route.fulfill({
        json: {
          ref: "SUB-314",
          state: "new",
          workItemKey: null,
          createdAt: "2026-10-04T10:00:00.000Z",
        },
      });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto("/");
  await page.getByRole("link", { name: requestType.name }).click();
  await expect(
    page.getByRole("heading", { name: requestType.name }),
  ).toBeVisible();
  await page
    .getByLabel("What happened? (Required)")
    .fill("Can't access the finance workspace");
  await page.getByLabel("Who is affected? (Required)").click();
  await page.getByRole("option", { name: "My team" }).click();
  await expect(page.getByLabel("More detail")).toBeVisible();
  await page.getByLabel("More detail").fill("Several teammates are blocked.");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Request received" }),
  ).toBeVisible();
  expect(submittedFormData).toEqual({
    summary: "Can't access the finance workspace",
    impact: "My team",
    details: "Several teammates are blocked.",
  });
  await expect(page.getByText(/SUB-314/)).toBeVisible();
});

test("file-backed forms disclose the unavailable upload seam and cannot discard attachments", async ({
  page,
}) => {
  await page.route("**/api/portal/catalogue", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            key: requestType.key,
            name: requestType.name,
            description: null,
            icon: null,
            group: "Access",
            position: 0,
          },
        ],
      },
    });
  });
  await page.route(
    "**/api/portal/catalogue/request-key-opaque",
    async (route) => {
      await route.fulfill({
        json: {
          ...requestType,
          formSchema: {
            fields: [
              {
                key: "proof",
                type: "file",
                label: "Screenshot",
                multiple: true,
              },
            ],
          },
        },
      });
    },
  );

  await page.goto("/");
  await page.getByRole("link", { name: requestType.name }).click();
  await expect(
    page.getByText(/which are not available on this portal build yet/i),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send request" }),
  ).toBeDisabled();
});
