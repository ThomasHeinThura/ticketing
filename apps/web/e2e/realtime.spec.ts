import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { withMfaCsrfApp } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });

function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}

async function csrfMutation(
  page: Page,
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return page.evaluate(
    async ({
      path: requestPath,
      method: requestMethod,
      body: requestBody,
      headers: requestHeaders,
    }) => {
      const issuer = await fetch("/api/me/csrf-token", {
        credentials: "same-origin",
      });
      if (!issuer.ok) return { status: issuer.status, body: undefined };
      const issued = (await issuer.json()) as { token: string };
      const response = await fetch(requestPath, {
        method: requestMethod,
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-csrf": issued.token,
          ...requestHeaders,
        },
        body: JSON.stringify(requestBody),
      });
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = undefined;
      }
      return { status: response.status, body: responseBody };
    },
    { path, method, body, headers },
  );
}

test("native work-item events invalidate a second authenticated browser session", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await withMfaCsrfApp(async ({ origin, email, password }) => {
    const firstContext = await browser.newContext({
      locale: "en-GB",
      timezoneId: "UTC",
    });
    const secondContext = await browser.newContext({
      locale: "en-GB",
      timezoneId: "UTC",
    });
    let primaryFailure: unknown;
    try {
      const first = await firstContext.newPage();
      const second = await secondContext.newPage();
      let secondPageClosed = false;
      let secondPageCrashed = false;
      second.on("close", () => {
        secondPageClosed = true;
      });
      second.on("crash", () => {
        secondPageCrashed = true;
      });
      await first.goto(new URL("/auth/sign-up", origin).toString());
      await first.getByLabel("Full name").fill("Realtime Journey Admin");
      await first.getByLabel("Email").fill(email);
      await first.locator('input[autocomplete="new-password"]').fill(password);
      await first.getByRole("button", { name: "Create account" }).click();
      await expect(first).toHaveURL(/\/onboarding(?:\?|$)/);
      await first
        .getByLabel("Workspace name")
        .fill("Realtime Journey Workspace");
      await first.getByRole("button", { name: "Create workspace" }).click();
      await expect(first).toHaveURL(/\/dashboard\/workspace\//);

      const workspaceId = new URL(first.url()).pathname.match(
        /\/dashboard\/workspace\/([^/]+)/,
      )?.[1];
      expect(workspaceId).toBeTruthy();
      const projectSlug = `realtime-${randomUUID().slice(0, 8)}`;
      const projectResult = await csrfMutation(first, "/api/project", "POST", {
        name: "Native realtime project",
        workspaceId: workspaceId as string,
        icon: "Folder",
        slug: projectSlug,
      });
      expect(projectResult.status).toBe(200);
      const project = projectResult.body as { id: string; slug: string };
      expect(project.slug).toBe(projectSlug);

      await second.goto(new URL("/auth/sign-in", origin).toString());
      await second.getByLabel("Email").fill(email);
      await second
        .locator('input[autocomplete="current-password"]')
        .fill(password);
      await second.getByRole("button", { name: "Sign in" }).click();
      await expect(second).toHaveURL(/\/dashboard(?:\/|\?|$)/);
      const activation = await csrfMutation(
        second,
        `/api/workspace/${encodeURIComponent(workspaceId as string)}/activate`,
        "POST",
        {},
      );
      expect(activation.status).toBe(200);

      const listPath = `/agent/projects/${encodeURIComponent(projectSlug)}/work?layout=list`;
      const listApiPath = `/api/projects/${project.id}/work-items`;
      const observedSocketPaths: string[] = [];
      const closedSocketPaths: string[] = [];
      const listSnapshots: {
        key?: string;
        title?: string;
        version?: number;
      }[][] = [];
      second.on("websocket", (socket) => {
        const socketPath = new URL(socket.url()).pathname;
        observedSocketPaths.push(socketPath);
        socket.on("close", () => closedSocketPaths.push(socketPath));
      });
      second.on("response", (response) => {
        if (
          new URL(response.url()).pathname !== listApiPath ||
          response.request().method() !== "GET" ||
          !response.ok()
        )
          return;
        void response
          .json()
          .then(
            (body: {
              data?: { key?: string; title?: string; version?: number }[];
            }) => {
              listSnapshots.push(
                (body.data ?? []).map(({ key, title, version }) => ({
                  key,
                  title,
                  version,
                })),
              );
            },
          )
          .catch(() => undefined);
      });
      const initialListResponse = settle(
        second.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === listApiPath &&
            response.request().method() === "GET" &&
            response.ok(),
        ),
      );
      await second.goto(new URL(listPath, origin).toString());
      const initialListResult = await initialListResponse;
      if ("error" in initialListResult) throw initialListResult.error;
      await expect(
        second.getByRole("heading", { name: /Native realtime project/ }),
      ).toBeVisible();
      await expect.poll(() => observedSocketPaths).toContain("/api/ws");
      const listOpenedAt = Date.now();

      const createdTitle = "Visible from the other browser session";
      const createdRefetch = settle(
        second.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === listApiPath &&
            response.request().method() === "GET" &&
            response.ok(),
        ),
      );
      await first.goto(new URL(listPath, origin).toString());
      await first.getByTestId("create-work-item-trigger").click();
      await expect(first.getByTestId("create-work-item-dialog")).toBeVisible();
      await first.getByTestId("create-work-item-type-trigger").click();
      await first.getByRole("option", { name: "Task", exact: true }).click();
      await first.getByTestId("create-work-item-title").fill(createdTitle);
      const createdResponse = settle(
        first.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === listApiPath &&
            response.request().method() === "POST",
        ),
      );
      await first.getByTestId("create-work-item-submit").click();
      const createdResult = await createdResponse;
      if ("error" in createdResult) throw createdResult.error;
      const postResponse = createdResult.value;
      expect(postResponse.ok()).toBe(true);
      const created = (await postResponse.json()) as {
        key: string;
        version: number;
      };
      expect(created.version).toBe(1);
      const createdRefetchResult = await createdRefetch;
      if ("error" in createdRefetchResult) throw createdRefetchResult.error;
      await expect(
        second.getByText(createdTitle, { exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          listSnapshots.some((snapshot) =>
            snapshot.some(
              (item) => item.key === created.key && item.title === createdTitle,
            ),
          ),
        )
        .toBe(true);
      expect(Date.now() - listOpenedAt).toBeLessThan(30_000);

      const updatedTitle = "Committed update from the first session";
      const updateRefetch = settle(
        second.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === listApiPath &&
            response.request().method() === "GET" &&
            response.ok(),
        ),
      );
      const patch = await csrfMutation(
        first,
        `/api/work-items/${encodeURIComponent(created.key)}`,
        "PATCH",
        { title: updatedTitle },
        { "if-match": `"${created.version}"` },
      );
      expect(patch.status).toBe(200);
      expect(patch.body).toMatchObject({ title: updatedTitle, version: 2 });
      const updateRefetchResult = await updateRefetch;
      if ("error" in updateRefetchResult) {
        throw new Error(
          JSON.stringify({
            secondPageClosed,
            secondPageCrashed,
            secondIsClosed: second.isClosed(),
            browserConnected: browser.isConnected(),
            observedSocketPaths,
            closedSocketPaths,
          }),
        );
      }
      await updateRefetchResult.value;
      await expect(
        second.getByText(updatedTitle, { exact: true }),
      ).toBeVisible();
      await expect(second.getByText(createdTitle, { exact: true })).toHaveCount(
        0,
      );
      await expect
        .poll(() =>
          listSnapshots.some((snapshot) =>
            snapshot.some(
              (item) =>
                item.key === created.key &&
                item.title === updatedTitle &&
                item.version === 2,
            ),
          ),
        )
        .toBe(true);
      const committedRead = await second.evaluate(async (key) => {
        const response = await fetch(
          `/api/work-items/${encodeURIComponent(key)}`,
        );
        return { status: response.status, body: await response.json() };
      }, created.key);
      expect(committedRead).toMatchObject({
        status: 200,
        body: { key: created.key, title: updatedTitle, version: 2 },
      });
      expect(closedSocketPaths).not.toContain("/api/ws");
    } catch (error) {
      primaryFailure = error;
    } finally {
      const cleanup = await Promise.allSettled([
        firstContext.close(),
        secondContext.close(),
      ]);
      const failedCleanup = cleanup.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (!primaryFailure && failedCleanup)
        primaryFailure = failedCleanup.reason;
    }
    if (primaryFailure) throw primaryFailure;
  });
});
