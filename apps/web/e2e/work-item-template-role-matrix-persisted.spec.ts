import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import {
  type MfaCsrfAppFixtureSetup,
  navigateToSetup,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "../../../tests/e2e/helpers/project-key";
import { enrollFirstAdmin } from "./helpers/enroll-first-admin";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
type FixturePgClient = {
  connect(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};
const { Client } = apiRequire("pg") as {
  Client: new (options: { connectionString: string }) => FixturePgClient;
};
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const ROLES = [
  "owner",
  "admin",
  "manager",
  "lead",
  "member",
  "viewer",
  "customer",
] as const;
type Role = (typeof ROLES)[number];
type Actor = {
  role: Role;
  id: string;
  personId: string;
  email: string;
  password: string;
};
const VIEWS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;
const THEMES = ["light", "dark"] as const;

function signInRetryDelay(headers: Record<string, string>) {
  const value = headers["retry-after"] ?? headers["x-retry-after"];
  if (!value || !/^(?:[1-9]|10)$/.test(value))
    throw new Error(
      "Auth retry requires a server-advertised delay of 1-10 seconds",
    );
  return Number(value) * 1000;
}

async function seedPortalSupport(fixture: MfaCsrfAppFixtureSetup) {
  const input = resolve(fixture.fixtureDir, "team-portal-input.json");
  const output = resolve(fixture.fixtureDir, "team-portal-output.json");
  await writeFile(input, JSON.stringify({ phase: "instance" }), {
    mode: 0o600,
  });
  for (const [script, args] of [
    ["seed-approval-auth-provider.ts", []],
    ["seed-portal-projects.ts", [input, output]],
  ] as const) {
    const child = await fixture.spawnChild(
      process.execPath,
      [
        resolve(root, "apps/api/node_modules/tsx/dist/cli.mjs"),
        "--tsconfig",
        resolve(root, "apps/api/tsconfig.tests.json"),
        resolve(root, "tests/e2e/scripts", script),
        ...args,
      ],
      `template-matrix-${script}`,
    );
    await new Promise<void>((done, reject) => {
      child.once("close", (code) =>
        code === 0
          ? done()
          : reject(new Error("Private portal fixture setup failed")),
      );
    });
  }
}

async function seedMatrixActors(databaseUrl: string, adminEmail: string) {
  if (!/^\/mfa_csrf_[a-f0-9]{32}_test$/.test(new URL(databaseUrl).pathname))
    throw new Error("Role matrix requires the disposable fixture database");
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const owner = await db.query<{ organisation_id: string }>(
      `SELECT p.organisation_id FROM person p JOIN "user" u ON u.id = p.user_id
       WHERE u.email = $1 AND p.side = 'staff'`,
      [adminEmail],
    );
    expect(owner.rows).toHaveLength(1);
    const internalOrganisationId = owner.rows[0]?.organisation_id;
    if (!internalOrganisationId)
      throw new Error("Fixture staff organisation missing");
    let customerRole = await db.query<{ id: string }>(
      `SELECT id FROM "role" WHERE scope = 'organisation' AND workspace_id IS NULL AND key = 'customer'`,
    );
    if (customerRole.rows.length === 0) {
      customerRole = await db.query<{ id: string }>(
        `INSERT INTO "role" (id, scope, workspace_id, key, name, rank, capabilities, is_system, is_editable)
         VALUES ($1, 'organisation', NULL, 'customer', 'Customer', $2, $3::jsonb, true, false) RETURNING id`,
        [
          randomUUID(),
          BUILT_IN_ROLES.customer.rank,
          JSON.stringify(BUILT_IN_ROLES.customer.capabilities),
        ],
      );
    }
    const customerRoleId = customerRole.rows[0]?.id;
    if (!customerRoleId) throw new Error("Canonical customer role missing");
    const actors = [];
    for (const role of ROLES) {
      const actor: Actor = {
        role,
        id: randomUUID(),
        personId: randomUUID(),
        email: `template-matrix-${role}-${randomUUID()}@example.test`,
        password: randomUUID(),
      };
      const now = new Date();
      let organisationId = internalOrganisationId;
      if (role === "customer") {
        organisationId = randomUUID();
        await db.query(
          `INSERT INTO organisation (id, key, name, is_internal, portal_access, default_customer_visibility)
           VALUES ($1, $2, 'Disposable customer organisation', false, true, 'organisation')`,
          [organisationId, `template-matrix-${randomUUID()}`],
        );
      }
      await db.query(
        `INSERT INTO "user" (id, name, email, email_verified, role, banned, two_factor_enabled, created_at, updated_at)
         VALUES ($1, $2, $3, true, NULL, false, false, $4, $4)`,
        [actor.id, `Team Matrix ${role}`, actor.email, now],
      );
      await db.query(
        `INSERT INTO person (id, user_id, organisation_id, side, display_name, active, is_placeholder, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, false, $6, $6)`,
        [
          actor.personId,
          actor.id,
          organisationId,
          role === "customer" ? "customer" : "staff",
          `Team Matrix ${role}`,
          now,
        ],
      );
      await db.query(
        `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES ($1, $2, 'credential', $2, $3, $4, $4)`,
        [randomUUID(), actor.id, await bcrypt.hash(actor.password, 4), now],
      );
      if (role === "customer") {
        await db.query(
          `INSERT INTO membership (id, person_id, scope, scope_id, role_id, sees_all, created_at, updated_at)
           VALUES ($1, $2, 'organisation', $3, $4, false, $5, $5)`,
          [randomUUID(), actor.personId, organisationId, customerRoleId, now],
        );
      }
      actors.push(actor);
    }
    return actors;
  } finally {
    await db.end();
  }
}

async function grantMatrixRoles(
  databaseUrl: string,
  workspaceId: string,
  actors: Actor[],
) {
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const owner = actors.find((actor) => actor.role === "owner");
    if (!owner) throw new Error("Matrix owner missing");
    for (const actor of actors) {
      if (actor.role === "owner" || actor.role === "customer") continue;
      const rows = await db.query<{ id: string; capabilities: string[] }>(
        `SELECT id, capabilities FROM "role" WHERE workspace_id = $1 AND key = $2 AND scope = 'workspace'`,
        [workspaceId, actor.role],
      );
      expect(rows.rows).toHaveLength(1);
      const storedRole = rows.rows[0];
      if (!storedRole) throw new Error("Canonical workspace role missing");
      expect([...storedRole.capabilities].sort()).toEqual(
        [...BUILT_IN_ROLES[actor.role].capabilities].sort(),
      );
      const membershipId = randomUUID();
      const now = new Date();
      await db.query(
        `INSERT INTO workspace_member (id, user_id, workspace_id, role, joined_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), actor.id, workspaceId, actor.role, now],
      );
      await db.query(
        `INSERT INTO membership (id, person_id, scope, scope_id, role_id, sees_all, created_at, updated_at)
         VALUES ($1, $2, 'workspace', $3, $4, false, $5, $5)`,
        [membershipId, actor.personId, workspaceId, storedRole.id, now],
      );
      await db.query(
        `INSERT INTO membership_grant (id, membership_id, person_id, scope, scope_id, role_id,
          source_kind, sees_all, direct_origin, granted_by_person_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'workspace', $4, $5, 'direct', false, 'admin', $6, $7, $7)`,
        [
          randomUUID(),
          membershipId,
          actor.personId,
          workspaceId,
          storedRole.id,
          owner.personId,
          now,
        ],
      );
    }
  } finally {
    await db.end();
  }
}

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => {
    const stored = JSON.parse(
      localStorage.getItem("user-preferences") ?? "{}",
    ) as {
      state?: Record<string, unknown>;
      version?: number;
    };
    localStorage.setItem(
      "user-preferences",
      JSON.stringify({
        ...stored,
        state: { ...stored.state, theme: value },
        version: stored.version ?? 0,
      }),
    );
  }, theme);
}

async function expectNoHorizontalOverflow(page: Page) {
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

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

async function requestJson<T>(
  page: Page,
  path: string,
  data?: Record<string, unknown>,
) {
  const result = await page.evaluate(
    async ({ path: url, data: body }) => {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (body !== undefined) {
        const issuer = await fetch("/api/me/csrf-token", {
          credentials: "same-origin",
        });
        if (!issuer.ok) return { status: issuer.status, body: null };
        const { token } = (await issuer.json()) as { token: string };
        headers["x-taskdesk-csrf"] = token;
      }
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    { path, data },
  );
  return { status: result.status, body: result.body as T };
}

type Item = { id: string; key: string };
type ItemDetail = { customFields: Array<{ key: string; value: unknown }> };

test("template defaults, overrides and clears persist across role, device and theme", async ({
  browser,
}, testInfo) => {
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
        const contexts = [];
        const evidence: Array<Record<string, unknown>> = [];
        try {
          const setupPage = await setup.newPage();
          await navigateToSetup(setupPage, setupUrl);
          await setupPage.getByLabel("Full name").fill("Template Matrix Setup");
          await setupPage.getByLabel("Email").fill(email);
          await setupPage
            .locator('input[autocomplete="new-password"]')
            .fill(password);
          await setupPage
            .getByRole("button", { name: "Create account" })
            .click();
          await enrollFirstAdmin(setupPage, origin, password);
          const actors = await seedMatrixActors(databaseUrl, email);
          const owner = actors.find((actor) => actor.role === "owner");
          if (!owner) throw new Error("Matrix owner missing");
          const workspace = await requestJson<{ id: string }>(
            setupPage,
            "/api/workspace",
            { name: "Template Matrix Workspace", ownerUserId: owner.id },
          );
          expect(workspace.status).toBe(200);
          const workspaceId = workspace.body.id;
          await grantMatrixRoles(databaseUrl, workspaceId, actors);
          const portal = new URL(origin);
          portal.hostname = "portal.localhost";
          const portalOrigin = portal.origin;
          const pages = new Map<Role, Page>();
          let signInRetried = false;
          for (const [index, actor] of actors.entries()) {
            // Seven actors need three windows under the shared sign-in limit.
            if (index === 3 || index === 6)
              await new Promise((done) => setTimeout(done, 12_000));
            const context = await browser.newContext({
              locale: "en-GB",
              timezoneId: "UTC",
              reducedMotion: "reduce",
            });
            contexts.push(context);
            const actorOrigin =
              actor.role === "customer" ? portalOrigin : origin;
            const signIn = () =>
              context.request.post(
                new URL("/api/auth/sign-in/email", actorOrigin).toString(),
                {
                  headers: { Origin: actorOrigin },
                  data: { email: actor.email, password: actor.password },
                },
              );
            let response = await signIn();
            if (response.status() === 429) {
              if (signInRetried)
                throw new Error(
                  "Actor setup exhausted its one auth rate-limit retry",
                );
              const delay = signInRetryDelay(response.headers());
              signInRetried = true;
              await response.dispose();
              await new Promise((done) => setTimeout(done, delay));
              response = await signIn();
            }
            expect(response.status(), `Real ${actor.role} sign-in`).toBe(200);
            const session = await context.request.get(
              new URL("/api/auth/get-session", actorOrigin).toString(),
            );
            expect(session.status()).toBe(200);
            const identity = (await session.json()) as {
              user: { id: string; role?: string | null };
              session: { portal: string };
            };
            expect(identity.session).toBeTruthy();
            expect(identity.user.id).toBe(actor.id);
            expect(
              identity.user.role === null ||
                identity.user.role === "user" ||
                (actor.role === "customer" && identity.user.role === undefined),
            ).toBe(true);
            expect(identity.session.portal).toBe(
              actor.role === "customer" ? "customer" : "agent",
            );
            if (actor.role === "customer") {
              expect(
                (await context.cookies(origin)).some(
                  (cookie) => cookie.name === "__Host-tdk_agent_session",
                ),
              ).toBe(false);
            } else {
              const instanceSettings = await context.request.get(
                new URL("/api/instance/settings", origin).toString(),
                { headers: { Origin: origin } },
              );
              expect(instanceSettings.status()).toBe(403);
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
                actorOrigin,
              ).toString(),
            );
            pages.set(actor.role, page);
          }
          const ownerPage = pages.get("owner");
          if (!ownerPage) throw new Error("Owner session missing");
          const slug = uniqueProjectKey(8);
          const project = await requestJson<{ id: string }>(
            ownerPage,
            "/api/project",
            { name: "Template Matrix", icon: "Folder", slug, workspaceId },
          );
          expect(project.status).toBe(200);
          const projectId = project.body.id;
          for (const role of ["lead", "member", "viewer"] as const) {
            const actor = actors.find((value) => value.role === role);
            if (!actor) throw new Error(`Missing ${role}`);
            const roleKey =
              role === "lead"
                ? "project-lead"
                : role === "member"
                  ? "project-member"
                  : "project-viewer";
            const grant = await requestJson(
              ownerPage,
              `/api/projects/${projectId}/members`,
              { personId: actor.personId, roleKey },
            );
            expect(grant.status, `Project reach for ${role}`).toBe(200);
          }
          const types = await requestJson<Array<{ id: string; key: string }>>(
            ownerPage,
            `/api/workspace/${workspaceId}/work-item-types`,
          );
          expect(types.status).toBe(200);
          const type = types.body.find((entry) => entry.key === "task");
          if (!type) throw new Error("Task type missing");
          const section = await requestJson<{ id: string }>(
            ownerPage,
            "/api/custom-field-sections",
            { workspaceId, name: "Template Matrix Fields" },
          );
          expect(section.status).toBe(200);
          for (const field of [
            { key: "matrix_required", name: "Matrix required", required: true },
            {
              key: "matrix_optional",
              name: "Matrix optional",
              required: false,
            },
          ]) {
            const created = await requestJson(ownerPage, "/api/custom-fields", {
              workspaceId,
              sectionId: section.body.id,
              key: field.key,
              name: field.name,
              format: "text",
              visibility: [
                {
                  workItemTypeId: type.id,
                  visible: true,
                  required: field.required,
                },
              ],
            });
            expect(created.status).toBe(200);
          }
          const template = await requestJson<{ id: string }>(
            ownerPage,
            `/api/workspace/${workspaceId}/work-item-templates`,
            {
              name: "Matrix template",
              typeId: type.id,
              title: "Matrix task",
              customFieldValues: {
                matrix_required: "Required default",
                matrix_optional: "Optional default",
              },
            },
          );
          expect(template.status).toBe(200);
          const createPath = `/api/projects/${encodeURIComponent(projectId)}/work-items`;
          const listUrl = new URL(
            `/agent/projects/${encodeURIComponent(slug)}/work?layout=list`,
            origin,
          ).toString();
          for (const role of ROLES) {
            const page = pages.get(role);
            if (!page) throw new Error(`Missing ${role} page`);
            for (const view of VIEWS) {
              await page.setViewportSize({
                width: view.width,
                height: view.height,
              });
              for (const theme of THEMES) {
                await setTheme(page, theme);
                await page.emulateMedia({ colorScheme: theme });
                if (role === "customer") {
                  await page.goto(
                    new URL("/projects", portalOrigin).toString(),
                  );
                  await expect(page.locator("html")).toHaveClass(
                    new RegExp(`\\b${theme}\\b`),
                  );
                  await expect(
                    page.getByRole("heading", {
                      name: "Projects",
                      exact: true,
                    }),
                  ).toBeVisible();
                  const agentApi = await page
                    .context()
                    .request.get(new URL(createPath, origin).toString());
                  expect(agentApi.status()).toBe(401);
                  const agentCreate = await page
                    .context()
                    .request.post(new URL(createPath, origin).toString(), {
                      headers: { Origin: origin },
                      data: {
                        typeId: type.id,
                        title: "Customer must not create agent work items",
                        templateId: template.body.id,
                      },
                    });
                  expect(agentCreate.status()).toBe(401);
                  await expectNoHorizontalOverflow(page);
                  await page.screenshot({
                    path: testInfo.outputPath(
                      `template-${role}-${view.name}-${theme}.png`,
                    ),
                  });
                  evidence.push({
                    role,
                    view: view.name,
                    theme,
                    agentStatus: agentApi.status(),
                    agentCreateStatus: agentCreate.status(),
                  });
                  continue;
                }
                await page.goto(listUrl);
                await expect(page.locator("html")).toHaveClass(
                  new RegExp(`\\b${theme}\\b`),
                );
                if (role === "viewer") {
                  await expect(
                    page.getByTestId("work-item-list-populated"),
                  ).toBeVisible();
                  const read = await requestJson(page, createPath);
                  expect(read.status).toBe(200);
                  const denied = await requestJson(page, createPath, {
                    typeId: type.id,
                    title: "Viewer must not create",
                    templateId: template.body.id,
                  });
                  expect(denied.status).toBe(403);
                  await expect(
                    page.getByTestId("create-work-item-trigger"),
                  ).toHaveCount(0);
                  await expectNoHorizontalOverflow(page);
                  await page.screenshot({
                    path: testInfo.outputPath(
                      `template-${role}-${view.name}-${theme}.png`,
                    ),
                  });
                  evidence.push({
                    role,
                    view: view.name,
                    theme,
                    createStatus: denied.status,
                  });
                  continue;
                }
                for (const scenario of [
                  "default",
                  "override",
                  "clear",
                ] as const) {
                  const keyboardJourney =
                    role === "owner" &&
                    view.name === "desktop" &&
                    theme === "light" &&
                    scenario === "default";
                  await page.goto(listUrl);
                  const create = page.getByTestId("create-work-item-trigger");
                  if (keyboardJourney) {
                    await create.focus();
                    await expect(create).toBeFocused();
                    await create.press("Enter");
                  } else await create.click();
                  const dialog = page.getByTestId("create-work-item-dialog");
                  await expect(dialog).toBeVisible();
                  const templateTrigger = dialog.getByTestId(
                    "create-work-item-template-trigger",
                  );
                  if (keyboardJourney) {
                    await expect(
                      dialog.getByTestId("create-work-item-title"),
                    ).toBeFocused();
                    await templateTrigger.focus();
                    await expect(templateTrigger).toBeFocused();
                    await templateTrigger.press("Enter");
                  } else await templateTrigger.click();
                  const templateOption = page.getByRole("button", {
                    name: "Matrix template",
                    exact: true,
                  });
                  if (keyboardJourney) {
                    await templateOption.focus();
                    await expect(templateOption).toBeFocused();
                    await templateOption.press("Enter");
                    await expect(templateTrigger).toBeFocused();
                  } else await templateOption.click();
                  await dialog
                    .getByTestId("create-work-item-title")
                    .fill(`${role} ${view.name} ${theme} ${scenario}`);
                  if (scenario === "override")
                    await dialog
                      .locator("#create-work-item-cf-matrix_required")
                      .fill("Explicit override");
                  if (scenario === "clear") {
                    const optional = dialog.locator(
                      "#create-work-item-cf-matrix_optional",
                    );
                    await optional.fill("temporary");
                    await optional.fill("");
                  }
                  const pending = page.waitForResponse(
                    (response) =>
                      new URL(response.url()).pathname === createPath &&
                      response.request().method() === "POST",
                  );
                  const submit = dialog.getByTestId("create-work-item-submit");
                  if (keyboardJourney) {
                    await submit.focus();
                    await expect(submit).toBeFocused();
                    await submit.press("Enter");
                  } else await submit.click();
                  const response = await pending;
                  expect(
                    response.status(),
                    `${role} ${view.name} ${theme} ${scenario}`,
                  ).toBe(200);
                  const item = (await response.json()) as Item;
                  await expect(dialog).toBeHidden();
                  const expectedRequired =
                    scenario === "override"
                      ? "Explicit override"
                      : "Required default";
                  const expectedOptional =
                    scenario === "clear" ? null : "Optional default";
                  const detail = await requestJson<ItemDetail>(
                    page,
                    `/api/work-items/${encodeURIComponent(item.key)}`,
                  );
                  expect(detail.status).toBe(200);
                  expect(
                    detail.body.customFields.find(
                      (field) => field.key === "matrix_required",
                    )?.value,
                  ).toBe(expectedRequired);
                  expect(
                    detail.body.customFields.find(
                      (field) => field.key === "matrix_optional",
                    )?.value ?? null,
                  ).toBe(expectedOptional);
                  await page.goto(
                    new URL(
                      `/agent/work-items/${encodeURIComponent(item.key)}`,
                      origin,
                    ).toString(),
                  );
                  await page.reload();
                  await expect(
                    page.locator("#work-item-cf-matrix_required"),
                  ).toHaveValue(expectedRequired);
                  await expect(
                    page.locator("#work-item-cf-matrix_optional"),
                  ).toHaveValue(expectedOptional ?? "");
                  if (keyboardJourney) {
                    const persisted = page.locator(
                      "#work-item-cf-matrix_required",
                    );
                    await persisted.focus();
                    await persisted.press("End");
                    await expect(persisted).toBeFocused();
                    await expect(persisted).toHaveValue(expectedRequired);
                  }
                  if (scenario === "clear") {
                    const required = page.locator(
                      "#work-item-cf-matrix_required",
                    );
                    const optional = page.locator(
                      "#work-item-cf-matrix_optional",
                    );
                    await required.focus();
                    await required.press("Tab");
                    await expect(optional).toBeFocused();
                    await optional.press("Shift+Tab");
                    await expect(required).toBeFocused();
                    await expect(required).toHaveValue(expectedRequired);
                    await expect(optional).toHaveValue(expectedOptional ?? "");
                    await expectNoHorizontalOverflow(page);
                    await page.screenshot({
                      path: testInfo.outputPath(
                        `template-${role}-${view.name}-${theme}.png`,
                      ),
                    });
                  }
                  evidence.push({
                    role,
                    view: view.name,
                    theme,
                    scenario,
                    item: item.key,
                    createStatus: response.status(),
                  });
                }
              }
            }
          }
          expect(evidence).toHaveLength(102);
          expect(
            new Set(
              evidence.map((cell) => `${cell.role}/${cell.view}/${cell.theme}`),
            ).size,
          ).toBe(42);
          for (const role of ROLES) {
            const records = evidence.filter((cell) => cell.role === role);
            expect(records).toHaveLength(
              role === "viewer" || role === "customer" ? 6 : 18,
            );
            expect(
              new Set(records.map((cell) => `${cell.view}/${cell.theme}`)).size,
            ).toBe(6);
          }
          await testInfo.attach("template-role-device-theme-matrix", {
            body: JSON.stringify(evidence, null, 2),
            contentType: "application/json",
          });
        } finally {
          await Promise.all(contexts.map((context) => context.close()));
          await setup.close();
        }
      },
      {
        beforeStart: seedPortalSupport,
        discardChildOutput: true,
        onContainerCreated: (id) => {
          containers.push(id);
          console.info(`Template matrix fixture container: ${id}`);
        },
      },
    );
  } finally {
    console.info(
      `Template matrix fixture containers created: ${containers.length ? containers.join(", ") : "none"}`,
    );
  }
});
