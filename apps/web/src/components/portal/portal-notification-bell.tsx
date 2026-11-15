import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
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
import { routes } from "@/lib/portal-route-builders";

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
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive-strong px-1 text-xs font-semibold leading-none text-destructive-strong-foreground ring-2 ring-card">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem
          onClick={() => void navigate({ to: routes.portalInbox.path })}
        >
          {t("notifications.inbox")}
        </DropdownMenuItem>
        {inbox.isError ? (
          <div className="p-1.5">
            <Alert variant="error">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>{t("notifications.loadFailed")}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void inbox.refetch()}
                >
                  {t("common:actions.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <span role="status" aria-live="polite" className="sr-only">
            {t("notifications.unreadCount", { count: unreadCount })}
          </span>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
