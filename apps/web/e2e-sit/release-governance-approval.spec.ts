import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import { removeWorkItem, type Session, signIn, stamp } from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const projectId = "uat-proj-web";

/**
 * Release journey: governance approval. An admin raises a change in the Website Relaunch
 * project and asks the lead (the change approver) for CAB approval. Neither the requester nor
 * a member can decide it; the lead sees it in the approvals lens, approves it, and the gated
 * transition opens. The change is deleted again at the end.
 */
test("CAB approval is decided by the named approver and never by the requester", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await signIn(browser, "admin");
  const sessions: Session[] = [admin];
  let key: string | null = null;
  try {
    const types = await admin.call(
      "GET",
      `/projects/${projectId}/creatable-work-item-types`,
    );
    const changeTypeId = (
      types.body as Array<{ id: string; isChange: boolean }>
    ).find((type) => type.isChange)?.id;
    expect(changeTypeId).toBeTruthy();
    const title = `R929 change approval ${stamp()}`;
    const made = await admin.call("POST", `/projects/${projectId}/work-items`, {
      typeId: changeTypeId,
      title,
      priority: "low",
    });
    expect(made.status).toBe(200);
    key = made.body.key as string;
    const rollback = await admin.call("PATCH", `/work-items/${key}/change`, {
      version: made.body.version,
      risk: "low",
      rollbackPlan: "Revert the release journey change.",
    });
    expect(rollback.status).toBe(200);

    const transitions = await admin.call(
      "GET",
      `/work-items/${key}/transitions`,
    );
    const gated = (
      transitions.body as Array<{
        transitionId: string;
        requiresCab: boolean;
        available: boolean;
      }>
    ).find((offer) => offer.requiresCab);
    expect(gated?.available).toBe(false);

    const requested = await admin.call("POST", `/work-items/${key}/approvals`, {
      transitionId: gated?.transitionId,
      kind: "cab",
      approverId: "uat-person-lead",
    });
    expect(requested.status).toBe(200);
    expect(requested.body.state).toBe("pending");
    const approvalId = requested.body.id as string;

    // The requester cannot decide their own request, and a member who is not the approver cannot.
    const self = await admin.call("POST", `/approvals/${approvalId}/decide`, {
      action: "approve",
    });
    expect(self.status).toBe(403);
    expect(JSON.stringify(self.body)).toContain("self_approval");
    const member = await signIn(browser, "member");
    sessions.push(member);
    const other = await member.call("POST", `/approvals/${approvalId}/decide`, {
      action: "approve",
    });
    expect([403, 404]).toContain(other.status);
    const stillPending = await admin.call(
      "GET",
      `/work-items/${key}/approvals`,
    );
    expect(JSON.stringify(stillPending.body)).toContain('"state":"pending"');

    // The lead finds the request in the approvals lens and approves it.
    const lead = await signIn(browser, "lead");
    sessions.push(lead);
    const page = await lead.context.newPage();
    await page.goto("/agent/my-work?lens=approvals");
    await expect(page.getByText(title).first()).toBeVisible();
    const decided = await lead.call("POST", `/approvals/${approvalId}/decide`, {
      action: "approve",
      note: "Release journey approval.",
    });
    expect(decided.status).toBe(200);
    expect(decided.body.state).toBe("approved");

    // Persisted: the decision survives a reload and opens the gated transition.
    const after = await admin.call("GET", `/work-items/${key}/transitions`);
    const opened = (
      after.body as Array<{ transitionId: string; available: boolean }>
    ).find((offer) => offer.transitionId === gated?.transitionId);
    expect(opened?.available).toBe(true);
    await page.reload();
    await expect(page.getByText(title)).toHaveCount(0);
  } finally {
    if (key) await removeWorkItem(admin, key);
    await Promise.all(sessions.map((session) => session.context.close()));
  }
});
