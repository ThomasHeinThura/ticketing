const REGISTERED_PENDING_ACTION_LABELS: Record<string, string> = {
  delete: "pendingActions:dynamic.actions.delete",
  bulk_delete: "pendingActions:dynamic.actions.bulkDelete",
  purge: "pendingActions:dynamic.actions.purge",
  mcp_destructive: "pendingActions:dynamic.actions.mcpDestructive",
  user_deactivation: "pendingActions:dynamic.actions.userDeactivation",
};

export function pendingActionLabelKey(action: string): string {
  return (
    REGISTERED_PENDING_ACTION_LABELS[action] ??
    "pendingActions:dynamic.unknownAction"
  );
}
