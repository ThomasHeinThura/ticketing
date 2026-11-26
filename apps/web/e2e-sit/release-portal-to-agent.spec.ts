import { expect, test } from "@playwright/test";
import { privateRequest } from "../../../tests/e2e/helpers/fill-sensitive";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  agentOrigin,
  ignoreHTTPSErrors,
  portalOrigin,
  type Session,
  signIn,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

/** The one submission this journey owns on a deployment; found again by this title every run. */
const probeTitle = "release-suite probe";
const question = "release-suite probe: which environment is affected?";
const answer = "release-suite probe: production";

/**
 * Release journey: portal to agent and back (service desk, portal and identity). No route
 * deletes a submission, so the journey reuses ONE open submission titled "release-suite probe"
 * (find-or-create) and never closes it: nothing accumulates between runs. Each step runs only
 * if an earlier run has not already done it (claim, one question, one answer), so a rerun
 * re-asserts what the customer and the agent see. The customer session is refused every agent
 * route. Decline-with-reason and accept-into-work-item are covered in release-service-desk
 * (accept) and listed in docs/testing.md (decline).
 */
test("customer request is triaged by an agent and the customer sees the reply", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const customer = await signIn(browser, "customer");
  const lead = await signIn(browser, "lead");
  const sessions: Session[] = [customer, lead];
  try {
    // Find the open probe, else raise it.
    const cases = await customer.call(
      "GET",
      `/portal/requests?q=${encodeURIComponent(probeTitle)}`,
    );
    expect(cases.status).toBe(200);
    let ref: string | null = null;
    for (const found of cases.body.cases as Array<{
      ref: string;
      title: string;
      source: string;
      isRequester: boolean;
    }>) {
      if (found.source !== "submission" || !found.isRequester) continue;
      if (!found.title.includes(probeTitle)) continue;
      const state = (
        await customer.call("GET", `/portal/submissions/${found.ref}`)
      ).body?.submission?.state;
      if (state === "new" || state === "clarifying") {
        ref = found.ref;
        break;
      }
    }
    if (!ref) {
      const catalogue = await customer.call("GET", "/portal/catalogue");
      expect(catalogue.status).toBe(200);
      const requestType = (
        catalogue.body.requestTypes as Array<{ key: string; name: string }>
      ).find((type) => type.name === "Report a problem");
      expect(requestType).toBeTruthy();
      const submitted = await customer.call("POST", "/portal/submissions", {
        key: requestType?.key,
        formData: {
          summary: probeTitle,
          details: "Release suite journey.",
          impact: "Minor",
        },
        customerVisibility: "private",
      });
      expect(submitted.status).toBe(200);
      ref = submitted.body.ref as string;
    }

    // The customer sees it in the portal; the agent finds it in the triage queue.
    const customerPage = await customer.context.newPage();
    await customerPage.goto(`${portalOrigin}/submissions/${ref}`);
    await expect(customerPage.getByText(probeTitle).first()).toBeVisible();
    const agentPage = await lead.context.newPage();
    await agentPage.goto(`${agentOrigin}/agent/triage?state=new&ref=${ref}`);
    await expect(agentPage.getByText(probeTitle).first()).toBeVisible();

    const staff = async () =>
      (await lead.call("GET", `/submissions/${ref}`)).body;
    const said = (
      detail: { messages: Array<{ body: string }> },
      text: string,
    ) => detail.messages.some((message) => message.body === text);

    // Agent claims once and asks the question once; the customer sees it and answers once.
    let detail = await staff();
    if (!detail.submission.claimedBy)
      expect(
        (await lead.call("POST", `/submissions/${ref}/claim`, {})).status,
      ).toBe(200);
    if (!said(detail, question))
      expect(
        (
          await lead.call("POST", `/submissions/${ref}/messages`, {
            body: question,
          })
        ).status,
      ).toBe(200);
    await customerPage.reload();
    await expect(customerPage.getByText(question).first()).toBeVisible();
    detail = await staff();
    if (!said(detail, answer))
      expect(
        (
          await customer.call("POST", `/portal/submissions/${ref}/messages`, {
            body: answer,
          })
        ).status,
      ).toBe(200);
    await agentPage.reload();
    await expect(agentPage.getByText(answer).first()).toBeVisible();

    // Customer is refused agent routes: the portal host does not serve them ...
    expect((await customer.call("GET", "/workspace")).status).toBe(404);
    expect((await customer.call("GET", "/work-items/WEB-1")).status).toBe(404);
    // ... and the portal session replayed on the agent host carries no authority. This runs in
    // its own context so only the agent host's own TLS policy applies, never the portal's.
    const replay = await browser.newContext({
      ignoreHTTPSErrors: ignoreHTTPSErrors(agentOrigin),
    });
    try {
      // privateRequest: a transport failure must not echo the replayed session cookie.
      const status = await privateRequest(async () => {
        await replay.addCookies(
          (await customer.context.cookies()).map((cookie) => ({
            ...cookie,
            domain: new URL(agentOrigin).hostname,
          })),
        );
        const response = await replay.request.get(
          `${agentOrigin}/api/workspace`,
          { headers: { Origin: agentOrigin } },
        );
        return response.status();
      });
      expect([401, 403]).toContain(status);
    } finally {
      await replay.close();
    }
  } finally {
    await Promise.all(sessions.map((session) => session.context.close()));
  }
});
