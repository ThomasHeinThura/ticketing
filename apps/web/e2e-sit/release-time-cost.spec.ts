import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  discoverTarget,
  removeWorkItem,
  rowsOf,
  type Session,
  signIn,
  stamp,
  taskTypeId,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

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
  let itemId = "";
  let workspaceId = "";
  let entryId: string | null = null;
  let member: Session | null = null;
  // Each cleanup step must succeed; a failure fails the journey instead of leaving data.
  async function cleanup() {
    // Each cleanup step must succeed; a failure fails the journey instead of leaving data.
    if (member && entryId) {
      const removed = await member.call("DELETE", `/time-entries/${entryId}`);
      const pending = removed.body?.pendingActionId as string | undefined;
      if (removed.status !== 202 || !pending)
        throw new Error(`Time entry deletion returned HTTP ${removed.status}.`);
      const approved = await member.call(
        "POST",
        `/me/pending-actions/${pending}/approve`,
        {},
      );
      if (approved.status !== 200)
        throw new Error(
          `Time entry approval returned HTTP ${approved.status}.`,
        );
      const gone = await member.call(
        "GET",
        `/time-entries?workspaceId=${workspaceId}&workItemId=${itemId}`,
      );
      if (
        gone.status !== 200 ||
        (gone.body.data as Array<{ id: string }>).some(
          (entry) => entry.id === entryId,
        )
      )
        throw new Error("Time entry is still listed after its deletion.");
    }
    if (key) await removeWorkItem(lead, key);
    await Promise.all(sessions.map((session) => session.context.close()));
  }
  try {
    const target = await discoverTarget(lead);
    const projectId = target.projectId;
    workspaceId = target.workspaceId;
    const activities = await lead.call(
      "GET",
      `/time-activities?workspaceId=${workspaceId}`,
    );
    expect(activities.status).toBe(200);
    const activityId = rowsOf<{ id: string }>(activities.body)[0]?.id;
    expect(activityId, "a time activity exists").toBeTruthy();
    const typeId = await taskTypeId(lead, projectId);
    const title = `R929 time and cost ${stamp()}`;
    const made = await lead.call("POST", `/projects/${projectId}/work-items`, {
      typeId,
      title,
    });
    expect(made.status).toBe(200);
    key = made.body.key as string;
    itemId = made.body.id as string;

    member = await signIn(browser, "member");
    sessions.push(member);
    // "Today" is the member's own calendar day as the API computes it, not UTC.
    const calendar = await member.call(
      "GET",
      `/time-entries?workspaceId=${workspaceId}&workItemId=${itemId}`,
    );
    expect(calendar.status).toBe(200);
    const today = calendar.body.today as string;
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
    await cleanup();
  }
});
