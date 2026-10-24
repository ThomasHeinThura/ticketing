/**
 * `feature.pages` gate (P5-R4-05): off (the default) means every Pages route answers 404
 * `feature_disabled` and pages are absent from canonical search; on, everything works. Rows are
 * retained and return on re-enable.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "./helpers/database";
import {
  doc,
  type PageBody,
  type PagesWorld,
  pagesWorld,
  setPagesFlag,
} from "./helpers/p5-pages";

let w: PagesWorld;
let pageId: string;
beforeEach(async () => {
  await resetTestDatabase();
  w = await pagesWorld();
  const page = await w.json<PageBody>(
    await w.call(w.editor.user, w.base(), {
      method: "POST",
      body: { title: "Gated quokka", body: doc("gated body") },
    }),
    201,
  );
  pageId = page.id;
});

function routes() {
  const base = w.base();
  return [
    ["GET", base, undefined],
    ["POST", base, { title: "x", body: doc("x") }],
    ["GET", `${base}/${pageId}`, undefined],
    ["PATCH", `${base}/${pageId}`, { expectedVersion: 1, title: "y" }],
    ["GET", `${base}/${pageId}/versions`, undefined],
    ["GET", `${base}/${pageId}/versions/1`, undefined],
    ["POST", `${base}/${pageId}/restore`, { number: 1, expectedVersion: 1 }],
    ["POST", `${base}/${pageId}/undelete`, {}],
    ["DELETE", `${base}/${pageId}`, undefined],
  ] as const;
}

const search = () =>
  w.call(
    w.editor.user,
    `/api/search?q=quokka&workspaceId=${w.workspaceId}&type=all`,
  );

describe("feature.pages gate", () => {
  it("off: every pages route is 404 feature_disabled and search omits pages", async () => {
    await setPagesFlag([w.project.id], false);
    for (const [method, path, body] of routes()) {
      const response = await w.call(w.editor.user, path, { method, body });
      const text = await response.text();
      expect(response.status, `${method} ${path}: ${text}`).toBe(404);
      expect(text).toContain("feature_disabled");
    }
    const hits = await w.json<{ results: Array<{ type: string }> }>(
      await search(),
    );
    expect(hits.results.some((r) => r.type === "page")).toBe(false);
  });

  it("off by default when no flag row exists", async () => {
    const fresh = await pagesWorld({ pagesOn: false });
    const response = await fresh.call(fresh.editor.user, fresh.base());
    expect(response.status).toBe(404);
  });

  it("on: routes work and search finds the page; off then on keeps the rows", async () => {
    expect((await w.call(w.editor.user, w.base())).status).toBe(200);
    const hits = await w.json<{ results: Array<{ type: string; id: string }> }>(
      await search(),
    );
    expect(hits.results.some((r) => r.type === "page" && r.id === pageId)).toBe(
      true,
    );
    await setPagesFlag([w.project.id], false);
    expect((await w.call(w.editor.user, w.base())).status).toBe(404);
    await setPagesFlag([w.project.id], true);
    const again = await w.json<PageBody>(
      await w.call(w.editor.user, `${w.base()}/${pageId}`),
    );
    expect(again.id).toBe(pageId);
  });

  it("search is per project: only the project with the flag on contributes", async () => {
    await setPagesFlag([w.otherProject.id], false);
    const hits = await w.json<{
      results: Array<{ type: string; projectId?: string }>;
    }>(await search());
    expect(
      hits.results.filter((r) => r.type === "page").map((r) => r.projectId),
    ).toEqual([w.project.id]);
  });
});
