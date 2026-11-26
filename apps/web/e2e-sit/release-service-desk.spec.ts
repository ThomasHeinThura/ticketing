import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  discoverTarget,
  hasAccount,
  portalOrigin,
  removeWorkItem,
  type Session,
  signIn,
  stamp,
  taskTypeId,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

/**
 * Release journey: service desk lifecycle. A customer raises a request on the portal, an agent
 * claims it, asks a question the customer sees, and accepts it into a work item. The request is
 * then hidden from a customer of another organisation (optional `customer-other` account).
 * The work item is deleted again at the end. No route deletes a submission, so the accepted
 * SUB-n record stays (one per run); the reusable open probe lives in release-portal-to-agent.
 */
test("customer request is accepted by an agent and stays private to its organisation", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const customer = await signIn(browser, "customer");
  const lead = await signIn(browser, "lead");
  const sessions: Session[] = [customer, lead];
  let workItemKey: string | null = null;
  try {
    const { projectId } = await discoverTarget(lead);
    const summary = `R929 service desk ${stamp()}`;
    const question = `R929 which environment ${stamp()}`;

    const catalogue = await customer.call("GET", "/portal/catalogue");
    expect(catalogue.status).toBe(200);
    const requestType = (
      catalogue.body.requestTypes as Array<{ key: string; name: string }>
    ).find((type) => type.name === "Report a problem");
    expect(requestType).toBeTruthy();
    const submitted = await customer.call("POST", "/portal/submissions", {
      key: requestType?.key,
      formData: { summary, details: "Release suite journey.", impact: "Minor" },
      customerVisibility: "private",
    });
    expect(submitted.status).toBe(200);
    const ref = submitted.body.ref as string;

    expect(
      (await lead.call("POST", `/submissions/${ref}/claim`, {})).status,
    ).toBe(200);
    const asked = await lead.call("POST", `/submissions/${ref}/messages`, {
      body: question,
    });
    expect(asked.status).toBe(200);
    const customerPage = await customer.context.newPage();
    await customerPage.goto(`${portalOrigin}/submissions/${ref}`);
    await expect(customerPage.getByText(question).first()).toBeVisible();

    const accepted = await lead.call("POST", `/submissions/${ref}/accept`, {
      projectId,
      workItemTypeId: await taskTypeId(lead, projectId),
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.state).toBe("accepted");
    workItemKey = accepted.body.workItem.key as string;
    const seen = await customer.call("GET", `/portal/submissions/${ref}`);
    expect(seen.status).toBe(200);
    expect(seen.body.submission.state).toBe("accepted");

    // Another organisation's customer neither reads nor lists the request.
    if (hasAccount("customer-other")) {
      const other = await signIn(browser, "customer-other");
      sessions.push(other);
      expect(
        (await other.call("GET", `/portal/submissions/${ref}`)).status,
      ).toBe(404);
      const listed = await other.call(
        "GET",
        `/portal/requests?q=${encodeURIComponent(summary)}`,
      );
      expect(listed.status).toBe(200);
      expect(
        (listed.body.cases as Array<{ ref: string }>).some(
          (found) => found.ref === ref,
        ),
      ).toBe(false);
    } else {
      test.info().annotations.push({
        type: "skipped-part",
        description:
          "No customer-other account: organisation isolation not run.",
      });
    }
  } finally {
    if (workItemKey) await removeWorkItem(lead, workItemKey);
    await Promise.all(sessions.map((session) => session.context.close()));
  }
});
