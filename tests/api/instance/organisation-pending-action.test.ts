import { describe, expect, it } from "vitest";
import { pendingActionApprovalContracts } from "../../../apps/api/src/pending-action/approval-contract";
import { registeredDeletionTargets } from "../../../apps/api/src/pending-action/deletion-targets";
import { pendingActionEventScope } from "../../../apps/api/src/pending-action/lifecycle-invalidation";
import {
  ORGANISATION_DELETION_ROUTE,
  organisationDeletionVersion,
} from "../../../apps/api/src/pending-action/organisation-deletion-target";
import { requiredConfirmation } from "../../../apps/api/src/pending-action/payload";

describe("organisation deletion pending action", () => {
  it("registers only the elevated, session-only typed-name approval flow", () => {
    const target = registeredDeletionTargets().find(
      (candidate) => candidate.targetType === "organisation",
    );
    expect(target).toMatchObject({
      targetType: "organisation",
      routeKey: ORGANISATION_DELETION_ROUTE,
      confirmation: "typed_name_step_up",
      sessionOnly: true,
    });
    expect(
      pendingActionApprovalContracts.find(
        (contract) =>
          contract.targetType === "organisation" &&
          contract.routeKey === ORGANISATION_DELETION_ROUTE,
      ),
    ).toMatchObject({
      action: "delete",
      targetType: "organisation",
      confirmationRequired: "typed_name_step_up",
      executor: "registered_deletion",
    });
    expect(
      requiredConfirmation({
        action: "delete",
        targetType: "organisation",
        targetCount: 1,
      }),
    ).toBe("typed_name_step_up");
  });

  it("binds approvals to both the exact profile ETag and deletion generation", () => {
    const version = organisationDeletionVersion('"profile-a"', 4);
    expect(version).toBe('{"profileEtag":"\\"profile-a\\"","generation":4}');
    expect(organisationDeletionVersion('"profile-b"', 4)).not.toBe(version);
    expect(organisationDeletionVersion('"profile-a"', 5)).not.toBe(version);
  });

  it("uses instance event scope only for a correctly bound organisation action", () => {
    const action = {
      action: "delete",
      targetType: "organisation",
      routeKey: ORGANISATION_DELETION_ROUTE,
      targetIds: ["org-a"],
      workspaceId: null,
      projectId: null,
      organisationId: "org-a",
    };
    expect(pendingActionEventScope(action)).toEqual({});
    expect(() =>
      pendingActionEventScope({ ...action, organisationId: "org-b" }),
    ).toThrow("An instance event cannot include narrower scope");
  });
});
