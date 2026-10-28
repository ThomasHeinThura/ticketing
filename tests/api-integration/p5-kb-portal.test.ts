/**
 * P5 knowledge base, portal side. KB-2: a customer sees an article only when it is published AND
 * customer visible, and only from a workspace and project their organisation reaches. The same
 * visibility condition serves list, detail, search, deflection, feedback and deflection
 * recording, so each is checked against every combination that must stay hidden.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  deflectionEventTable,
  kbArticleFeedbackTable,
} from "../../apps/api/src/database/schema-p5-kb";
import { resetTestDatabase } from "./helpers/database";
import {
  articleRow,
  doc,
  insertArticle,
  type KbWorld,
  kbWorld,
  setKbFlag,
} from "./helpers/p5-kb";

let w: KbWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await kbWorld();
});

type Summary = { id: string; title: string };
async function ids(path: string, user = w.customerA.user) {
  const response = await w.portal(user, path);
  expect(response.status, `${path}: ${await response.clone().text()}`).toBe(
    200,
  );
  const body = (await response.json()) as { articles: Summary[] };
  return body.articles.map((a) => a.id);
}

const surfaces = (id: string, q = "invoice") => ({
  list: `/api/portal/kb?q=${q}`,
  deflection: `/api/portal/kb/deflection?q=${q}`,
  detail: `/api/portal/kb/${id}`,
});

async function expectHidden(
  id: string,
  user = w.customerA.user,
  q = "invoice",
) {
  const s = surfaces(id, q);
  expect(await ids(s.list, user), "list").not.toContain(id);
  expect(await ids(s.deflection, user), "deflection").not.toContain(id);
  expect((await w.portal(user, s.detail)).status, "detail").toBe(404);
  expect(
    (
      await w.portal(user, `/api/portal/kb/${id}/feedback`, {
        method: "POST",
        body: { helpful: true },
      })
    ).status,
    "feedback",
  ).toBe(404);
  expect(
    (
      await w.portal(user, "/api/portal/kb/deflection", {
        method: "POST",
        body: { articleId: id, query: q },
      })
    ).status,
    "deflection record",
  ).toBe(404);
  const browse = await w.portal(user, "/api/portal/kb");
  expect(JSON.stringify(await browse.json())).not.toContain(id);
}

describe("KB-2 the double gate", () => {
  it("shows an article that is published and customer visible", async () => {
    const article = await insertArticle(w.workspaceId, {
      title: "Where to find your invoice",
      state: "published",
      customerVisible: true,
    });
    const s = surfaces(article.id);
    expect(await ids(s.list)).toEqual([article.id]);
    expect(await ids(s.deflection)).toEqual([article.id]);
    expect((await w.portal(w.customerA.user, s.detail)).status).toBe(200);
  });

  it("hides every other state and visibility combination from every surface", async () => {
    const hidden = [
      { state: "draft", customerVisible: true },
      { state: "in_review", customerVisible: true },
      { state: "archived", customerVisible: true },
      { state: "draft", customerVisible: false },
      { state: "published", customerVisible: false },
    ] as const;
    for (const [index, combo] of hidden.entries()) {
      const article = await insertArticle(w.workspaceId, {
        title: `Invoice guide ${index}`,
        ...combo,
      });
      await expectHidden(article.id);
    }
  });

  it("never serves the working copy: edits stay hidden until the next publish", async () => {
    const created = await w.agent(w.owner.user, "/api/kb/articles", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        title: "Invoice basics",
        body: doc("Public invoice text."),
        customerVisible: true,
      },
    });
    const article = (await created.json()) as { id: string; version: number };
    const published = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}/publish`,
      { method: "POST", body: { version: article.version } },
    );
    const live = (await published.json()) as { version: number };
    expect(await ids("/api/portal/kb?q=invoice")).toEqual([article.id]);

    await w.agent(w.owner.user, `/api/kb/articles/${article.id}`, {
      method: "PATCH",
      body: {
        version: live.version,
        title: "Invoice SECRETTITLE",
        body: doc("Embargoed invoice rewrite."),
      },
    });
    const detail = await w.portal(
      w.customerA.user,
      `/api/portal/kb/${article.id}`,
    );
    const text = JSON.stringify(await detail.json());
    expect(text).toContain("Public invoice text.");
    expect(text).not.toContain("SECRETTITLE");
    expect(text).not.toContain("Embargoed");
    expect(await ids("/api/portal/kb?q=SECRETTITLE")).toEqual([]);
    expect(
      await ids("/api/portal/kb/deflection?q=embargoed%20rewrite"),
    ).toEqual([]);
  });

  it("returns a 404 on the next load once the article is unpublished", async () => {
    const created = await w.agent(w.owner.user, "/api/kb/articles", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        title: "Invoice retention",
        customerVisible: true,
      },
    });
    const article = (await created.json()) as { id: string; version: number };
    const published = (await (
      await w.agent(w.owner.user, `/api/kb/articles/${article.id}/publish`, {
        method: "POST",
        body: { version: article.version },
      })
    ).json()) as { version: number };
    expect(
      (await w.portal(w.customerA.user, `/api/portal/kb/${article.id}`)).status,
    ).toBe(200);
    const off = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}/unpublish`,
      { method: "POST", body: { version: published.version } },
    );
    expect(off.status).toBe(200);
    await expectHidden(article.id);
  });

  it("strips internal callouts and work item references and exposes no staff metadata", async () => {
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Invoice help. " },
            {
              type: "taskdeskIssueLink",
              attrs: { issueKey: "OPS-77", taskId: "t1", url: "/agent/x" },
            },
          ],
        },
        {
          type: "callout",
          attrs: { variant: "internal" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "INTERNALNOTE" }],
            },
          ],
        },
        {
          type: "callout",
          attrs: { variant: "info" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Public tip" }],
            },
          ],
        },
      ],
    };
    const created = await w.agent(w.owner.user, "/api/kb/articles", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        title: "Invoice tips",
        body,
        customerVisible: true,
      },
    });
    const article = (await created.json()) as { id: string; version: number };
    await w.agent(w.owner.user, `/api/kb/articles/${article.id}/publish`, {
      method: "POST",
      body: { version: article.version },
    });
    const response = await w.portal(
      w.customerA.user,
      `/api/portal/kb/${article.id}`,
    );
    const raw = await response.text();
    expect(raw).toContain("Public tip");
    expect(raw).not.toContain("INTERNALNOTE");
    expect(raw).not.toContain("OPS-77");
    for (const leak of [
      "authorId",
      "ownerId",
      "workspaceId",
      "projectId",
      "viewCount",
      "customerVisible",
    ])
      expect(raw, leak).not.toContain(leak);
    // The agent still has the note.
    const staff = await w.agent(w.owner.user, `/api/kb/articles/${article.id}`);
    expect(await staff.text()).toContain("INTERNALNOTE");
  });
});

describe("tenant and project isolation", () => {
  it("does not show another organisation, an unbound organisation or another workspace", async () => {
    const open = await insertArticle(w.workspaceId, {
      title: "Invoice workspace guide",
      state: "published",
      customerVisible: true,
    });
    // Customer B belongs to an organisation bound to nothing in this workspace.
    await expectHidden(open.id, w.customerB.user);
    expect(await ids("/api/portal/kb", w.customerB.user)).toEqual([]);

    const other = await kbWorld();
    const foreign = await insertArticle(other.workspaceId, {
      title: "Invoice foreign workspace",
      state: "published",
      customerVisible: true,
    });
    expect(await ids("/api/portal/kb?q=invoice")).not.toContain(foreign.id);
    expect(
      (await w.portal(w.customerA.user, `/api/portal/kb/${foreign.id}`)).status,
    ).toBe(404);
  });

  it("scopes a project article to organisations bound to that project", async () => {
    const bound = await insertArticle(w.workspaceId, {
      title: "Invoice project A guide",
      state: "published",
      customerVisible: true,
      projectId: w.projectA.id,
    });
    const unbound = await insertArticle(w.workspaceId, {
      title: "Invoice project B guide",
      state: "published",
      customerVisible: true,
      projectId: w.projectB.id,
    });
    expect(await ids("/api/portal/kb?q=invoice")).toEqual([bound.id]);
    await expectHidden(unbound.id);
    await expectHidden(bound.id, w.customerB.user);

    // The customer organisation loses the project: the article disappears and its URL is a 404.
    await db
      .update(schema.projectTable)
      .set({ organisationId: null })
      .where(eq(schema.projectTable.id, w.projectA.id));
    await expectHidden(bound.id);
  });

  it("drops articles of an archived project", async () => {
    const bound = await insertArticle(w.workspaceId, {
      title: "Invoice archived project guide",
      state: "published",
      customerVisible: true,
      projectId: w.projectA.id,
    });
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, w.projectA.id));
    await expectHidden(bound.id);
  });

  it("is empty and 404 while the feature is off for the workspace", async () => {
    const article = await insertArticle(w.workspaceId, {
      title: "Invoice flag guide",
      state: "published",
      customerVisible: true,
    });
    await setKbFlag(w.workspaceId, false);
    await expectHidden(article.id);
    const categories = await w.portal(
      w.customerA.user,
      "/api/portal/kb/categories",
    );
    expect(
      ((await categories.json()) as { categories: unknown[] }).categories,
    ).toEqual([]);
  });

  it("turns an agent session away from the portal knowledge base", async () => {
    const response = await w.agent(w.owner.user, "/api/portal/kb");
    expect(response.status).not.toBe(200);
  });
});

describe("categories, feedback and deflection", () => {
  it("lists only categories that hold visible articles", async () => {
    const used = await w.agent(w.owner.user, "/api/kb/categories", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "Billing" },
    });
    const unused = await w.agent(w.owner.user, "/api/kb/categories", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "Internal only" },
    });
    const usedId = ((await used.json()) as { id: string }).id;
    const unusedId = ((await unused.json()) as { id: string }).id;
    await insertArticle(w.workspaceId, {
      title: "Invoice in billing",
      state: "published",
      customerVisible: true,
      categoryId: usedId,
    });
    await insertArticle(w.workspaceId, {
      title: "Draft in internal",
      categoryId: unusedId,
    });
    const response = await w.portal(
      w.customerA.user,
      "/api/portal/kb/categories",
    );
    const names = (
      (await response.json()) as { categories: { name: string }[] }
    ).categories.map((c) => c.name);
    expect(names).toEqual(["Billing"]);
    expect(await ids(`/api/portal/kb?categoryId=${usedId}`)).toHaveLength(1);
    expect(await ids(`/api/portal/kb?categoryId=${unusedId}`)).toHaveLength(0);
  });

  it("records one answer per customer, replaces it, and feeds the agent report", async () => {
    const article = await insertArticle(w.workspaceId, {
      title: "Invoice helpfulness",
      state: "published",
      customerVisible: true,
    });
    const post = (helpful: boolean, comment?: string) =>
      w.portal(w.customerA.user, `/api/portal/kb/${article.id}/feedback`, {
        method: "POST",
        body: { helpful, comment },
      });
    expect((await post(true)).status).toBe(200);
    expect((await post(false, "Did not cover refunds")).status).toBe(200);
    const rows = await db
      .select()
      .from(kbArticleFeedbackTable)
      .where(eq(kbArticleFeedbackTable.articleId, article.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.helpful).toBe(false);

    const summary = await w.agent(
      w.viewer.user,
      `/api/kb/articles/${article.id}/feedback`,
    );
    const parsed = (await summary.json()) as {
      helpful: number;
      notHelpful: number;
      comments: { comment: string }[];
    };
    expect(parsed).toMatchObject({ helpful: 0, notHelpful: 1 });
    expect(parsed.comments[0]?.comment).toBe("Did not cover refunds");
    const report = await w.agent(
      w.viewer.user,
      `/api/kb/report?workspaceId=${w.workspaceId}`,
    );
    expect(
      ((await report.json()) as { unhelpful: { id: string }[] }).unhelpful.map(
        (a) => a.id,
      ),
    ).toEqual([article.id]);
    // The detail view reminds the customer of their own answer.
    const detail = await w.portal(
      w.customerA.user,
      `/api/portal/kb/${article.id}`,
    );
    expect(
      ((await detail.json()) as { myFeedback: { helpful: boolean } }).myFeedback
        .helpful,
    ).toBe(false);
  });

  it("suggests inline, records a candidate, and counts an abandoned form as a deflection", async () => {
    const article = await insertArticle(w.workspaceId, {
      title: "Reset your VPN password",
      state: "published",
      customerVisible: true,
    });
    // Too short a summary offers nothing; a real one does. Nothing is recorded by suggesting.
    expect(await ids("/api/portal/kb/deflection?q=vp")).toEqual([]);
    expect(
      await ids("/api/portal/kb/deflection?q=how%20do%20I%20reset%20my%20vpn"),
    ).toEqual([article.id]);
    const before = await db.select().from(deflectionEventTable);
    expect(before).toHaveLength(0);

    const record = () =>
      w.portal(w.customerA.user, "/api/portal/kb/deflection", {
        method: "POST",
        body: { articleId: article.id, query: "reset my vpn" },
      });
    const first = (await (await record()).json()) as { id: string };
    const again = (await (await record()).json()) as { id: string };
    expect(again.id).toBe(first.id);
    const [candidate] = await db.select().from(deflectionEventTable);
    expect(candidate?.abandonedAt).toBeNull();
    expect(candidate?.personId).toBe(w.customerA.person.id);

    // Another customer cannot abandon someone else's candidate.
    const foreign = await w.portal(
      w.customerB.user,
      `/api/portal/kb/deflection/${first.id}/abandon`,
      { method: "POST" },
    );
    expect(foreign.status).toBe(404);
    const [untouched] = await db.select().from(deflectionEventTable);
    expect(untouched?.abandonedAt).toBeNull();

    const abandoned = await w.portal(
      w.customerA.user,
      `/api/portal/kb/deflection/${first.id}/abandon`,
      { method: "POST" },
    );
    expect(abandoned.status).toBe(200);
    const [done] = await db
      .select()
      .from(deflectionEventTable)
      .where(and(eq(deflectionEventTable.id, first.id)));
    expect(done?.abandonedAt).not.toBeNull();

    const report = await w.agent(
      w.viewer.user,
      `/api/kb/report?workspaceId=${w.workspaceId}`,
    );
    const deflection = (
      (await report.json()) as {
        deflection: { candidates: number; deflected: number };
      }
    ).deflection;
    expect(deflection).toMatchObject({ candidates: 1, deflected: 1 });
  });

  it("offers staff the same suggestions while triaging, including internal articles", async () => {
    const internal = await insertArticle(w.workspaceId, {
      title: "Reset your VPN password internally",
      state: "published",
      customerVisible: false,
    });
    const staff = await w.agent(
      w.member.user,
      `/api/kb/deflection?workspaceId=${w.workspaceId}&q=reset%20vpn`,
    );
    expect(
      ((await staff.json()) as { articles: { id: string }[] }).articles.map(
        (a) => a.id,
      ),
    ).toEqual([internal.id]);
    // ...but the customer never gets it.
    expect(await ids("/api/portal/kb/deflection?q=reset%20vpn")).toEqual([]);
  });

  it("counts a portal read as a view but never changes updated_at", async () => {
    const article = await insertArticle(w.workspaceId, {
      title: "Invoice views",
      state: "published",
      customerVisible: true,
    });
    const before = await articleRow(article.id);
    await w.portal(w.customerA.user, `/api/portal/kb/${article.id}`);
    await w.portal(w.customerA.user, `/api/portal/kb/${article.id}`);
    const after = await articleRow(article.id);
    expect(after?.viewCount).toBe((before?.viewCount ?? 0) + 2);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });
});
