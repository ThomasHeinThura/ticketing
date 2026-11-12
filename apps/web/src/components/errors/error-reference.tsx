import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { HttpError } from "@/lib/http-error";

export function ErrorReference({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!(error instanceof HttpError) || error.status < 500 || !error.requestId)
    return null;
  const id = error.requestId;
  return (
    <div className="flex items-center gap-2">
      <span>{t("common:error.reference", { id })}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void navigator.clipboard.writeText(id)}
      >
        {t("common:error.copyReference")}
      </Button>
    </div>
  );
}
