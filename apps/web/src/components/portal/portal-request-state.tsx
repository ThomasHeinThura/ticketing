import { Badge } from "@taskdesk/ui";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { customerStatusKey } from "@/lib/portal-request";

/**
 * A request's status in customer language (CP-5). `customerStatus` from the server is preferred;
 * the submission state is the fallback. Never a raw workflow state name.
 */
export function PortalRequestState({
  state,
  customerStatus,
}: {
  state: string;
  customerStatus?: string | null;
}) {
  const { t } = usePortalTranslation("portal");
  const key = customerStatusKey(customerStatus, state);
  return <Badge variant="outline">{key ? t(key) : state}</Badge>;
}
