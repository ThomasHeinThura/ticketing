/** PG-7 recovery listing: deleted page metadata is update-only and restores through the existing route. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { projectPageTable } from "../../apps/api/src/database/schema-p5-pages";
import { resetTestDatabase } from "./helpers/database";
import {
  doc,
  type PageBody,
  type PagesWorld,
  pagesWorld,
} from "./helpers/p5-pages";
import { ensureAgentSession } from "./helpers/pending-deletion";
import { makeApiKey } from "./helpers/reach-world";

let w: PagesWorld;

beforeEach(async () => {
  await resetTestDatabase();
  w = await pagesWorld();
  await ensureAgentSession(w.editor.user.id);
  await ensureAgentSession(w.reader.user.id);
});

describe("PG-7 deleted page recovery listing", () => {
  it("keeps the default list live-only and gives update-capable staff recovery metadata", async () => {
    const page = await w.json<PageBody>(
      await w.call(w.editor.user, w.base(), {
        method: "POST",
        body: { title: "Recovery runbook", body: doc("private content") },
      }),
      201,
    );
    const deletedAt = new Date();
    const purgeAfter = new Date(deletedAt.getTime() + 30 * 86_400_000);
    await db
      .update(projectPageTable)
      .set({ deletedAt, purgeAfter })
      .where(eq(projectPageTable.id, page.id));

    const ordinary = await w.json<{
      pages: { id: string; deletedAt?: string }[];
    }>(await w.call(w.editor.user, w.base()));
    expect(ordinary.pages.map((entry) => entry.id)).not.toContain(page.id);
    expect(ordinary.pages.every((entry) => entry.deletedAt === undefined)).toBe(
      true,
    );

    const recovery = await w.json<{
      pages: {
        id: string;
        title: string;
        snippet: string;
        deletedAt?: string;
        purgeAfter?: string;
      }[];
      canEdit: boolean;
    }>(await w.call(w.editor.user, `${w.base()}?deletedOnly=true`));
    expect(recovery.canEdit).toBe(true);
    expect(recovery.pages).toEqual([
      expect.objectContaining({
        id: page.id,
        title: "Recovery runbook",
        snippet: "private content",
        deletedAt: deletedAt.toISOString(),
        purgeAfter: purgeAfter.toISOString(),
      }),
    ]);
    expect(recovery.pages[0]).not.toHaveProperty("body");

    const refused = await w.call(w.reader.user, `${w.base()}?deletedOnly=true`);
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain("Recovery runbook");
    const readOnlyKey = await makeApiKey(w.editor.user.id, {
      project: ["read"],
    });
    const keyRefused = await w.app.request(`${w.base()}?deletedOnly=true`, {
      headers: { "x-api-key": readOnlyKey },
    });
    expect(keyRefused.status).toBe(403);
    expect(await keyRefused.text()).not.toContain("Recovery runbook");

    const absent = await w.call(
      w.editor.user,
      `${w.base("missing-project")}?deletedOnly=true`,
    );
    const absentText = await absent.text();
    expect(absent.status).toBe(404);
    for (const user of [w.outsider.user, w.foreign.user]) {
      const unreachable = await w.call(user, `${w.base()}?deletedOnly=true`);
      expect(unreachable.status).toBe(404);
      expect(await unreachable.text()).toBe(absentText);
    }
    const portal = await w.portal(
      w.customer.user,
      `${w.base()}?deletedOnly=true`,
    );
    expect(portal.status).toBe(404);
    expect(await portal.text()).not.toContain("Recovery runbook");

    const restored = await w.json<PageBody>(
      await w.call(w.editor.user, `${w.base()}/${page.id}/undelete`, {
        method: "POST",
      }),
    );
    expect(restored.id).toBe(page.id);
    const afterRestore = await w.json<{ pages: { id: string }[] }>(
      await w.call(w.editor.user, w.base()),
    );
    expect(afterRestore.pages.map((entry) => entry.id)).toContain(page.id);
  });
});
