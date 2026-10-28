import { describe, expect, it } from "vitest";
import { decorateWorkItemRows } from "../../apps/api/src/work-item/decorate-rows";

const item = (id: string) =>
  ({
    id,
    projectId: "p1",
    assigneeId: null,
    workspaceId: "w1",
    typeId: null,
    priority: null,
    slaPolicyVersionId: null,
    slaStartedAt: null,
    createdAt: new Date(0),
    firstResponseAt: null,
  }) as never;

describe("decorateWorkItemRows (P1-7: shared by list and filtered search)", () => {
  it("attaches row facts and the SLA badge by item id, omitting sla when absent", async () => {
    const rows = [{ workItem: item("a") }, { workItem: item("b") }];
    const seen: string[][] = [];
    const decorate = await decorateWorkItemRows(
      {} as never,
      rows,
      (row) => row.workItem,
      {
        facts: (async (_e: unknown, items: Array<{ id: string }>) => {
          seen.push(items.map((i) => i.id));
          return new Map(
            items.map((i) => [
              i.id,
              {
                assigneeActive: null,
                assigneeOnProject: null,
                blockedByOpenCount: i.id === "a" ? 2 : 0,
              },
            ]),
          );
        }) as never,
        sla: (async () => new Map([["a", { state: "at_risk" }]])) as never,
      },
    );
    expect(seen).toEqual([["a", "b"]]);
    expect(decorate(rows[0]!)).toMatchObject({
      blockedByOpenCount: 2,
      sla: { state: "at_risk" },
    });
    const b = decorate(rows[1]!);
    expect(b).toMatchObject({ blockedByOpenCount: 0 });
    expect("sla" in b).toBe(false);
  });
});
