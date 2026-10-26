import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Frame,
  Label,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerPopover } from "@/components/common/picker-popover";
import {
  type EngineRun,
  getImportMapping,
  type ImportMapping,
  type MappingDomain,
  type MappingEdit,
  type MappingEntry,
  type MappingStatus,
  type STATE_GROUPS,
  saveImportMapping,
} from "@/fetchers/god-mode/imports";
import { HttpError } from "@/lib/http-error";
import { useIdempotencyKey } from "./use-idempotency-key";
import { useTargetCatalogue } from "./use-target-catalogue";
import { wizardKeys } from "./wizard-keys";
import {
  decodeTarget,
  encodeTarget,
  type TargetCatalogue,
  targetOptionsFor,
} from "./wizard-model";

const PAGE = 100;

function statusVariant(status: MappingStatus) {
  if (status === "confirmed") return "success" as const;
  if (status === "proposed") return "warning" as const;
  return "error" as const;
}

function summarize(entries: readonly MappingEntry[]) {
  let unmapped = 0;
  let proposed = 0;
  let confirmed = 0;
  for (const entry of entries) {
    if (entry.status === "confirmed" && entry.target) confirmed += 1;
    else if (entry.status === "proposed") proposed += 1;
    else unmapped += 1;
  }
  return { unmapped, proposed, confirmed };
}

/** Applies edits the way the server will, so the table answers before the round trip. */
function applyOptimistic(
  mapping: ImportMapping,
  edits: readonly MappingEdit[],
  confirmProposals: boolean,
): ImportMapping {
  const entries = mapping.entries.map((entry) => {
    const edit = edits.find(
      (candidate) =>
        candidate.domain === entry.domain && candidate.value === entry.value,
    );
    if (edit)
      return {
        ...entry,
        target: edit.target,
        status: (edit.target ? "confirmed" : "unmapped") as MappingStatus,
      };
    if (confirmProposals && entry.status === "proposed" && entry.target)
      return { ...entry, status: "confirmed" as const };
    return entry;
  });
  return { ...mapping, entries };
}

/**
 * Presentational mapping table: source values against target values, the automatic proposal
 * pre-filled, unmapped rows highlighted and the number of records that depend on each row.
 */
export function MappingTable({
  entries,
  catalogue,
  disabled,
  onChange,
}: {
  entries: readonly MappingEntry[];
  catalogue: TargetCatalogue;
  disabled?: boolean;
  onChange: (entry: MappingEntry, target: string) => void;
}) {
  const { t } = useTranslation("godModeImports");
  const labels = {
    ignore: t("wizard.mapping.ignore"),
    placeholder: t("wizard.mapping.placeholder"),
    group: (group: (typeof STATE_GROUPS)[number]) =>
      t(`wizard.stateGroups.${group}`),
    priority: (value: "low" | "medium" | "high" | "urgent") =>
      t(`wizard.priorities.${value}`),
  };
  return (
    <Frame className="min-w-0 overflow-x-auto">
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            <TableHead>{t("wizard.mapping.domain")}</TableHead>
            <TableHead>{t("wizard.mapping.sourceValue")}</TableHead>
            <TableHead className="text-right">
              {t("wizard.mapping.affected")}
            </TableHead>
            <TableHead>{t("wizard.mapping.target")}</TableHead>
            <TableHead>{t("wizard.mapping.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const options = targetOptionsFor(entry.domain, catalogue, labels);
            const current = encodeTarget(entry.target);
            const known = !current || options.some((o) => o.value === current);
            const shown = known
              ? options
              : [
                  ...options,
                  { value: current, label: t("wizard.mapping.unknownTarget") },
                ];
            return (
              <TableRow
                key={`${entry.domain}:${entry.value}`}
                data-status={entry.status}
                className={
                  entry.status === "unmapped"
                    ? "bg-destructive/5"
                    : entry.status === "proposed"
                      ? "bg-warning/5"
                      : undefined
                }
              >
                <TableCell>
                  <Badge variant="outline">
                    {t(`wizard.domains.${entry.domain}`)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-64 break-all font-medium">
                  {entry.value}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {entry.affected}
                </TableCell>
                <TableCell>
                  <PickerPopover
                    value={current}
                    options={shown}
                    disabled={disabled}
                    placeholder={t("wizard.mapping.chooseTarget")}
                    ariaLabel={t("wizard.mapping.targetFor", {
                      value: entry.value,
                    })}
                    onChange={(next) => onChange(entry, next)}
                    className="w-52"
                  />
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(entry.status)}>
                    {t(`wizard.mapping.statuses.${entry.status}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Frame>
  );
}

type PendingSave = { edits: MappingEdit[]; confirmProposals: boolean };

/** Step 3: the mapping screen. Edits are optimistic and version-checked; a 409 offers a retry. */
export function MappingStep({
  run,
  onContinue,
}: {
  run: EngineRun;
  onContinue: () => void;
}) {
  const { t } = useTranslation("godModeImports");
  const client = useQueryClient();
  const key = useIdempotencyKey();
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [conflict, setConflict] = useState<PendingSave | null>(null);
  const queryKey = wizardKeys.mapping(run.id);
  const mapping = useQuery({
    queryKey,
    queryFn: () => getImportMapping(run.id),
    retry: false,
  });
  const domains = useMemo(
    () => new Set<MappingDomain>(mapping.data?.entries.map((e) => e.domain)),
    [mapping.data?.entries],
  );
  const { catalogue, failed } = useTargetCatalogue(run, domains);
  const locked = run.phase === "completed";

  const save = useMutation({
    mutationFn: (vars: PendingSave & { expectedVersion: number }) =>
      saveImportMapping(
        run.id,
        {
          expectedMappingVersion: vars.expectedVersion,
          entries: vars.edits,
          ...(vars.confirmProposals ? { confirmProposals: true } : {}),
        },
        key.keyFor(JSON.stringify(vars)),
      ),
    onMutate: async (vars) => {
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<ImportMapping>(queryKey);
      setConflict(null);
      if (previous)
        client.setQueryData(
          queryKey,
          applyOptimistic(previous, vars.edits, vars.confirmProposals),
        );
      return { previous };
    },
    onError: (error, vars, context) => {
      if (context?.previous) client.setQueryData(queryKey, context.previous);
      if (error instanceof HttpError && error.status === 409) {
        setConflict({
          edits: vars.edits,
          confirmProposals: vars.confirmProposals,
        });
        void client.invalidateQueries({ queryKey });
      }
    },
    onSuccess: (saved) => {
      key.reset();
      client.setQueryData(queryKey, saved);
      void client.invalidateQueries({ queryKey: wizardKeys.engine(run.id) });
      void client.invalidateQueries({ queryKey: wizardKeys.dryRun(run.id) });
    },
  });

  if (mapping.isPending) return <Skeleton className="h-72 w-full" />;
  if (mapping.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("wizard.mapping.loadErrorTitle")}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{t("wizard.mapping.loadErrorDescription")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void mapping.refetch()}
          >
            {t("retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );

  const data = mapping.data;
  const counts = summarize(data.entries);
  const open = counts.unmapped + counts.proposed;
  const visible = (
    onlyOpen
      ? data.entries.filter((e) => e.status !== "confirmed" || !e.target)
      : data.entries
  ).slice(0, shown);
  const total = onlyOpen ? open : data.entries.length;

  function submit(pending: PendingSave) {
    save.mutate({ ...pending, expectedVersion: data.mappingVersion });
  }

  return (
    <div className="min-w-0 space-y-5">
      {run.phase === "executing" ? (
        <Alert variant="warning">
          <AlertDescription>
            {t("wizard.mapping.executingWarning")}
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <ul
            className="flex flex-wrap gap-2"
            aria-label={t("wizard.mapping.summary")}
          >
            <li>
              <Badge variant="error">
                {t("wizard.mapping.unmappedCount", { count: counts.unmapped })}
              </Badge>
            </li>
            <li>
              <Badge variant="warning">
                {t("wizard.mapping.proposedCount", { count: counts.proposed })}
              </Badge>
            </li>
            <li>
              <Badge variant="success">
                {t("wizard.mapping.confirmedCount", {
                  count: counts.confirmed,
                })}
              </Badge>
            </li>
          </ul>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="import-wizard-only-open"
                checked={onlyOpen}
                onCheckedChange={(checked) => {
                  setOnlyOpen(checked);
                  setShown(PAGE);
                }}
              />
              <Label htmlFor="import-wizard-only-open">
                {t("wizard.mapping.onlyOpen")}
              </Label>
            </div>
            <Button
              variant="outline"
              disabled={counts.proposed === 0 || save.isPending || locked}
              onClick={() => submit({ edits: [], confirmProposals: true })}
            >
              {t("wizard.mapping.confirmProposals")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {open > 0 ? (
        <Alert variant="warning">
          <AlertTitle>{t("wizard.mapping.blockedTitle")}</AlertTitle>
          <AlertDescription>
            {t("wizard.mapping.blockedDescription", { count: open })}
          </AlertDescription>
        </Alert>
      ) : null}
      {failed.length > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            {t("wizard.mapping.catalogueError", {
              domains: failed.map((d) => t(`wizard.domains.${d}`)).join(", "),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {conflict ? (
        <Alert variant="error">
          <AlertTitle>{t("wizard.mapping.conflictTitle")}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{t("wizard.mapping.conflictDescription")}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={mapping.isFetching || save.isPending}
              onClick={() => submit(conflict)}
            >
              {t("wizard.mapping.conflictRetry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : save.isError ? (
        <Alert variant="error">
          <AlertTitle>{t("wizard.mapping.saveErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("wizard.mapping.saveErrorDescription")}
          </AlertDescription>
        </Alert>
      ) : null}

      {data.entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("wizard.mapping.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("wizard.mapping.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <MappingTable
          entries={visible}
          catalogue={catalogue}
          disabled={locked || save.isPending}
          onChange={(entry, encoded) => {
            const target = decodeTarget(encoded);
            if (!target) return;
            submit({
              edits: [{ domain: entry.domain, value: entry.value, target }],
              confirmProposals: false,
            });
          }}
        />
      )}
      {total > shown ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setShown(shown + PAGE)}>
            {t("wizard.mapping.showMore", { count: total - shown })}
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button disabled={open > 0 || save.isPending} onClick={onContinue}>
          {t("wizard.mapping.continue")}
        </Button>
      </div>
    </div>
  );
}
