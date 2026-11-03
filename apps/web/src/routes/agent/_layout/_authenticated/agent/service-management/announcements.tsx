import { createFileRoute } from "@tanstack/react-router";
import { AnnouncementsList } from "@/components/service-management/announcements-list";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/service-management/announcements",
)({
  component: AnnouncementsList,
});
