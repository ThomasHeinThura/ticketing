import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  discoverTarget,
  portalOrigin,
  rowsOf,
  type Session,
  signIn,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

/**
 * Release journey: knowledge base and reports. An admin publishes a customer-visible article,
 * the customer finds and opens it on the portal, and the admin opens the reports catalogue.
 * No route deletes an article, so the article is archived again at the end (it leaves the portal).
 */
test("a published article reaches the portal customer and the reports page opens", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await signIn(browser, "admin");
  const customer = await signIn(browser, "customer");
  const sessions: Session[] = [admin, customer];
  let articleId: string | null = null;
  try {
    const { workspaceId } = await discoverTarget(admin);
    // One fixed article is reused (nothing piles up): find it by title, else create it once.
    const title = "release-suite probe article";
    const found = await admin.call(
      "GET",
      `/kb/articles?workspaceId=${workspaceId}&q=${encodeURIComponent(title)}&limit=50`,
    );
    expect(found.status).toBe(200);
    const existing = rowsOf<{ id: string; title: string }>(found.body).find(
      (row) => row.title === title,
    );
    let current = existing
      ? await admin.call("GET", `/kb/articles/${existing.id}`)
      : await admin.call("POST", "/kb/articles", {
          workspaceId,
          title,
          customerVisible: true,
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Release suite article body." },
                ],
              },
            ],
          },
        });
    expect(current.status).toBe(200);
    const read = () =>
      (current.body?.article ?? current.body) as {
        id: string;
        version: number;
        state: string;
      };
    articleId = read().id;
    // An archived probe comes back as a draft first.
    if (read().state === "archived") {
      current = await admin.call("POST", `/kb/articles/${articleId}/restore`, {
        version: read().version,
      });
      expect(current.status).toBe(200);
    }
    const step = async (action: string) =>
      admin.call("POST", `/kb/articles/${articleId}/${action}`, {
        version: read().version,
      });

    // A deployment with the review step needs submit before publish.
    if (read().state !== "published") {
      let published = await step("publish");
      if (published.status !== 200) {
        const submitted = await step("submit");
        expect(submitted.status).toBe(200);
        current = submitted;
        published = await step("publish");
      }
      expect(published.status).toBe(200);
      expect(published.body.state).toBe("published");
      current = published;
    }

    const listed = await customer.call(
      "GET",
      `/portal/kb?q=${encodeURIComponent(title)}`,
    );
    expect(listed.status).toBe(200);
    expect(
      rowsOf<{ id: string }>(listed.body).some((row) => row.id === articleId),
    ).toBe(true);
    const page = await customer.context.newPage();
    await page.goto(`${portalOrigin}/kb/${articleId}`);
    await expect(page.getByText(title).first()).toBeVisible();

    // Reports: the catalogue answers and the screen shows its first report.
    const catalogue = await admin.call(
      "GET",
      `/reports?workspaceId=${workspaceId}`,
    );
    if (catalogue.status === 409) {
      test.info().annotations.push({
        type: "skipped-part",
        description: "feature.reports is off: report page not opened.",
      });
    } else {
      expect(catalogue.status).toBe(200);
      const first = rowsOf<{ title: string }>(catalogue.body)[0];
      if (!first) throw new Error("The report catalogue is empty.");
      const reports = await admin.context.newPage();
      await reports.goto("/agent/reports");
      await expect(reports.getByText(first.title).first()).toBeVisible();
    }
  } finally {
    await cleanup();
  }

  async function cleanup() {
    if (articleId) {
      const current = await admin.call("GET", `/kb/articles/${articleId}`);
      const archived = await admin.call(
        "POST",
        `/kb/articles/${articleId}/archive`,
        { version: (current.body?.article ?? current.body)?.version },
      );
      if (archived.status !== 200)
        throw new Error(
          `Archiving the article returned HTTP ${archived.status}.`,
        );
    }
    await Promise.all(sessions.map((session) => session.context.close()));
  }
});
