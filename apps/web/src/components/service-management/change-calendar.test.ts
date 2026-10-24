import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: () => null,
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => 1,
}));

import type { CalendarChange } from "@/fetchers/service-management";
import { buildTasks, taskStatus } from "./change-calendar";

function change(overrides: Partial<CalendarChange> = {}): CalendarChange {
  return {
    key: "OPS-1",
    title: "Patch",
    projectId: "p1",
    projectName: "Ops",
    windowStart: "2031-01-10T02:00:00.000Z",
    windowEnd: "2031-01-10T06:00:00.000Z",
    risk: "low",
    stateName: "Planned",
    stateGroup: "unstarted",
    services: [],
    retrospective: false,
    frozen: false,
    overridden: false,
    conflict: false,
    ...overrides,
  };
}

describe("change calendar bars", () => {
  it("colours a frozen window over a conflict over the past over a plain change", () => {
    expect(taskStatus(change())).toBe("in-progress");
    expect(taskStatus(change({ retrospective: true }))).toBe("done");
    expect(taskStatus(change({ conflict: true, retrospective: true }))).toBe(
      "conflict",
    );
    expect(taskStatus(change({ frozen: true, conflict: true }))).toBe("frozen");
  });

  it("draws freezes and changes as bars, with freezes distinguishable by id", () => {
    const tasks = buildTasks(
      [change()],
      [
        {
          id: "f1",
          name: "Year end",
          startsAt: "2031-01-09T00:00:00.000Z",
          endsAt: "2031-01-12T00:00:00.000Z",
        },
      ],
    );
    expect(tasks.map((task) => task.id)).toEqual(["freeze:f1", "OPS-1"]);
    expect(tasks[0]?.status).toBe("freeze");
    expect(tasks[1]?.title).toBe("OPS-1 Patch");
  });

  it("keeps a window that ends at midnight off the next day", () => {
    const [task] = buildTasks(
      [
        change({
          windowStart: "2031-01-10T22:00:00.000Z",
          windowEnd: "2031-01-11T00:00:00.000Z",
        }),
      ],
      [],
    );
    expect(task?.scheduleEnd.toISOString()).toBe("2031-01-10T23:59:59.999Z");
  });
});
