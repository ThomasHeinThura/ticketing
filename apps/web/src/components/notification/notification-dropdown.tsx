import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  KbdSequence,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import { Bell } from "lucide-react";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import NamespaceBoundary from "@/components/common/namespace-boundary";
import { shortcuts } from "@/constants/shortcuts";
import useClearNotifications from "@/hooks/mutations/notification/use-clear-notifications";
import useGetNotifications from "@/hooks/queries/notification/use-get-notifications";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import NotificationClearDialog from "./notification-clear-dialog";
import NotificationMenu from "./notification-menu";
import NotificationMenuSkeleton, {
  NotificationMenuError,
} from "./notification-menu-skeleton";

export type NotificationDropdownRef = {
  toggle: () => void;
};

/**
 * The shell's notification bell. Only the trigger paints with the work route; the menu and the
 * clear dialog read the deferred `notifications` namespace, so each mounts on first use inside a
 * `NamespaceBoundary` and never paints raw keys or re-renders the work list when strings land.
 */
const NotificationDropdown = forwardRef<NotificationDropdownRef>(
  (_props, ref) => {
    const { t } = useTranslation();
    const { data: inbox } = useGetNotifications("all");
    const unreadCount = inbox?.pages[0]?.unreadCount ?? 0;
    const [isOpen, setIsOpen] = useState(false);
    // Mounted on first open and kept, so later opens and closes keep their motion.
    const [menuMounted, setMenuMounted] = useState(false);
    const [showClearDialog, setShowClearDialog] = useState(false);
    const [clearDialogMounted, setClearDialogMounted] = useState(false);

    const { mutate: clearAll } = useClearNotifications();

    const setOpen = (open: boolean) => {
      setIsOpen(open);
      if (open) setMenuMounted(true);
    };

    useImperativeHandle(ref, () => ({
      toggle: () => setOpen(!isOpen),
    }));

    const handleClearAll = () => {
      clearAll();
      setShowClearDialog(false);
    };

    useRegisterShortcuts({
      sequentialShortcuts: {
        [shortcuts.notification.prefix]: {
          [shortcuts.notification.open]: () => setOpen(!isOpen),
        },
      },
    });

    return (
      <>
        <DropdownMenu open={isOpen} onOpenChange={setOpen}>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive-strong px-1 text-[9px] font-semibold leading-none text-destructive-strong-foreground ring-2 ring-sidebar transition-[scale,opacity] duration-base ease-out starting:scale-75 starting:opacity-0 motion-reduce:starting:scale-100">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                    <span className="sr-only">
                      {t("navigation:notifications")}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p className="flex items-center gap-2">
                  <KbdSequence
                    keys={[
                      shortcuts.notification.prefix,
                      shortcuts.notification.open,
                    ]}
                    description={t("navigation:openNotifications")}
                  />
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {menuMounted ? (
            <NamespaceBoundary
              fallback={(visible) => (
                <NotificationMenuSkeleton visible={visible} />
              )}
              renderError={(retry) => <NotificationMenuError onRetry={retry} />}
            >
              <NotificationMenu
                onClearAll={() => {
                  setClearDialogMounted(true);
                  setShowClearDialog(true);
                }}
              />
            </NamespaceBoundary>
          ) : null}
        </DropdownMenu>

        {clearDialogMounted ? (
          <NamespaceBoundary fallback={null}>
            <NotificationClearDialog
              open={showClearDialog}
              onOpenChange={setShowClearDialog}
              onConfirm={handleClearAll}
            />
          </NamespaceBoundary>
        ) : null}
      </>
    );
  },
);

NotificationDropdown.displayName = "NotificationDropdown";

export default NotificationDropdown;
