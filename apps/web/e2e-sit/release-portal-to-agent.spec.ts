import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  agentOrigin,
  ignoreHTTPSErrors,
  portalOrigin,
  type Session,
  signIn,
  stamp,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

/**
 * Release journey: portal to agent and back (service desk, portal and identity). A customer
 * raises a request on the portal host, an agent claims it, asks for clarification, the customer
 * answers, and the agent declines it with a reason the customer sees. The customer session is
 * refused every agent route.
 *
 * No route deletes a submission or its messages, and accepting one would leave a work item
 * whose scheduled purge the submission reference blocks. The journey therefore ends in the
 * terminal declined state (no work item is ever created) and fails loudly if it cannot get
 * there. The one declined SUB-n record per run is the only data left behind; accept-into-work-item
 * is listed as a gap in docs/testing.md.
 */
test("customer request is triaged by an agent and the customer sees the reply", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const customer = await signIn(browser, "customer");
  const lead = await signIn(browser, "lead");
  const sessions: Session[] = [customer, lead];
  let ref: string | null = null;
  let closed = false;
  // A failure before triage must still close the request, and a failed close is loud.
  async function cleanup() {
    if (ref && !closed) {
      const late = await lead.call("POST", `/submissions/${ref}/decline`, {
        reason: "R929 release journey cleanup after a failed run.",
      });
      if (late.status !== 200)
        throw new Error(
          `Cleanup decline of ${ref} returned HTTP ${late.status}.`,
        );
    }
    await Promise.all(sessions.map((session) => session.context.close()));
  }
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

    // The agent declines with a customer-visible reason; the customer sees the closed request.
    const reason = `R929 closing the release journey request ${stamp()}`;
    const declined = await lead.call("POST", `/submissions/${ref}/decline`, {
      reason,
    });
    expect(declined.status).toBe(200);
    expect(declined.body.state).toBe("declined");
    closed = true;
    const seen = await customer.call("GET", `/portal/submissions/${ref}`);
    expect(seen.status).toBe(200);
    expect(seen.body.submission.state).toBe("declined");
    await customerPage.reload();
    await expect(customerPage.getByText(reason).first()).toBeVisible();

    // Customer is refused agent routes: the portal host does not serve them ...
    expect((await customer.call("GET", "/workspace")).status).toBe(404);
    expect((await customer.call("GET", "/work-items/WEB-1")).status).toBe(404);
    // ... and the portal session replayed on the agent host carries no authority. This runs in
    // its own context so only the agent host's own TLS policy applies, never the portal's.
    const replay = await browser.newContext({
      ignoreHTTPSErrors: ignoreHTTPSErrors(agentOrigin),
    });
    try {
      await replay.addCookies(
        (await customer.context.cookies()).map((cookie) => ({
          ...cookie,
          domain: new URL(agentOrigin).hostname,
        })),
      );
      const onAgentHost = await replay.request.get(
        `${agentOrigin}/api/workspace`,
        { headers: { Origin: agentOrigin } },
      );
      expect([401, 403]).toContain(onAgentHost.status());
    } finally {
      await replay.close();
    }
  } finally {
    await cleanup();
  }
});
