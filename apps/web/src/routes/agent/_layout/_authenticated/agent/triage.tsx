import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { getIntakeQueue } from "@/fetchers/request-type";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { routes } from "@/lib/routes";

const states = [
  "new",
  "clarifying",
  "accepted",
  "declined",
  "duplicate",
  "withdrawn",
] as const;
type State = (typeof states)[number];
function validateSearch(raw: Record<string, unknown>): {
  tab: "intake";
  state?: State;
  before?: string;
} {
  const state =
    typeof raw.state === "string" && states.includes(raw.state as State)
      ? (raw.state as State)
      : undefined;
  const before =
    typeof raw.before === "string" && /^SUB-[1-9]\d*$/u.test(raw.before)
      ? raw.before
      : undefined;
  return { tab: "intake", state, before };
}

export const Route = createFileRoute("/_layout/_authenticated/agent/triage")({
  validateSearch,
  component: IntakeQueueRoute,
});

function IntakeQueueRoute() {
  const { t } = useTranslation("intakeTriage");
  const navigate = useNavigate({ from: Route.fullPath });
  const { state, before } = Route.useSearch();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const { canTriageIntake, isCheckingPermissions } = useWorkspacePermission(
    workspace?.id ?? null,
  );
  const allowed = canTriageIntake();
  const query = useQuery({
    queryKey: [
      "intake-queue",
      workspace?.id ?? "",
      state ?? null,
      before ?? null,
    ],
    queryFn: () =>
      getIntakeQueue({ workspaceId: workspace!.id, state, before }),
    enabled: Boolean(workspace?.id && allowed),
  });
  const open = (ref: string) =>
    navigate({ to: routes.intakeSubmission.path, params: { ref } });

  if (!isCheckingPermissions && !allowed)
    return (
      <main className="p-6">
        <Alert variant="error">
          <AlertTitle>{t("title")}</AlertTitle>
          <AlertDescription>{t("loadError")}</AlertDescription>
        </Alert>
      </main>
    );
  return (
    <>
      <PageTitle title={t("title")} />
      <main className="flex h-full flex-col gap-5 overflow-y-auto p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
          <div className="w-52">
            <Select
              value={state ?? "all"}
              onValueChange={(value) =>
                void navigate({
                  search: {
                    tab: "intake",
                    state: value === "all" ? undefined : (value as State),
                    before: undefined,
                  },
                })
              }
            >
              <SelectTrigger aria-label={t("state")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("title")}</SelectItem>
                {states.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {t(`states.${entry}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>
        {workspaceLoading || query.isLoading ? (
          <div role="status" aria-label={t("loading")} className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : query.isError ? (
          <Alert variant="error">
            <AlertTitle>{t("loadError")}</AlertTitle>
            <AlertDescription>
              <Button variant="outline" onClick={() => void query.refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : query.data?.items.length ? (
          <section aria-label={t("title")} className="grid gap-3">
            {query.data.items.map((item) => {
              const title =
                Object.values(item.formData).find(
                  (value): value is string => typeof value === "string",
                ) ?? item.ref;
              const createdAt = new Date(item.createdAt).toISOString();
              return (
                <Card
                  key={item.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => open(item.ref)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      open(item.ref);
                    }
                  }}
                  className="cursor-pointer"
                >
                  <CardContent className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.ref}</span>
                        <span className="text-sm text-muted-foreground">
                          {item.requestTypeName}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2">{title}</p>
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={createdAt}
                      >
                        {new Date(createdAt).toLocaleString()}
                      </time>
                    </div>
                    <Button
                      variant="outline"
                      render={
                        <Link
                          to={routes.intakeSubmission.path}
                          params={{ ref: item.ref }}
                        />
                      }
                      onClick={(event) => event.stopPropagation()}
                    >
                      {t("open")}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t("empty")}</EmptyTitle>
                  <EmptyDescription>{t("description")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        )}
        {query.data?.nextBefore ? (
          <Button
            variant="outline"
            className="self-start"
            onClick={() =>
              void navigate({
                search: {
                  tab: "intake",
                  state,
                  before: query.data?.nextBefore ?? undefined,
                },
              })
            }
          >
            {t("next")}
          </Button>
        ) : null}
        {before ? (
          <Button
            variant="ghost"
            className="self-start"
            onClick={() =>
              void navigate({
                search: { tab: "intake", state, before: undefined },
              })
            }
          >
            {t("previous")}
          </Button>
        ) : null}
      </main>
    </>
  );
}
