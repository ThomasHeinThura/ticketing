import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  discoverTarget,
  removeWorkItem,
  type Session,
  signIn,
  stamp,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

/**
 * Release journey: core work (docs/testing.md Level 2). Creates its own item in the Website
 * Relaunch project, proves it persists across a reload and a second session, that a viewer
 * cannot edit it, that a stale concurrent edit is refused, and deletes it again.
 */
test("core work persists, is shared, denied to viewers and protected from stale edits", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const lead = await signIn(browser, "lead");
  const created: string[] = [];
  const sessions: Session[] = [lead];
  try {
    const { projectId } = await discoverTarget(lead);
    const title = `R929 core work ${stamp()}`;
    const types = await lead.call(
      "GET",
      `/projects/${projectId}/creatable-work-item-types`,
    );
    expect(types.status).toBe(200);
    const typeId = (
      types.body as Array<{ id: string; key: string; isEpic: boolean }>
    ).find((type) => type.key === "task" && !type.isEpic)?.id;
    expect(typeId).toBeTruthy();
    const made = await lead.call("POST", `/projects/${projectId}/work-items`, {
      typeId,
      title,
      priority: "low",
    });
    expect(made.status).toBe(200);
    const key = made.body.key as string;
    created.push(key);

    // Reload persistence in the creator's own session.
    const page = await lead.context.newPage();
    await page.goto(`/agent/work-items/${key}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Delete/ })).toBeVisible();

    // A second, independent session sees the same persisted item.
    const member = await signIn(browser, "member");
    sessions.push(member);
    const memberPage = await member.context.newPage();
    await memberPage.goto(`/agent/work-items/${key}`);
    await expect(
      memberPage.getByRole("heading", { name: title }),
    ).toBeVisible();

    // A viewer reads it but cannot edit: read-only title, no delete, API refuses with 403.
    const viewer = await signIn(browser, "viewer");
    sessions.push(viewer);
    const viewerPage = await viewer.context.newPage();
    await viewerPage.goto(`/agent/work-items/${key}`);
    await expect(
      viewerPage.getByRole("heading", { name: title }),
    ).toBeVisible();
    await expect(
      viewerPage.getByLabel("Title", { exact: true }),
    ).not.toBeEditable();
    await expect(
      viewerPage.getByRole("button", { name: /^Delete/ }),
    ).toHaveCount(0);
    const denied = await viewer.call(
      "PATCH",
      `/work-items/${key}`,
      { title: `${title} viewer edit` },
      { "If-Match": `"${made.body.version}"` },
    );
    expect(denied.status).toBe(403);

    // Stale concurrent edit: the second write with the old version is a 409, not a lost update.
    const first = await lead.call(
      "PATCH",
      `/work-items/${key}`,
      { title: `${title} edit one` },
      { "If-Match": `"${made.body.version}"` },
    );
    expect(first.status).toBe(200);
    const stale = await member.call(
      "PATCH",
      `/work-items/${key}`,
      { title: `${title} edit two` },
      { "If-Match": `"${made.body.version}"` },
    );
    expect(stale.status).toBe(409);
    const after = await lead.call("GET", `/work-items/${key}`);
    expect(after.body.title).toBe(`${title} edit one`);
  } finally {
    for (const key of created) await removeWorkItem(lead, key);
    await Promise.all(sessions.map((session) => session.context.close()));
  }
});
