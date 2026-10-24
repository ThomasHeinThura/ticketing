/**
 * P5 releases (REL-1..REL-5) and the country holiday presets (CAL-10, CAL-11): a release groups
 * changes, instantiates its service's checklist, generates editable notes, locks them on
 * publication; presets are previewed before they are appended and never overwrite.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { changeDetailTable } from "../../apps/api/src/database/schema-p5-service";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import { workItemWorld } from "./helpers/p4-closeout";
import { serviceWorld } from "./helpers/p5-service";

type ReleaseBody = {
  id: string;
  name: string;
  status: string;
  version: number;
  notes: string | null;
  notesRedacted: boolean;
  notesLocked: boolean;
  publishToPortal: boolean;
  publishedAt: string | null;
  changes: { key: string; title: string }[];
  hiddenChangeCount: number;
  checklist: { id: string; text: string; done: boolean }[];
};

beforeEach(async () => resetTestDatabase());

async function releaseWorld() {
  const w = await serviceWorld();
  const service = await w.ownerCall("/api/services", {
    method: "POST",
    body: {
      workspaceId: w.workspaceId,
      name: "Checkout",
      releaseChecklist: ["Smoke test", "Tell support"],
    },
  });
  const serviceId = ((await service.json()) as { id: string }).id;
  const changeType = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: w.workspaceId,
        key: `chg-${randomUUID().slice(0, 6)}`,
        name: "Change",
        category: "service",
        isChange: true,
      })
      .returning(),
    "change type",
  );
  const world = await workItemWorld(w.workspaceId, w.project.id);
  async function change(title: string) {
    const item = await world.makeItem(title);
    await db
      .update(schema.workItemTable)
      .set({ typeId: changeType.id })
      .where(eq(schema.workItemTable.id, item.id));
    return item;
  }
  const create = async (body: Record<string, unknown> = {}) => {
    const response = await w.ownerCall("/api/releases", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "R1", serviceId, ...body },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as ReleaseBody;
  };
  return { w, serviceId, change, create, changeType, world };
}

describe("releases", () => {
  it("creates a release for a service, groups changes and instantiates the checklist (REL-1, REL-2, REL-3)", async () => {
    const { w, change, create } = await releaseWorld();
    const a = await change("Patch the gateway");
    const b = await change("Rotate keys");
    const release = await create({
      plannedDate: "2031-02-01",
      changeKeys: [a.key, b.key],
    });
    expect(release.status).toBe("planned");
    expect(release.changes.map((c) => c.key).sort()).toEqual(
      [a.key, b.key].sort(),
    );
    expect(release.checklist.map((i) => i.text)).toEqual([
      "Smoke test",
      "Tell support",
    ]);
    // The change shows its release (REL-2).
    const detail = await w.ownerCall(`/api/work-items/${a.key}/change`);
    expect(
      ((await detail.json()) as { detail: { release: { name: string } } })
        .detail.release.name,
    ).toBe("R1");
    const list = await w.ownerCall(
      `/api/releases?workspaceId=${w.workspaceId}`,
    );
    const rows = (
      (await list.json()) as {
        data: { changeCount: number; checklistTotal: number }[];
      }
    ).data;
    expect(rows[0]).toMatchObject({ changeCount: 2, checklistTotal: 2 });
  });

  it("allows a release with no changes: the notes say so (edge case)", async () => {
    const { w, create } = await releaseWorld();
    const release = await create();
    const notes = await w.ownerCall(`/api/releases/${release.id}/notes`, {
      method: "POST",
      body: { regenerate: true },
    });
    expect(notes.status, await notes.clone().text()).toBe(200);
    expect(((await notes.json()) as ReleaseBody).notes).toContain(
      "No changes are associated",
    );
  });

  it("generates notes from the changes, keeps an edit, and regenerates on demand (REL-4)", async () => {
    const { w, change, create } = await releaseWorld();
    const a = await change("Patch the gateway");
    const release = await create({ changeKeys: [a.key] });
    const generated = await w.ownerCall(`/api/releases/${release.id}/notes`, {
      method: "POST",
      body: { regenerate: true },
    });
    const first = (await generated.json()) as ReleaseBody;
    expect(first.notes).toContain(`${a.key}: Patch the gateway`);
    const edited = await w.ownerCall(`/api/releases/${release.id}/notes`, {
      method: "POST",
      body: { notes: "Hand written notes" },
    });
    expect(((await edited.json()) as ReleaseBody).notes).toBe(
      "Hand written notes",
    );
    const read = await w.ownerCall(`/api/releases/${release.id}`);
    expect(((await read.json()) as ReleaseBody).notes).toBe(
      "Hand written notes",
    );
    const again = await w.ownerCall(`/api/releases/${release.id}/notes`, {
      method: "POST",
      body: { regenerate: true },
    });
    expect(((await again.json()) as ReleaseBody).notes).toContain(a.key);
    const neither = await w.ownerCall(`/api/releases/${release.id}/notes`, {
      method: "POST",
      body: {},
    });
    expect(neither.status).toBe(400);
  });

  it("publishes to the portal only when switched on and released, and then locks the notes (REL-5)", async () => {
    const { w, create } = await releaseWorld();
    const release = await create();
    expect(release.publishToPortal).toBe(false);
    const on = await w.ownerCall(`/api/releases/${release.id}`, {
      method: "PATCH",
      body: { publishToPortal: true },
    });
    const switched = (await on.json()) as ReleaseBody;
    expect(switched.publishToPortal).toBe(true);
    // Off by default and not published until the release is actually released.
    expect(switched.publishedAt).toBeNull();
    const released = await w.ownerCall(`/api/releases/${release.id}`, {
      method: "PATCH",
      body: { status: "released" },
    });
    const done = (await released.json()) as ReleaseBody;
    expect(done.publishedAt).not.toBeNull();
    expect(done.notesLocked).toBe(true);
    const locked = await w.ownerCall(`/api/releases/${release.id}/notes`, {
      method: "POST",
      body: { notes: "Too late" },
    });
    expect(locked.status).toBe(409);
    const actions = (
      await db
        .select({ action: schema.auditLogTable.action })
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.workspaceId, w.workspaceId))
    ).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining(["release.created", "release.published"]),
    );
  });

  it("ticks checklist items and refuses a stale version", async () => {
    const { w, create } = await releaseWorld();
    const release = await create();
    const item = release.checklist[0];
    const tick = await w.ownerCall(
      `/api/releases/${release.id}/checklist/${item?.id}`,
      { method: "PATCH", body: { done: true } },
    );
    expect(tick.status, await tick.clone().text()).toBe(200);
    const read = await w.ownerCall(`/api/releases/${release.id}`);
    expect(
      ((await read.json()) as ReleaseBody).checklist.find(
        (i) => i.id === item?.id,
      )?.done,
    ).toBe(true);
    const missing = await w.ownerCall(
      `/api/releases/${release.id}/checklist/${randomUUID()}`,
      { method: "PATCH", body: { done: true } },
    );
    expect(missing.status).toBe(404);
    const stale = await w.ownerCall(`/api/releases/${release.id}`, {
      method: "PATCH",
      body: { name: "Renamed", version: 99 },
    });
    expect(stale.status).toBe(409);
  });

  it("refuses an unknown service, a non-change work item and a change in a project the caller cannot reach", async () => {
    const { w, serviceId, change, create, changeType, world } =
      await releaseWorld();
    const unknownService = await w.ownerCall("/api/releases", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "X", serviceId: randomUUID() },
    });
    expect(unknownService.status).toBe(422);
    const task = await world.makeItem("Not a change");
    const notChange = await w.ownerCall("/api/releases", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Y",
        serviceId,
        changeKeys: [task.key],
      },
    });
    expect(notChange.status).toBe(422);
    // A change in a hidden project is not associable and is counted, not named, in a release.
    const { project: hidden } = await createProjectFixture({
      workspaceId: w.workspaceId,
    });
    const secretWorld = await workItemWorld(w.workspaceId, hidden.id);
    const secret = await secretWorld.makeItem("Secret change");
    const visible = await change("Visible");
    const release = await create({ changeKeys: [visible.key] });
    await db
      .update(schema.workItemTable)
      .set({ typeId: changeType.id })
      .where(eq(schema.workItemTable.id, secret.id));
    await db.insert(changeDetailTable).values({
      workItemId: secret.id,
      workspaceId: w.workspaceId,
      releaseId: release.id,
    });
    const detail = await w.ownerCall(`/api/releases/${release.id}`);
    const body = (await detail.json()) as ReleaseBody;
    expect(body.changes.map((c) => c.key)).toEqual([visible.key]);
    expect(body.hiddenChangeCount).toBe(1);
    expect(JSON.stringify(body)).not.toContain("Secret change");
    const attach = await w.ownerCall(`/api/releases/${release.id}`, {
      method: "PATCH",
      body: { changeKeys: [visible.key, secret.key] },
    });
    expect(attach.status).toBe(422);
    // Editing the visible set never detaches a change the caller cannot see.
    for (const changeKeys of [[visible.key], []]) {
      const edited = await w.ownerCall(`/api/releases/${release.id}`, {
        method: "PATCH",
        body: { changeKeys },
      });
      expect(edited.status, await edited.clone().text()).toBe(200);
      const after = (await edited.json()) as ReleaseBody;
      expect(after.hiddenChangeCount).toBe(1);
      expect(after.changes.map((c) => c.key)).toEqual(changeKeys);
    }
    const stillAttached = await db
      .select({ releaseId: changeDetailTable.releaseId })
      .from(changeDetailTable)
      .where(eq(changeDetailTable.workItemId, secret.id));
    expect(stillAttached[0]?.releaseId).toBe(release.id);
  });

  it("withholds stored notes from a reader who cannot reach every change, but not from a release manager (P5-R1-05)", async () => {
    const { w, change, create, changeType } = await releaseWorld();
    await grantProjectRole(w.viewer.user.id, w.project.id, ["project:read"]);
    const visible = await change("Visible patch");
    const release = await create({ changeKeys: [visible.key] });
    const { project: hidden } = await createProjectFixture({
      workspaceId: w.workspaceId,
    });
    const secret = await (
      await workItemWorld(w.workspaceId, hidden.id)
    ).makeItem("Classified rotation");
    await db
      .update(schema.workItemTable)
      .set({ typeId: changeType.id })
      .where(eq(schema.workItemTable.id, secret.id));
    await db.insert(changeDetailTable).values({
      workItemId: secret.id,
      workspaceId: w.workspaceId,
      releaseId: release.id,
    });
    const notesPath = `/api/releases/${release.id}/notes`;
    const regenerated = await w.ownerCall(notesPath, {
      method: "POST",
      body: { regenerate: true },
    });
    expect(regenerated.status, await regenerated.clone().text()).toBe(200);
    const edited = await w.ownerCall(notesPath, {
      method: "POST",
      body: { notes: `Shipping ${secret.key}: Classified rotation` },
    });
    expect(edited.status).toBe(200);

    // The manager reads the stored notes, hidden change or not.
    const asOwner = (await (
      await w.ownerCall(`/api/releases/${release.id}`)
    ).json()) as ReleaseBody;
    expect(asOwner.notesRedacted).toBe(false);
    expect(asOwner.notes).toContain("Classified rotation");

    // A project:read holder who does not reach every change gets no notes, and a flag.
    const read = await w.as(w.viewer.user, `/api/releases/${release.id}`);
    expect(read.status, await read.clone().text()).toBe(200);
    const asViewer = (await read.json()) as ReleaseBody;
    expect(asViewer.hiddenChangeCount).toBe(1);
    expect(asViewer.notesRedacted).toBe(true);
    expect(asViewer.notes).toBeNull();
    expect(JSON.stringify(asViewer)).not.toContain("Classified rotation");
    expect(JSON.stringify(asViewer)).not.toContain(secret.key);

    // Once every change is within the reader's reach the notes are returned.
    await db
      .update(changeDetailTable)
      .set({ releaseId: null })
      .where(eq(changeDetailTable.workItemId, secret.id));
    const after = (await (
      await w.as(w.viewer.user, `/api/releases/${release.id}`)
    ).json()) as ReleaseBody;
    expect(after.hiddenChangeCount).toBe(0);
    expect(after.notesRedacted).toBe(false);
    expect(after.notes).toContain("Classified rotation");
  });

  it("blocks deleting a service that has releases", async () => {
    const { w, serviceId, create } = await releaseWorld();
    await create();
    const refused = await w.ownerCall(`/api/services/${serviceId}`, {
      method: "DELETE",
    });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("release");
  });

  it("denies a member, lets a viewer read, and isolates tenants", async () => {
    const { w, create } = await releaseWorld();
    const release = await create();
    const write = await w.as(w.member.user, "/api/releases", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Nope",
        serviceId: randomUUID(),
      },
    });
    expect(write.status).toBe(403);
    const patch = await w.as(w.member.user, `/api/releases/${release.id}`, {
      method: "PATCH",
      body: { name: "Nope" },
    });
    expect(patch.status).toBe(403);
    const read = await w.as(
      w.viewer.user,
      `/api/releases?workspaceId=${w.workspaceId}`,
    );
    expect(read.status, await read.clone().text()).toBe(200);
    for (const [method, path, body] of [
      ["GET", `/api/releases/${release.id}`, undefined],
      ["PATCH", `/api/releases/${release.id}`, { name: "Hijack" }],
      ["POST", `/api/releases/${release.id}/notes`, { notes: "Hijack" }],
    ] as const) {
      const response = await w.as(w.stranger.user, path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const foreignList = await w.as(
      w.stranger.user,
      `/api/releases?workspaceId=${w.workspaceId}`,
    );
    expect(foreignList.status).toBe(403);
  });
});

describe("country holiday presets (CAL-10, CAL-11)", () => {
  async function calendarWorld() {
    const w = await serviceWorld();
    const created = await w.ownerCall("/api/service-calendars", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "UK support",
        timezone: "Europe/London",
        windows: { mon: [{ from: 540, to: 1020 }] },
        holidays: [{ date: "2026-12-25", name: "Christmas Day" }],
      },
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const calendar = (await created.json()) as { id: string; version: number };
    return { w, calendar };
  }
  type PresetBody = {
    datasetVersion: string;
    notIncluded: string;
    applied: boolean;
    importedCount: number;
    duplicateCount: number;
    holidays: { date: string; name: string; existing: boolean }[];
  };

  it("lists bundled presets with the dataset version", async () => {
    const { w, calendar } = await calendarWorld();
    const response = await w.ownerCall(
      `/api/service-calendars/${calendar.id}/holidays/presets`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      datasetVersion: string;
      presets: { country: string }[];
    };
    expect(body.datasetVersion).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    expect(body.presets.map((p) => p.country)).toContain("GB");
  });

  it("previews by default without saving, then appends only the missing dates on confirmation", async () => {
    const { w, calendar } = await calendarWorld();
    const url = `/api/service-calendars/${calendar.id}/holidays/preset`;
    const preview = await w.ownerCall(url, {
      method: "POST",
      body: { country: "GB", year: 2026 },
    });
    expect(preview.status, await preview.clone().text()).toBe(200);
    const proposed = (await preview.json()) as PresetBody;
    expect(proposed.applied).toBe(false);
    expect(proposed.notIncluded.length).toBeGreaterThan(10);
    expect(
      proposed.holidays.find((h) => h.date === "2026-12-25")?.existing,
    ).toBe(true);
    const stored = await db
      .select({ holidays: schema.serviceCalendarTable.holidays })
      .from(schema.serviceCalendarTable)
      .where(eq(schema.serviceCalendarTable.id, calendar.id));
    expect(stored[0]?.holidays as unknown[]).toHaveLength(1);

    const applied = await w.ownerCall(url, {
      method: "POST",
      body: { country: "GB", year: 2026, preview: false },
    });
    expect(applied.status, await applied.clone().text()).toBe(200);
    const result = (await applied.json()) as PresetBody;
    expect(result.applied).toBe(true);
    expect(result.duplicateCount).toBe(1);
    expect(result.importedCount).toBe(proposed.holidays.length - 1);
    const after = await db
      .select({ holidays: schema.serviceCalendarTable.holidays })
      .from(schema.serviceCalendarTable)
      .where(eq(schema.serviceCalendarTable.id, calendar.id));
    expect(after[0]?.holidays as unknown[]).toHaveLength(
      proposed.holidays.length,
    );
  });

  it("refuses an unknown country, a stale version and a caller without sla_policy:manage", async () => {
    const { w, calendar } = await calendarWorld();
    const url = `/api/service-calendars/${calendar.id}/holidays/preset`;
    const unknown = await w.ownerCall(url, {
      method: "POST",
      body: { country: "ZZ", year: 2026 },
    });
    expect(unknown.status).toBe(400);
    mockAuthenticatedSession(w.owner.user);
    const stale = await w.app.request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "if-match": '"99"' },
      body: JSON.stringify({ country: "GB", year: 2026, preview: false }),
    });
    expect(stale.status).toBe(409);
    const denied = await w.as(w.viewer.user, url, {
      method: "POST",
      body: { country: "GB", year: 2026, preview: false },
    });
    expect(denied.status).toBe(403);
    const foreign = await w.as(w.stranger.user, url, {
      method: "POST",
      body: { country: "GB", year: 2026 },
    });
    expect(foreign.status).toBe(404);
  });
});
