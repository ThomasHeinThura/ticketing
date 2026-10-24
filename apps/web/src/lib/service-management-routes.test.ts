import { describe, expect, it } from "vitest";
import {
  parseChangeCalendarSearch,
  parseReleaseListSearch,
  parseServiceListSearch,
  routes,
} from "./routes";
import { parseWorkItemDetailSectionsSearch } from "./work-item-detail-sections-search";

describe("service management URL state", () => {
  it("keeps only a valid month and a non-default tab", () => {
    expect(
      parseChangeCalendarSearch({ month: "2031-02", tab: "freezes" }),
    ).toEqual({
      month: "2031-02",
      tab: "freezes",
    });
    expect(
      parseChangeCalendarSearch({ month: "2031-13", tab: "calendar" }),
    ).toEqual({});
    expect(parseChangeCalendarSearch({ tab: "unknown" })).toEqual({});
    expect(parseChangeCalendarSearch(null)).toEqual({});
  });

  it("bounds the service query and the release filter", () => {
    expect(parseServiceListSearch({ q: "pay" })).toEqual({ q: "pay" });
    expect(parseServiceListSearch({ q: "x".repeat(500) })).toEqual({});
    expect(parseServiceListSearch({ q: "a\u0000b" })).toEqual({});
    expect(parseReleaseListSearch({ serviceId: "svc_1" })).toEqual({
      serviceId: "svc_1",
    });
    expect(parseReleaseListSearch({ serviceId: 5 })).toEqual({});
  });

  it("builds the four canonical screens under /agent/service-management", () => {
    expect(routes.serviceManagementServices.build({ q: "pay" })).toBe(
      "/agent/service-management/services?q=pay",
    );
    expect(routes.serviceManagementServiceDetail.build({ id: "a b" })).toBe(
      "/agent/service-management/services/a%20b",
    );
    expect(
      routes.serviceManagementChanges.build({
        month: "2031-02",
        tab: "overrides",
      }),
    ).toBe("/agent/service-management/changes?month=2031-02&tab=overrides");
    expect(routes.serviceManagementChanges.build()).toBe(
      "/agent/service-management/changes",
    );
    expect(routes.serviceManagementReleases.build({ serviceId: "s1" })).toBe(
      "/agent/service-management/releases?serviceId=s1",
    );
    expect(routes.serviceManagementReleaseDetail.build({ id: "r1" })).toBe(
      "/agent/service-management/releases/r1",
    );
  });

  it("accepts the change section in the work item disclosure state", () => {
    expect(
      parseWorkItemDetailSectionsSearch({
        sections: JSON.stringify({ itemKey: "OPS-1", open: ["change"] }),
      }),
    ).toEqual({ sections: { itemKey: "OPS-1", open: ["change"] } });
  });
});
