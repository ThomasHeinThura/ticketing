import { PageHeader } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { NoAccessPage } from "@/components/common/page-states";
import PageTitle from "@/components/page-title";
import { type SettingsAccess, SettingsAccessGate } from "./settings-access";

/** Route-local fallback: preserve context while access is unknown, replace it on denial. */
export function SettingsAccessPage({
  access,
  titleKey,
  descriptionKey,
}: {
  access: Exclude<SettingsAccess, "allowed">;
  titleKey: string;
  descriptionKey?: string;
}) {
  const { t } = useTranslation();
  if (access === "denied") return <NoAccessPage />;
  return (
    <div className="flex min-w-0 flex-col gap-6 p-6">
      <PageTitle title={t(titleKey)} />
      <PageHeader
        title={t(titleKey)}
        description={descriptionKey ? t(descriptionKey) : undefined}
      />
      <SettingsAccessGate access={access}>{null}</SettingsAccessGate>
    </div>
  );
}
