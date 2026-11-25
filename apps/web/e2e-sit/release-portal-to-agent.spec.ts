import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  agentOrigin,
  portalOrigin,
  removeWorkItem,
  type Session,
  signIn,
  stamp,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

/**
 * Release journey: portal to agent and back (service desk, portal and identity). A customer
 * raises a request on the portal host, an agent claims it, asks for clarification and accepts
 * it into a work item, and the customer sees the agent's reply. The customer session is
 * refused every agent route. The accepted work item is deleted again at the end.
 */
test("customer request is triaged by an agent and the customer sees the reply", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const customer = await signIn(browser, "customer");
  const lead = await signIn(browser, "lead");
  const sessions: Session[] = [customer, lead];
  let workItemKey: string | null = null;
  let ref: string | null = null;
  try {
    const summary = `R929 portal request ${stamp()}`;
    const question = `R929 which environment is affected ${stamp()}`;
    const answer = `R929 production ${stamp()}`;

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
    ref = submitted.body.ref as string;

    // The customer sees it in the portal; the agent finds it in the triage queue.
    const customerPage = await customer.context.newPage();
    await customerPage.goto(`${portalOrigin}/submissions/${ref}`);
    await expect(customerPage.getByText(summary).first()).toBeVisible();
    const agentPage = await lead.context.newPage();
    await agentPage.goto(`${agentOrigin}/agent/triage?state=new&ref=${ref}`);
    await expect(agentPage.getByText(summary).first()).toBeVisible();

    // Agent claims and asks a question; the customer sees it on the portal and answers.
    expect(
      (await lead.call("POST", `/submissions/${ref}/claim`, {})).status,
    ).toBe(200);
    const asked = await lead.call("POST", `/submissions/${ref}/messages`, {
      body: question,
    });
    expect(asked.status).toBe(200);
    expect(asked.body.state).toBe("clarifying");
    await customerPage.reload();
    await expect(customerPage.getByText(question).first()).toBeVisible();
    const replied = await customer.call(
      "POST",
      `/portal/submissions/${ref}/messages`,
      { body: answer },
    );
    expect(replied.status).toBe(200);
    await agentPage.reload();
    await expect(agentPage.getByText(answer).first()).toBeVisible();

    // Accept into a work item in the service project; the customer's request reflects it.
    const accepted = await lead.call("POST", `/submissions/${ref}/accept`, {
      projectId: "uat-proj-support",
      workItemTypeId: "uat-service-type-incident",
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.state).toBe("accepted");
    workItemKey = accepted.body.workItem.key as string;
    const seen = await customer.call("GET", `/portal/submissions/${ref}`);
    expect(seen.status).toBe(200);
    expect(JSON.stringify(seen.body)).not.toContain("uat-proj-support");

    // Customer is refused agent routes: portal host does not serve them and the portal
    // session carries no authority on the agent host.
    expect((await customer.call("GET", "/workspace")).status).toBe(404);
    expect(
      (await customer.call("GET", `/work-items/${workItemKey}`)).status,
    ).toBe(404);
    const onAgentHost = await customer.context.request.get(
      `${agentOrigin}/api/workspace`,
      { headers: { Origin: agentOrigin } },
    );
    expect([401, 403]).toContain(onAgentHost.status());
  } finally {
    // A failure before triage still leaves no open request or work item behind.
    if (ref && !workItemKey) {
      const late = await lead.call("POST", `/submissions/${ref}/accept`, {
        projectId: "uat-proj-support",
        workItemTypeId: "uat-service-type-incident",
      });
      workItemKey = late.body?.workItem?.key ?? null;
    }
    if (workItemKey) await removeWorkItem(lead, workItemKey);
    await Promise.all(sessions.map((session) => session.context.close()));
  }
});
