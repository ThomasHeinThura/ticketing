import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  removeWorkItem,
  type Session,
  signIn,
  stamp,
  workspaceId,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const projectId = "uat-proj-web";
const activityId = "uat-time-activity";

/**
 * Release journey: planning, time and cost. A member logs time on an item the journey creates
 * and the totals follow the entry. Cost per currency is only visible to rate managers
 * (admin, owner), never to the lead or member, and a viewer can neither log nor read time.
 */
test("time logged by a member totals correctly and cost stays with rate managers", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const lead = await signIn(browser, "lead");
  const sessions: Session[] = [lead];
  let key: string | null = null;
  let entryId: string | null = null;
  let member: Session | null = null;
  try {
    const types = await lead.call(
      "GET",
      `/projects/${projectId}/creatable-work-item-types`,
    );
    const typeId = (
      types.body as Array<{ id: string; key: string; isEpic: boolean }>
    ).find((type) => type.key === "task" && !type.isEpic)?.id;
    const title = `R929 time and cost ${stamp()}`;
    const made = await lead.call("POST", `/projects/${projectId}/work-items`, {
      typeId,
      title,
    });
    expect(made.status).toBe(200);
    key = made.body.key as string;
    const itemId = made.body.id as string;

    member = await signIn(browser, "member");
    sessions.push(member);
    const today = new Date().toISOString().slice(0, 10);
    const logged = await member.call("POST", "/time-entries", {
      workspaceId,
      workItemId: itemId,
      date: today,
      minutes: 45,
      activityId,
      description: "R929 release journey",
    });
    expect(logged.status).toBe(201);
    entryId = logged.body.id as string;

    const summaryPath = `/time-entries/summary?workspaceId=${workspaceId}&workItemId=${itemId}`;
    const own = await member.call("GET", summaryPath);
    expect(own.status).toBe(200);
    expect(own.body.totalMinutes).toBe(45);
    expect(own.body.entryCount).toBe(1);

    // The change persists: edit the entry and the totals follow, for a second reader too.
    const edited = await member.call("PATCH", `/time-entries/${entryId}`, {
      minutes: 50,
    });
    expect(edited.status).toBe(200);
    const leadView = await lead.call("GET", summaryPath);
    expect(leadView.status).toBe(200);
    expect(leadView.body.totalMinutes).toBe(50);

    // Cost per currency is a rate-manager view only.
    expect("cost" in own.body).toBe(false);
    expect("cost" in leadView.body).toBe(false);
    for (const role of ["admin", "owner"] as const) {
      const manager = await signIn(browser, role);
      sessions.push(manager);
      const costed = await manager.call("GET", summaryPath);
      expect(costed.status).toBe(200);
      expect(costed.body.totalMinutes).toBe(50);
      expect(Array.isArray(costed.body.cost?.byCurrency)).toBe(true);
    }

    // The viewer role neither logs nor reads time.
    const viewer = await signIn(browser, "viewer");
    sessions.push(viewer);
    const refused = await viewer.call("POST", "/time-entries", {
      workspaceId,
      workItemId: itemId,
      date: today,
      minutes: 5,
      activityId,
    });
    expect(refused.status).toBe(403);
    expect((await viewer.call("GET", summaryPath)).status).toBe(403);
    expect(
      (
        await viewer.call(
          "GET",
          `/time-entries?workspaceId=${workspaceId}&workItemId=${itemId}`,
        )
      ).status,
    ).toBe(403);

    // The member's timesheet shows the item with its 0:50 after a reload.
    const page = await member.context.newPage();
    await page.goto("/agent/timesheet");
    await page.reload();
    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText("0:50");
  } finally {
    if (member && entryId) {
      const removed = await member.call("DELETE", `/time-entries/${entryId}`);
      const pending = removed.body?.pendingActionId as string | undefined;
      if (pending)
        await member.call("POST", `/me/pending-actions/${pending}/approve`, {});
    }
    if (key) await removeWorkItem(lead, key);
    await Promise.all(sessions.map((session) => session.context.close()));
  }
});
