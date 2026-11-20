import { isDeepStrictEqual } from "node:util";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import {
  navigateToSetup,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { enrollFirstAdmin } from "./helpers/enroll-first-admin";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";
import {
  grantMatrixRoles,
  ROLES,
  seedMatrixActors,
  seedPortalSupport,
  signInRetryDelay,
} from "./project-key-role-fixture";
import {
  assertMembershipDatabaseBinding,
  seedUnbackedProjectMembership,
} from "./settings-history-membership-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const actorName = "Team Matrix owner";
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;
type Member = {
  id: string;
  personId: string;
  workspaceMemberId: string;
  role: string;
  name: string;
};
type Roster = {
  members: Array<{
    personId: string;
    membershipId: string | null;
    source: string;
    roleKey: string;
    displayName: string | null;
    managedExternally: boolean;
  }>;
};
type Row = {
  at: string;
  actor: { kind: string; name: string | null };
  action: string;
  changedFields: string[];
};
type History = {
  entityType: string;
  entityId: string;
  workspaceId: string | null;
  projectId: string | null;
  lastChanged: { at: string; actor: Row["actor"] } | null;
  rows: Row[];
};

async function get<T>(
  page: Page,
  path: string,
): Promise<{ status: number; body: T | null }> {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "same-origin" });
    return {
      status: response.status,
      body: response.ok ? await response.json() : null,
    };
  }, path);
}
async function mutate<T>(
  page: Page,
  method: "POST" | "PATCH",
  path: string,
  body: object,
): Promise<{ status: number; body: T | null }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const issuer = await fetch("/api/me/csrf-token", {
        credentials: "same-origin",
      });
      if (issuer.status !== 200)
        throw new Error("CSRF issuer failed before membership request");
      const data = (await issuer.json()) as { token?: string };
      if (!data.token)
        throw new Error(
          "CSRF issuer returned no token before membership request",
        );
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-csrf": data.token,
        },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: response.ok ? await response.json().catch(() => null) : null,
      };
    },
    { method, path, body },
  );
}
async function history(
  page: Page,
  type: "workspace_member" | "project_membership",
  id: string,
): Promise<History> {
  const query = new URLSearchParams({ entity_type: type, entity_id: id });
  const result = await get<History>(page, `/api/audit?${query}`);
  expect(result.status, "Current synthetic membership History GET").toBe(200);
  if (!result.body) throw new Error("History response absent");
  return result.body;
}
async function workspaceRole(page: Page, workspaceId: string, userId: string) {
  const result = await get<{ members: Member[] }>(
    page,
    `/api/workspace/${workspaceId}`,
  );
  expect(result.status, "Owner workspace role readback").toBe(200);
  const role = result.body?.members.find(
    (member) => member.id === userId,
  )?.role;
  if (!role) throw new Error("Synthetic workspace target absent on readback");
  return role;
}
async function projectRole(page: Page, projectId: string, personId: string) {
  const result = await get<Roster>(page, `/api/projects/${projectId}/members`);
  expect(result.status, "Owner project role readback").toBe(200);
  const role = result.body?.members.find(
    (member) => member.personId === personId,
  )?.roleKey;
  if (!role) throw new Error("Synthetic project target absent on readback");
  return role;
}
function closedHistory(
  data: History,
  type: History["entityType"],
  id: string,
  forbidden: string[],
) {
  expect(Object.keys(data).sort()).toEqual([
    "entityId",
    "entityType",
    "lastChanged",
    "projectId",
    "rows",
    "workspaceId",
  ]);
  expect(data.entityType).toBe(type);
  expect(data.entityId).toBe(id);
  const first = data.rows[0];
  if (!first) throw new Error("Role-change History row absent");
  expect(data.lastChanged).toEqual({ at: first.at, actor: first.actor });
  expect(first.action).toBe("membership.changed");
  expect(first.changedFields).toEqual(["role"]);
  expect(first.actor).toEqual({ kind: "person", name: actorName });
  expect(Number.isNaN(Date.parse(first.at))).toBe(false);
  for (const row of data.rows) {
    expect(Object.keys(row).sort()).toEqual([
      "action",
      "actor",
      "at",
      "changedFields",
    ]);
    expect(Object.keys(row.actor).sort()).toEqual(["kind", "name"]);
  }
  const text = JSON.stringify(data.rows);
  for (const value of forbidden)
    expect(text.includes(JSON.stringify(value))).toBe(false);
}
async function showHistory(
  page: Page,
  name: string,
  row: Row,
  id: string,
  testInfo: TestInfo,
  label: string,
) {
  const button = page.getByRole("button", {
    name: new RegExp(`^History for ${name} \\(`),
  });
  await expect(button).toBeVisible();
  await button.focus();
  await expect(button).toBeFocused();
  await button.press("Enter");
  const dialog = page.getByRole("dialog", { name: "History" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "History", exact: true }).click();
  const changed = dialog.getByText("Role changed", { exact: false }).first();
  await expect(changed).toBeVisible();
  await expect(dialog).toContainText("Role");
  await expect(dialog).not.toContainText(id);
  const rows = dialog.locator(".border-b");
  await expect(rows.first()).toContainText(actorName);
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(row.at));
  await expect(rows.first()).toContainText(formatted);
  await dialog.screenshot({
    mask: (await rows.all()).slice(1),
    path: testInfo.outputPath(`${label}.png`),
  });
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await expect(dialog).toBeHidden();
}

test("workspace and project membership role History persists with closed metadata and read permissions", async ({
  browser,
}, testInfo) => {
  test.setTimeout(1_200_000);
  await withMfaCsrfApp(
    async (fixture) => {
      assertMembershipDatabaseBinding(fixture);
      const { origin, email, password, setupUrl, databaseUrl } = fixture;
      const setup = await browser.newContext({
        viewport: viewports[0],
        locale: "en-US",
        timezoneId: "UTC",
        reducedMotion: "reduce",
      });
      const contexts = [];
      try {
        const setupPage = await setup.newPage();
        await navigateToSetup(setupPage, setupUrl);
        await setupPage
          .getByLabel("Full name")
          .fill("Disposable Membership Setup");
        await setupPage.getByLabel("Email").fill(email);
        await setupPage
          .locator('input[autocomplete="new-password"]')
          .fill(password);
        await setupPage.getByRole("button", { name: "Create account" }).click();
        await enrollFirstAdmin(setupPage, origin, password);
        const actors = await seedMatrixActors(databaseUrl, email);
        expect(ROLES.every((role) => Object.hasOwn(BUILT_IN_ROLES, role))).toBe(
          true,
        );
        const owner = actors.find((actor) => actor.role === "owner");
        if (!owner) throw new Error("Synthetic owner absent");
        const createdWorkspace = await mutate<{ id: string }>(
          setupPage,
          "POST",
          "/api/workspace",
          {
            name: "Disposable Membership History Workspace",
            ownerUserId: owner.id,
          },
        );
        expect(createdWorkspace.status).toBe(200);
        const workspaceId = createdWorkspace.body?.id;
        if (!workspaceId) throw new Error("Synthetic workspace ID absent");
        await grantMatrixRoles(databaseUrl, workspaceId, actors);
        const ownerContext = await browser.newContext({
          viewport: viewports[0],
          locale: "en-US",
          timezoneId: "UTC",
          reducedMotion: "reduce",
        });
        contexts.push(ownerContext);
        const signedIn = await ownerContext.request.post(
          new URL("/api/auth/sign-in/email", origin).toString(),
          {
            headers: { Origin: origin },
            data: { email: owner.email, password: owner.password },
          },
        );
        expect(signedIn.status()).toBe(200);
        const csrf = await ownerContext.request.get(
          new URL("/api/me/csrf-token", origin).toString(),
          { headers: { Origin: origin } },
        );
        expect(csrf.status()).toBe(200);
        const { token } = (await csrf.json()) as { token?: string };
        if (!token) throw new Error("Owner activation CSRF token absent");
        const activated = await ownerContext.request.post(
          new URL(`/api/workspace/${workspaceId}/activate`, origin).toString(),
          {
            headers: { Origin: origin, "x-taskdesk-csrf": token },
            data: {},
          },
        );
        expect(activated.status()).toBe(200);
        const page = await ownerContext.newPage();
        await page.goto(new URL("/agent", origin).toString());
        const target = actors.find((actor) => actor.role === "member");
        if (!target) throw new Error("Synthetic member actor absent");
        const at = (path: string) => new URL(path, origin).toString();
        const workspaceRoute = at("/dashboard/settings/workspace/members");
        const project = await mutate<{ id: string }>(
          page,
          "POST",
          "/api/project",
          {
            name: "Disposable Membership Project",
            icon: "Folder",
            slug: "HIST",
            workspaceId,
          },
        );
        expect(project.status).toBe(200);
        const projectId = project.body?.id;
        if (!projectId) throw new Error("Synthetic project ID absent");
        for (const role of ["lead", "member", "viewer"] as const) {
          const actor = actors.find((candidate) => candidate.role === role);
          if (!actor) throw new Error("Synthetic project actor absent");
          const added = await mutate<unknown>(
            page,
            "POST",
            `/api/projects/${projectId}/members`,
            { personId: actor.personId, roleKey: `project-${role}` },
          );
          expect(added.status).toBe(200);
        }
        const full = await get<{ members: Member[] }>(
          page,
          `/api/workspace/${workspaceId}`,
        );
        expect(full.status).toBe(200);
        const member = full.body?.members.find(
          (candidate) => candidate.id === target.id,
        );
        if (!member?.workspaceMemberId || member.personId !== target.personId)
          throw new Error("Workspace response did not bind target row ID");
        const beforeWorkspace = await history(
          page,
          "workspace_member",
          member.workspaceMemberId,
        );
        const workspaceRow = page
          .getByRole("row")
          .filter({ hasText: "Team Matrix member" });
        await page.goto(workspaceRoute);
        await expect(
          page.getByRole("heading", { name: "Members" }),
        ).toBeVisible();
        await expect(workspaceRow).toBeVisible();
        const changedWorkspace = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/workspace/${workspaceId}/members/${target.id}/role` &&
            response.request().method() === "PATCH",
        );
        void changedWorkspace.catch(() => {});
        await workspaceRow
          .getByRole("button", { name: "Member", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Viewer", exact: true })
          .last()
          .click();
        expect((await changedWorkspace).status()).toBe(200);
        const workspaceHistory = await history(
          page,
          "workspace_member",
          member.workspaceMemberId,
        );
        expect(workspaceHistory.rows.length).toBe(
          beforeWorkspace.rows.length + 1,
        );
        expect(workspaceHistory.workspaceId).toBe(workspaceId);
        expect(workspaceHistory.projectId).toBeNull();
        closedHistory(
          workspaceHistory,
          "workspace_member",
          member.workspaceMemberId,
          [
            member.workspaceMemberId,
            target.id,
            target.personId,
            "member",
            "viewer",
          ],
        );
        expect(
          (
            await mutate(
              page,
              "PATCH",
              `/api/workspace/${workspaceId}/members/${target.id}/role`,
              { role: "viewer" },
            )
          ).status,
        ).toBe(200);
        expect(
          isDeepStrictEqual(
            await history(page, "workspace_member", member.workspaceMemberId),
            workspaceHistory,
          ),
        ).toBe(true);
        expect(
          (
            await mutate(
              page,
              "PATCH",
              `/api/workspace/${workspaceId}/members/${target.id}/role`,
              { role: "owner" },
            )
          ).status,
        ).toBe(400);
        expect(await workspaceRole(page, workspaceId, target.id)).toBe(
          "viewer",
        );
        expect(
          isDeepStrictEqual(
            await history(page, "workspace_member", member.workspaceMemberId),
            workspaceHistory,
          ),
        ).toBe(true);
        await page.reload();
        await expect(
          workspaceRow.getByRole("button", { name: "Viewer", exact: true }),
        ).toBeVisible();
        for (const theme of ["light", "dark"] as const)
          for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            await page.evaluate((value) => {
              const state = JSON.parse(
                localStorage.getItem("user-preferences") ?? "{}",
              );
              localStorage.setItem(
                "user-preferences",
                JSON.stringify({
                  ...state,
                  state: { ...(state.state ?? {}), theme: value },
                  version: state.version ?? 0,
                }),
              );
            }, theme);
            await page.goto(workspaceRoute);
            await expect(page.locator("html")).toHaveClass(new RegExp(theme));
            await expect(workspaceRow).toBeVisible();
            await showHistory(
              page,
              "Team Matrix member",
              workspaceHistory.rows[0] ??
                (() => {
                  throw new Error("Workspace role row absent");
                })(),
              member.workspaceMemberId,
              testInfo,
              `workspace-membership-${viewport.name}-${theme}`,
            );
          }
        const rosterPath = `/api/projects/${projectId}/members`;
        const roster = await get<Roster>(page, rosterPath);
        expect(roster.status).toBe(200);
        const projectMember = roster.body?.members.find(
          (candidate) => candidate.personId === target.personId,
        );
        if (!projectMember?.membershipId || projectMember.source !== "direct")
          throw new Error(
            "Project roster did not bind direct membership row ID",
          );
        const projectHistoryBefore = await history(
          page,
          "project_membership",
          projectMember.membershipId,
        );
        const projectRoute = at(
          `/dashboard/settings/projects/${projectId}/members`,
        );
        await page.goto(projectRoute);
        const projectRow = page
          .getByRole("row")
          .filter({ hasText: "Team Matrix member" });
        await expect(projectRow).toBeVisible();
        const changedProject = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/projects/${projectId}/members/${target.personId}` &&
            response.request().method() === "PATCH",
        );
        void changedProject.catch(() => {});
        await projectRow
          .getByRole("button", { name: "Change role for Team Matrix member" })
          .click();
        await page
          .getByRole("button", { name: "Project viewer", exact: true })
          .click();
        expect((await changedProject).status()).toBe(200);
        const projectHistory = await history(
          page,
          "project_membership",
          projectMember.membershipId,
        );
        expect(projectHistory.rows.length).toBe(
          projectHistoryBefore.rows.length + 1,
        );
        expect(projectHistory.workspaceId).toBe(workspaceId);
        expect(projectHistory.projectId).toBe(projectId);
        closedHistory(
          projectHistory,
          "project_membership",
          projectMember.membershipId,
          [
            projectMember.membershipId,
            target.id,
            target.personId,
            "project-member",
            "project-viewer",
          ],
        );
        expect(
          (
            await mutate(
              page,
              "PATCH",
              `/api/projects/${projectId}/members/${target.personId}`,
              { roleKey: "project-viewer" },
            )
          ).status,
        ).toBe(200);
        expect(
          isDeepStrictEqual(
            await history(
              page,
              "project_membership",
              projectMember.membershipId,
            ),
            projectHistory,
          ),
        ).toBe(true);
        expect(
          (
            await mutate(
              page,
              "PATCH",
              `/api/projects/${projectId}/members/${target.personId}`,
              { roleKey: "invalid-role" },
            )
          ).status,
        ).toBe(422);
        expect(await projectRole(page, projectId, target.personId)).toBe(
          "project-viewer",
        );
        expect(
          isDeepStrictEqual(
            await history(
              page,
              "project_membership",
              projectMember.membershipId,
            ),
            projectHistory,
          ),
        ).toBe(true);
        await page.reload();
        await expect(projectRow).toContainText("Project viewer");
        await showHistory(
          page,
          "Team Matrix member",
          projectHistory.rows[0] ??
            (() => {
              throw new Error("Project role row absent");
            })(),
          projectMember.membershipId,
          testInfo,
          "project-membership-owner",
        );

        const external = actors.find((actor) => actor.role === "manager");
        if (!external) throw new Error("Synthetic non-direct actor absent");
        const unbackedId = await seedUnbackedProjectMembership(
          fixture,
          workspaceId,
          projectId,
          external.personId,
        );
        const unbackedRoster = await get<Roster>(page, rosterPath);
        const unbacked = unbackedRoster.body?.members.find(
          (candidate) => candidate.personId === external.personId,
        );
        expect(unbacked?.source).toBe("direct");
        expect(unbacked?.managedExternally).toBe(true);
        expect(unbacked?.membershipId).toBeNull();
        expect(
          (
            await get(
              page,
              `/api/audit?${new URLSearchParams({ entity_type: "project_membership", entity_id: unbackedId })}`,
            )
          ).status,
        ).toBe(404);
        await page.goto(projectRoute);
        const unbackedRow = page
          .getByRole("row")
          .filter({ hasText: "Team Matrix manager" });
        await expect(unbackedRow).toBeVisible();
        await expect(
          unbackedRow.getByRole("button", {
            name: /History for Team Matrix manager/,
          }),
        ).toHaveCount(0);

        // A child projects the parent's direct member as inherited, with no target row ID.
        const child = await mutate<{ id: string }>(
          page,
          "POST",
          "/api/project",
          {
            name: "Disposable Membership Child",
            icon: "Folder",
            slug: "HISC",
            workspaceId,
          },
        );
        expect(child.status).toBe(200);
        if (!child.body?.id)
          throw new Error("Synthetic child project ID absent");
        expect(
          (
            await mutate(
              page,
              "PATCH",
              `/api/projects/${child.body.id}/ownership`,
              { parentId: projectId },
            )
          ).status,
        ).toBe(200);
        const childRoster = await get<Roster>(
          page,
          `/api/projects/${child.body.id}/members`,
        );
        expect(childRoster.status).toBe(200);
        const inherited = childRoster.body?.members.find(
          (candidate) => candidate.personId === target.personId,
        );
        expect(inherited?.source).toBe("inherited");
        expect(inherited?.membershipId).toBeNull();
        await page.goto(
          at(`/dashboard/settings/projects/${child.body.id}/members`),
        );
        const inheritedRow = page
          .getByRole("row")
          .filter({ hasText: "Team Matrix member" });
        await expect(inheritedRow).toContainText("Inherited");
        await expect(
          inheritedRow.getByRole("button", {
            name: /History for Team Matrix member/,
          }),
        ).toHaveCount(0);
        expect(
          (
            await get(
              page,
              `/api/audit?${new URLSearchParams({ entity_type: "project_membership", entity_id: target.personId })}`,
            )
          ).status,
        ).toBe(404);

        const isolated = await browser.newContext();
        try {
          const createdKey = await mutate<{ key: string }>(
            page,
            "POST",
            "/api/me/api-keys",
            { name: "Synthetic Membership History Key" },
          );
          expect(createdKey.status).toBe(201);
          const key = createdKey.body?.key;
          if (!key) throw new Error("Synthetic personal key absent");
          const query = new URLSearchParams({
            entity_type: "workspace_member",
            entity_id: member.workspaceMemberId,
          });
          const keyDenied = await isolated.request.get(
            at(`/api/audit?${query}`),
            { headers: { authorization: `Bearer ${key}` } },
          );
          expect(keyDenied.status()).toBe(403);
          const wrongHost = new URL(origin);
          wrongHost.hostname = "portal.localhost";
          const portalDenied = await setup.request.get(
            new URL(`/api/audit?${query}`, wrongHost).toString(),
          );
          expect([401, 403, 404]).toContain(portalDenied.status());
        } finally {
          await isolated.close();
        }

        // Separate real sessions prove source-read admission; a role picker is not evidence of History read rights.
        let retried = false;
        for (const [index, actor] of actors.entries()) {
          if (actor.role === "owner") continue; // The owner journey above uses this actor.
          if (index === 3 || index === 6)
            await new Promise((resolve) => setTimeout(resolve, 12_000));
          const context = await browser.newContext({
            locale: "en-US",
            timezoneId: "UTC",
            reducedMotion: "reduce",
          });
          contexts.push(context);
          const portal = new URL(origin);
          portal.hostname = "portal.localhost";
          const actorOrigin =
            actor.role === "customer" ? portal.origin : origin;
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
            if (retried)
              throw new Error("Actor sign-in exhausted one advertised retry");
            retried = true;
            const delay = signInRetryDelay(response.headers());
            await response.dispose();
            await new Promise((resolve) => setTimeout(resolve, delay));
            response = await signIn();
          }
          expect(response.status()).toBe(200);
          if (actor.role !== "customer") {
            const issued = await context.request.get(
              new URL("/api/me/csrf-token", origin).toString(),
              { headers: { Origin: origin } },
            );
            if (issued.status() !== 200)
              throw new Error("Actor activation CSRF issuer failed");
            const { token } = (await issued.json()) as { token?: string };
            if (!token) throw new Error("Actor activation CSRF token absent");
            const activation = await context.request.post(
              new URL(
                `/api/workspace/${workspaceId}/activate`,
                origin,
              ).toString(),
              {
                headers: { Origin: origin, "x-taskdesk-csrf": token },
                data: {},
              },
            );
            expect(activation.status()).toBe(200);
          }
          const actorPage = await context.newPage();
          const workspaceRead = await context.request.get(
            new URL(
              `/api/audit?${new URLSearchParams({ entity_type: "workspace_member", entity_id: member.workspaceMemberId })}`,
              actorOrigin,
            ).toString(),
          );
          const projectRead = await context.request.get(
            new URL(
              `/api/audit?${new URLSearchParams({ entity_type: "project_membership", entity_id: projectMember.membershipId })}`,
              actorOrigin,
            ).toString(),
          );
          const workspaceCap =
            actor.role !== "customer" &&
            BUILT_IN_ROLES[actor.role].capabilities.includes("workspace:read");
          const projectCap =
            actor.role !== "customer" &&
            BUILT_IN_ROLES[actor.role].capabilities.includes("project:read");
          expect(workspaceRead.status()).toBe(workspaceCap ? 200 : 404);
          expect(projectRead.status()).toBe(projectCap ? 200 : 404);
          if (workspaceCap) {
            await actorPage.goto(
              new URL(
                "/dashboard/settings/workspace/members",
                origin,
              ).toString(),
            );
            await expect(
              actorPage.getByRole("heading", { name: "Members" }),
            ).toBeVisible();
            const row = actorPage
              .getByRole("row")
              .filter({ hasText: "Team Matrix member" });
            await expect(
              row.getByRole("button", {
                name: /History for Team Matrix member/,
              }),
            ).toBeVisible();
            await row
              .getByRole("button", { name: /History for Team Matrix member/ })
              .click();
            const dialog = actorPage.getByRole("dialog", { name: "History" });
            await expect(dialog).toBeVisible();
            await dialog
              .getByRole("button", { name: "History", exact: true })
              .click();
            await expect(
              dialog.getByText("Role changed").first(),
            ).toBeVisible();
            await dialog.getByRole("button", { name: "Close" }).first().click();
            if (
              !BUILT_IN_ROLES[actor.role].capabilities.includes(
                "workspace:manage_members",
              )
            ) {
              await expect(
                row.getByRole("button", { name: "Viewer", exact: true }),
              ).toHaveCount(0);
              expect(
                (
                  await mutate(
                    actorPage,
                    "PATCH",
                    `/api/workspace/${workspaceId}/members/${target.id}/role`,
                    { role: "member" },
                  )
                ).status,
              ).toBe(403);
              expect(await workspaceRole(page, workspaceId, target.id)).toBe(
                "viewer",
              );
            }
          }
          if (projectCap) {
            await actorPage.goto(projectRoute);
            const row = actorPage
              .getByRole("row")
              .filter({ hasText: "Team Matrix member" });
            await expect(
              row.getByRole("button", {
                name: /History for Team Matrix member/,
              }),
            ).toBeVisible();
            await row
              .getByRole("button", { name: /History for Team Matrix member/ })
              .click();
            const dialog = actorPage.getByRole("dialog", { name: "History" });
            await expect(dialog).toBeVisible();
            await dialog
              .getByRole("button", { name: "History", exact: true })
              .click();
            await expect(
              dialog.getByText("Role changed").first(),
            ).toBeVisible();
            await dialog.getByRole("button", { name: "Close" }).first().click();
            if (
              !BUILT_IN_ROLES[actor.role].capabilities.includes(
                "project:manage_members",
              )
            ) {
              await expect(
                row.getByRole("button", {
                  name: "Change role for Team Matrix member",
                }),
              ).toHaveCount(0);
              expect(
                (
                  await mutate(
                    actorPage,
                    "PATCH",
                    `/api/projects/${projectId}/members/${target.personId}`,
                    { roleKey: "project-member" },
                  )
                ).status,
              ).toBe(403);
              expect(await projectRole(page, projectId, target.personId)).toBe(
                "project-viewer",
              );
            }
          }
        }
        expect(
          isDeepStrictEqual(
            await history(page, "workspace_member", member.workspaceMemberId),
            workspaceHistory,
          ),
        ).toBe(true);
        expect(
          isDeepStrictEqual(
            await history(
              page,
              "project_membership",
              projectMember.membershipId,
            ),
            projectHistory,
          ),
        ).toBe(true);
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
        await setup.close();
      }
    },
    { discardChildOutput: true, beforeStart: seedPortalSupport },
  );
});
