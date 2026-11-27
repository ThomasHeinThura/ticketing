import { Alert, AlertDescription } from "@taskdesk/ui";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

/** A managed service runs continuously; cycles and an end date that already exist stay visible. */
export function ManagedServiceUnusedNotice() {
  const { t } = useTranslation("common");
  return (
    <Alert variant="warning" data-testid="managed-service-unused-notice">
      <TriangleAlert />
      <AlertDescription className="text-xs">
        {t("managedServiceUnused")}
      </AlertDescription>
    </Alert>
  );
}
