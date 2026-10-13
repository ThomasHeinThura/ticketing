import { describe, expect, it } from "vitest";
import {
  pendingActionApprovalContracts,
  resolvePendingActionApprovalContract,
} from "../../apps/api/src/pending-action/approval-contract";

describe("pending-action approval contracts", () => {
  it.each(pendingActionApprovalContracts)(
    "recognizes the registered $executor tuple",
    (contract) => {
      expect(resolvePendingActionApprovalContract(contract)).toEqual(contract);
    },
  );

  it.each(
    pendingActionApprovalContracts.flatMap((contract) =>
      (
        ["action", "targetType", "confirmationRequired", "routeKey"] as const
      ).map((field) => ({ contract, field })),
    ),
  )("rejects a $field mismatch for $executor", ({ contract, field }) => {
    expect(
      resolvePendingActionApprovalContract({
        ...contract,
        [field]: `unregistered-${field}`,
      }),
    ).toBeUndefined();
  });

  it("rejects the legacy user_deactivation/person storage shape", () => {
    expect(
      resolvePendingActionApprovalContract({
        action: "user_deactivation",
        targetType: "person",
        confirmationRequired: "typed_name_step_up",
        routeKey: "POST /api/instance/users/{id}/deactivate",
      }),
    ).toBeUndefined();
  });
});
