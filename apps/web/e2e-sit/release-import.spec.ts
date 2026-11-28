import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  discoverTarget,
  type Role,
  type Session,
  signIn,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

/**
 * Release journey: import. Every import route (`GET/POST /api/imports*`, `/api/import-sources*`)
 * requires the `instance:admin` capability (apps/api/src/imports/policy.ts), which God Mode
 * signs in with its own password and MFA. The first test proves every workspace role whose session
 * the server does not report as an instance administrator is refused every import route, and
 * that the God Mode import screen shows such a workspace admin "Access denied". Instance
 * administrators (any account, including a break-glass grant) are covered by
 * release-import-apply.spec.ts.
 */
const csv = "external_id,title,type\nR929-1,R929 import denial row,task\n";
const roles: Role[] = ["owner", "admin", "lead", "member", "viewer"];

test("workspace roles are refused every import route and the God Mode import screen", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const sessions: Session[] = [];
  try {
    const lead = await signIn(browser, "lead");
    sessions.push(lead);
    const { workspaceId } = await discoverTarget(lead);
    const refused: Role[] = [];
    for (const role of roles) {
      const session = await signIn(browser, role);
      sessions.push(session);
      // The server's own answer decides, so any instance administrator is skipped.
      const me = await session.call("GET", "/auth/get-session");
      expect(me.status, `${role} session`).toBe(200);
      if (me.body?.user?.role === "admin") continue;
      refused.push(role);
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
    // Never pass vacuously: a workspace admin must be among the refused accounts.
    expect(refused).toContain("admin");
    const admin = sessions.find((session) => session.role === "admin");
    if (!admin) throw new Error("No admin session.");
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
