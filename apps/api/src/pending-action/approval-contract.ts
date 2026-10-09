export const pendingActionApprovalContracts = [
  {
    action: "delete",
    targetType: "service_calendar",
    confirmationRequired: "click",
    routeKey: "DELETE /api/service-calendars/{id}",
    executor: "service_calendar_delete",
  },
  {
    action: "delete",
    targetType: "saved_view",
    confirmationRequired: "click",
    routeKey: "DELETE /api/views/{id}",
    executor: "saved_view_delete",
  },
  {
    action: "delete",
    targetType: "user",
    confirmationRequired: "typed_name_step_up",
    routeKey: "POST /api/instance/users/{id}/deactivate",
    executor: "user_deactivation",
  },
] as const;

export type PendingActionApprovalContract =
  (typeof pendingActionApprovalContracts)[number];

export function resolvePendingActionApprovalContract(input: {
  action: string;
  targetType: string;
  confirmationRequired: string;
  routeKey: string;
}): PendingActionApprovalContract | undefined {
  return pendingActionApprovalContracts.find(
    (contract) =>
      contract.action === input.action &&
      contract.targetType === input.targetType &&
      contract.confirmationRequired === input.confirmationRequired &&
      contract.routeKey === input.routeKey,
  );
}
