import { Alert, AlertDescription } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { ProjectSocketStatus } from "@/hooks/use-project-websocket";

/**
 * The "live updates unavailable" indicator of realtime.md (Fallback), for the legacy project
 * socket. Shown only for `unavailable`; the page stays fully usable and its queries keep their
 * 30-second foreground polling. The same wording as the native work-item screens.
 */
export default function RealtimeUnavailableNotice({
  status,
}: {
  status: ProjectSocketStatus;
}) {
  const { t } = useTranslation();
  if (status !== "unavailable") return null;
  return (
    <div className="px-2 pt-2">
      <Alert variant="warning" role="status" data-testid="realtime-unavailable">
        <AlertDescription>
          {t("workItems:detail.realtimeUnavailable")}
        </AlertDescription>
      </Alert>
    </div>
  );
}
