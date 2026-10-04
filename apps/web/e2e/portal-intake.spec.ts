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
  const draftStorageKey =
    "taskdesk:portal-request-draft:v1:request-key-opaque:3";
  await expect
    .poll(() =>
      page.evaluate((key) => localStorage.getItem(key), draftStorageKey),
    )
    .toBe(
      JSON.stringify({
        summary: "Can't access the finance workspace",
        impact: "My team",
        details: "Several teammates are blocked.",
      }),
    );
  await page.reload();
  await expect(page.getByLabel("What happened? (Required)")).toHaveValue(
    "Can't access the finance workspace",
  );
  await expect(page.getByLabel("Who is affected? (Required)")).toContainText(
    "My team",
  );
  await expect(page.getByLabel("More detail")).toHaveValue(
    "Several teammates are blocked.",
  );
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Request received" }),
  ).toBeVisible();
  expect(submittedFormData).toEqual({
    summary: "Can't access the finance workspace",
    impact: "My team",
    details: "Several teammates are blocked.",
  });
  await expect
    .poll(() =>
      page.evaluate((key) => localStorage.getItem(key), draftStorageKey),
    )
    .toBeNull();
  await expect(page.getByText(/SUB-314/)).toBeVisible();
});

test("file-backed form stages, completes, and submits its owned attachment", async ({
  page,
}) => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const draftRef = "SUB-315";
  const attachmentId = "attachment-staged-315";
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
                key: "summary",
                type: "text",
                label: "What happened?",
                required: true,
              },
              {
                key: "proof",
                type: "file",
                label: "Screenshot",
                required: true,
              },
            ],
          },
        },
      });
    },
  );
  await page.route("**/api/me/csrf-token", async (route) => {
    await route.fulfill({
      json: { token: "test-csrf-token", expiresAt: "2099-01-01T00:00:00.000Z" },
    });
  });
  await page.route("**/api/portal/submissions/drafts", async (route) => {
    calls.push({
      path: new URL(route.request().url()).pathname,
      method: route.request().method(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      json: {
        ref: draftRef,
        state: "draft",
        workItemKey: null,
        createdAt: "2026-10-04T10:00:00.000Z",
      },
    });
  });
  await page.route(
    "**/api/portal/submissions/SUB-315/attachments/presign",
    async (route) => {
      calls.push({
        path: new URL(route.request().url()).pathname,
        method: route.request().method(),
        body: route.request().postDataJSON(),
      });
      await route.fulfill({
        json: {
          attachmentId,
          fieldKey: "proof",
          uploadUrl: "https://upload.example.test/object",
          uploadHeaders: { "content-type": "image/png" },
        },
      });
    },
  );
  await page.route("https://upload.example.test/object", async (route) => {
    calls.push({
      path: "/signed-object-put",
      method: route.request().method(),
      body: null,
    });
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route(
    `**/api/portal/submissions/${draftRef}/attachments/${attachmentId}/complete`,
    async (route) => {
      calls.push({
        path: new URL(route.request().url()).pathname,
        method: route.request().method(),
        body: null,
      });
      await route.fulfill({ json: { id: attachmentId, state: "ready" } });
    },
  );
  let submittedBody: Record<string, unknown> | undefined;
  await page.route(
    `**/api/portal/submissions/${draftRef}/submit`,
    async (route) => {
      submittedBody = route.request().postDataJSON() as Record<string, unknown>;
      calls.push({
        path: new URL(route.request().url()).pathname,
        method: route.request().method(),
        body: submittedBody,
      });
      await route.fulfill({
        json: {
          ref: draftRef,
          state: "new",
          workItemKey: null,
          createdAt: "2026-10-04T10:00:00.000Z",
        },
      });
    },
  );

  await page.goto("/");
  await page.getByRole("link", { name: requestType.name }).click();
  await page.getByLabel("What happened? (Required)").fill("Access is blocked");
  await page.getByLabel("Screenshot (Required)").setInputFiles({
    name: "evidence.png",
    mimeType: "image/png",
    buffer: Buffer.from("test image bytes"),
  });

  await page.getByRole("button", { name: "Send request" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "Request received" }),
  ).toBeVisible();
  expect(submittedBody).toEqual({
    formData: { summary: "Access is blocked", proof: attachmentId },
  });
  expect(calls.map(({ path, method }) => `${method} ${path}`)).toEqual([
    "POST /api/portal/submissions/drafts",
    "POST /api/portal/submissions/SUB-315/attachments/presign",
    "PUT /signed-object-put",
    "POST /api/portal/submissions/SUB-315/attachments/attachment-staged-315/complete",
    "POST /api/portal/submissions/SUB-315/submit",
  ]);
  expect(calls[0]?.body).toEqual({
    requestTypeKey: requestType.key,
    formData: { summary: "Access is blocked" },
  });
  expect(calls[1]?.body).toMatchObject({
    fieldKey: "proof",
    filename: "evidence.png",
    contentType: "image/png",
  });
  expect(calls[1]?.body).toHaveProperty(
    "size",
    Buffer.byteLength("test image bytes"),
  );
});
