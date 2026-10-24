import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  createHourlyRate,
  TimeTrackingDisabledError,
} from "@/fetchers/time-tracking";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useHourlyRates } from "@/hooks/queries/time-tracking/use-time-tracking";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { formatMinor, parseMinor } from "@/lib/money-minor";
import { toast } from "@/lib/toast";
import { CostTypesSection } from "./cost-types-settings";
import { DateField } from "./date-field";
import { useInvalidateTime, useTimeErrorMessage } from "./time-shared";

const DEFAULT_PROJECT = "__default__";

function isForbidden(error: unknown) {
  return (error as { status?: number } | null)?.status === 403;
}

/**
 * `docs/screens.md` "Workspace — rates" (P5, `TC-8`..`TC-11`): hourly rates by person, optionally
 * by project, effective from a date. Only `time_entry:manage_rates` holders can read this at all.
 */
export function RatesSettings() {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const rates = useHourlyRates(workspace?.id);
  const projects = useGetProjects({ workspaceId: workspace?.id ?? "" });
  const [personId, setPersonId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>(DEFAULT_PROJECT);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const lastCurrency = rates.data?.data[0]?.currency ?? "";
  const code = (currency || lastCurrency).toUpperCase();
  const minor = /^[A-Z]{3}$/u.test(code) ? parseMinor(amount, code) : null;
  const projectNames = new Map(
    (projects.data ?? []).map((project) => [project.id, project.name]),
  );
  const add = useMutation({
    mutationFn: () =>
      createHourlyRate({
        workspaceId: workspace?.id as string,
        personId: personId as string,
        projectId: projectId === DEFAULT_PROJECT ? null : projectId,
        rateMinor: minor as number,
        currency: code,
        effectiveFrom: effectiveFrom || today,
      }),
    onSuccess: async () => {
      setAmount("");
      toast.success(t("timeTracking:rates.added"));
      await invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message.includes("already starts")
          ? t("timeTracking:rates.duplicate")
          : message(error),
      ),
  });
  const people = rates.data?.people ?? [];
  const chosenPerson = people.find((person) => person.personId === personId);
  const loading = workspaceLoading || rates.isLoading;
  const canSubmit = Boolean(personId) && minor !== null && !add.isPending;
  return (
    <>
      <PageTitle title={t("timeTracking:rates.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl">
            {t("timeTracking:rates.title")}
          </h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            {t("timeTracking:rates.description")}
          </p>
        </div>
        {loading ? (
          <Skeleton className="h-32 w-full" role="status" />
        ) : isForbidden(rates.error) ? (
          <Alert variant="error">
            <AlertTitle>{t("timeTracking:rates.forbiddenTitle")}</AlertTitle>
            <AlertDescription>
              {t("timeTracking:rates.forbiddenDescription")}
            </AlertDescription>
          </Alert>
        ) : rates.error instanceof TimeTrackingDisabledError ? (
          <Alert variant="info">
            <AlertTitle>{t("timeTracking:rates.disabledTitle")}</AlertTitle>
            <AlertDescription>
              {t("timeTracking:rates.disabledDescription")}
            </AlertDescription>
          </Alert>
        ) : rates.isError || !rates.data ? (
          <Alert variant="error">
            <AlertTitle>{t("timeTracking:rates.loadError")}</AlertTitle>
          </Alert>
        ) : (
          <>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmit) add.mutate();
              }}
            >
              <div className="w-48 space-y-1">
                <Label htmlFor="rate-person" className="text-xs">
                  {t("timeTracking:fields.person")}
                </Label>
                <Select value={personId} onValueChange={setPersonId}>
                  <SelectTrigger id="rate-person">
                    <SelectValue>
                      {chosenPerson?.name ??
                        t("timeTracking:rates.choosePerson")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((person) => (
                      <SelectItem key={person.personId} value={person.personId}>
                        {person.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-48 space-y-1">
                <Label htmlFor="rate-project" className="text-xs">
                  {t("timeTracking:rates.project")}
                </Label>
                <Select
                  value={projectId}
                  onValueChange={(value) => value && setProjectId(value)}
                >
                  <SelectTrigger id="rate-project">
                    <SelectValue>
                      {projectId === DEFAULT_PROJECT
                        ? t("timeTracking:rates.defaultRate")
                        : (projectNames.get(projectId) ?? projectId)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_PROJECT}>
                      {t("timeTracking:rates.defaultRate")}
                    </SelectItem>
                    {(projects.data ?? []).map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28 space-y-1">
                <Label htmlFor="rate-amount" className="text-xs">
                  {t("timeTracking:rates.amount")}
                </Label>
                <Input
                  id="rate-amount"
                  inputMode="decimal"
                  value={amount}
                  aria-invalid={amount !== "" && minor === null}
                  disabled={add.isPending}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
              <div className="w-24 space-y-1">
                <Label htmlFor="rate-currency" className="text-xs">
                  {t("timeTracking:rates.currency")}
                </Label>
                <Input
                  id="rate-currency"
                  maxLength={3}
                  placeholder="EUR"
                  value={currency || lastCurrency}
                  disabled={add.isPending}
                  onChange={(event) =>
                    setCurrency(event.target.value.toUpperCase())
                  }
                />
              </div>
              <div className="w-44 space-y-1">
                <Label htmlFor="rate-from" className="text-xs">
                  {t("timeTracking:rates.effectiveFrom")}
                </Label>
                <DateField
                  id="rate-from"
                  value={effectiveFrom || today}
                  disabled={add.isPending}
                  onChange={setEffectiveFrom}
                />
              </div>
              <Button type="submit" disabled={!canSubmit}>
                <Plus aria-hidden="true" />
                {t("timeTracking:rates.add")}
              </Button>
            </form>
            <p className="max-w-2xl text-muted-foreground text-xs">
              {t("timeTracking:rates.snapshotNote")}
            </p>
            {rates.data.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("timeTracking:rates.empty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("timeTracking:fields.person")}</TableHead>
                    <TableHead>{t("timeTracking:rates.project")}</TableHead>
                    <TableHead className="text-right">
                      {t("timeTracking:rates.hourly")}
                    </TableHead>
                    <TableHead>
                      {t("timeTracking:rates.effectiveFrom")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.data.data.map((rate) => (
                    <TableRow key={rate.id} data-testid="rate-row">
                      <TableCell>{rate.personName ?? rate.personId}</TableCell>
                      <TableCell>
                        {rate.projectId
                          ? (projectNames.get(rate.projectId) ?? rate.projectId)
                          : t("timeTracking:rates.defaultRate")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMinor(rate.rateMinor, rate.currency)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {rate.effectiveFrom}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <CostTypesSection workspaceId={workspace?.id ?? ""} />
          </>
        )}
      </div>
    </>
  );
}
