import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import getWorkItem from "@/fetchers/work-item/get-work-item";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";

/**
 * KB-6: a work item reference inside an article renders its key, title and state live. A
 * deleted or unreachable item renders as "(removed)". Staff only: the customer view drops
 * these nodes.
 */
export function KbWorkItemReference({ issueKey }: { issueKey: string }) {
  const { t } = useTranslation();
  const item = useQuery({
    queryKey: ["kb", "work-item", issueKey],
    queryFn: () => getWorkItem(issueKey),
    retry: false,
    staleTime: 60_000,
  });
  if (item.isLoading) return <Badge variant="outline">{issueKey}</Badge>;
  if (!item.isSuccess) {
    const gone =
      item.error instanceof HttpError &&
      (item.error.status === 404 || item.error.status === 403);
    return (
      <Badge variant="outline">
        {issueKey} {gone ? t("kb:article.removedReference") : null}
      </Badge>
    );
  }
  return (
    <Link
      className="inline-flex items-center gap-1 rounded-sm underline-offset-4 hover:underline"
      to={routes.workItemDetail.path}
      params={{ key: item.data.key }}
    >
      <span className="font-medium">{item.data.key}</span>
      <span>{item.data.title}</span>
      <Badge variant="secondary">{item.data.stateName}</Badge>
    </Link>
  );
}
