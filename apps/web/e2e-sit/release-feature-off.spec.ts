import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  discoverTarget,
  type Session,
  setProjectFeature,
  signIn,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const feature = "feature.cycles";

/**
 * Release journey: feature off. An admin turns the cycles feature off for one project through
 * the API; the cycles API answers 404 `feature_disabled` and the cycles screen does not list
 * cycles. The project's previous override is put back in `finally`, even when an assertion
 * fails. An instance-locked flag makes the switch refuse (409) and fails the journey loudly.
 */
test("a project feature switched off is denied by the API and the screen, then restored", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await signIn(browser, "admin");
  const sessions: Session[] = [admin];
  let restore: { projectId: string; override: boolean | null } | null = null;
  try {
    const { projectId, projectKey } = await discoverTarget(admin);
    restore = {
      projectId,
      override: await setProjectFeature(admin, projectId, feature, false),
    };

    const denied = await admin.call("GET", `/projects/${projectKey}/cycles`);
    expect(denied.status).toBe(404);
    expect(JSON.stringify(denied.body)).toContain("feature_disabled");
    const resolved = await admin.call(
      "GET",
      `/features/resolved?project=${projectId}`,
    );
    expect(
      (resolved.body.features as Array<{ key: string; enabled: boolean }>).find(
        (row) => row.key === feature,
      )?.enabled,
    ).toBe(false);

    const page = await admin.context.newPage();
    // The screen asks for the cycles and is refused by the same API rule.
    const asked = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        `/api/projects/${projectKey}/cycles`,
    );
    await page.goto(`/agent/projects/${projectKey}/cycles`);
    expect((await asked).status()).toBe(404);
  } finally {
    if (restore) {
      await setProjectFeature(
        admin,
        restore.projectId,
        feature,
        restore.override,
      );
    }
    await Promise.all(sessions.map((session) => session.context.close()));
  }
});
