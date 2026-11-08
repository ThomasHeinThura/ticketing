import { Link } from "@tanstack/react-router";
import {
  Badge,
  cn,
  Frame,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import {
  formatPortalDate,
  formatPortalDateTime,
} from "@/components/portal/portal-format";
import { PortalSlaStatus } from "@/components/portal/portal-sla-status";
import type { PortalCase } from "@/fetchers/portal/cases";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/routes";

const STATUS_TONE = {
  received: "info",
  need_more_info: "warning",
  in_progress: "secondary",
  resolved: "success",
  closed: "outline",
  declined: "error",
  withdrawn: "outline",
} as const;

const PRIORITY_TONE = {
  low: "outline",
  medium: "secondary",
  high: "warning",
  urgent: "error",
} as const;

/** A case reference link: the shared focus ring, like the other portal controls. */
const CASE_LINK_CLASS =
  "whitespace-nowrap rounded-sm font-medium text-primary tabular-nums outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/**
 * The optional columns (CP-2): `project` when the customer can see more than one project,
 * `created` on the full list, and `people` (Created by, Assigned to) only for All requests,
 * since under My requests every row reads "You" and "Your team".
 */
export type PortalCaseColumn = "project" | "created" | "people";

function formatDate(value: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

/** A compact date, with the full date and time in the title (the portal's shared formats). */
function PortalCaseUpdated({
  value,
  locale,
  className,
}: {
  value: string;
  locale?: string;
  className?: string;
}) {
  return (
    <time
      dateTime={value}
      title={formatPortalDateTime(value, locale)}
      className={className}
    >
      {formatPortalDate(value, locale)}
    </time>
  );
}

/**
 * The customer's cases as Kaneo's framed table (WSO2-style columns): Updated (compact date), Details,
 * Severity, Status and, when asked for, Created by and Assigned to, which is always "Your team"
 * (`CP-4`/`CP-5`). The service
 * target (`CP-6`) sits under the status badge, so it shows at every width. Columns follow the
 * width of the frame (container queries), not the viewport, because the portal sidebar takes part
 * of the screen: below 42rem only Details shows, carrying the severity, status, service target
 * and update time; Created by and Assigned to join at 56rem, Project and Created at 64rem. The
 * pages cap the frame at 69rem (`max-w-6xl` less padding), so no column waits on a wider step.
 * Every text column wraps instead of holding a fixed width, so the table's minimum width stays
 * inside the frame at each step with long names.
 */
export function PortalCaseTable({
  cases,
  columns = [],
  caption,
}: {
  cases: PortalCase[];
  columns?: PortalCaseColumn[];
  caption: string;
}) {
  const { t, i18n } = usePortalTranslation("portal");
  const locale = i18n?.resolvedLanguage || i18n?.language || undefined;
  const show = (column: PortalCaseColumn) => columns.includes(column);
  return (
    <Frame className="@container">
      <Table scrollLabel={caption}>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead className="@2xl:table-cell hidden">
              {t("cases.columns.updated")}
            </TableHead>
            <TableHead>{t("cases.columns.details")}</TableHead>
            {show("project") ? (
              <TableHead className="@5xl:table-cell hidden">
                {t("cases.columns.project")}
              </TableHead>
            ) : null}
            <TableHead className="@2xl:table-cell hidden">
              {t("cases.columns.severity")}
            </TableHead>
            <TableHead className="@2xl:table-cell hidden">
              {t("cases.columns.status")}
            </TableHead>
            {show("people") ? (
              <>
                <TableHead className="@4xl:table-cell hidden">
                  {t("cases.columns.createdBy")}
                </TableHead>
                <TableHead className="@4xl:table-cell hidden">
                  {t("cases.columns.assignedTo")}
                </TableHead>
              </>
            ) : null}
            {show("created") ? (
              <TableHead className="@5xl:table-cell hidden">
                {t("cases.columns.created")}
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {cases.map((item) => (
            <TableRow key={`${item.source}:${item.ref}`}>
              <TableCell className="@2xl:table-cell hidden whitespace-nowrap text-muted-foreground text-xs">
                <PortalCaseUpdated value={item.updatedAt} locale={locale} />
              </TableCell>
              <TableCell className="@2xl:min-w-48 whitespace-normal">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                    {item.source === "submission" ? (
                      <Link
                        to={routes.portalSubmission.path}
                        params={{ ref: item.ref }}
                        className={CASE_LINK_CLASS}
                      >
                        {item.ref}
                      </Link>
                    ) : (
                      <Link
                        to={routes.portalRequest.path}
                        params={{ ref: item.ref }}
                        className={CASE_LINK_CLASS}
                      >
                        {item.ref}
                      </Link>
                    )}
                    <span className="break-words text-muted-foreground">
                      {item.requestTypeName}
                    </span>
                  </span>
                  <span className="line-clamp-2 break-words text-foreground text-sm">
                    {item.title || item.requestTypeName}
                  </span>
                  {item.source === "direct" ? (
                    <span className="text-muted-foreground text-xs">
                      {raisedByTeamLabel(item, t)}
                    </span>
                  ) : null}
                  {/* Narrow frames: the hidden columns' key facts, under the title. */}
                  <span className="@2xl:hidden mt-1 flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {item.priority ? (
                        <PortalCaseSeverity priority={item.priority} />
                      ) : null}
                      <PortalCaseStatus status={item.customerStatus} />
                      <PortalCaseUpdated
                        value={item.updatedAt}
                        locale={locale}
                        className="text-muted-foreground text-xs"
                      />
                    </span>
                    <PortalSlaStatus sla={item.sla} />
                  </span>
                </div>
              </TableCell>
              {show("project") ? (
                <TableCell className="@5xl:table-cell hidden max-w-40 whitespace-normal text-sm">
                  {item.project ? (
                    <span className="line-clamp-2 break-words">
                      {item.project.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              ) : null}
              <TableCell className="@2xl:table-cell hidden">
                <PortalCaseSeverity priority={item.priority} />
              </TableCell>
              <TableCell className="@2xl:table-cell hidden min-w-40 whitespace-normal">
                <div className="flex flex-col items-start gap-1.5">
                  <PortalCaseStatus status={item.customerStatus} />
                  <PortalSlaStatus sla={item.sla} />
                </div>
              </TableCell>
              {show("people") ? (
                <>
                  <TableCell
                    className={cn(
                      "@4xl:table-cell hidden max-w-36 whitespace-normal text-sm",
                      !item.createdBy.isYou &&
                        !item.createdBy.name &&
                        "text-muted-foreground",
                    )}
                  >
                    <span className="line-clamp-2 break-words">
                      {item.createdBy.isYou
                        ? t("request.author.you")
                        : (item.createdBy.name ??
                          t("request.author.colleague"))}
                    </span>
                  </TableCell>
                  <TableCell className="@4xl:table-cell hidden whitespace-normal text-muted-foreground text-sm">
                    {t("cases.yourTeam")}
                  </TableCell>
                </>
              ) : null}
              {show("created") ? (
                <TableCell className="@5xl:table-cell hidden text-muted-foreground text-xs tabular-nums">
                  <time dateTime={item.createdAt}>
                    {formatDate(item.createdAt, locale)}
                  </time>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Frame>
  );
}

/**
 * Who a request the team raised (D6) was raised for: "for you" only for the requester; a
 * colleague reads the requester's name (D5), or "a colleague" when the name is withheld.
 */
export function raisedByTeamLabel(
  item: Pick<PortalCase, "isRequester" | "createdBy">,
  t: ReturnType<typeof usePortalTranslation>["t"],
) {
  if (item.isRequester) return t("cases.raisedByTeam");
  return item.createdBy.name
    ? t("cases.raisedByTeamFor", { name: item.createdBy.name })
    : t("cases.raisedByTeamForColleague");
}

export function PortalCaseSeverity({
  priority,
}: {
  priority: PortalCase["priority"];
}) {
  const { t } = usePortalTranslation("portal");
  // CP-2: an unset severity is a quiet dash, still named for screen readers.
  if (!priority)
    return (
      <span className="text-muted-foreground text-xs">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t("cases.notSet")}</span>
      </span>
    );
  return (
    <Badge variant={PRIORITY_TONE[priority]}>
      {t(`request.priority.value.${priority}`)}
    </Badge>
  );
}

export function PortalCaseStatus({
  status,
}: {
  status: PortalCase["customerStatus"];
}) {
  const { t } = usePortalTranslation("portal");
  return (
    <Badge variant={STATUS_TONE[status]}>{t(`request.status.${status}`)}</Badge>
  );
}
