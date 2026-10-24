import type { AgentInboxFilter } from "@/lib/routes";
import type { Notification } from "@/types/notification";

const MENTION_KINDS = new Set(["work_item.mentioned"]);
const ASSIGNMENT_KINDS = new Set([
  "work_item.assigned",
  "work_item.unassigned",
]);

type Filterable = Pick<Notification, "isRead" | "type"> & {
  kind?: string | null;
};

/** `NO-13`: the inbox filters. Legacy Kaneo rows are classified by their `type`. */
export function matchesInboxFilter(
  notification: Filterable,
  filter: AgentInboxFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unread":
      return !notification.isRead;
    case "mentions":
      return (
        MENTION_KINDS.has(notification.kind ?? "") ||
        notification.type === "task_mention"
      );
    case "assignments":
      return (
        ASSIGNMENT_KINDS.has(notification.kind ?? "") ||
        notification.type === "task_assignee_changed"
      );
  }
}
