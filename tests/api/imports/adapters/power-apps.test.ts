import { describe, expect, it } from "vitest";
import { createPowerAppsAdapter } from "../../../../apps/api/src/imports/adapters/power-apps";
import { connection, context, fixture, readAll } from "./helpers";

const adapter = createPowerAppsAdapter();
const conn = (extra: Record<string, unknown> = {}) =>
  connection("import.power-apps", {
    csvText: fixture("power-apps/tickets.csv"),
    ...extra,
  });

describe("power apps csv profile", () => {
  it("maps ticket number, subject, status, category, severity and dates", async () => {
    const records = await readAll(adapter, conn());
    expect(records).toHaveLength(52);
    const t = records.find((r) => r.sourceId === "TKT-2026-0004");
    expect(t).toMatchObject({
      sourceType: "ticket",
      title: "Ticket 4: printer on floor 4",
    });
    expect(t?.facets).toContainEqual({ domain: "state", value: "Closed" });
    expect(t?.facets).toContainEqual({ domain: "type", value: "Hardware" });
    expect(t?.facets).toContainEqual({ domain: "priority", value: "Low" });
    expect(t?.facets).toContainEqual({
      domain: "custom_field",
      value: "department",
    });
    expect(t?.sourceCreatedAt).toBe("2026-05-05T08:00:00.000Z");
    expect(t?.dueDate).toBe("2026-06-05T00:00:00.000Z");
  });

  it("keeps resolution notes in the description and reports it; reports requester and extras", async () => {
    const records = await readAll(adapter, conn());
    const t = records.find((r) => r.sourceId === "TKT-2026-0003");
    expect(t?.description).toContain(
      "Resolution notes\nReplaced toner cartridge",
    );
    expect(t?.losses).toContainEqual({
      code: "resolution_notes_in_description",
    });
    expect(t?.requester?.email).toBeTruthy();
    expect(t?.losses).toContainEqual({
      code: "column_ignored",
      detailCode: "modified_by",
    });
    expect(t?.sourceResolvedAt).toBeTruthy();
  });

  it("never invents values for bad cells", async () => {
    const records = await readAll(adapter, conn());
    const bad = records.find((r) => r.sourceId === "TKT-2026-0009");
    expect(bad?.sourceCreatedAt).toBeUndefined();
    expect(bad?.losses).toContainEqual({
      code: "invalid_date",
      detailCode: "created_at",
    });
    const mail = records.find((r) => r.sourceId === "TKT-2026-0012");
    expect(mail?.assigneeEmail).toBeUndefined();
    expect(mail?.losses).toContainEqual({
      code: "invalid_email",
      detailCode: "assignee",
    });
    // missing ticket number: stable hashed id, reported
    const hashed = records.find((r) => r.sourceId.startsWith("row-"));
    expect(hashed?.losses).toContainEqual({ code: "external_id_missing" });
  });

  it("proposes states, severities and persons; leaves unknown statuses for the operator", async () => {
    const d = await adapter.discover(conn());
    const proposals = await adapter.proposeMapping(d, context);
    const group = (v: string) => {
      const p = proposals.find((x) => x.domain === "state" && x.value === v);
      return p?.target.kind === "group" ? p.target.group : undefined;
    };
    expect(group("New")).toBe("unstarted");
    expect(group("In Progress")).toBe("started");
    expect(group("Resolved")).toBe("completed");
    expect(group("Cancelled")).toBe("cancelled");
    expect(group("Awaiting customer")).toBeUndefined();
    const crit = proposals.find(
      (p) => p.domain === "priority" && p.value === "Critical",
    );
    expect(crit?.target).toEqual({ kind: "priority", value: "urgent" });
  });

  it("the saved column map and categoryAs=label override the built-in profile", async () => {
    const records = await readAll(
      adapter,
      connection("import.power-apps", {
        csvText: "Ref,What,Kind,Status\nR1,Broken screen,Hardware,Open",
        columnMap: { external_id: "Ref", title: "What", category: "Kind" },
        categoryAs: "label",
        defaultType: "Incident",
      }),
    );
    expect(records[0]).toMatchObject({
      sourceId: "R1",
      title: "Broken screen",
    });
    expect(records[0]?.facets).toContainEqual({
      domain: "label",
      value: "Hardware",
    });
    expect(records[0]?.facets).toContainEqual({
      domain: "type",
      value: "Incident",
    });
  });
});
