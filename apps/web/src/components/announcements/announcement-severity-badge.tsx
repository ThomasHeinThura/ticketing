import { Badge } from "@taskdesk/ui";
import type { AnnouncementSeverity } from "@/fetchers/announcements";

const SEVERITY_VARIANT = {
  info: "info",
  maintenance: "warning",
  incident: "error",
} as const satisfies Record<AnnouncementSeverity, "info" | "warning" | "error">;

/** Shared by the agent and portal surfaces; the caller supplies the translated label. */
export function AnnouncementSeverityBadge({
  severity,
  label,
}: {
  severity: AnnouncementSeverity;
  label: string;
}) {
  return <Badge variant={SEVERITY_VARIANT[severity]}>{label}</Badge>;
}

/** Where an announcement stands for customers right now. */
export type AnnouncementState = "draft" | "scheduled" | "live" | "ended";

export function announcementState(
  announcement: {
    publishedAt: string | null;
    startsAt: string;
    endsAt: string | null;
  },
  now: number = Date.now(),
): AnnouncementState {
  if (!announcement.publishedAt) return "draft";
  if (new Date(announcement.startsAt).getTime() > now) return "scheduled";
  if (announcement.endsAt && new Date(announcement.endsAt).getTime() <= now)
    return "ended";
  return "live";
}
