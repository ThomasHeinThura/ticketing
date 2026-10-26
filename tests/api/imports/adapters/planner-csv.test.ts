import { describe, expect, it } from "vitest";
import { createPlannerCsvAdapter } from "../../../../apps/api/src/imports/adapters/planner-csv";
import { connection, context, fixture, readAll } from "./helpers";

const adapter = createPlannerCsvAdapter();
const conn = (extra: Record<string, unknown> = {}) =>
  connection("import.planner", {
    csvText: fixture("planner-csv/plan-export.csv"),
    ...extra,
  });

describe("planner csv profile", () => {
  it("reads a Planner export: ids, bucket/progress state, priority, assignee, labels, dates", async () => {
    const records = await readAll(adapter, conn());
    expect(records).toHaveLength(56);
    const todo = records.find((r) => r.sourceId === "PL0001");
    expect(todo).toMatchObject({ sourceType: "task", title: "Planner task 1" });
    expect(todo?.facets).toContainEqual({
      domain: "state",
      value: "To do | Not started",
    });
    expect(todo?.facets).toContainEqual({
      domain: "priority",
      value: "Important",
    });
    expect(todo?.facets).toContainEqual({ domain: "type", value: "task" });
    expect(todo?.facets).toContainEqual({ domain: "label", value: "Green" });
    const multi = records.find((r) => r.sourceId === "PL0003");
    expect(multi?.facets).toContainEqual({ domain: "label", value: "Red" });
    expect(multi?.facets).toContainEqual({ domain: "label", value: "Blue" });
    // first address is the assignee, the rest are reported (watchers are unsupported)
    expect(todo?.assigneeEmail).toBe("ben.okafor@example.test");
    expect(todo?.losses).toContainEqual({
      code: "additional_assignees_not_imported",
    });
    expect(todo?.sourceAuthorEmail).toBe("ana.lopez@example.test");
    expect(todo?.startDate).toBe("2026-03-02T00:00:00.000Z");
    expect(todo?.dueDate).toBe("2026-04-02T00:00:00.000Z");
  });

  it("reports display names, bad dates, checklist and unsupported columns", async () => {
    const records = await readAll(adapter, conn());
    const by = (id: string) => records.find((r) => r.sourceId === id);
    // "Dana Whitfield" is a display name, not an e-mail
    const named = by("PL0002");
    expect(named?.assigneeEmail).toBeUndefined();
    expect(named?.losses).toContainEqual({
      code: "person_not_email",
      detailCode: "assignee",
    });
    expect(by("PL0005")?.losses).toContainEqual({
      code: "invalid_date",
      detailCode: "created_at",
    });
    expect(by("PL0005")?.sourceCreatedAt).toBeUndefined();
    const withChecklist = by("PL0010");
    expect(withChecklist?.description).toContain(
      "Checklist (1/3 of 3 completed)",
    );
    expect(withChecklist?.description).toContain("- Draft\n- Review\n- Ship");
    expect(withChecklist?.losses).toContainEqual({
      code: "checklist_flattened",
    });
    expect(by("PL0004")?.title).toBe('Rollout "phase 2", EU région');
    // columns the engine cannot carry are reported, not dropped
    expect(by("PL0003")?.losses).toContainEqual({
      code: "column_ignored",
      detailCode: "completed_by",
    });
    // Planner has no type column: the default type facet is supplied
    expect(
      records
        .filter((r) => r.title)
        .every((r) => r.facets.some((f) => f.domain === "type")),
    ).toBe(true);
  });

  it("proposes the state group from Progress, with the bucket deciding backlog", async () => {
    const d = await adapter.discover(conn());
    const proposals = await adapter.proposeMapping(d, context);
    const group = (value: string) => {
      const p = proposals.find(
        (x) => x.domain === "state" && x.value === value,
      );
      return p?.target.kind === "group" ? p.target.group : undefined;
    };
    expect(group("Backlog | Not started")).toBe("backlog");
    expect(group("To do | Not started")).toBe("unstarted");
    expect(group("Doing | In progress")).toBe("started");
    expect(group("Done | Completed")).toBe("completed");
    expect(group("Waiting | Not started")).toBe("unstarted");
    // unknown progress and unknown bucket: no guess
    expect(group("Misc | Blocked??")).toBeUndefined();
    expect(group("Done | Blocked??")).toBe("completed");
    const prio = (v: string) => {
      const p = proposals.find((x) => x.domain === "priority" && x.value === v);
      return p?.target.kind === "priority" ? p.target.value : undefined;
    };
    expect(prio("Urgent")).toBe("urgent");
    expect(prio("Important")).toBe("high");
    expect(prio("Medium")).toBe("medium");
    expect(prio("Low")).toBe("low");
    expect(
      proposals.find((p) => p.domain === "type" && p.value === "task")?.target,
    ).toEqual({ kind: "target", id: "type-task" });
  });

  it("flags the duplicate task id and reads day-first dates when configured", async () => {
    const records = await readAll(adapter, conn());
    const dup = records.find((r) => r.sourceId === "PL0001~dup2");
    expect(dup?.title).toBe("");
    expect(dup?.losses).toContainEqual({ code: "duplicate_source_id" });
    const dmy = await readAll(
      adapter,
      connection("import.planner", {
        csvText:
          "Task Name,Bucket Name,Progress,Due Date\nA,To do,Not started,25/12/2026",
        dateOrder: "dmy",
      }),
    );
    expect(dmy[0]?.dueDate).toBe("2026-12-25T00:00:00.000Z");
  });
});
