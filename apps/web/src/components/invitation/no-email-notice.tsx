import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";
import { routes } from "@/lib/routes";

export function NoEmailNotice() {
  const {
    data: config,
    isLoading,
    isFetching,
    isError,
  } = useGetConfig("always");
  const isAdmin = useInstanceAdminSignal();
  const { t } = useTranslation();

  if (isLoading || isFetching || isError || config?.hasSmtp !== false)
    return null;

  return (
    <Alert role="status">
      <AlertDescription>
        <span>{t("team:invitations.noEmailNotice")}</span>
        {isAdmin ? (
          <Link to={routes.notificationProvider.path} className="underline">
            {t("team:invitations.configureEmail")}
          </Link>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
