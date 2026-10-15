/**
 * #580 batch 4: behaviour pins for publishing a workflow version once its statements live
 * in the workflow repository -- the response carries only the published version's own
 * transitions, records who published it, activates exactly that version, and the workflow
 * tree lists every version with its transitions.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

function call(method: string, path: string, body?: unknown) {
  const { app } = createApp();
  return app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("API integration: workflow publish response and tree", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("publishes version 2 with only its own transitions, records the publisher and activates it", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const [backlog, active, done] = await db
      .insert(schema.stateTemplateTable)
      .values([
        {
          workspaceId: owner.workspace.id,
          key: "backlog",
          name: "Backlog",
          group: "backlog",
        },
        {
          workspaceId: owner.workspace.id,
          key: "active",
          name: "Active",
          group: "started",
        },
        {
          workspaceId: owner.workspace.id,
          key: "done",
          name: "Done",
          group: "completed",
        },
      ])
      .returning();
    const b = requireRow([backlog], "backlog").id;
    const a = requireRow([active], "active").id;
    const d = requireRow([done], "done").id;
    const t = (from: string, to: string) => ({
      fromStateTemplateId: from,
      toStateTemplateId: to,
      notePolicy: "none",
      noteVisibility: "internal",
    });

    const created = await call("POST", "/api/workflows", {
      workspaceId: owner.workspace.id,
      key: "flow",
      name: "Flow",
    });
    const workflow = (await created.json()) as { id: string };
    const v1 = await call("POST", `/api/workflows/${workflow.id}/versions`, {
      transitions: [t(b, d)],
    });
    expect(((await v1.json()) as { number: number }).number).toBe(1);
    const v2 = await call("POST", `/api/workflows/${workflow.id}/versions`, {
      transitions: [t(b, a), t(a, d)],
    });
    const v2Body = (await v2.json()) as { id: string; number: number };
    expect(v2Body.number).toBe(2);

    const published = await call(
      "POST",
      `/api/workflows/${workflow.id}/versions/2/publish`,
    );
    expect(published.status).toBe(200);
    const body = (await published.json()) as {
      id: string;
      publishedAt: string | null;
      publishedBy: string | null;
      transitions: unknown[];
    };
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id));
    expect(body.id).toBe(v2Body.id);
    expect(body.publishedAt).not.toBeNull();
    expect(body.publishedBy).toBe(person?.id);
    expect(body.transitions).toHaveLength(2);

    const tree = (await (
      await call("GET", `/api/workflows/${workflow.id}`)
    ).json()) as {
      activeVersionId: string;
      versions: { number: number; transitions: unknown[] }[];
    };
    expect(tree.activeVersionId).toBe(v2Body.id);
    expect(
      tree.versions
        .map((v) => [v.number, v.transitions.length])
        .sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0)),
    ).toEqual([
      [1, 1],
      [2, 2],
    ]);

    const missing = await call(
      "POST",
      `/api/workflows/${workflow.id}/versions/9/publish`,
    );
    expect(missing.status).toBe(404);
    await missing.text();
  });
});
