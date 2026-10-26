/**
 * P5 knowledge base, agent side: lifecycle and versions (KB-3), review step (KB-4), sanitised
 * bodies (KB-5), concurrency (409), reach on project-scoped articles (KB-1), categories, feature
 * gate, capability denials and session separation.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import {
  kbArticleTable,
  kbArticleVersionTable,
} from "../../apps/api/src/database/schema-p5-kb";
import { deleteWorkspaceRoleDependents } from "../../apps/api/src/workspace/controllers/delete-workspace-role-dependents";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  articleRow,
  auditActions,
  doc,
  insertArticle,
  type KbWorld,
  kbWorld,
  setKbFlag,
  versionRows,
} from "./helpers/p5-kb";
import {
  deleteThroughApproval,
  ensureAgentSession,
} from "./helpers/pending-deletion";

let w: KbWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await kbWorld();
});

type Article = { id: string; version: number; state: string; title: string };
async function createDraft(
  user: Parameters<KbWorld["agent"]>[0],
  extra: Record<string, unknown> = {},
) {
  const response = await w.agent(user, "/api/kb/articles", {
    method: "POST",
    body: {
      workspaceId: w.workspaceId,
      title: "Reset your VPN password",
      body: doc("Open the portal and choose reset."),
      ...extra,
    },
  });
  const text = await response.clone().text();
  let article = {} as Article;
  try {
    article = JSON.parse(text) as Article;
  } catch {
    // an error body is plain text
  }
  return { response, article };
}

describe("lifecycle, versions and concurrency", () => {
  it("exposes person identifiers for owner selection and rejects a login user id", async () => {
    const { article } = await createDraft(w.member.user);
    const members = await w.agent(
      w.owner.user,
      `/api/workspace/${w.workspaceId}/members`,
    );
    expect(members.status).toBe(200);
    const choices = (await members.json()) as Array<{
      id: string;
      personId: string | null;
    }>;
    const owner = choices.find((row) => row.id === w.owner.user.id);
    expect(owner?.personId).toBeTypeOf("string");
    expect(owner?.personId).not.toBe(w.owner.user.id);
    const rejected = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}`,
      {
        method: "PATCH",
        body: { version: article.version, ownerId: w.owner.user.id },
      },
    );
    expect(rejected.status).toBe(404);
    const saved = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}`,
      {
        method: "PATCH",
        body: { version: article.version, ownerId: owner?.personId },
      },
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect((await saved.json()).ownerId).toBe(owner?.personId);
  });
  it("lets a writer draft, a publisher publish, and keeps versions immutable", async () => {
    const { response, article } = await createDraft(w.member.user);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(article.state).toBe("draft");
    expect(await versionRows(article.id)).toHaveLength(0);

    // A member holds kb_article:write, not publish.
    const denied = await w.agent(
      w.member.user,
      `/api/kb/articles/${article.id}/publish`,
      { method: "POST", body: { version: article.version } },
    );
    expect(denied.status).toBe(403);

    const published = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}/publish`,
      { method: "POST", body: { version: article.version } },
    );
    expect(published.status, await published.clone().text()).toBe(200);
    const live = (await published.json()) as Article & {
      publishedVersion: number;
    };
    expect(live.state).toBe("published");
    expect(live.publishedVersion).toBe(1);
    const versions = await versionRows(article.id);
    expect(versions).toHaveLength(1);

    // Editing the working copy and republishing makes version 2; version 1 never changes.
    const edited = await w.agent(
      w.member.user,
      `/api/kb/articles/${article.id}`,
      {
        method: "PATCH",
        body: { version: live.version, body: doc("A second draft.") },
      },
    );
    expect(edited.status).toBe(200);
    const editedBody = (await edited.json()) as Article & {
      hasUnpublishedChanges: boolean;
    };
    expect(editedBody.hasUnpublishedChanges).toBe(true);
    const republished = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}/publish`,
      { method: "POST", body: { version: editedBody.version } },
    );
    expect(republished.status).toBe(200);
    const after = await versionRows(article.id);
    expect(after.map((row) => row.number).sort()).toEqual([1, 2]);
    expect(
      JSON.stringify(after.find((row) => row.number === 1)?.body),
    ).toContain("choose reset");

    // The database refuses an UPDATE of a version row.
    await expect(
      db
        .update(kbArticleVersionTable)
        .set({ title: "tampered" })
        .where(eq(kbArticleVersionTable.articleId, article.id)),
    ).rejects.toThrow();

    // History is browsable and restorable into the working copy.
    const history = await w.agent(
      w.viewer.user,
      `/api/kb/articles/${article.id}/versions`,
    );
    expect(history.status).toBe(200);
    expect(
      ((await history.json()) as { versions: { number: number }[] }).versions,
    ).toHaveLength(2);
    const current = await articleRow(article.id);
    const restored = await w.agent(
      w.member.user,
      `/api/kb/articles/${article.id}/versions/1/restore`,
      { method: "POST", body: { version: current?.version } },
    );
    expect(restored.status, await restored.clone().text()).toBe(200);
    expect(JSON.stringify((await restored.json()) as unknown)).toContain(
      "choose reset",
    );
    expect(await versionRows(article.id)).toHaveLength(2);

    const actions = await auditActions(w.workspaceId);
    expect(actions).toEqual(
      expect.arrayContaining([
        "kb_article.created",
        "kb_article.updated",
        "kb_article.published",
        "kb_article.version_restored",
      ]),
    );
  });

  it("answers a stale PATCH with 409 and the current article", async () => {
    const { article } = await createDraft(w.member.user);
    const first = await w.agent(
      w.member.user,
      `/api/kb/articles/${article.id}`,
      {
        method: "PATCH",
        body: { version: article.version, title: "First editor" },
      },
    );
    expect(first.status).toBe(200);
    const stale = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}`,
      {
        method: "PATCH",
        body: { version: article.version, title: "Second editor" },
      },
    );
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as {
      error: string;
      current: { title: string; version: number };
    };
    expect(body.error).toBe("version_conflict");
    expect(body.current.title).toBe("First editor");
    expect((await articleRow(article.id))?.title).toBe("First editor");
  });

  it("sanitises a hostile body on write", async () => {
    const hostile = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
        { type: "script", attrs: { html: "<script>x</script>" } },
      ],
    };
    const { response, article } = await createDraft(w.member.user, {
      body: hostile,
    });
    expect(response.status).toBe(200);
    const stored = JSON.stringify((await articleRow(article.id))?.body);
    expect(stored).not.toContain("javascript");
    expect(stored).not.toContain("script");
    const refused = await createDraft(w.member.user, { body: "<p>raw</p>" });
    expect(refused.response.status).toBe(400);
  });

  it("guards exposure: only a publisher may make an article customer visible", async () => {
    const memberVisible = await createDraft(w.member.user, {
      customerVisible: true,
    });
    expect(memberVisible.response.status).toBe(403);
    const { article } = await createDraft(w.member.user);
    const toggle = await w.agent(
      w.member.user,
      `/api/kb/articles/${article.id}`,
      {
        method: "PATCH",
        body: { version: article.version, customerVisible: true },
      },
    );
    expect(toggle.status).toBe(403);
    expect((await articleRow(article.id))?.customerVisible).toBe(false);
    const ownerToggle = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}`,
      {
        method: "PATCH",
        body: { version: article.version, customerVisible: true },
      },
    );
    expect(ownerToggle.status).toBe(200);
  });
});

describe("KB-4 review step", () => {
  it("requires submit then publish when switched on, and only a manager may switch it", async () => {
    const denied = await w.agent(
      w.member.user,
      `/api/kb/settings?workspaceId=${w.workspaceId}`,
      { method: "PATCH", body: { reviewStepEnabled: true } },
    );
    expect(denied.status).toBe(403);
    const on = await w.agent(
      w.owner.user,
      `/api/kb/settings?workspaceId=${w.workspaceId}`,
      { method: "PATCH", body: { reviewStepEnabled: true } },
    );
    expect(on.status, await on.clone().text()).toBe(200);

    const { article } = await createDraft(w.member.user);
    const direct = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}/publish`,
      { method: "POST", body: { version: article.version } },
    );
    expect(direct.status).toBe(409);
    const submitted = await w.agent(
      w.member.user,
      `/api/kb/articles/${article.id}/submit`,
      { method: "POST", body: { version: article.version } },
    );
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    const inReview = (await submitted.json()) as Article;
    expect(inReview.state).toBe("in_review");
    const published = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}/publish`,
      { method: "POST", body: { version: inReview.version } },
    );
    expect(published.status).toBe(200);
    expect(await auditActions(w.workspaceId)).toEqual(
      expect.arrayContaining(["kb.settings_changed", "kb_article.submitted"]),
    );
  });
});

describe("KB-1 project scope and reach", () => {
  it("hides a project-scoped article from staff who do not reach the project", async () => {
    const scoped = await insertArticle(w.workspaceId, {
      title: "Project A runbook",
      state: "published",
      projectId: w.projectA.id,
    });
    const open = await insertArticle(w.workspaceId, {
      title: "Workspace wide guide",
      state: "published",
    });

    const asMember = await w.agent(
      w.member.user,
      `/api/kb/articles?workspaceId=${w.workspaceId}`,
    );
    const memberList = (await asMember.json()) as {
      articles: { id: string }[];
    };
    expect(memberList.articles.map((a) => a.id)).toEqual([open.id]);
    expect(
      (await w.agent(w.member.user, `/api/kb/articles/${scoped.id}`)).status,
    ).toBe(404);
    for (const path of [
      `/api/kb/search?workspaceId=${w.workspaceId}&q=runbook`,
      `/api/kb/deflection?workspaceId=${w.workspaceId}&q=runbook`,
    ]) {
      const hit = await w.agent(w.member.user, path);
      expect(
        ((await hit.json()) as { articles: unknown[] }).articles,
        path,
      ).toHaveLength(0);
    }
    expect(
      (await w.agent(w.member.user, `/api/kb/articles/${scoped.id}/versions`))
        .status,
    ).toBe(404);
    expect(
      (
        await w.agent(w.member.user, `/api/kb/articles/${scoped.id}`, {
          method: "PATCH",
          body: { version: 1, title: "Hijack" },
        })
      ).status,
    ).toBe(404);

    const asReacher = await w.agent(
      w.reacher.user,
      `/api/kb/search?workspaceId=${w.workspaceId}&q=runbook`,
    );
    expect(
      ((await asReacher.json()) as { articles: { id: string }[] }).articles.map(
        (a) => a.id,
      ),
    ).toEqual([scoped.id]);
    expect(
      (await w.agent(w.reacher.user, `/api/kb/articles/${scoped.id}`)).status,
    ).toBe(200);
  });

  it("refuses to scope an article to a project the author cannot reach", async () => {
    const { response } = await createDraft(w.member.user, {
      projectId: w.projectA.id,
    });
    expect(response.status).toBe(404);
    const ok = await createDraft(w.reacher.user, { projectId: w.projectA.id });
    expect(ok.response.status, await ok.response.clone().text()).toBe(200);
  });

  it("does not let a foreign workspace read or write an article", async () => {
    const other = await kbWorldOther();
    const article = await insertArticle(w.workspaceId, {
      title: "Private to the first workspace",
      state: "published",
    });
    const read = await w.agent(
      other.owner.user,
      `/api/kb/articles/${article.id}`,
    );
    expect(read.status).toBe(404);
    const list = await w.agent(
      other.owner.user,
      `/api/kb/articles?workspaceId=${w.workspaceId}`,
    );
    expect([403, 404]).toContain(list.status);
  });
});

async function kbWorldOther() {
  const { createWorkspaceMember } = await import("./helpers/fixtures");
  const owner = await createWorkspaceMember({ role: "owner" });
  await setKbFlag(owner.workspace.id, true);
  return { owner };
}

describe("categories", () => {
  it("refuses to delete a category that holds articles and deletes an empty one through a pending action", async () => {
    const create = await w.agent(w.owner.user, "/api/kb/categories", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "VPN" },
    });
    expect(create.status, await create.clone().text()).toBe(200);
    const category = (await create.json()) as { id: string };
    const { article } = await createDraft(w.member.user, {
      categoryId: category.id,
    });
    expect(article.id).toBeTruthy();

    const refused = await w.agent(
      w.owner.user,
      `/api/kb/categories/${category.id}`,
      { method: "DELETE" },
    );
    expect(refused.status).toBe(409);

    const empty = await w.agent(w.owner.user, "/api/kb/categories", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "Empty" },
    });
    const emptyCategory = (await empty.json()) as { id: string };
    await ensureAgentSession(w.owner.user.id);
    mockAuthenticatedSession(w.owner.user);
    await deleteThroughApproval(
      w.app,
      w.owner.user,
      `/api/kb/categories/${emptyCategory.id}`,
      {
        afterRequest: async () => {
          // Not deleted until approved.
          const list = await w.agent(
            w.viewer.user,
            `/api/kb/categories?workspaceId=${w.workspaceId}`,
          );
          expect(
            (
              (await list.json()) as { categories: { id: string }[] }
            ).categories.map((c) => c.id),
          ).toContain(emptyCategory.id);
          mockAuthenticatedSession(w.owner.user);
        },
      },
    );
    const after = await w.agent(
      w.viewer.user,
      `/api/kb/categories?workspaceId=${w.workspaceId}`,
    );
    expect(
      ((await after.json()) as { categories: { id: string }[] }).categories.map(
        (c) => c.id,
      ),
    ).not.toContain(emptyCategory.id);
    expect(await auditActions(w.workspaceId)).toContain("kb_category.deleted");
  });

  it("only publishers manage categories, and a category cannot be its own ancestor", async () => {
    const denied = await w.agent(w.member.user, "/api/kb/categories", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "Nope" },
    });
    expect(denied.status).toBe(403);
    const parent = (await (
      await w.agent(w.owner.user, "/api/kb/categories", {
        method: "POST",
        body: { workspaceId: w.workspaceId, name: "Parent" },
      })
    ).json()) as { id: string };
    const child = (await (
      await w.agent(w.owner.user, "/api/kb/categories", {
        method: "POST",
        body: {
          workspaceId: w.workspaceId,
          name: "Child",
          parentId: parent.id,
        },
      })
    ).json()) as { id: string };
    const cycle = await w.agent(
      w.owner.user,
      `/api/kb/categories/${parent.id}`,
      {
        method: "PATCH",
        body: { parentId: child.id },
      },
    );
    expect(cycle.status).toBe(409);
  });
});

describe("gates", () => {
  it("is a 404 on every agent route while feature.knowledge_base is off", async () => {
    await setKbFlag(w.workspaceId, false);
    const list = await w.agent(
      w.owner.user,
      `/api/kb/articles?workspaceId=${w.workspaceId}`,
    );
    expect(list.status).toBe(404);
    const create = await w.agent(w.owner.user, "/api/kb/articles", {
      method: "POST",
      body: { workspaceId: w.workspaceId, title: "x" },
    });
    expect(create.status).toBe(404);
    const article = await insertArticle(w.workspaceId, { title: "Hidden" });
    expect(
      (await w.agent(w.owner.user, `/api/kb/articles/${article.id}`)).status,
    ).toBe(404);
  });

  it("denies a viewer writes and a customer session every agent route", async () => {
    const viewerWrite = await createDraft(w.viewer.user);
    expect(viewerWrite.response.status).toBe(403);
    const viewerRead = await w.agent(
      w.viewer.user,
      `/api/kb/articles?workspaceId=${w.workspaceId}`,
    );
    expect(viewerRead.status).toBe(200);

    const article = await insertArticle(w.workspaceId, {
      title: "Customer must not read this here",
      state: "published",
      customerVisible: true,
    });
    {
      mockAuthenticatedSession(w.customerA.user, { portal: "customer" });
      for (const path of [
        `/api/kb/articles?workspaceId=${w.workspaceId}`,
        `/api/kb/articles/${article.id}`,
        `/api/kb/search?workspaceId=${w.workspaceId}&q=customer`,
        `/api/kb/deflection?workspaceId=${w.workspaceId}&q=customer`,
        `/api/kb/categories?workspaceId=${w.workspaceId}`,
        `/api/kb/report?workspaceId=${w.workspaceId}`,
      ]) {
        const response = await w.app.request(path, { headers: {} });
        expect([401, 403, 404], `${path} -> ${response.status}`).toContain(
          response.status,
        );
      }
      const write = await w.app.request("/api/kb/articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: w.workspaceId, title: "x" }),
      });
      expect([401, 403, 404]).toContain(write.status);
    }
  });

  it("turns away an agent session on the portal knowledge base", async () => {
    mockAuthenticatedSession(w.owner.user);
    const response = await w.app.request("/api/portal/kb", {
      headers: { host: "portal.localhost:5174" },
    });
    expect(response.status).not.toBe(200);
    const onAgentHost = await w.agent(w.owner.user, "/api/portal/kb");
    expect(onAgentHost.status).not.toBe(200);
  });
});

describe("search, report and feedback totals", () => {
  it("finds persisted full-width and decomposed Unicode titles", async () => {
    const fullWidth = await insertArticle(w.workspaceId, {
      title: "Ａｌｐｈａ guide",
    });
    const decomposed = await insertArticle(w.workspaceId, {
      title: "Cafe\u0301 reset guide",
    });
    const search = async (q: string) => {
      const response = await w.agent(
        w.viewer.user,
        `/api/kb/search?workspaceId=${w.workspaceId}&q=${encodeURIComponent(q)}`,
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { articles: { id: string }[] })
        .articles;
    };

    const [fullWidthResults, decomposedResults] = await Promise.all([
      search("Ａｌｐｈａ"),
      search("Cafe\u0301"),
    ]);
    expect({
      fullWidth: fullWidthResults.some(
        (article) => article.id === fullWidth.id,
      ),
      decomposed: decomposedResults.some(
        (article) => article.id === decomposed.id,
      ),
    }).toEqual({ fullWidth: true, decomposed: true });

    const globalSearch = async (q: string) => {
      const response = await w.agent(
        w.viewer.user,
        `/api/search?workspaceId=${w.workspaceId}&type=kb_articles&q=${encodeURIComponent(q)}`,
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { results: { id: string }[] }).results;
    };
    const [globalFullWidth, globalDecomposed] = await Promise.all([
      globalSearch("Ａｌｐｈａ"),
      globalSearch("Cafe\u0301"),
    ]);
    expect({
      fullWidth: globalFullWidth.some((article) => article.id === fullWidth.id),
      decomposed: globalDecomposed.some(
        (article) => article.id === decomposed.id,
      ),
    }).toEqual({ fullWidth: true, decomposed: true });
  });

  it("weights titles above bodies and reports overdue reviews", async () => {
    const body = await insertArticle(w.workspaceId, {
      title: "Unrelated heading",
      bodyText: "this explains the vpn certificate renewal",
      state: "published",
    });
    const title = await insertArticle(w.workspaceId, {
      title: "VPN certificate renewal",
      bodyText: "steps",
      state: "published",
    });
    const overdue = await insertArticle(w.workspaceId, {
      title: "Stale page",
      reviewDueAt: new Date(Date.now() - 86_400_000),
    });
    const response = await w.agent(
      w.viewer.user,
      `/api/kb/search?workspaceId=${w.workspaceId}&q=vpn%20cert`,
    );
    const ids = (
      (await response.json()) as { articles: { id: string }[] }
    ).articles.map((a) => a.id);
    expect(ids).toEqual([title.id, body.id]);

    const globalSearch = await w.agent(
      w.viewer.user,
      `/api/search?workspaceId=${w.workspaceId}&type=kb_articles&q=vpn%20cert`,
    );
    expect(globalSearch.status).toBe(200);
    const globalIds = (
      (await globalSearch.json()) as { results: { id: string }[] }
    ).results.map((article) => article.id);
    expect(globalIds).toEqual([title.id, body.id]);

    const report = await w.agent(
      w.viewer.user,
      `/api/kb/report?workspaceId=${w.workspaceId}`,
    );
    expect(report.status).toBe(200);
    const parsed = (await report.json()) as { overdue: { id: string }[] };
    expect(parsed.overdue.map((a) => a.id)).toEqual([overdue.id]);
  });

  it("adds readable KB articles to agent search using the staff copy and portal published version", async () => {
    const article = await insertArticle(w.workspaceId, {
      title: "Public VPN guide",
      bodyText: "Public certificate instructions",
      state: "published",
      customerVisible: true,
    });
    await db
      .update(kbArticleTable)
      .set({
        title: "Working VPN draft",
        bodyText: "Working certificate instructions",
      })
      .where(eq(kbArticleTable.id, article.id));

    const staffQuery = (q: string, type = "all") =>
      `/api/search?q=${encodeURIComponent(q)}&workspaceId=${w.workspaceId}&type=${type}`;
    const staffHit = await w.agent(w.viewer.user, staffQuery("Working VPN"));
    expect(staffHit.status).toBe(200);
    const staffResults = (await staffHit.json()) as {
      results: { id: string; type: string; title: string }[];
    };
    expect(staffResults.results).toContainEqual(
      expect.objectContaining({
        id: article.id,
        type: "kb_article",
        title: "Working VPN draft",
      }),
    );
    const typedHit = await w.agent(
      w.viewer.user,
      staffQuery("Working VPN", "kb_articles"),
    );
    expect(typedHit.status).toBe(200);
    expect(
      ((await typedHit.json()) as { results: { id: string }[] }).results,
    ).toContainEqual(expect.objectContaining({ id: article.id }));
    const punctuationOnly = await w.agent(
      w.viewer.user,
      staffQuery("!!!", "kb_articles"),
    );
    expect(
      ((await punctuationOnly.json()) as { results: { id: string }[] }).results,
    ).not.toContainEqual(expect.objectContaining({ id: article.id }));
    expect(
      (
        (await (
          await w.agent(w.viewer.user, staffQuery("Public VPN"))
        ).json()) as { results: { id: string }[] }
      ).results,
    ).not.toContainEqual(expect.objectContaining({ id: article.id }));

    const portalHit = await w.portal(
      w.customerA.user,
      `/api/portal/kb?q=${encodeURIComponent("Public VPN")}`,
    );
    expect(portalHit.status).toBe(200);
    const portalResults = (await portalHit.json()) as {
      articles: { id: string; title: string }[];
    };
    expect(portalResults.articles).toContainEqual(
      expect.objectContaining({
        id: article.id,
        title: "Public VPN guide",
      }),
    );

    const writer = await w.agent(w.member.user, staffQuery("Working VPN"));
    expect(
      ((await writer.json()) as { results: { id: string }[] }).results,
    ).toContainEqual(expect.objectContaining({ id: article.id }));

    const projectArticle = await insertArticle(w.workspaceId, {
      title: "Reachable project guide",
      projectId: w.projectA.id,
    });
    const outsideReach = await w.agent(
      w.member.user,
      staffQuery("Reachable project"),
    );
    expect(
      ((await outsideReach.json()) as { results: { id: string }[] }).results,
    ).not.toContainEqual(expect.objectContaining({ id: projectArticle.id }));
    const withinReach = await w.agent(
      w.reacher.user,
      staffQuery("Reachable project"),
    );
    expect(
      ((await withinReach.json()) as { results: { id: string }[] }).results,
    ).toContainEqual(expect.objectContaining({ id: projectArticle.id }));

    await setKbFlag(w.workspaceId, false);
    const off = await w.agent(w.viewer.user, staffQuery("Working VPN"));
    expect(
      ((await off.json()) as { results: { id: string }[] }).results,
    ).not.toContainEqual(expect.objectContaining({ id: article.id }));
  });

  it("respects an API key capability ceiling when adding KB results to global search", async () => {
    const article = await insertArticle(w.workspaceId, {
      title: "Needle customer support guide",
      state: "published",
      customerVisible: true,
    });
    const key = await createPersonalApiKey(
      { userId: w.owner.user.id },
      {
        name: "global search workspace reader",
        capabilities: ["workspace:read"],
      },
    );
    mockAnonymousSession();
    const response = await w.app.request(
      `/api/search?q=Needle&workspaceId=${w.workspaceId}&type=kb_articles`,
      { headers: { "x-api-key": key.key } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      results: { id: string; type: string }[];
    };
    expect(body.results).not.toContainEqual(
      expect.objectContaining({ id: article.id, type: "kb_article" }),
    );
  });
});

describe("archive, restore and settings", () => {
  it("archives (taking it off the portal), restores to draft, and refuses to publish an archived article", async () => {
    const { article } = await createDraft(w.owner.user, {
      customerVisible: true,
    });
    const published = (await (
      await w.agent(w.owner.user, `/api/kb/articles/${article.id}/publish`, {
        method: "POST",
        body: { version: article.version },
      })
    ).json()) as Article;
    expect(
      (await w.portal(w.customerA.user, `/api/portal/kb/${article.id}`)).status,
    ).toBe(200);

    const archivedResponse = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}/archive`,
      { method: "POST", body: { version: published.version } },
    );
    expect(archivedResponse.status).toBe(200);
    const archived = (await archivedResponse.json()) as Article & {
      publishedVersion: number | null;
    };
    expect(archived.state).toBe("archived");
    expect(archived.publishedVersion).toBeNull();
    expect(
      (await w.portal(w.customerA.user, `/api/portal/kb/${article.id}`)).status,
    ).toBe(404);
    // The version history stays.
    expect(await versionRows(article.id)).toHaveLength(1);

    const refused = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}/publish`,
      { method: "POST", body: { version: archived.version } },
    );
    expect(refused.status).toBe(409);
    const restored = await w.agent(
      w.owner.user,
      `/api/kb/articles/${article.id}/restore`,
      { method: "POST", body: { version: archived.version } },
    );
    expect(restored.status, await restored.clone().text()).toBe(200);
    expect(((await restored.json()) as Article).state).toBe("draft");
    expect(await auditActions(w.workspaceId)).toEqual(
      expect.arrayContaining(["kb_article.archived", "kb_article.restored"]),
    );
  });

  it("tells each caller what they may do", async () => {
    const read = async (user: Parameters<KbWorld["agent"]>[0]) =>
      (await (
        await w.agent(user, `/api/kb/settings?workspaceId=${w.workspaceId}`)
      ).json()) as {
        canWrite: boolean;
        canPublish: boolean;
        canManageSettings: boolean;
        reviewStepEnabled: boolean;
      };
    expect(await read(w.viewer.user)).toMatchObject({
      canWrite: false,
      canPublish: false,
      canManageSettings: false,
      reviewStepEnabled: false,
    });
    expect(await read(w.member.user)).toMatchObject({
      canWrite: true,
      canPublish: false,
    });
    expect(await read(w.owner.user)).toMatchObject({
      canWrite: true,
      canPublish: true,
      canManageSettings: true,
    });
  });

  it("returns the portal base URL only to staff, with the triage suggestions", async () => {
    await insertArticle(w.workspaceId, {
      title: "Reset your VPN password",
      state: "published",
      customerVisible: true,
    });
    const response = await w.agent(
      w.member.user,
      `/api/kb/deflection?workspaceId=${w.workspaceId}&q=reset%20vpn`,
    );
    const body = (await response.json()) as {
      articles: unknown[];
      portalBaseUrl: string | null;
    };
    expect(body.articles).toHaveLength(1);
    expect("portalBaseUrl" in body).toBe(true);
  });
});

describe("existing deletion paths", () => {
  it("lets a workspace be deleted, and a purged project take its articles with it", async () => {
    const scoped = await insertArticle(w.workspaceId, {
      title: "Project scoped",
      state: "published",
      projectId: w.projectA.id,
    });
    const wide = await insertArticle(w.workspaceId, {
      title: "Workspace wide",
      state: "published",
    });
    // A purged project removes the articles scoped to it, and nothing else.
    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, w.projectA.id));
    expect(await articleRow(scoped.id)).toBeUndefined();
    expect(await articleRow(wide.id)).toBeDefined();

    // The workspace delete removes projects before the workspace row; KB rows must not block it.
    await insertArticle(w.workspaceId, {
      title: "Scoped to B",
      state: "published",
      projectId: w.projectB.id,
    });
    await db.transaction(async (tx) => {
      await deleteWorkspaceRoleDependents(tx, [w.workspaceId]);
      await tx
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, w.workspaceId));
    });
    expect(await articleRow(wide.id)).toBeUndefined();
    expect(await versionRows(wide.id)).toHaveLength(0);
  });
});
