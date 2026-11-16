import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";
import {
  expectEmptyPortalProjectsReady,
  expectReadOnlyProjectReady,
  projectMatrixRequest,
} from "./project-key-role-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, info) =>
  redactSecretErrorContext(info),
);

for (const mode of ["refused", "missing-token"] as const) {
  test(`CSRF ${mode} cannot masquerade as a protected denial`, async ({
    page,
  }) => {
    let protectedRequests = 0;
    await page.route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/me/csrf-token") {
        await route.fulfill(
          mode === "refused"
            ? { status: 403, body: "" }
            : { status: 200, contentType: "application/json", body: "{}" },
        );
      } else if (path === "/api/project") {
        protectedRequests += 1;
        await route.fulfill({ status: 403, body: "" });
      } else
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<main>Fixture</main>",
        });
    });
    await page.goto("http://matrix.invalid/fixture");
    await expect(
      projectMatrixRequest(page, "/api/project", "POST", {}),
    ).rejects.toThrow("Matrix CSRF unavailable");
    expect(protectedRequests).toBe(0);
  });
}

test("readiness waits for loaded content and rejects redirected routes", async ({
  page,
}) => {
  await page.route("**/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>General Settings</h1>",
    });
  });
  const url = "http://matrix.invalid/general";
  await page.goto(url);
  let ready = false;
  const waiting = expectReadOnlyProjectReady(page, url, "ABCDEFGHIJKLMNO").then(
    () => {
      ready = true;
    },
  );
  await expect(
    expect.poll(() => ready, { timeout: 250 }).toBe(true),
  ).rejects.toThrow();
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", "<p>ABCDEFGHIJKLMNO</p>");
  });
  await waiting;
  expect(ready).toBe(true);
  await page.goto("http://matrix.invalid/redirected");
  await expect(
    expectReadOnlyProjectReady(page, url, "ABCDEFGHIJKLMNO"),
  ).rejects.toThrow();
});

test("portal readiness requires the loaded empty state", async ({ page }) => {
  await page.route("**/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>Projects</h1>",
    });
  });
  const url = "http://matrix.invalid/projects";
  await page.goto(url);
  let ready = false;
  const waiting = expectEmptyPortalProjectsReady(page, url).then(() => {
    ready = true;
  });
  await expect(
    expect.poll(() => ready, { timeout: 250 }).toBe(true),
  ).rejects.toThrow();
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", "<p>No projects yet</p>");
  });
  await waiting;
  expect(ready).toBe(true);
});
