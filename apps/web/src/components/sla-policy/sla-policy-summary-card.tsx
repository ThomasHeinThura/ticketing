import { Link } from "@tanstack/react-router";
import {
  Badge,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { SlaPolicyPage } from "@/fetchers/sla-policy";
import { routes } from "@/lib/routes";

type SlaPolicyListItem = SlaPolicyPage["data"][number];

export function SlaPolicySummaryCard({
  policy,
}: {
  policy: SlaPolicyListItem;
}) {
  const { t } = useTranslation("slaPolicies");
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <CardTitle className="truncate">
            <Link
              className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={routes.slaPolicyEditor.path}
              params={{ id: policy.id }}
            >
              {policy.name}
            </Link>
          </CardTitle>
          <CardDescription className="break-words">
            {policy.description || t("list.noDescription")}
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {policy.activeVersion ? (
            <Badge variant="secondary">
              {t("list.active", { version: policy.activeVersion.number })}
            </Badge>
          ) : (
            <Badge variant="outline">{t("list.unpublished")}</Badge>
          )}
          {policy.hasDraft ? (
            <Badge variant="outline">{t("list.draft")}</Badge>
          ) : null}
        </div>
      </CardHeader>
    </Card>
  );
}
