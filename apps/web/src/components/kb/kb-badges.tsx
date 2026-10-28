import { Badge } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { ArticleState } from "@/fetchers/kb";

const STATE_VARIANT = {
  draft: "outline",
  in_review: "warning",
  published: "success",
  archived: "secondary",
} as const;

export function KbStateBadge({ state }: { state: ArticleState }) {
  const { t } = useTranslation();
  return <Badge variant={STATE_VARIANT[state]}>{t(`kb:state.${state}`)}</Badge>;
}

/** KB-2: customers see an article only when it is both published and customer visible. */
export function KbVisibilityBadge({
  customerVisible,
}: {
  customerVisible: boolean;
}) {
  const { t } = useTranslation();
  return customerVisible ? (
    <Badge variant="info">{t("kb:visibility.customers")}</Badge>
  ) : (
    <Badge variant="outline">{t("kb:visibility.staff")}</Badge>
  );
}

export function formatKbDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}
