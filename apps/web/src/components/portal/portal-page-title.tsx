import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";

/**
 * The browser tab title for a portal page (WCAG 2.4.2): "<page> · Customer portal". Every page
 * under the portal shell renders one; the shell's own `fallback` title covers the moment before a
 * page mounts.
 */
export function PortalPageTitle({
  title,
  fallback = false,
}: {
  title: string;
  fallback?: boolean;
}) {
  // The suffix names no request term, so plain i18next is enough (and keeps this light).
  const { t } = useTranslation("portal");
  return (
    <PageTitle
      title={title}
      suffix={t("navigation.title")}
      fallback={fallback}
    />
  );
}
