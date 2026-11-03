import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Button } from "@taskdesk/ui";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getPortalAnnouncements,
  type PortalAnnouncement,
} from "@/fetchers/portal/announcements";
import { routes } from "@/lib/routes";

const STORAGE_KEY = "taskdesk.portal.dismissedAnnouncements";

/** A republished announcement gets a new `publishedAt`, so it shows again. */
const dismissalKey = (announcement: PortalAnnouncement) =>
  `${announcement.id}@${announcement.publishedAt}`;

function readDismissed(): string[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function writeDismissed(keys: string[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Storage blocked: the dismissal lasts for this page view only.
  }
}

/**
 * D7: incidents and maintenance currently in their window, at the top of every portal page.
 * Dismissal lasts for the browser session. Errors and feature-off answers show nothing.
 */
export default function PortalAnnouncementBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(readDismissed);
  const active = useQuery({
    queryKey: ["portal", "announcement-banner"],
    queryFn: () =>
      getPortalAnnouncements({
        limit: 3,
        severities: ["incident", "maintenance"],
      }),
    retry: false,
    staleTime: 60_000,
  });
  const visible = (active.data?.data ?? []).filter(
    (announcement) =>
      announcement.severity !== "info" &&
      !dismissed.includes(dismissalKey(announcement)),
  );
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-4 pt-4 sm:px-6">
      {visible.map((announcement) => (
        <Alert
          key={announcement.id}
          variant={announcement.severity === "incident" ? "error" : "warning"}
        >
          <AlertTitle className="flex items-start justify-between gap-2">
            <Link
              className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={routes.portalAnnouncement.path}
              params={{ id: announcement.id }}
            >
              {announcement.title}
            </Link>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("portal:announcements.banner.dismiss", {
                title: announcement.title,
              })}
              onClick={() => {
                const next = [...dismissed, dismissalKey(announcement)];
                writeDismissed(next);
                setDismissed(next);
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </AlertTitle>
          <AlertDescription>
            {t(`portal:announcements.severity.${announcement.severity}`)}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
