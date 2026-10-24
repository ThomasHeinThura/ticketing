/**
 * P5-R2-04 / P5-R2-06: deleting a service records what it unlinked (count and project ids, never
 * titles), and the service detail shows a knowledge base link only for an article the caller can see.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { kbArticleTable } from "../../apps/api/src/database/schema-p5-kb";
import { serviceLinkTable } from "../../apps/api/src/database/schema-p5-service";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, requireRow } from "./helpers/fixtures";
import { workItemWorld } from "./helpers/p4-closeout";
import { setKbFlag } from "./helpers/p5-kb";
import { serviceWorld } from "./helpers/p5-service";

beforeEach(async () => resetTestDatabase());

type Detail = {
  id: string;
  links: { kind: string; kbArticleId: string | null }[];
};

async function article(
  workspaceId: string,
  projectId: string | null,
  title: string,
) {
  return requireRow(
    await db
      .insert(kbArticleTable)
      .values({
        workspaceId,
        projectId,
        title,
        body: { type: "doc", content: [] },
      })
      .returning(),
    "article",
  );
}

describe("service delete audit (P5-R2-04)", () => {
  it("records the unlinked count and project ids, no titles, and unlinks every item", async () => {
    const w = await serviceWorld();
    const svc = await w.makeService("Billing");
    const other = await createProjectFixture({ workspaceId: w.workspaceId });
    const a = await workItemWorld(w.workspaceId, w.project.id);
    const b = await workItemWorld(w.workspaceId, other.project.id);
    const items = [
      await a.makeItem("Secret title one"),
      await a.makeItem("Secret title two"),
      await b.makeItem("Secret title three"),
    ];
    for (const item of items)
      await db
        .update(schema.workItemTable)
        .set({ serviceId: svc.id })
        .where(eq(schema.workItemTable.id, item.id));

    const free = await w.ownerCall(`/api/services/${svc.id}`, {
      method: "DELETE",
    });
    expect(free.status, await free.clone().text()).toBe(202);
    const pending = (await free.json()) as { pendingActionId: string };
    const approved = await w.ownerCall(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      { method: "POST", body: {} },
    );
    expect(approved.status, await approved.clone().text()).toBe(200);

    for (const item of items) {
      const [row] = await db
        .select({ serviceId: schema.workItemTable.serviceId })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, item.id));
      expect(row?.serviceId).toBeNull();
    }
    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "service.deleted"));
    const after = (audit?.after ?? {}) as {
      unlinkedWorkItemCount?: number;
      unlinkedProjectIds?: string[];
    };
    expect(after.unlinkedWorkItemCount).toBe(3);
    expect(after.unlinkedProjectIds).toEqual(
      [w.project.id, other.project.id].sort(),
    );
    expect(JSON.stringify([audit?.before, audit?.after])).not.toContain(
      "Secret title",
    );
  });
});

describe("service detail knowledge base links (P5-R2-06)", () => {
  it("shows only articles the caller can see and drops dangling ids", async () => {
    const w = await serviceWorld();
    await setKbFlag(w.workspaceId, true);
    const svc = await w.makeService("Search");
    const open = await article(w.workspaceId, null, "Workspace wide");
    const scoped = await article(w.workspaceId, w.project.id, "Project only");
    for (const id of [open.id, scoped.id]) {
      await db.insert(serviceLinkTable).values({
        workspaceId: w.workspaceId,
        serviceId: svc.id,
        kind: "kb_article",
        kbArticleId: id,
      });
    }
    await db.insert(serviceLinkTable).values({
      workspaceId: w.workspaceId,
      serviceId: svc.id,
      kind: "kb_article",
      kbArticleId: randomUUID(),
    });

    const ownerView = (await (
      await w.ownerCall(`/api/services/${svc.id}`)
    ).json()) as Detail;
    expect(ownerView.links.map((l) => l.kbArticleId).sort()).toEqual(
      [open.id, scoped.id].sort(),
    );

    const viewerRes = await w.as(w.viewer.user, `/api/services/${svc.id}`);
    expect(viewerRes.status, await viewerRes.clone().text()).toBe(200);
    const viewerView = (await viewerRes.json()) as Detail;
    expect(viewerView.links.map((l) => l.kbArticleId)).toEqual([open.id]);
  });

  it("returns no knowledge base links while the knowledge base is off (P5-R3-09)", async () => {
    const w = await serviceWorld();
    const svc = await w.makeService("Search");
    const open = await article(w.workspaceId, null, "Workspace wide");
    await db.insert(serviceLinkTable).values({
      workspaceId: w.workspaceId,
      serviceId: svc.id,
      kind: "kb_article",
      kbArticleId: open.id,
    });
    await setKbFlag(w.workspaceId, false);
    const off = (await (
      await w.ownerCall(`/api/services/${svc.id}`)
    ).json()) as Detail;
    expect(off.links).toEqual([]);
    await setKbFlag(w.workspaceId, true);
    const on = (await (
      await w.ownerCall(`/api/services/${svc.id}`)
    ).json()) as Detail;
    expect(on.links.map((l) => l.kbArticleId)).toEqual([open.id]);
  });
});
