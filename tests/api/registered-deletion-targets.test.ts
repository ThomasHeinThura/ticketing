import { describe, expect, it } from "vitest";
import { pendingActionApprovalContracts } from "../../apps/api/src/pending-action/approval-contract";
import {
  REGISTERED_DELETION_TARGETS,
  registeredDeletionTarget,
} from "../../apps/web/src/components/pending-action/registered-deletion-targets";

describe("registered deletion approval flows", () => {
  it("includes every generic target in the actual server approval registry", () => {
    const serverTargets = new Set(
      pendingActionApprovalContracts
        .filter((contract) => contract.executor === "registered_deletion")
        .map((contract) => contract.targetType),
    );
    expect(new Set(REGISTERED_DELETION_TARGETS)).toEqual(serverTargets);
    expect(registeredDeletionTarget("project_page")).toBe("project_page");
    expect(registeredDeletionTarget("unregistered_target")).toBeNull();
  });
});
