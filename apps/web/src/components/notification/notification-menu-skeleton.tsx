import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  LoadingStatus,
  Skeleton,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

const ROWS = ["w-3/4", "w-2/3", "w-1/2"] as const;

/**
 * Placeholder for the notification menu while its strings load: the same `w-88` popup with the
 * header row and three notification rows. The caller owns the ~150 ms delay and the minimum
 * visible time, so nothing paints until `visible` and a fast load never flashes it.
 */
export default function NotificationMenuSkeleton({
  visible,
}: {
  visible: boolean;
}) {
  const { t } = useTranslation();
  return (
    <LoadingStatus visible={visible} label={t("common:empty.loading")}>
      {visible ? (
        <DropdownMenuContent
          align="end"
          aria-busy="true"
          className="w-88 p-0"
          data-testid="notification-menu-loading"
        >
          <div className="flex h-10 items-center border-border/50 border-b pl-3">
            <Skeleton className="h-3.5 w-24" />
          </div>
          <div className="flex flex-col gap-1 p-1">
            {ROWS.map((width) => (
              <div key={width} className="flex flex-col gap-1.5 px-2.5 py-2">
                <Skeleton className={`h-3.5 ${width}`} />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        </DropdownMenuContent>
      ) : null}
    </LoadingStatus>
  );
}

/**
 * The notification menu when its strings failed to load: the message labels a group whose one
 * item retries, so the error stays inside the popup, closes with it and is reachable by keyboard.
 */
export function NotificationMenuError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenuContent
      align="end"
      className="w-88 p-0"
      data-testid="notification-menu-error"
    >
      <DropdownMenuGroup className="p-1">
        <DropdownMenuLabel className="px-2.5 py-2 font-normal text-muted-foreground text-sm">
          {t("common:error.messages.unknown")}
        </DropdownMenuLabel>
        <DropdownMenuItem
          closeOnClick={false}
          onClick={onRetry}
          className="cursor-pointer justify-center rounded-md px-2 py-1.5 text-sm"
        >
          {t("common:actions.retry")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}
