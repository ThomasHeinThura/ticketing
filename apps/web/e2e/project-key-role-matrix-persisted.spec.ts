import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import {
  navigateToSetup,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "../../../tests/e2e/helpers/project-key";
import { enrollFirstAdmin } from "./helpers/enroll-first-admin";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";
import {
  expectEmptyPortalProjectsReady,
  expectReadOnlyProjectReady,
  grantMatrixRoles,
  ROLES,
  type Role,
  projectMatrixRequest as request,
  seedMatrixActors,
  seedPortalSupport,
  signInRetryDelay,
} from "./project-key-role-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, info) =>
  redactSecretErrorContext(info),
);
const views = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
] as const;
const themes = ["light", "dark"] as const;
const canCreate = new Set<Role>(["owner", "admin", "manager"]);
const canRename = new Set<Role>(["owner", "admin", "manager", "lead"]);
type Project = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  description: string | null;
};
type Item = { id: string; key: string };

async function setTheme(page: Page, theme: string) {
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
}
async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBe(0);
}

test("project key creation and rename respect role, viewport, theme and host", async ({
  browser,
}, info) => {
  test.setTimeout(1_800_000);
  const containers: string[] = [];
  try {
    await withMfaCsrfApp(
      async (fixture) => {
        const { origin, email, password, setupUrl, databaseUrl } = fixture;
        const setup = await browser.newContext({
          locale: "en-GB",
          timezoneId: "UTC",
          reducedMotion: "reduce",
        });
        const contexts: BrowserContext[] = [];
        try {
          const bootstrap = await setup.newPage();
          await navigateToSetup(bootstrap, setupUrl);
          await bootstrap
            .getByLabel("Full name")
            .fill("Disposable Matrix Setup");
          await bootstrap.getByLabel("Email").fill(email);
          await bootstrap
            .locator('input[autocomplete="new-password"]')
            .fill(password);
          await bootstrap
            .getByRole("button", { name: "Create account" })
            .click();
          await enrollFirstAdmin(bootstrap, origin, password);
          const actors = await seedMatrixActors(databaseUrl, email);
          const owner = actors.find((actor) => actor.role === "owner");
          if (!owner) throw new Error("Owner fixture missing");
          const workspace = await request<{ id: string }>(
            bootstrap,
            "/api/workspace",
            "POST",
            { name: "Key Matrix", ownerUserId: owner.id },
          );
          expect(workspace.status).toBe(200);
          const workspaceId = workspace.body.id;
          await grantMatrixRoles(databaseUrl, workspaceId, actors);
          const bootstrapSession = await request<{ user: { id: string } }>(
            bootstrap,
            "/api/auth/get-session",
          );
          expect(bootstrapSession.status).toBe(200);
          const foreignWorkspace = await request<{ id: string }>(
            bootstrap,
            "/api/workspace",
            "POST",
            {
              name: "Isolated Matrix Workspace",
              ownerUserId: bootstrapSession.body.user.id,
            },
          );
          expect(foreignWorkspace.status).toBe(200);
          const foreignProject = await request<Project>(
            bootstrap,
            "/api/project",
            "POST",
            {
              workspaceId: foreignWorkspace.body.id,
              name: "Isolated Matrix Project",
              icon: "Folder",
              slug: uniqueProjectKey(8),
            },
          );
          expect(foreignProject.status).toBe(200);
          const portal = new URL(origin);
          portal.hostname = "portal.localhost";
          const pages = new Map<Role, Page>();
          let retried = false;
          for (const [index, actor] of actors.entries()) {
            if (index === 3 || index === 6)
              await new Promise((done) => setTimeout(done, 12_000));
            const context = await browser.newContext({
              locale: "en-GB",
              timezoneId: "UTC",
              reducedMotion: "reduce",
            });
            contexts.push(context);
            const host = actor.role === "customer" ? portal.origin : origin;
            const signIn = () =>
              context.request.post(
                new URL("/api/auth/sign-in/email", host).toString(),
                {
                  headers: { Origin: host },
                  data: { email: actor.email, password: actor.password },
                },
              );
            let response = await signIn();
            if (response.status() === 429) {
              if (retried)
                throw new Error("Fixture authentication rate limited");
              const delay = signInRetryDelay(response.headers());
              retried = true;
              await response.dispose();
              await new Promise((done) => setTimeout(done, delay));
              response = await signIn();
            }
            expect(response.status(), `sign-in ${actor.role}`).toBe(200);
            const session = await context.request.get(
              new URL("/api/auth/get-session", host).toString(),
            );
            expect(session.status()).toBe(200);
            const identity = (await session.json()) as {
              user: { id: string };
              session: { portal: string };
            };
            expect(identity.user.id).toBe(actor.id);
            expect(identity.session.portal).toBe(
              actor.role === "customer" ? "customer" : "agent",
            );
            if (actor.role !== "customer") {
              const csrf = await context.request.get(
                new URL("/api/me/csrf-token", origin).toString(),
                { headers: { Origin: origin } },
              );
              expect(csrf.status()).toBe(200);
              const { token } = (await csrf.json()) as { token: string };
              const activated = await context.request.post(
                new URL(
                  `/api/workspace/${workspaceId}/activate`,
                  origin,
                ).toString(),
                {
                  headers: { Origin: origin, "x-taskdesk-csrf": token },
                  data: {},
                },
              );
              expect(activated.status()).toBe(200);
            }
            const page = await context.newPage();
            await page.goto(
              new URL(
                actor.role === "customer" ? "/projects" : "/agent",
                host,
              ).toString(),
            );
            pages.set(actor.role, page);
          }
          const ownerPage = pages.get("owner");
          if (!ownerPage) throw new Error("Owner session missing");
          const shared = await request<Project>(
            ownerPage,
            "/api/project",
            "POST",
            {
              workspaceId,
              name: "Matrix shared",
              icon: "Folder",
              slug: uniqueProjectKey(8),
            },
          );
          expect(shared.status).toBe(200);
          for (const role of ["lead", "member", "viewer"] as const) {
            const actor = actors.find((entry) => entry.role === role);
            if (!actor) throw new Error("Role fixture missing");
            const member = await request(
              ownerPage,
              `/api/projects/${shared.body.id}/members`,
              "POST",
              { personId: actor.personId, roleKey: `project-${role}` },
            );
            expect(member.status).toBe(200);
          }
          const types = await request<Array<{ id: string; key: string }>>(
            ownerPage,
            `/api/workspace/${workspaceId}/work-item-types`,
          );
          expect(types.status).toBe(200);
          const taskType = types.body.find((item) => item.key === "task");
          if (!taskType) throw new Error("Task type missing");
          const originalItem = await request<Item>(
            ownerPage,
            `/api/projects/${shared.body.id}/work-items`,
            "POST",
            { typeId: taskType.id, title: "Original matrix prefix" },
          );
          expect(originalItem.status).toBe(200);
          expect(originalItem.body.key).toBe(`${shared.body.slug}-1`);
          const expectNoCreatedProject = async (slug: string) => {
            const list = await request<Project[]>(
              ownerPage,
              `/api/project?workspaceId=${encodeURIComponent(workspaceId)}`,
            );
            expect(list.status).toBe(200);
            expect(list.body.some((project) => project.slug === slug)).toBe(
              false,
            );
          };
          for (const role of ROLES) {
            expect(
              BUILT_IN_ROLES[role].capabilities.includes("project:create"),
              `catalogue create ${role}`,
            ).toBe(canCreate.has(role));
            expect(
              BUILT_IN_ROLES[role].capabilities.includes("project:update"),
              `catalogue update ${role}`,
            ).toBe(canRename.has(role));
            const page = pages.get(role);
            if (!page) throw new Error("Role page missing");
            for (const view of views)
              for (const theme of themes) {
                await page.setViewportSize(view);
                await setTheme(page, theme);
                await page.emulateMedia({ colorScheme: theme });
                if (role === "customer") {
                  await page.goto(
                    new URL("/projects", portal.origin).toString(),
                  );
                  await expectEmptyPortalProjectsReady(
                    page,
                    new URL("/projects", portal.origin).toString(),
                  );
                  await expect(page.locator("html")).toHaveClass(
                    new RegExp(`\\b${theme}\\b`),
                  );
                  expect(
                    (
                      await page
                        .context()
                        .request.get(
                          new URL(
                            `/api/project/${shared.body.id}`,
                            origin,
                          ).toString(),
                        )
                    ).status(),
                  ).toBe(401);
                  const portalAgentRead = await page
                    .context()
                    .request.get(
                      new URL(
                        `/api/project/${shared.body.id}`,
                        portal.origin,
                      ).toString(),
                    );
                  expect(portalAgentRead.status()).toBe(404);
                  const deniedSlug = uniqueProjectKey(15);
                  const portalAgentCreate = await page
                    .context()
                    .request.post(
                      new URL("/api/project", portal.origin).toString(),
                      {
                        headers: { Origin: portal.origin },
                        data: {
                          workspaceId,
                          name: "Denied customer project",
                          icon: "Folder",
                          slug: deniedSlug,
                        },
                      },
                    );
                  expect(portalAgentCreate.status()).toBe(404);
                  await expectNoCreatedProject(deniedSlug);
                  await expect(
                    page.getByRole("button", { name: /^Create project$/i }),
                  ).toHaveCount(0);
                  await noOverflow(page);
                  await page.screenshot({
                    path: info.outputPath(
                      `key-${role}-${view.name}-${theme}.png`,
                    ),
                  });
                  continue;
                }
                const foreign = await request(
                  page,
                  `/api/project/${foreignProject.body.id}`,
                );
                expect(foreign.status, `workspace isolation ${role}`).toBe(404);
                await page.goto(new URL("/agent", origin).toString());
                await expect(
                  page.getByTestId("g13-projects-content"),
                ).toBeVisible();
                await expect(page.locator("html")).toHaveClass(
                  new RegExp(`\\b${theme}\\b`),
                );
                const create = page
                  .locator("header")
                  .getByRole("button", { name: /^Create project$/i });
                if (canCreate.has(role)) {
                  await create.click();
                  const dialog = page.getByRole("dialog");
                  const name = dialog.getByPlaceholder(/name$/i);
                  const key = dialog.getByRole("textbox", { name: /^Key:?$/i });
                  await name.fill("Customer Support Delivery");
                  await expect(key).toHaveValue("CUSTOMERSUPPORT");
                  await key.fill("WWWWWWWWWWWWWWW");
                  await key.focus();
                  await page.keyboard.press("Tab");
                  await page.keyboard.press("Shift+Tab");
                  await expect(key).toBeFocused();
                  await key.press("End");
                  const size = await key.evaluate(
                    (element: HTMLInputElement) => ({
                      scroll: element.scrollWidth,
                      width: element.clientWidth,
                      left: element.scrollLeft,
                    }),
                  );
                  expect(size.scroll).toBeLessThanOrEqual(size.width);
                  expect(size.left).toBe(0);
                  await noOverflow(page);
                  await dialog.screenshot({
                    path: info.outputPath(
                      `key-${role}-${view.name}-${theme}.png`,
                    ),
                  });
                  const slug = uniqueProjectKey(15);
                  await key.fill(slug);
                  await name.fill("Synthetic matrix project");
                  await expect(key).toHaveValue(slug);
                  const created = page.waitForResponse(
                    (r) =>
                      new URL(r.url()).pathname === "/api/project" &&
                      r.request().method() === "POST",
                  );
                  await dialog
                    .getByRole("button", { name: /^Create project$/i })
                    .click();
                  const response = await created;
                  expect(response.status()).toBe(200);
                  const project = (await response.json()) as Project;
                  expect(project.slug).toBe(slug);
                  const fresh = await request<Project>(
                    page,
                    `/api/project/${project.id}`,
                  );
                  expect(fresh.status).toBe(200);
                  expect(fresh.body.slug).toBe(slug);
                  await page.goto(
                    new URL(`/agent/projects/${slug}`, origin).toString(),
                  );
                  await expect(
                    page.getByTestId("project-overview-page"),
                  ).toBeVisible();
                  await page.reload();
                  await expect(
                    page.getByTestId("project-overview-page"),
                  ).toBeVisible();
                  const item = await request<Item>(
                    page,
                    `/api/projects/${project.id}/work-items`,
                    "POST",
                    { typeId: taskType.id, title: "Synthetic matrix item" },
                  );
                  expect(item.status).toBe(200);
                  expect(item.body.key).toBe(`${slug}-1`);
                  await page.goto(
                    new URL(
                      `/agent/projects/${slug}/work?layout=board`,
                      origin,
                    ).toString(),
                  );
                  const itemLink = page.getByRole("link", {
                    name: "Synthetic matrix item",
                  });
                  await expect(itemLink).toHaveAttribute(
                    "href",
                    `/agent/work-items/${item.body.key}`,
                  );
                  await page.goto(
                    new URL(
                      `/agent/work-items/${item.body.key}`,
                      origin,
                    ).toString(),
                  );
                  await expect(
                    page.getByTestId("work-item-detail"),
                  ).toBeVisible();
                } else {
                  await expect(create).toHaveCount(0);
                  const deniedSlug = uniqueProjectKey(15);
                  const denied = await request(page, "/api/project", "POST", {
                    workspaceId,
                    name: "Denied matrix project",
                    icon: "Folder",
                    slug: deniedSlug,
                  });
                  expect(denied.status).toBe(403);
                  await expectNoCreatedProject(deniedSlug);
                  const generalUrl = new URL(
                    `/dashboard/settings/projects/${shared.body.id}/general`,
                    origin,
                  ).toString();
                  await page.goto(generalUrl);
                  if (canRename.has(role)) {
                    await expect(page).toHaveURL(generalUrl);
                    const input = page.getByRole("textbox", {
                      name: "Key",
                      exact: true,
                    });
                    await expect(input).toBeVisible();
                    const slug = uniqueProjectKey(15);
                    await input.fill("WWWWWWWWWWWWWWW");
                    await input.focus();
                    await page.keyboard.press("Tab");
                    await page.keyboard.press("Shift+Tab");
                    await expect(input).toBeFocused();
                    await input.press("End");
                    const size = await input.evaluate(
                      (element: HTMLInputElement) => ({
                        scroll: element.scrollWidth,
                        width: element.clientWidth,
                        left: element.scrollLeft,
                      }),
                    );
                    expect(size.scroll).toBeLessThanOrEqual(size.width);
                    expect(size.left).toBe(0);
                    await noOverflow(page);
                    await page.screenshot({
                      path: info.outputPath(
                        `key-${role}-${view.name}-${theme}.png`,
                      ),
                    });
                    await input.fill(slug);
                    await page
                      .getByRole("button", { name: "Rename key" })
                      .click();
                    const confirmation = page.getByRole("alertdialog");
                    await expect(confirmation).toBeVisible();
                    await confirmation
                      .getByRole("button", { name: "Rename key" })
                      .click();
                    await expect
                      .poll(
                        async () =>
                          (
                            await request<Project>(
                              page,
                              `/api/project/${shared.body.id}`,
                            )
                          ).body.slug,
                      )
                      .toBe(slug);
                    await page.reload();
                    await expect(input).toHaveValue(slug);
                    const retained = await request<Item>(
                      page,
                      `/api/work-items/${encodeURIComponent(originalItem.body.key)}`,
                    );
                    expect(retained.status).toBe(200);
                    expect(retained.body.key).toBe(originalItem.body.key);
                    const item = await request<Item>(
                      page,
                      `/api/projects/${shared.body.id}/work-items`,
                      "POST",
                      {
                        typeId: taskType.id,
                        title: `Synthetic lead ${slug}`,
                      },
                    );
                    expect(item.status).toBe(200);
                    expect(item.body.key.startsWith(`${slug}-`)).toBe(true);
                    await page.goto(
                      new URL(
                        `/agent/projects/${slug}/work?layout=board`,
                        origin,
                      ).toString(),
                    );
                    const itemLink = page.getByRole("link", {
                      name: `Synthetic lead ${slug}`,
                    });
                    await expect(itemLink).toHaveAttribute(
                      "href",
                      `/agent/work-items/${item.body.key}`,
                    );
                    await page.goto(
                      new URL(
                        `/agent/work-items/${item.body.key}`,
                        origin,
                      ).toString(),
                    );
                    await expect(
                      page.getByTestId("work-item-detail"),
                    ).toBeVisible();
                  } else {
                    const current = await request<Project>(
                      page,
                      `/api/project/${shared.body.id}`,
                    );
                    expect(current.status).toBe(200);
                    expect(current.body.slug).toHaveLength(15);
                    await expectReadOnlyProjectReady(
                      page,
                      generalUrl,
                      current.body.slug,
                    );
                    await expect(
                      page.getByRole("textbox", { name: "Key", exact: true }),
                    ).toHaveCount(0);
                    const deniedUpdate = await request(
                      page,
                      `/api/project/${shared.body.id}`,
                      "PUT",
                      {
                        name: current.body.name,
                        slug: uniqueProjectKey(15),
                        icon: current.body.icon ?? "Folder",
                        description: current.body.description ?? "",
                      },
                    );
                    expect(deniedUpdate.status).toBe(403);
                    const unchanged = await request<Project>(
                      page,
                      `/api/project/${shared.body.id}`,
                    );
                    expect(unchanged.status).toBe(200);
                    expect(unchanged.body.slug).toBe(current.body.slug);
                  }
                  await noOverflow(page);
                  if (!canRename.has(role))
                    await page.screenshot({
                      path: info.outputPath(
                        `key-${role}-${view.name}-${theme}.png`,
                      ),
                    });
                }
              }
          }
        } finally {
          for (const context of contexts) await context.close();
          await setup.close();
        }
      },
      {
        beforeStart: seedPortalSupport,
        discardChildOutput: true,
        onContainerCreated: (id) => {
          containers.push(id);
        },
      },
    );
  } finally {
    console.info(
      `Key matrix fixture containers created: ${containers.length ? containers.join(", ") : "none"}`,
    );
  }
});
