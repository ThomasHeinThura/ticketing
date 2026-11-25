import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  type Role,
  type Session,
  signIn,
  workspaceId,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

/**
 * Release journey: import, denial half only.
 *
 * Every import route (`GET/POST /api/imports*`, `/api/import-sources*`) requires the
 * `instance:admin` capability (apps/api/src/imports/policy.ts), which God Mode signs in with
 * its own password and MFA. None of the workspace accounts in SIT_ACCOUNTS_FILE holds it, so
 * the CSV preview and apply journey cannot run on SIT without an instance-admin login that
 * the release suite does not have. It is therefore not written here, and docs/testing.md lists
 * it as a gap rather than a faked pass. What this spec does prove: no workspace role,
 * including owner and admin, can list, create or run an import, and the God Mode import
 * screen shows a workspace admin "Access denied".
 */
const csv = "external_id,title,type\nR929-1,R929 import denial row,task\n";
const roles: Role[] = ["owner", "admin", "lead", "member", "viewer"];

test("workspace roles are refused every import route and the God Mode import screen", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const sessions: Session[] = [];
  try {
    for (const role of roles) {
      const session = await signIn(browser, role);
      sessions.push(session);
      const list = await session.call(
        "GET",
        `/imports?workspaceId=${workspaceId}`,
      );
      expect(list.status, `${role} list imports`).toBe(403);
      const sources = await session.call(
        "GET",
        `/import-sources?workspaceId=${workspaceId}`,
      );
      expect(sources.status, `${role} list sources`).toBe(403);
      const created = await session.call("POST", "/import-sources", {
        workspaceId,
        pluginId: "import.csv",
        name: "R929 denied import",
        config: { csvText: csv },
      });
      expect(created.status, `${role} create source`).toBe(403);
    }
    const admin = sessions[roles.indexOf("admin")];
    const page = await admin.context.newPage();
    await page.goto("/god-mode/imports");
    await expect(page.getByText("Access denied")).toBeVisible();
    await expect(
      page.getByText(/instance administrator access/i),
    ).toBeVisible();
  } finally {
    await Promise.all(sessions.map((session) => session.context.close()));
  }
});
