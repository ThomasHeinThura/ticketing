import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Browser,
  expect,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { fillSensitive } from "../../../tests/e2e/helpers/fill-sensitive";
import {
  type MfaCsrfAppFixtureSetup,
  navigateToSetup,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import {
  createFirstWorkspace,
  enrollFirstAdmin,
} from "./helpers/enroll-first-admin";
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
type Team = { id: string; name: string; canManageTeam: boolean };
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
      `team-matrix-${script}`,
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
        email: `team-matrix-${role}-${randomUUID()}@example.test`,
        password: randomUUID(),
      };
      const now = new Date();
      let organisationId = internalOrganisationId;
      if (role === "customer") {
        organisationId = randomUUID();
        await db.query(
          `INSERT INTO organisation (id, key, name, is_internal, portal_access, default_customer_visibility)
           VALUES ($1, $2, 'Disposable customer organisation', false, true, 'organisation')`,
          [organisationId, `team-matrix-${randomUUID()}`],
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

async function captureRoleMatrix(
  browser: Browser,
  setupPage: Page,
  origin: string,
  databaseUrl: string,
  adminEmail: string,
  testInfo: TestInfo,
) {
  const actors = await seedMatrixActors(databaseUrl, adminEmail);
  const owner = actors.find((actor) => actor.role === "owner");
  if (!owner) throw new Error("Matrix owner missing");
  const workspace = await requestJson<{ id: string }>(
    setupPage,
    "/api/workspace",
    {
      name: "Independent Team Matrix Workspace",
      ownerUserId: owner.id,
    },
  );
  expect(workspace.status).toBe(200);
  const workspaceId = workspace.body.id;
  await grantMatrixRoles(databaseUrl, workspaceId, actors);
  const contexts = [];
  const pages = new Map<Role, Page>();
  const records: Array<Record<string, unknown>> = [];
  const portal = new URL(origin);
  portal.hostname = "portal.localhost";
  const portalOrigin = portal.origin;
  let signInRetried = false;
  try {
    for (const actor of actors) {
      const context = await browser.newContext({
        locale: "en-GB",
        timezoneId: "UTC",
        reducedMotion: "reduce",
      });
      contexts.push(context);
      const actorOrigin = actor.role === "customer" ? portalOrigin : origin;
      const signIn = () =>
        context.request.post(
          new URL("/api/auth/sign-in/email", actorOrigin).toString(),
          {
            headers: { Origin: actorOrigin },
            data: { email: actor.email, password: actor.password },
          },
        );
      let signedIn = await signIn();
      if (signedIn.status() === 429) {
        if (signInRetried)
          throw new Error(
            "Actor setup exhausted its one auth rate-limit retry",
          );
        const delayMs = signInRetryDelay(signedIn.headers());
        signInRetried = true;
        await signedIn.dispose();
        await new Promise((done) => setTimeout(done, delayMs));
        signedIn = await signIn();
      }
      expect(signedIn.status(), `Real ${actor.role} sign-in`).toBe(200);
      const session = await context.request.get(
        new URL("/api/auth/get-session", actorOrigin).toString(),
      );
      expect(session.status()).toBe(200);
      const identity = (await session.json()) as {
        user: { id: string; role?: string | null };
        session: unknown;
      };
      expect(Boolean(identity.session)).toBe(true);
      expect(identity.user.id === actor.id).toBe(true);
      expect(identity.user.role ?? null).toBeNull();
      if (actor.role === "customer") {
        expect(
          (await context.cookies(origin)).some(
            (cookie) => cookie.name === "__Host-tdk_agent_session",
          ),
        ).toBe(false);
      }
      if (actor.role !== "customer") {
        const csrf = await context.request.get(
          new URL("/api/me/csrf-token", origin).toString(),
          {
            headers: { Origin: origin },
          },
        );
        expect(csrf.status()).toBe(200);
        const { token } = (await csrf.json()) as { token: string };
        const activated = await context.request.post(
          new URL(`/api/workspace/${workspaceId}/activate`, origin).toString(),
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
    const probe = await requestJson<Team>(ownerPage, "/api/teams", {
      workspaceId,
      name: "Independent Owner Matrix Team",
    });
    expect(probe.status).toBe(200);
    for (const role of [
      "lead",
      "member",
      "viewer",
      "customer",
      "owner",
      "admin",
    ] as const) {
      const page = pages.get(role);
      if (!page) throw new Error("Matrix session missing");
      const expectedManagement = role === "owner" || role === "admin";
      let team = probe.body;
      if (role === "admin") {
        const created = await requestJson<Team>(page, "/api/teams", {
          workspaceId,
          name: "Independent Admin Matrix Team",
        });
        expect(created.status).toBe(200);
        team = created.body;
      }
      const path = `/api/teams/${encodeURIComponent(team.id)}`;
      const detail = `/dashboard/settings/workspace/teams/${encodeURIComponent(team.id)}`;
      const proofRequests: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          request.method() === "POST" &&
          /^\/api\/me\/step-up(?:\/|$)/.test(url.pathname)
        )
          proofRequests.push(url.pathname);
      });
      let manageWorkspaceSettings: boolean | null = null;
      let canManageTeam: boolean | null = null;
      if (role !== "customer") {
        const capabilities = await requestJson<{
          manageWorkspaceSettings: boolean;
        }>(
          page,
          `/api/capabilities?workspaceId=${encodeURIComponent(workspaceId)}`,
        );
        expect(capabilities.status).toBe(200);
        manageWorkspaceSettings = capabilities.body.manageWorkspaceSettings;
        expect(manageWorkspaceSettings).toBe(expectedManagement);
        const read = await requestJson<Team>(page, path);
        expect(read.status).toBe(200);
        expect(read.body.canManageTeam).toBe(expectedManagement);
        canManageTeam = read.body.canManageTeam;
      }
      for (const view of VIEWS) {
        await page.setViewportSize({ width: view.width, height: view.height });
        for (const theme of THEMES) {
          await setTheme(page, theme);
          await page.emulateMedia({ colorScheme: theme });
          await page.goto(
            new URL(
              role === "customer" ? "/projects" : detail,
              role === "customer" ? portalOrigin : origin,
            ).toString(),
          );
          await expect(page.locator("html")).toHaveClass(
            new RegExp(`\\b${theme}\\b`),
          );
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          const trigger = page.getByRole("button", {
            name: "Delete team",
            exact: true,
          });
          if (role === "customer") {
            const projects = await page.request.get(
              new URL("/api/portal/projects", portalOrigin).toString(),
            );
            expect(projects.status()).toBe(200);
            const agentRead = await page.request.get(
              new URL(path, origin).toString(),
            );
            expect(agentRead.status()).toBe(401);
            const agentDelete = await page.request.delete(
              new URL(path, origin).toString(),
              { headers: { Origin: origin } },
            );
            expect(agentDelete.status()).toBe(401);
            await expect(trigger).toHaveCount(0);
          } else if (!expectedManagement) {
            await expect(trigger).toHaveCount(0);
            const denied = await page.evaluate(async (url) => {
              const issuer = await fetch("/api/me/csrf-token");
              const { token } = (await issuer.json()) as { token: string };
              return (
                await fetch(url, {
                  method: "DELETE",
                  headers: { "x-taskdesk-csrf": token },
                })
              ).status;
            }, path);
            expect(denied).toBe(403);
            expect((await requestJson(page, path)).status).toBe(200);
          } else {
            await expect(trigger).toBeEnabled();
            await trigger.scrollIntoViewIfNeeded();
          }
          await page.screenshot({
            path: testInfo.outputPath(
              `matrix-${role}-${view.name}-${theme}-screen.png`,
            ),
          });
          if (expectedManagement) {
            const pending = page.waitForResponse(
              (response) =>
                new URL(response.url()).pathname === path &&
                response.request().method() === "DELETE",
            );
            await trigger.click();
            const response = await pending;
            expect(response.status()).toBe(202);
            const action = (await response.json()) as {
              pendingActionId: string;
              confirmation: string;
            };
            expect(action.confirmation).toBe("typed_name");
            const dialog = page.getByRole("dialog", {
              name: "Delete team",
              exact: true,
            });
            const input = dialog.getByLabel("Type the exact name to confirm");
            const approve = dialog.getByRole("button", {
              name: "Delete",
              exact: true,
            });
            await expect(approve).toBeDisabled();
            for (const name of [team.name.toLowerCase(), `${team.name} `]) {
              await input.fill(name);
              await expect(approve).toBeDisabled();
            }
            await expect(dialog.locator('input[type="password"]')).toHaveCount(
              0,
            );
            await input.fill(team.name);
            await expect(approve).toBeEnabled();
            await input.press("Tab");
            await expect(approve).toBeFocused();
            await expect(approve).toBeInViewport();
            await page.screenshot({
              path: testInfo.outputPath(
                `matrix-${role}-${view.name}-${theme}-confirmation.png`,
              ),
            });
            await page.keyboard.press("Escape");
            await expect(dialog).toBeHidden();
            await expect(trigger).toBeFocused();
            const cancelled = await requestJson(
              page,
              `/api/me/pending-actions/${action.pendingActionId}/cancel`,
              {},
            );
            expect(cancelled.status).toBe(200);
          }
          records.push({
            role,
            view: view.name,
            theme,
            manageWorkspaceSettings,
            canManageTeam,
            expectedDeleteAllowed: expectedManagement,
            surface:
              role === "customer"
                ? "portal-projects-agent-denied"
                : "team-detail",
          });
        }
      }
      if (expectedManagement) {
        const pending = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === path &&
            response.request().method() === "DELETE",
        );
        await page
          .getByRole("button", { name: "Delete team", exact: true })
          .click();
        const pendingResponse = await pending;
        expect(pendingResponse.status()).toBe(202);
        const { pendingActionId } = (await pendingResponse.json()) as {
          pendingActionId: string;
        };
        const dialog = page.getByRole("dialog", {
          name: "Delete team",
          exact: true,
        });
        await dialog
          .getByLabel("Type the exact name to confirm")
          .fill(team.name);
        const approved = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/me/pending-actions/${pendingActionId}/approve` &&
            response.request().method() === "POST",
        );
        await dialog.getByLabel("Type the exact name to confirm").press("Tab");
        await expect(
          dialog.getByRole("button", { name: "Delete", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Enter");
        const executed = await approved;
        expect(executed.status()).toBe(200);
        expect(((await executed.json()) as { state: string }).state).toBe(
          "executed",
        );
        await expect(dialog).toBeHidden();
        await expect(page).toHaveURL(
          new URL("/dashboard/settings/workspace/teams", origin).toString(),
        );
        expect((await requestJson(page, path)).status).toBe(404);
        await page.reload();
        await expect(page.getByRole("link", { name: team.name })).toHaveCount(
          0,
        );
        expect((await requestJson(page, path)).status).toBe(404);
      }
      expect(proofRequests).toEqual([]);
    }
    expect(records).toHaveLength(ROLES.length * VIEWS.length * THEMES.length);
    await testInfo.attach("team-deletion-effective-role-matrix", {
      body: Buffer.from(JSON.stringify(records, null, 2)),
      contentType: "application/json",
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}

test("auth retry accepts only the server's bounded delay headers", () => {
  expect(signInRetryDelay({ "retry-after": "1" })).toBe(1000);
  expect(signInRetryDelay({ "x-retry-after": "10" })).toBe(10_000);
  for (const value of [
    undefined,
    "",
    "0",
    "-1",
    "1.5",
    "11",
    "NaN",
    "Infinity",
    "1e1",
    " 5 ",
  ]) {
    expect(() =>
      signInRetryDelay(value === undefined ? {} : { "x-retry-after": value }),
    ).toThrow();
  }
  expect(() =>
    signInRetryDelay({ "retry-after": "bad", "x-retry-after": "1" }),
  ).toThrow();
});

test("team deletion requires its exact name in the shared dialog and refuses direct click bypasses", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const containers: string[] = [];
  try {
    await withMfaCsrfApp(
      async ({ origin, email, password, setupUrl, databaseUrl }) => {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          locale: "en-GB",
          timezoneId: "UTC",
          colorScheme: "dark",
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          await navigateToSetup(page, setupUrl);
          await page
            .getByLabel("Full name")
            .fill("Team Deletion Journey Admin");
          await page.getByLabel("Email").fill(email);
          await fillSensitive(
            page.locator('input[autocomplete="new-password"]'),
            password,
          );
          await page.getByRole("button", { name: "Create account" }).click();
          await enrollFirstAdmin(page, origin, password);
          const workspaceId = await createFirstWorkspace(
            page,
            "Team Deletion Journey Workspace",
          );
          const teamName = "Disposable Support Team";
          const created = await requestJson<{ id: string; name: string }>(
            page,
            "/api/teams",
            { workspaceId, name: teamName },
          );
          expect(created.status).toBe(200);
          expect(created.body.name).toBe(teamName);
          const teamPath = `/api/teams/${encodeURIComponent(created.body.id)}`;
          const teamsPath = `/api/teams?workspaceId=${encodeURIComponent(workspaceId)}`;
          const detailPath = `/dashboard/settings/workspace/teams/${encodeURIComponent(created.body.id)}`;
          const proofRequests: string[] = [];
          page.on("request", (request) => {
            const path = new URL(request.url()).pathname;
            if (
              request.method() === "POST" &&
              (path === "/api/me/step-up" ||
                path.startsWith("/api/me/step-up/"))
            )
              proofRequests.push(path);
          });
          await page.goto(new URL(detailPath, origin).toString());
          await expect(
            page.getByRole("heading", { name: teamName, exact: true }),
          ).toBeVisible();
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
          const trigger = page.getByRole("button", {
            name: "Delete team",
            exact: true,
          });
          await expect(trigger).toBeEnabled();
          await expect(
            page.locator('[data-slot="card"]').filter({ has: trigger }),
          ).toHaveClass(/border-destructive\/32/);
          await trigger.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: testInfo.outputPath("team-danger-zone-desktop-dark.png"),
          });

          const openDeletion = async () => {
            const pending = page.waitForResponse(
              (response) =>
                new URL(response.url()).pathname === teamPath &&
                response.request().method() === "DELETE",
            );
            await trigger.click();
            const requested = await pending;
            expect(requested.status()).toBe(202);
            const action = (await requested.json()) as {
              pendingActionId: string;
              confirmation: string;
              summary: { name: string };
            };
            expect(action.confirmation).toBe("typed_name");
            expect(action.summary.name).toBe(teamName);
            return action.pendingActionId;
          };
          const cancelledId = await openDeletion();
          const dialog = page.getByRole("dialog", {
            name: "Delete team",
            exact: true,
          });
          await expect(
            dialog.getByRole("heading", { name: "Delete team" }),
          ).toBeVisible();
          const cancelResponse = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                `/api/me/pending-actions/${cancelledId}/cancel` &&
              response.request().method() === "POST",
          );
          await dialog.getByRole("button", { name: "Cancel request" }).click();
          expect((await cancelResponse).status()).toBe(200);
          await expect(dialog).toBeHidden();
          await expect(trigger).toBeFocused();
          expect((await requestJson(page, teamPath)).status).toBe(200);
          const cancelledToast = page.getByText("Deletion request cancelled.", {
            exact: true,
          });
          await expect(cancelledToast).toBeVisible();
          await expect(cancelledToast).toBeHidden({ timeout: 10_000 });

          const pendingId = await openDeletion();
          const input = dialog.getByLabel("Type the exact name to confirm");
          const approve = dialog.getByRole("button", {
            name: "Delete",
            exact: true,
          });
          await expect(input).toHaveValue("");
          await expect(approve).toBeDisabled();
          for (const value of [teamName.toLowerCase(), `${teamName} `]) {
            await input.fill(value);
            await expect(approve).toBeDisabled();
          }
          await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
          const approvePath = `/api/me/pending-actions/${pendingId}/approve`;
          for (const bypass of [
            {},
            { click: true },
            { typedName: teamName.toLowerCase() },
            { typedName: `${teamName} ` },
          ]) {
            expect((await requestJson(page, approvePath, bypass)).status).toBe(
              400,
            );
            expect((await requestJson(page, teamPath)).status).toBe(200);
            const action = await requestJson<{ state: string }>(
              page,
              `/api/me/pending-actions/${pendingId}`,
            );
            expect(action.status).toBe(200);
            expect(action.body.state).toBe("pending");
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.emulateMedia({ colorScheme: "dark" });
          await expect(input).toBeVisible();
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
          await page.screenshot({
            path: testInfo.outputPath("team-name-required-mobile-dark.png"),
          });
          await input.fill(teamName);
          await expect(approve).toBeEnabled();
          const approved = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === approvePath &&
              response.request().method() === "POST",
          );
          await input.press("Tab");
          await expect(approve).toBeFocused();
          await expect(approve).toBeInViewport();
          await page.screenshot({
            path: testInfo.outputPath("team-exact-name-ready-mobile-dark.png"),
          });
          await page.keyboard.press("Enter");
          const response = await approved;
          expect(response.status()).toBe(200);
          expect(((await response.json()) as { state: string }).state).toBe(
            "executed",
          );
          await expect(dialog).toBeHidden();
          await expect(page).toHaveURL(
            new URL("/dashboard/settings/workspace/teams", origin).toString(),
          );
          expect((await requestJson(page, teamPath)).status).toBe(404);
          const teams = await requestJson<{
            data: Array<{ id: string }>;
          }>(page, teamsPath);
          expect(teams.status).toBe(200);
          expect(teams.body.data.map((team) => team.id)).not.toContain(
            created.body.id,
          );
          await page.reload();
          await expect(page.getByRole("link", { name: teamName })).toHaveCount(
            0,
          );
          expect((await requestJson(page, teamPath)).status).toBe(404);
          expect(proofRequests).toEqual([]);
          await page.screenshot({
            path: testInfo.outputPath("team-deleted-reloaded-mobile-dark.png"),
          });
          await captureRoleMatrix(
            browser,
            page,
            origin,
            databaseUrl,
            email,
            testInfo,
          );
        } finally {
          await context.close();
        }
      },
      {
        beforeStart: seedPortalSupport,
        discardChildOutput: true,
        onContainerCreated: (id) => {
          containers.push(id);
          console.info(`Team deletion fixture container: ${id}`);
        },
      },
    );
  } finally {
    console.info(
      `Team deletion fixture containers created: ${containers.length ? containers.join(", ") : "none"}`,
    );
  }
});
