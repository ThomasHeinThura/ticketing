import { Alert, AlertAction, AlertDescription, Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

export default function WorkListChangedNotice({
  onRefresh,
}: {
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Alert role="status" aria-live="polite">
      <AlertDescription>{t("workItems:listChanged")}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          {t("common:actions.refresh")}
        </Button>
      </AlertAction>
    </Alert>
  );
}
