import { describe, expect, it } from "vitest";
import { ensureImportAdaptersRegistered } from "../../../../apps/api/src/imports/adapters";
import { createBundleAdapter } from "../../../../apps/api/src/imports/adapters/bundle";
import { getImportAdapter } from "../../../../apps/api/src/imports/engine/adapter";
import { connection, context, fixture, readAll } from "./helpers";

const adapter = createBundleAdapter();
const bundleText = fixture("bundle/two-projects.ndjson");
const conn = (extra: Record<string, unknown> = {}) =>
  connection("import.bundle", { bundleText, projectKey: "WEB", ...extra });

describe("import.bundle adapter", () => {
  it("registers under its plugin id", () => {
    ensureImportAdaptersRegistered();
    expect(getImportAdapter("import.bundle")?.pluginId).toBe("import.bundle");
  });

  it("connects, filters one project and reports configuration problems with fixed reasons", async () => {
    expect(await adapter.connect(conn())).toEqual({
      ok: true,
      label: "bundle WEB (4)",
    });
    expect(await adapter.connect(conn({ projectKey: "web" }))).toMatchObject({
      ok: true,
    });
    expect(await adapter.connect(conn({ projectKey: "NOPE" }))).toEqual({
      ok: false,
      reason: "not_found",
    });
    // Two projects and no key: the run cannot tell which one is meant.
    expect(
      await adapter.connect(connection("import.bundle", { bundleText })),
    ).toEqual({ ok: false, reason: "invalid_configuration" });
    expect(await adapter.connect(conn({ projectKey: "../etc" }))).toEqual({
      ok: false,
      reason: "invalid_configuration",
    });
    expect(await adapter.connect(connection("import.bundle", {}))).toEqual({
      ok: false,
      reason: "export_text_missing",
    });
    expect(
      await adapter.connect(conn({ bundleText: `${bundleText}\nnot json` })),
    ).toEqual({ ok: false, reason: "invalid_export" });
    expect(
      await adapter.connect(conn({ bundleText: "x".repeat(8_000_001) })),
    ).toEqual({ ok: false, reason: "file_too_large" });
  });

  it("pages deterministically by cursor in file order", async () => {
    const all = await readAll(adapter, conn());
    expect(all.map((r) => r.sourceId)).toEqual(["w1", "w2", "w3", "w4"]);
    expect(await readAll(adapter, conn(), 1)).toEqual(all);
    const first = await adapter.readPage(conn(), null, 3);
    expect(first.nextCursor).toBe("3");
    expect(
      (await adapter.readPage(conn(), "3", 3)).records.map((r) => r.sourceId),
    ).toEqual(["w4"]);
    expect((await adapter.readPage(conn(), "3", 3)).nextCursor).toBeNull();
    // Same call, same answer (resume after a crash).
    expect(await adapter.readPage(conn(), "1", 2)).toEqual(
      await adapter.readPage(conn(), "1", 2),
    );
    await expect(adapter.readPage(conn(), "99", 3)).rejects.toThrow();
    await expect(adapter.readPage(conn(), "-1", 3)).rejects.toThrow();
    // The other project is its own run.
    const ops = await readAll(adapter, conn({ projectKey: "OPS" }));
    expect(ops.map((r) => r.sourceId)).toEqual(["o1", "o2"]);
  });

  it("builds the record from the bundle: facets, people, nested rows and provenance ids", async () => {
    const [w1] = await readAll(adapter, conn());
    expect(w1).toMatchObject({
      sourceType: "issue",
      sourceId: "w1",
      sourceUrl: "https://plane.lan/acme/projects/p1/issues/w1",
      title: "Fix the login redirect",
      assigneeEmail: "ana.lopez@example.test",
      sourceAuthorEmail: "ben.ito@example.test",
      sourceAuthorName: "Ben Ito",
      requester: { email: "ben.ito@example.test", name: "Ben Ito" },
      sourceCreatedAt: "2026-01-05T09:00:00.000Z",
      dueDate: "2026-02-15T00:00:00.000Z",
    });
    expect(w1?.facets).toEqual([
      { domain: "type", value: "task" },
      { domain: "state", value: "In Review (started)" },
      { domain: "priority", value: "high" },
      { domain: "label", value: "bug" },
      { domain: "label", value: "frontend" },
    ]);
    // Comment authorship and timestamps travel; no visibility means the writer's internal default.
    expect(w1?.comments?.[0]).toEqual({
      sourceId: "c1",
      authorEmail: "ana.lopez@example.test",
      authorName: "Ana Lopez",
      createdAt: "2026-01-06T11:30:00.000Z",
      body: "Reproduced on staging.",
    });
    expect(w1?.attachments?.[0]).toMatchObject({
      sourceId: "a1",
      filename: "screenshot.png",
      authorEmail: "ana.lopez@example.test",
    });
    expect(w1?.history?.[0]).toMatchObject({
      sourceId: "h1",
      field: "state",
      from: "Todo",
      to: "In Review",
    });
    const w2 = (await readAll(adapter, conn()))[1];
    expect(w2?.parentSourceId).toBe("w1");
    expect(w2?.relations).toEqual([
      { type: "blocks", target: { sourceType: "issue", sourceId: "w1" } },
    ]);
  });

  it("reports requester-adjacent, estimate, cycle, module and link fields as losses, never silently", async () => {
    const [w1] = await readAll(adapter, conn());
    expect(w1?.losses).toEqual(
      expect.arrayContaining([
        { code: "estimate_not_carried" },
        { code: "cycle_not_carried" },
        { code: "module_not_carried" },
        { code: "links_not_carried" },
      ]),
    );
    // The engine reports `writer_unavailable/requester` from the record's requester.
    expect(w1?.requester).toBeDefined();
  });

  it("keeps a person without an email by name only and reports it", async () => {
    const records = await readAll(adapter, conn());
    const w1 = records[0];
    const w2 = records[1];
    expect(w1?.comments?.[1]).toMatchObject({
      sourceId: "c2",
      authorName: "Casey No-Email",
    });
    expect(w1?.comments?.[1]).not.toHaveProperty("authorEmail");
    expect(w1?.losses).toContainEqual({
      code: "person_email_missing",
      detailCode: "comment",
    });
    expect(w2).not.toHaveProperty("assigneeEmail");
    expect(w2?.losses).toContainEqual({
      code: "person_email_missing",
      detailCode: "assignee",
    });
  });

  it("discovers facets with counts and counts what slice 1 does not write", async () => {
    const found = await adapter.discover(conn());
    expect(found.totalRecords).toBe(4);
    expect(found.counts).toEqual({
      issue: 4,
      membership_not_written: 2,
      state_not_written: 3,
      label_not_written: 2,
    });
    const count = (domain: string, value: string) =>
      found.facets.find((f) => f.domain === domain && f.value === value)?.count;
    expect(count("type", "task")).toBe(3);
    expect(count("label", "bug")).toBe(2);
    expect(count("state", "Todo (unstarted)")).toBe(2);
    expect(count("person", "ana.lopez@example.test")).toBe(2);
    expect(found.facets.some((f) => f.value === "No-Email")).toBe(false);
  });

  it("proposes only exact matches and leaves the rest unmapped", async () => {
    const found = await adapter.discover(conn());
    const proposals = await adapter.proposeMapping(found, context);
    const byKey = new Map(proposals.map((p) => [`${p.domain}|${p.value}`, p]));
    expect(byKey.get("state|In Review (started)")?.target).toEqual({
      kind: "group",
      group: "started",
    });
    expect(byKey.get("priority|high")?.target).toEqual({
      kind: "priority",
      value: "high",
    });
    expect(byKey.get("type|task")?.target).toEqual({
      kind: "target",
      id: "type-task",
    });
    expect(byKey.get("person|ana.lopez@example.test")?.target).toEqual({
      kind: "target",
      id: "person-ana",
    });
    // No staff match for Ben, no type "bug" in the destination, labels carry no destination ids.
    expect(byKey.has("person|ben.ito@example.test")).toBe(false);
    expect(byKey.has("type|bug")).toBe(false);
    expect([...byKey.keys()].some((k) => k.startsWith("label|"))).toBe(false);
  });

  it("counts the converter's header warnings and refuses a malformed one", async () => {
    const warned = bundleText.replace(
      '"exportedAt":"2026-11-27T08:00:00.000Z"}',
      '"exportedAt":"2026-11-27T08:00:00.000Z"},"warnings":[{"code":"attachments_truncated","item":"w1","omitted":1},{"code":"endpoint_not_supported","endpoint":"cycles"}]',
    );
    expect(warned).not.toBe(bundleText);
    const found = await adapter.discover(conn({ bundleText: warned }));
    expect(found.counts.converter_warnings).toBe(2);
    expect((await adapter.discover(conn())).counts).not.toHaveProperty(
      "converter_warnings",
    );
    const bad = bundleText.replace(
      '"exportedAt":"2026-11-27T08:00:00.000Z"}',
      '"exportedAt":"2026-11-27T08:00:00.000Z"},"warnings":[{"code":"x","extra":1}]',
    );
    expect(await adapter.connect(conn({ bundleText: bad }))).toEqual({
      ok: false,
      reason: "invalid_export",
    });
  });
});
