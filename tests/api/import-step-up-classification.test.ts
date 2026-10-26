import { describe, expect, it } from "vitest";
import {
  IMPORT_CHUNK_ROUTE,
  IMPORT_CHUNK_TARGET,
  IMPORT_LINK_CHUNK_ROUTE,
} from "../../apps/api/src/imports/pending-action-contract";
import { isStepUpPendingDeletion } from "../../apps/api/src/pending-action/deletion-targets";

describe("import chunk PA-15 classification", () => {
  it.each([IMPORT_CHUNK_ROUTE, IMPORT_LINK_CHUNK_ROUTE])(
    "admits only the exact registered route %s",
    (routeKey) => {
      expect(
        isStepUpPendingDeletion({
          action: "mcp_destructive",
          targetType: IMPORT_CHUNK_TARGET,
          routeKey,
          confirmation: "typed_count_step_up",
        }),
      ).toBe(true);
    },
  );

  it.each([
    {
      action: "delete",
      targetType: IMPORT_CHUNK_TARGET,
      routeKey: IMPORT_CHUNK_ROUTE,
      confirmation: "typed_count_step_up",
    },
    {
      action: "mcp_destructive",
      targetType: "work_item",
      routeKey: IMPORT_CHUNK_ROUTE,
      confirmation: "typed_count_step_up",
    },
    {
      action: "mcp_destructive",
      targetType: IMPORT_CHUNK_TARGET,
      routeKey: "POST /api/imports/{id}/unknown",
      confirmation: "typed_count_step_up",
    },
    {
      action: "mcp_destructive",
      targetType: IMPORT_CHUNK_TARGET,
      routeKey: IMPORT_CHUNK_ROUTE,
      confirmation: "click",
    },
  ])("rejects unregistered import approval tuple %#", (tuple) => {
    expect(isStepUpPendingDeletion(tuple)).toBe(false);
  });
});
