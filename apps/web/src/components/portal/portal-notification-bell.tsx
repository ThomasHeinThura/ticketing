import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@taskdesk/ui";
import { Bell } from "lucide-react";
import { getPortalNotifications } from "@/fetchers/portal-notifications";
import { usePortalNotificationWebSocket } from "@/hooks/use-portal-notification-websocket";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { portalNotificationQueryKey } from "@/lib/portal-notification-query-keys";

export default function PortalNotificationBell() {
  usePortalNotificationWebSocket();
  const { t } = usePortalTranslation("portal");
  const navigate = useNavigate();
  const inbox = useQuery({
    queryKey: portalNotificationQueryKey,
    queryFn: () => getPortalNotifications({ limit: 1 }),
    retry: false,
    staleTime: 30_000,
  });
  const unreadCount = inbox.data?.unreadCount ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative shrink-0"
          aria-label={t("notifications.inbox")}
        >
          <Bell className="size-4" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive-strong px-1 text-[9px] font-semibold leading-none text-destructive-strong-foreground ring-2 ring-card">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem
          onClick={() => void navigate({ to: "/notifications" })}
        >
          {t("notifications.inbox")}
        </DropdownMenuItem>
        <div
          className="px-2 py-1.5 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {t("notifications.unreadCount", { count: unreadCount })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
