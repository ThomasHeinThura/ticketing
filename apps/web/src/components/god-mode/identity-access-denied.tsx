import { Alert, AlertDescription, AlertTitle } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

/** Shown instead of any identity form or data when the session is not an instance administrator. */
export function IdentityAccessDenied() {
  const { t } = useTranslation("identityConnections");
  return (
    <Alert variant="error">
      <AlertTitle>{t("list.deniedTitle")}</AlertTitle>
      <AlertDescription>
        <p>{t("errors.denied")}</p>
      </AlertDescription>
    </Alert>
  );
}
