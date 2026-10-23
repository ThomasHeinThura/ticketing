import { describe, expect, it } from "vitest";
import {
  parseProjectBacklogSearchFromQueryString,
  parseWorkItemDetailSearch,
  parseWorkItemListSearchFromQueryString,
  routes,
} from "./routes";
import { parseWorkItemApprovalRequestSearch } from "./work-item-approval-request-search";

describe("approval request URL state", () => {
  const approvalRequest = {
    itemKey: "HELP-4",
    open: true as const,
    kind: "cab" as const,
    transitionId: "real-gate",
    query: "Jane",
  };
  it("round trips task detail and canonical list/backlog without losing other controls", () => {
    const detail = new URL(
      routes.workItemDetail.build(
        { key: "HELP-4" },
        { activity: "public", approvalRequest },
      ),
      "https://test.invalid",
    );
    expect(
      parseWorkItemDetailSearch(Object.fromEntries(detail.searchParams)),
    ).toEqual({ activity: "public", approvalRequest });
    const list = new URL(
      routes.workItemList.build(
        { projectKey: "help" },
        {
          item: "HELP-4",
          layout: "board",
          filter: "priority:high",
          approvalRequest,
        },
      ),
      "https://test.invalid",
    );
    expect(parseWorkItemListSearchFromQueryString(list.search)).toMatchObject({
      item: "HELP-4",
      filter: "priority:high",
      approvalRequest,
    });
    const backlog = new URL(
      routes.projectBacklog.build(
        { projectKey: "help" },
        { item: "HELP-4", approvalRequest },
      ),
      "https://test.invalid",
    );
    expect(
      parseProjectBacklogSearchFromQueryString(backlog.search),
    ).toMatchObject({ item: "HELP-4", approvalRequest });
  });
  it("bounds and validates item-scoped state without accepting foreign data or prototype keys", () => {
    expect(parseWorkItemApprovalRequestSearch({ approvalRequest })).toEqual({
      approvalRequest,
    });
    expect(
      parseWorkItemApprovalRequestSearch({
        approvalRequest: { ...approvalRequest, itemKey: "uuid" },
      }),
    ).toEqual({});
    expect(
      parseWorkItemApprovalRequestSearch({
        approvalRequest: { ...approvalRequest, open: false },
      }),
    ).toEqual({});
    expect(
      parseWorkItemApprovalRequestSearch({
        approvalRequest: { ...approvalRequest, query: "x".repeat(201) },
      }),
    ).toEqual({
      approvalRequest: {
        itemKey: "HELP-4",
        open: true,
        kind: "cab",
        transitionId: "real-gate",
      },
    });
    expect(
      parseWorkItemApprovalRequestSearch({
        approvalRequest: JSON.stringify({
          ...approvalRequest,
          constructor: "x",
        }),
      }),
    ).toEqual({});
  });
  it("registers canonical comment focus without dropping other item-scoped panels", () => {
    const href = routes.workItemDetail.build(
      { key: "HELP-4" },
      {
        comment: "real-comment_id",
        activity: "comments",
        approvalRequest,
        relations: { itemKey: "HELP-4", collapsed: true },
      },
    );
    const parsed = parseWorkItemDetailSearch(
      Object.fromEntries(new URL(href, "https://test.invalid").searchParams),
    );
    expect(parsed).toMatchObject({
      comment: "real-comment_id",
      activity: "comments",
      approvalRequest,
      relations: { itemKey: "HELP-4", collapsed: true },
    });
    for (const comment of ["", "a/b", "x".repeat(257), null])
      expect(parseWorkItemDetailSearch({ comment })).not.toHaveProperty(
        "comment",
      );
  });
});
