import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  Skeleton,
} from "@taskdesk/ui";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Mail,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  getPortalProject,
  type PortalProjectDetail,
  portalProjectKeys,
} from "@/fetchers/portal/projects";
import { formatDateMedium } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/portal-route-builders";
import type { PortalHomeSearch } from "@/lib/portal-route-search";

import type { PortalCaseFilterPatch } from "../cases/portal-case-filters";
import { PortalOutstandingCases } from "../cases/portal-outstanding-cases";
import { PortalHomeKpis } from "../portal-home-kpis";
import { PortalPageTitle } from "../portal-page-title";
import {
  formatPortalCalendarDate,
  formatPortalHours,
  PortalProjectHealthBadge,
  PortalProjectStatusBadge,
} from "./portal-project-format";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="flex flex-col gap-1 border-b py-3">
        <CardTitle
          render={(props) => <h2 {...props} />}
          className="font-semibold text-sm"
        >
          {title}
        </CardTitle>
        {description ? (
          <CardDescription className="text-xs">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 py-3 text-sm sm:px-6">
        {children}
      </div>
    </Card>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

function InformationCard({ project }: { project: PortalProjectDetail }) {
  const { t } = usePortalTranslation("portal");
  const notSet = (
    <span className="text-muted-foreground">
      {t("projects.detail.information.notSet")}
    </span>
  );
  return (
    <Section
      title={t("projects.detail.information.title")}
      className="lg:col-span-2"
    >
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label={t("projects.detail.information.name")}>
          {project.name}
        </Fact>
        <Fact label={t("projects.detail.information.key")}>
          <Badge variant="outline" className="font-mono">
            {project.key}
          </Badge>
        </Fact>
        <Fact label={t("projects.columns.type")}>
          {t(`projects.kind.${project.kind}`)}
        </Fact>
        <Fact label={t("projects.detail.information.createdOn")}>
          {formatDateMedium(project.createdAt)}
        </Fact>
        <Fact label={t("projects.detail.information.supportTier")}>
          {project.supportLevel ?? notSet}
        </Fact>
        <Fact label={t("projects.detail.information.goLive")}>
          {project.goLive ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {formatPortalCalendarDate(project.goLive.date)}
              {project.goLive.reached ? (
                <Badge variant="success">
                  {t("projects.detail.information.live")}
                </Badge>
              ) : null}
            </span>
          ) : (
            notSet
          )}
        </Fact>
        <Fact label={t("projects.detail.information.serviceHours")}>
          {project.serviceCalendarName ?? notSet}
        </Fact>
        <Fact label={t("projects.columns.status")}>
          <span className="flex flex-wrap items-center gap-1.5">
            <PortalProjectStatusBadge status={project.status} />
            <PortalProjectHealthBadge health={project.health} />
          </span>
        </Fact>
      </dl>
      {project.description ? (
        <p className="whitespace-pre-line text-muted-foreground text-sm">
          {project.description}
        </p>
      ) : null}
    </Section>
  );
}

function ContactsCard({ project }: { project: PortalProjectDetail }) {
  const { t } = usePortalTranslation("portal");
  return (
    <Section title={t("projects.detail.contacts.title")}>
      {project.contacts.length === 0 ? (
        <Muted>{t("projects.detail.contacts.none")}</Muted>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {project.contacts.map((contact) => {
            const name = contact.name ?? t("projects.detail.contacts.unnamed");
            return (
              <li
                // Contacts carry no person id (none is exposed to customers).
                key={`${contact.kind}|${contact.role ?? ""}|${contact.email ?? contact.name ?? ""}`}
                className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0"
              >
                <span className="text-muted-foreground text-xs">
                  {contact.kind === "manager"
                    ? t("projects.detail.contacts.manager")
                    : contact.role}
                </span>
                <span className="font-medium text-sm">{name}</span>
                {contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    aria-label={t("projects.detail.contacts.emailLabel", {
                      name,
                    })}
                    className="flex w-fit items-center gap-1.5 rounded-sm text-primary text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Mail className="size-3.5" aria-hidden="true" />
                    <span className="break-all">{contact.email}</span>
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function SubscriptionCard({ project }: { project: PortalProjectDetail }) {
  const { t } = usePortalTranslation("portal");
  const contract = project.contract;
  return (
    <Section title={t("projects.detail.subscription.title")}>
      {!contract ? (
        <Muted>{t("projects.detail.subscription.none")}</Muted>
      ) : (
        <>
          <Progress
            value={contract.period.elapsedPct}
            aria-label={t("projects.detail.subscription.progressLabel")}
          >
            <ProgressTrack className="h-2">
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
          <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">
                {t("projects.detail.subscription.start")}
              </span>
              <span>{formatPortalCalendarDate(contract.startDate)}</span>
            </div>
            <span className="self-center font-medium tabular-nums">
              {contract.period.state === "upcoming"
                ? t("projects.detail.subscription.upcoming", {
                    date: formatPortalCalendarDate(contract.startDate),
                  })
                : contract.period.state === "ended"
                  ? t("projects.detail.subscription.ended", {
                      date: formatPortalCalendarDate(contract.endDate),
                    })
                  : t("projects.detail.subscription.remaining", {
                      count: contract.period.daysRemaining,
                    })}
            </span>
            <div className="flex flex-col text-right">
              <span className="text-muted-foreground text-xs">
                {t("projects.detail.subscription.end")}
              </span>
              <span>{formatPortalCalendarDate(contract.endDate)}</span>
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

function HoursCard({ project }: { project: PortalProjectDetail }) {
  const { t, i18n } = usePortalTranslation("portal");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const hours = project.contract?.hours;
  return (
    <Section title={t("projects.detail.hours.title")}>
      {!hours ? (
        <Muted>{t("projects.detail.hours.none")}</Muted>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-sm">
              {t("projects.detail.hours.usedOf", {
                used: formatPortalHours(hours.usedMinutes, locale),
                total: formatPortalHours(hours.contractedMinutes, locale),
              })}
            </span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("projects.detail.hours.percentUsed", {
                percent: hours.usedPct,
              })}
            </span>
          </div>
          <Progress
            value={Math.min(100, hours.usedPct)}
            aria-label={t("projects.detail.hours.progressLabel")}
          >
            <ProgressTrack className="h-2">
              <ProgressIndicator
                className={cn(
                  hours.usedPct >= 100
                    ? "bg-destructive"
                    : hours.usedPct >= 80
                      ? "bg-warning"
                      : undefined,
                )}
              />
            </ProgressTrack>
          </Progress>
          <span
            className={cn(
              "text-sm tabular-nums",
              hours.remainingMinutes < 0
                ? "text-destructive-foreground"
                : "text-muted-foreground",
            )}
          >
            {hours.remainingMinutes < 0
              ? t("projects.detail.hours.overdrawn", {
                  hours: formatPortalHours(-hours.remainingMinutes, locale),
                })
              : t("projects.detail.hours.remaining", {
                  hours: formatPortalHours(hours.remainingMinutes, locale),
                })}
          </span>
        </>
      )}
    </Section>
  );
}

function SummaryCard({ project }: { project: PortalProjectDetail }) {
  const { t } = usePortalTranslation("portal");
  const fields = (
    ["objective", "inScope", "outOfScope", "successCriteria"] as const
  ).filter((field) => project.summary[field]);
  return (
    <Section title={t("projects.detail.summary.title")}>
      {fields.length === 0 ? (
        <Muted>{t("projects.detail.summary.none")}</Muted>
      ) : (
        <dl className="flex flex-col gap-3">
          {fields.map((field) => (
            <div key={field} className="flex flex-col gap-0.5">
              <dt className="font-medium text-xs">
                {t(`projects.detail.summary.${field}`)}
              </dt>
              <dd className="whitespace-pre-line text-muted-foreground text-sm">
                {project.summary[field]}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  );
}

function MilestonesCard({ project }: { project: PortalProjectDetail }) {
  const { t } = usePortalTranslation("portal");
  return (
    <Section title={t("projects.detail.milestones.title")}>
      {project.milestones.length === 0 ? (
        <Muted>{t("projects.detail.milestones.none")}</Muted>
      ) : (
        <ol className="flex flex-col gap-2">
          {project.milestones.map((milestone) => {
            const reached = milestone.reachedAt !== null;
            const Icon = reached ? CircleCheck : CircleDashed;
            return (
              <li key={milestone.id} className="flex items-start gap-2">
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    reached
                      ? "text-success-foreground"
                      : "text-muted-foreground",
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words text-sm">{milestone.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatPortalCalendarDate(milestone.date)}
                    {" · "}
                    {reached
                      ? t("projects.detail.milestones.reached")
                      : t("projects.detail.milestones.planned")}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function PrerequisitesCard({ project }: { project: PortalProjectDetail }) {
  const { t } = usePortalTranslation("portal");
  return (
    <Section
      title={t("projects.detail.prerequisites.title")}
      description={t("projects.detail.prerequisites.description")}
    >
      {project.prerequisites.length === 0 ? (
        <Muted>{t("projects.detail.prerequisites.none")}</Muted>
      ) : (
        <ul className="flex flex-col gap-2">
          {project.prerequisites.map((item) => {
            const done = item.completedAt !== null;
            return (
              <li key={item.id} className="flex items-start gap-2">
                {done ? (
                  <CircleCheck
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-success-foreground"
                  />
                ) : (
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-warning-foreground"
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words text-sm">{item.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {done
                      ? t("projects.detail.prerequisites.done")
                      : item.dueDate
                        ? t("projects.detail.prerequisites.due", {
                            date: formatPortalCalendarDate(item.dueDate),
                          })
                        : t("projects.detail.prerequisites.open")}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** Only http(s) links are rendered as links; anything else is shown as plain text. */
function safeHref(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function DocumentsCard({ project }: { project: PortalProjectDetail }) {
  const { t } = usePortalTranslation("portal");
  return (
    <Section title={t("projects.detail.documents.title")}>
      {project.documents.length === 0 ? (
        <Muted>{t("projects.detail.documents.none")}</Muted>
      ) : (
        <ul className="flex flex-col gap-3">
          {project.documents.map((document) => {
            const href = safeHref(document.url);
            const kindLabel = t(
              `projects.detail.documents.kinds.${document.kind}`,
            );
            // The type badge adds nothing when the title already says it.
            const showKind =
              kindLabel.toLocaleLowerCase() !==
              document.title.trim().toLocaleLowerCase();
            return (
              <li
                key={document.id}
                className="flex flex-col gap-1 text-sm"
                data-testid="portal-project-document"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="break-words">{document.title}</span>
                      <ExternalLink
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="sr-only">
                        ({t("projects.detail.documents.opensInNewTab")})
                      </span>
                    </a>
                  ) : (
                    <span className="break-words">{document.title}</span>
                  )}
                  {showKind ? (
                    <Badge variant="outline">{kindLabel}</Badge>
                  ) : null}
                </div>
                {document.description ? (
                  <p className="whitespace-pre-line break-words text-muted-foreground">
                    {document.description}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function DetailsSkeleton() {
  const { t } = usePortalTranslation("portal");
  return (
    <div
      role="status"
      aria-label={t("projects.detail.information.title")}
      className="grid gap-4 lg:grid-cols-3"
    >
      <Skeleton className="h-40 lg:col-span-2" />
      <Skeleton className="h-40" />
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
    </div>
  );
}

/**
 * Project Details (S4c), modelled on the WSO2 portal: the engagement's own status page (U-11).
 * The dashboard's four figures and its outstanding cases, scoped to this project
 * (`GET /api/portal/home?project=KEY`, `GET /api/portal/requests?project=KEY`), then project
 * information, contact information, subscription period and service-hours allocation, the
 * summary, milestones, what the team needs from the customer and the shared documents
 * (`GET /api/portal/projects/{key}`, the customer view only). The scoped reads wait for the
 * project to load, so an unknown key asks for nothing else.
 */
export function PortalProjectDetails({
  projectKey,
  portalUserId,
  caseFilters,
  onCaseFiltersChange,
}: {
  projectKey: string;
  portalUserId: string;
  caseFilters: Pick<PortalHomeSearch, "scope" | "status" | "priority">;
  onCaseFiltersChange: (patch: PortalCaseFilterPatch) => void;
}) {
  const { t } = usePortalTranslation("portal");
  const query = useQuery({
    queryKey: portalProjectKeys.detail(projectKey),
    queryFn: () => getPortalProject(projectKey),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status === 404) && count < 2,
    refetchOnMount: "always",
  });
  const project = query.data;
  const notFound =
    query.error instanceof HttpError && query.error.status === 404;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <PortalPageTitle
        title={
          notFound
            ? t("projects.detail.notFound.title")
            : project
              ? `${project.name} · ${project.key}`
              : projectKey
        }
      />
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to={routes.portalProjects.path} />}
        >
          <ArrowLeft aria-hidden="true" />
          {t("projects.detail.back")}
        </Button>
      </div>
      {notFound ? (
        <section className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl">
            {t("projects.detail.notFound.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("projects.detail.notFound.description")}
          </p>
        </section>
      ) : query.isError ? (
        <Alert variant="error">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("projects.detail.loadFailed")}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              {t("common:actions.tryAgain")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !project ? (
        <DetailsSkeleton />
      ) : (
        <>
          <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words font-semibold text-2xl">
                  {project.name}
                </h1>
                <Badge variant="outline" className="font-mono">
                  {project.key}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {t(`projects.kind.${project.kind}`)}
              </p>
            </div>
          </header>
          <PortalHomeKpis
            portalUserId={portalUserId}
            project={project.key}
            label={t("projects.detail.figures")}
          />
          {/* The project's facts lead, as on the v1 project page; its cases follow. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <InformationCard project={project} />
            <ContactsCard project={project} />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SubscriptionCard project={project} />
            <HoursCard project={project} />
          </div>
          <PortalOutstandingCases
            portalUserId={portalUserId}
            filters={caseFilters}
            project={project.key}
            onChange={onCaseFiltersChange}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SummaryCard project={project} />
            <MilestonesCard project={project} />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PrerequisitesCard project={project} />
            <DocumentsCard project={project} />
          </div>
        </>
      )}
    </div>
  );
}
