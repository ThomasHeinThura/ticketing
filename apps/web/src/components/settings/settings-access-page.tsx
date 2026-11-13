import { PageHeader } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { NoAccessPage } from "@/components/common/page-states";
import PageTitle from "@/components/page-title";
import { type SettingsAccess, SettingsAccessGate } from "./settings-access";

/** Route-local fallback: preserve context while access is unknown, replace it on denial. */
export function SettingsAccessPage({
  access,
  titleKey,
  title,
  descriptionKey,
  pageTitleKey,
}: {
  access: Exclude<SettingsAccess, "allowed">;
  titleKey: string;
  title?: string;
  descriptionKey?: string;
  pageTitleKey?: string;
}) {
  const { t } = useTranslation();
  if (access === "denied") return <NoAccessPage />;
  return (
    <div className="flex min-w-0 flex-col gap-6 p-6">
      <PageTitle
        title={pageTitleKey ? t(pageTitleKey) : (title ?? t(titleKey))}
      />
      <PageHeader
        title={title ?? t(titleKey)}
        description={descriptionKey ? t(descriptionKey) : undefined}
      />
      <SettingsAccessGate access={access}>{null}</SettingsAccessGate>
    </div>
  );
}
