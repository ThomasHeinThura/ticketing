import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  totpForUri,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

test.use({ trace: "off", video: "off", screenshot: "off" });

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(repoRoot, "apps/api/package.json"));
type FixturePgClient = {
  connect(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rowCount: number | null; rows: T[] }>;
  end(): Promise<void>;
};
const { Client } = apiRequire("pg") as {
  Client: new (options: { connectionString: string }) => FixturePgClient;
};

type UserTarget = {
  id: string;
  personId: string;
  name: string;
  email: string;
  sessionId?: string;
  apiKeyId?: string;
  membershipId?: string;
  membershipGrantId?: string;
};

async function createAdminWorkspace(
  page: Page,
  origin: string,
  email: string,
  password: string,
) {
  await page.goto(new URL("/auth/sign-up", origin).toString());
  await page.getByLabel("Full name").fill("Disposable Users Administrator");
  await page.getByLabel("Email").fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(password);
  const signUpPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/sign-up/email" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create account" }).click();
  expect((await signUpPromise).status()).toBe(200);
  await expect(page).toHaveURL(/\/onboarding(?:\?|$)/u);
  await page.getByLabel("Workspace name").fill("Disposable Users Workspace");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard\/workspace\//u);
}

async function enrollFactor(page: Page, origin: string, password: string) {
  await page.goto(
    new URL("/dashboard/settings/account/security", origin).toString(),
  );
  await page.locator("#factor-password").fill(password);
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const provisioningUri =
    (await page.locator("code").textContent())?.trim() ?? "";
  expect(provisioningUri.startsWith("otpauth://totp/")).toBe(true);
  await page.locator("#enrollment-code").fill(totpForUri(provisioningUri));
  await page.getByRole("button", { name: "Verify and enable" }).click();
  const saveCodesButton = page.getByRole("button", {
    name: "I saved these codes",
  });
  await expect(saveCodesButton).toBeVisible();
  const backupCodeItems = page.locator('[role="alert"] li');
  await expect
    .poll(() => backupCodeItems.count(), {
      message: "Authenticator enrollment backup codes were not rendered",
    })
    .toBeGreaterThanOrEqual(3);
  const backupCodes = await backupCodeItems.allTextContents();
  expect(backupCodes.length).toBeGreaterThanOrEqual(3);
  await saveCodesButton.click();
  await expect(saveCodesButton).toBeHidden();
  return {
    provisioningUri,
    backupCodes: backupCodes.map((code) => code.trim()),
  };
}

test.afterEach(({ page: _page }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

async function signInWithTotp(
  page: Page,
  origin: string,
  email: string,
  password: string,
  provisioningUri: string,
) {
  await page.goto("about:blank");
  const signOut = await page.request.post(
    new URL("/api/auth/sign-out", origin).toString(),
    { headers: { Origin: origin }, data: {} },
  );
  expect(signOut.status()).toBe(200);
  await page.goto(new URL("/auth/sign-in", origin).toString());
  await page.getByLabel("Email").fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/auth\/two-factor(?:\?|$)/u);
  await page.locator("#factor-code").fill(totpForUri(provisioningUri));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\/|\?|$)/u);
}

async function seedTargets(
  databaseUrl: string,
  adminEmail: string,
): Promise<{ deactivation: UserTarget; staleGrant: UserTarget }> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const adminPerson = await client.query<{
      organisation_id: string;
      person_id: string;
      workspace_id: string;
    }>(
      `SELECT p.organisation_id, p.id AS person_id, wm.workspace_id
         FROM person AS p
         JOIN "user" AS u ON u.id = p.user_id
         JOIN workspace_member AS wm ON wm.user_id = u.id
        WHERE u.email = $1 AND p.side = 'staff' AND p.active = true
        ORDER BY wm.joined_at
        LIMIT 1`,
      [adminEmail],
    );
    expect(adminPerson.rowCount).toBe(1);
    const organisationId = adminPerson.rows[0]?.organisation_id;
    const adminPersonId = adminPerson.rows[0]?.person_id;
    const workspaceId = adminPerson.rows[0]?.workspace_id;
    expect(organisationId).toBeTruthy();
    expect(adminPersonId).toBeTruthy();
    expect(workspaceId).toBeTruthy();

    const createTarget = async (
      label: string,
      withCredentials: boolean,
    ): Promise<UserTarget> => {
      const suffix = randomUUID();
      const target: UserTarget = {
        id: `users-journey-${suffix}`,
        personId: `users-journey-person-${suffix}`,
        name: `Users Journey ${label}`,
        email: `users-journey-${label.toLowerCase()}-${suffix}@example.test`,
      };
      const now = new Date();
      await client.query(
        `INSERT INTO "user"
           (id, name, email, email_verified, role, banned, two_factor_enabled,
            created_at, updated_at)
         VALUES ($1, $2, $3, true, NULL, false, false, $4, $4)`,
        [target.id, target.name, target.email, now],
      );
      await client.query(
        `INSERT INTO person
           (id, user_id, organisation_id, side, display_name, active,
            is_placeholder, created_at, updated_at)
         VALUES ($1, $2, $3, 'staff', $4, true, false, $5, $5)`,
        [target.personId, target.id, organisationId, target.name, now],
      );

      if (withCredentials) {
        target.sessionId = `users-journey-session-${suffix}`;
        await client.query(
          `INSERT INTO session
             (id, token, user_id, portal, expires_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'agent', $4, $5, $5)`,
          [
            target.sessionId,
            `users-journey-token-${randomUUID()}`,
            target.id,
            new Date(now.getTime() + 60 * 60 * 1000),
            now,
          ],
        );
        target.apiKeyId = `users-journey-key-${suffix}`;
        const rawKey = `taskdesk_users_journey_${randomUUID()}`;
        await client.query(
          `INSERT INTO apikey
             (id, reference_id, user_id, key, name, start, prefix, enabled,
              created_at, updated_at)
           VALUES ($1, $2, $2, $3, $4, $5, 'taskdesk', true, $6, $6)`,
          [
            target.apiKeyId,
            target.id,
            createHash("sha256").update(rawKey).digest("base64url"),
            "Disposable Users journey key",
            rawKey.slice(0, 12),
            now,
          ],
        );
      }

      if (label === "Deactivation") {
        const roleId = `users-journey-role-${suffix}`;
        target.membershipId = `users-journey-membership-${suffix}`;
        target.membershipGrantId = `users-journey-grant-${suffix}`;
        await client.query(
          `INSERT INTO "role"
             (id, scope, workspace_id, key, name, rank, capabilities,
              is_system, is_editable, created_at, updated_at)
           VALUES ($1, 'workspace', $2, $3, $4, 1, '[]'::jsonb,
                   false, true, $5, $5)`,
          [
            roleId,
            workspaceId,
            `users-journey-${suffix}`,
            "Users journey direct role",
            now,
          ],
        );
        await client.query(
          `INSERT INTO membership
             (id, person_id, scope, scope_id, role_id, sees_all,
              created_at, updated_at)
           VALUES ($1, $2, 'workspace', $3, $4, false, $5, $5)`,
          [target.membershipId, target.personId, workspaceId, roleId, now],
        );
        await client.query(
          `INSERT INTO membership_grant
             (id, membership_id, person_id, scope, scope_id, role_id,
              source_kind, sees_all, direct_origin, granted_by_person_id,
              created_at, updated_at)
           VALUES ($1, $2, $3, 'workspace', $4, $5,
                   'direct', false, 'admin', $6, $7, $7)`,
          [
            target.membershipGrantId,
            target.membershipId,
            target.personId,
            workspaceId,
            roleId,
            adminPersonId,
            now,
          ],
        );
      }
      return target;
    };

    return {
      deactivation: await createTarget("Deactivation", true),
      staleGrant: await createTarget("Stale Grant", false),
    };
  } finally {
    await client.end();
  }
}

async function openInstanceUsers(page: Page) {
  await page
    .getByRole("button", { name: /Disposable Users Workspace/u })
    .click();
  await page.getByRole("menuitem", { name: "Instance users" }).click();
  await expect(page).toHaveURL(/\/agent\/god-mode\/users(?:\?|$)/u);
  await expect(
    page.getByRole("heading", { name: "Instance users", exact: true }),
  ).toBeVisible();
}

async function selectUser(page: Page, user: UserTarget) {
  await page
    .getByRole("link", { name: `Open ${user.name}, ${user.email}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`[?&]user=${user.id}(?:&|$)`, "u"));
  await expect(page.getByTestId("instance-user-details")).toContainText(
    user.email,
  );
}

async function leavePendingActionToInstanceUsers(page: Page) {
  // The pending-action list/detail routes render without the app sidebar, so
  // the workspace switcher used by openInstanceUsers() does not exist there.
  // Leave through real in-app history (same document, so the held proof
  // request stays in flight) back to the Users directory the journey came from.
  const usersUrl = /\/agent\/god-mode\/users(?:\?|$)/u;
  for (let steps = 0; steps < 8 && !usersUrl.test(page.url()); steps += 1) {
    const before = page.url();
    await page.goBack();
    await expect.poll(() => page.url()).not.toBe(before);
  }
  await expect(page).toHaveURL(usersUrl);
  await expect(
    page.getByRole("heading", { name: "Instance users", exact: true }),
  ).toBeVisible();
}

function holdNextRealStepUpResponse(page: Page) {
  let resolveReady!: (status: number) => void;
  let rejectReady!: (error: unknown) => void;
  let resolveRelease!: () => void;
  let resolveCompleted!: () => void;
  const ready = new Promise<number>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const release = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve;
  });
  let claimed = false;

  const handler = async (route: import("@playwright/test").Route) => {
    if (
      claimed ||
      new URL(route.request().url()).pathname !== "/api/me/step-up"
    ) {
      await route.continue();
      return;
    }
    claimed = true;
    try {
      const response = await route.fetch();
      resolveReady(response.status());
      await release;
      await route.fulfill({ response });
    } catch (error) {
      rejectReady(error);
      await route.abort().catch(() => {});
    } finally {
      resolveCompleted();
    }
  };

  const installed = page.route("**/api/me/step-up", handler);
  return {
    ready,
    release: resolveRelease,
    completed,
    remove: async () => {
      resolveRelease();
      await installed;
      await page.unroute("**/api/me/step-up", handler);
      if (claimed) await completed;
    },
  };
}

async function selectBackupCode(page: Page, selector: string) {
  const method = page.locator(selector);
  await method.click();
  await page.getByRole("option", { name: "Backup code" }).click();
}

async function getPersonState(client: FixturePgClient, userId: string) {
  const result = await client.query<{ active: boolean }>(
    "SELECT active FROM person WHERE user_id = $1",
    [userId],
  );
  expect(result.rowCount).toBe(1);
  return result.rows[0]?.active;
}

test("real Users UI binds delayed proof and approval to its current route intent", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);

  await withMfaCsrfApp(async ({ origin, email, password, databaseUrl }) => {
    await test.step("sign up, enroll MFA, and sign in through the UI", async () => {
      await createAdminWorkspace(page, origin, email, password);
    });
    const { provisioningUri, backupCodes } = await enrollFactor(
      page,
      origin,
      password,
    );
    await signInWithTotp(page, origin, email, password, provisioningUri);
    const users = await seedTargets(databaseUrl, email);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const grantRequests: string[] = [];
    const approvalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "POST" &&
        url.pathname ===
          `/api/instance/users/${users.staleGrant.id}/grant-admin`
      ) {
        grantRequests.push(url.pathname);
      }
      if (
        request.method() === "POST" &&
        url.pathname.startsWith("/api/me/pending-actions/") &&
        url.pathname.endsWith("/approve")
      ) {
        approvalRequests.push(url.pathname);
      }
    });

    try {
      await openInstanceUsers(page);
      await selectUser(page, users.deactivation);
      await expect(page).toHaveURL(
        new RegExp(`[?&]user=${users.deactivation.id}(?:&|$)`, "u"),
      );
      await page.screenshot({
        path: testInfo.outputPath("users-directory-after-auth.png"),
        fullPage: true,
      });

      await selectUser(page, users.staleGrant);
      await page.getByRole("button", { name: "Grant instance admin" }).click();
      const grantDialog = page.getByRole("dialog");
      await expect(grantDialog).toContainText(users.staleGrant.email);
      await selectBackupCode(page, "#step-up-method");
      await page.locator("#step-up-code").fill(backupCodes[0] ?? "");

      const delayedGrantProof = holdNextRealStepUpResponse(page);
      try {
        await grantDialog
          .getByRole("button", { name: "Grant instance administrator" })
          .click();
        expect(await delayedGrantProof.ready).toBe(200);
        await page.keyboard.press("Escape");
        await expect(grantDialog).toBeHidden();
        await expect(page).toHaveURL(
          new RegExp(`[?&]user=${users.staleGrant.id}(?:&|$)`, "u"),
        );
        await selectUser(page, users.deactivation);
      } finally {
        await delayedGrantProof.remove();
      }
      await expect(page.getByRole("dialog")).toBeHidden();

      const grantState = await client.query<{ role: string | null }>(
        `SELECT role FROM "user" WHERE id = $1`,
        [users.staleGrant.id],
      );
      expect(grantState.rows).toEqual([{ role: null }]);
      expect(grantRequests).toEqual([]);

      await page.getByRole("button", { name: "Deactivate person" }).click();
      const deactivationDialog = page.getByRole("dialog");
      await expect(deactivationDialog).toContainText(users.deactivation.email);
      await expect(page).toHaveURL(
        new RegExp(
          `[?&]user=${users.deactivation.id}(?:&|$).*action=deactivate|[?&]action=deactivate.*[&]user=${users.deactivation.id}(?:&|$)`,
          "u",
        ),
      );
      const requestResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/instance/users/${users.deactivation.id}/deactivate` &&
          response.request().method() === "POST",
      );
      await deactivationDialog
        .getByRole("button", { name: "Request person deactivation" })
        .click();
      const request = await requestResponse;
      expect(request.status()).toBe(202);
      const pending = (await request.json()) as {
        pendingActionId: string;
        action: "delete";
        confirmation: "typed_name_step_up";
        approveUrl: string;
      };
      expect(pending.action).toBe("delete");
      expect(pending.confirmation).toBe("typed_name_step_up");
      expect(pending.pendingActionId).toBeTruthy();
      expect(pending.approveUrl).toBe(
        `/agent/settings/profile/pending-actions/${encodeURIComponent(pending.pendingActionId)}`,
      );
      const deactivationNoticeText =
        "A deactivation approval was created. The account is unchanged until approval.";
      const deactivationNotice = page
        .getByRole("status")
        .filter({ hasText: deactivationNoticeText });
      await expect(deactivationNotice).toContainText(deactivationNoticeText);
      const reviewApprovalLink = page.getByRole("link", {
        name: "Review pending approval",
        exact: true,
      });
      await expect(reviewApprovalLink).toBeVisible();
      await expect(reviewApprovalLink).toHaveAttribute(
        "href",
        pending.approveUrl,
      );

      const pendingBeforeApproval = await client.query<{
        state: string;
        action: string;
        target_type: string;
        target_ids: string[];
        confirmation_required: string;
      }>(
        `SELECT state, action, target_type, target_ids, confirmation_required
           FROM pending_action WHERE id = $1`,
        [pending.pendingActionId],
      );
      expect(pendingBeforeApproval.rows).toEqual([
        {
          state: "pending",
          action: "delete",
          target_type: "user",
          target_ids: [users.deactivation.id],
          confirmation_required: "typed_name_step_up",
        },
      ]);
      expect(await getPersonState(client, users.deactivation.id)).toBe(true);
      const credentialsBeforeApproval = await client.query<{
        sessions: number;
        enabled_keys: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM session WHERE user_id = $1) AS sessions,
           (SELECT count(*)::int FROM apikey WHERE reference_id = $1 AND enabled = true) AS enabled_keys`,
        [users.deactivation.id],
      );
      expect(credentialsBeforeApproval.rows).toEqual([
        { sessions: 1, enabled_keys: 1 },
      ]);
      expect(users.deactivation.membershipId).toBeTruthy();
      expect(users.deactivation.membershipGrantId).toBeTruthy();
      const membershipBeforeApproval = await client.query<{
        membership_id: string;
        grant_id: string;
        revoked_at: Date | null;
      }>(
        `SELECT m.id AS membership_id, g.id AS grant_id, g.revoked_at
           FROM membership AS m
           JOIN membership_grant AS g ON g.membership_id = m.id
          WHERE m.id = $1 AND g.id = $2`,
        [users.deactivation.membershipId, users.deactivation.membershipGrantId],
      );
      expect(membershipBeforeApproval.rows).toEqual([
        {
          membership_id: users.deactivation.membershipId,
          grant_id: users.deactivation.membershipGrantId,
          revoked_at: null,
        },
      ]);

      await page.getByRole("link", { name: "My pending actions" }).click();
      await expect(page).toHaveURL(
        /\/agent\/settings\/profile\/pending-actions$/u,
      );
      await expect(
        page.getByRole("heading", {
          name: "My pending actions",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: `Deactivate person · ${users.deactivation.email}`,
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("pending-actions-list-after-auth.png"),
        fullPage: true,
      });
      await page.getByRole("link", { name: "Review", exact: true }).click();
      await expect(page).toHaveURL(
        new RegExp(`${pending.pendingActionId}$`, "u"),
      );
      await expect(
        page.getByRole("heading", { name: "Approve person deactivation" }),
      ).toBeVisible();
      await expect(page.locator("main")).toContainText(
        users.deactivation.email,
      );
      await page.screenshot({
        path: testInfo.outputPath("pending-action-detail-after-auth.png"),
        fullPage: true,
      });

      await page
        .locator("#confirm-current-email")
        .fill(`wrong-${users.deactivation.email}`);
      const approveButton = page.getByRole("button", {
        name: "Approve and deactivate",
      });
      await expect(approveButton).toBeDisabled();
      await page
        .locator("#confirm-current-email")
        .fill(users.deactivation.email);
      await selectBackupCode(page, "#pending-action-step-up-method");
      await page
        .locator("#pending-action-step-up-secret")
        .fill(backupCodes[1] ?? "");

      const delayedApprovalProof = holdNextRealStepUpResponse(page);
      try {
        await approveButton.click();
        expect(await delayedApprovalProof.ready).toBe(200);
        await leavePendingActionToInstanceUsers(page);
        await page.getByRole("link", { name: "My pending actions" }).click();
        await expect(page).toHaveURL(
          /\/agent\/settings\/profile\/pending-actions$/u,
        );
        await page.getByRole("link", { name: "Review", exact: true }).click();
        await expect(page).toHaveURL(
          new RegExp(`${pending.pendingActionId}$`, "u"),
        );
      } finally {
        await delayedApprovalProof.remove();
      }
      await expect(page.getByText("Pending", { exact: true })).toBeVisible();
      expect(approvalRequests).toEqual([]);
      expect(await getPersonState(client, users.deactivation.id)).toBe(true);
      const stillPending = await client.query<{ state: string }>(
        "SELECT state FROM pending_action WHERE id = $1",
        [pending.pendingActionId],
      );
      expect(stillPending.rows).toEqual([{ state: "pending" }]);

      await page
        .locator("#confirm-current-email")
        .fill(users.deactivation.email);
      await selectBackupCode(page, "#pending-action-step-up-method");
      await page
        .locator("#pending-action-step-up-secret")
        .fill(backupCodes[2] ?? "");
      const approvalResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/me/pending-actions/${pending.pendingActionId}/approve` &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Approve and deactivate" })
        .click();
      const approval = await approvalResponse;
      expect(approval.status()).toBe(200);
      await expect(page.getByText("Executed", { exact: true })).toBeVisible();
      expect(approvalRequests).toEqual([
        `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      ]);

      expect(await getPersonState(client, users.deactivation.id)).toBe(false);
      const retiredMembership = await client.query<{
        id: string;
        revocation_reason: string | null;
      }>(
        `SELECT id, revocation_reason
           FROM membership_grant
          WHERE id = $1 AND revoked_at IS NOT NULL`,
        [users.deactivation.membershipGrantId],
      );
      expect(retiredMembership.rows).toEqual([
        {
          id: users.deactivation.membershipGrantId,
          revocation_reason: "person_deactivated",
        },
      ]);
      const effectiveMembership = await client.query<{ id: string }>(
        "SELECT id FROM membership WHERE id = $1",
        [users.deactivation.membershipId],
      );
      expect(effectiveMembership.rows).toEqual([]);
      const finalPending = await client.query<{
        state: string;
        action: string;
        target_type: string;
        target_ids: string[];
      }>(
        `SELECT state, action, target_type, target_ids
           FROM pending_action WHERE id = $1`,
        [pending.pendingActionId],
      );
      expect(finalPending.rows).toEqual([
        {
          state: "executed",
          action: "delete",
          target_type: "user",
          target_ids: [users.deactivation.id],
        },
      ]);
      const finalCredentials = await client.query<{
        sessions: number;
        enabled_keys: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM session WHERE user_id = $1) AS sessions,
           (SELECT count(*)::int FROM apikey WHERE reference_id = $1 AND enabled = true) AS enabled_keys`,
        [users.deactivation.id],
      );
      expect(finalCredentials.rows).toEqual([{ sessions: 0, enabled_keys: 0 }]);
      const audits = await client.query<{ action: string }>(
        "SELECT action FROM audit_log WHERE entity_id = $1",
        [pending.pendingActionId],
      );
      expect(audits.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          "pending_action.decided",
          "pending_action.executed",
          "auth.step_up_issued",
        ]),
      );
      const actionEvents = await client.query<{ kind: string }>(
        `SELECT kind FROM outbox
          WHERE payload->'payload'->>'pendingActionId' = $1
          ORDER BY created_at, event_id`,
        [pending.pendingActionId],
      );
      expect(actionEvents.rows.map((row) => row.kind)).toEqual(
        expect.arrayContaining([
          "pending_action.requested",
          "pending_action.decided",
          "pending_action.executed",
        ]),
      );
      const identityEvent = await client.query<{ payload: unknown }>(
        `SELECT payload FROM outbox
          WHERE kind = 'identity.deprovisioned'
            AND payload->'payload'->>'personId' = $1`,
        [users.deactivation.personId],
      );
      expect(identityEvent.rowCount).toBe(1);
      expect(identityEvent.rows[0]?.payload).toMatchObject({
        kind: "identity.deprovisioned",
        scope: {},
        payload: {
          source: "god_mode",
          personId: users.deactivation.personId,
          previousState: { active: true },
          resultingAction: "deactivated",
          sessionsRevoked: 1,
          keysRevoked: 1,
          membershipsEnded: 1,
        },
      });

      await page.getByRole("link", { name: "Back to pending actions" }).click();
      await expect(page).toHaveURL(
        /\/agent\/settings\/profile\/pending-actions$/u,
      );
      await expect(
        page.getByText("You have no pending actions."),
      ).toBeVisible();
    } finally {
      await client.end();
    }
  });
});
