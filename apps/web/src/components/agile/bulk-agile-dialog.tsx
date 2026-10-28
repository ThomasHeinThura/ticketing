import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addCycleWorkItems,
  addModuleWorkItems,
  getCycles,
  getModules,
} from "@/fetchers/agile";

/** The API accepts at most this many keys per bulk call. */
export const BULK_CHUNK = 200;

export type BulkOutcome = {
  added: string[];
  already: string[];
  moved: string[];
  refused: Array<{ key: string; reason: string }>;
};

type AnyResult = {
  added: string[];
  alreadyInCycle?: string[];
  alreadyInModule?: string[];
  movedFromOtherCycle?: string[];
  movedFromOtherModule?: string[];
  refused: Array<{ key: string; reason: string }>;
};

/** Folds the per-call results of a chunked bulk add into one outcome. */
export function mergeOutcomes(results: readonly AnyResult[]): BulkOutcome {
  const outcome: BulkOutcome = {
    added: [],
    already: [],
    moved: [],
    refused: [],
  };
  for (const result of results) {
    outcome.added.push(...result.added);
    outcome.already.push(
      ...(result.alreadyInCycle ?? result.alreadyInModule ?? []),
    );
    outcome.moved.push(
      ...(result.movedFromOtherCycle ?? result.movedFromOtherModule ?? []),
    );
    outcome.refused.push(...result.refused);
  }
  return outcome;
}

export function chunkKeys(keys: readonly string[], size = BULK_CHUNK) {
  const chunks: string[][] = [];
  for (let index = 0; index < keys.length; index += size)
    chunks.push(keys.slice(index, index + size));
  return chunks;
}

type Kind = "cycle" | "module";

/**
 * Bulk "add to cycle / module" for the current list selection (`CY-5`). A work item is in at most
 * one cycle and one module, so an item already elsewhere is moved; the outcome per item is shown
 * rather than hidden behind a toast.
 */
export function BulkAgileDialog({
  projectKey,
  features,
  selectedKeys,
  onClose,
  onDone,
}: {
  projectKey: string;
  features: { cycles: boolean; modules: boolean };
  selectedKeys: string[];
  onClose: () => void;
  onDone?: (added: string[]) => void;
}) {
  const { t } = useTranslation("agile");
  const cache = useQueryClient();
  const [kind, setKind] = useState<Kind>(features.cycles ? "cycle" : "module");
  const [targetId, setTargetId] = useState("");
  const [outcome, setOutcome] = useState<BulkOutcome>();

  const cycles = useQuery({
    queryKey: ["agile", "cycles", projectKey],
    queryFn: () => getCycles(projectKey),
    enabled: features.cycles,
  });
  const modules = useQuery({
    queryKey: ["agile", "modules", projectKey],
    queryFn: () => getModules(projectKey),
    enabled: features.modules,
  });
  const targets =
    kind === "cycle"
      ? (cycles.data?.data
          .filter((cycle) => cycle.status !== "completed")
          .map((cycle) => ({ id: cycle.id, name: cycle.name })) ?? [])
      : (modules.data?.data.map((mod) => ({ id: mod.id, name: mod.name })) ??
        []);
  const loading = kind === "cycle" ? cycles.isLoading : modules.isLoading;

  const add = useMutation({
    mutationFn: async () => {
      const results: AnyResult[] = [];
      for (const chunk of chunkKeys(selectedKeys))
        results.push(
          kind === "cycle"
            ? await addCycleWorkItems(targetId, chunk)
            : await addModuleWorkItems(targetId, chunk),
        );
      return mergeOutcomes(results);
    },
    onSuccess: async (result) => {
      setOutcome(result);
      await cache.invalidateQueries({ queryKey: ["agile"] });
      await cache.invalidateQueries({ queryKey: ["work-items"] });
      onDone?.(result.added);
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("bulk.title")}</DialogTitle>
          <DialogDescription>
            {t("bulk.description", { count: selectedKeys.length })}
          </DialogDescription>
        </DialogHeader>
        {outcome ? (
          <div className="flex flex-col gap-2" data-testid="bulk-agile-outcome">
            <ul className="text-sm">
              <li>
                {t("bulk.outcome.added", { count: outcome.added.length })}
              </li>
              {outcome.already.length > 0 ? (
                <li>
                  {t(`bulk.outcome.already.${kind}`, {
                    count: outcome.already.length,
                  })}
                </li>
              ) : null}
              {outcome.moved.length > 0 ? (
                <li>
                  {t(`bulk.outcome.moved.${kind}`, {
                    count: outcome.moved.length,
                  })}
                </li>
              ) : null}
            </ul>
            {outcome.refused.length > 0 ? (
              <Alert variant="error">
                <AlertDescription>
                  <p>
                    {t("bulk.outcome.refused", {
                      count: outcome.refused.length,
                    })}
                  </p>
                  <ul className="list-disc ps-4 text-xs">
                    {outcome.refused.map((entry) => (
                      <li key={entry.key}>
                        {entry.key}: {entry.reason}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {features.cycles && features.modules ? (
              <RadioGroup
                value={kind}
                onValueChange={(value) => {
                  setKind(value as Kind);
                  setTargetId("");
                }}
                aria-label={t("bulk.kindLabel")}
                className="flex gap-4"
              >
                {(["cycle", "module"] as const).map((option) => (
                  <div key={option} className="flex items-center gap-2">
                    <RadioGroupItem id={`bulk-kind-${option}`} value={option} />
                    <Label
                      htmlFor={`bulk-kind-${option}`}
                      className="font-normal"
                    >
                      {t(`bulk.kind.${option}`)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            ) : null}
            {loading ? (
              <Skeleton className="h-16 w-full" />
            ) : targets.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t(`bulk.none.${kind}`)}
              </p>
            ) : (
              <RadioGroup
                value={targetId}
                onValueChange={(value) => setTargetId(String(value))}
                aria-label={t(`bulk.targetLabel.${kind}`)}
              >
                {targets.map((target) => (
                  <div key={target.id} className="flex items-center gap-2">
                    <RadioGroupItem
                      id={`bulk-target-${target.id}`}
                      value={target.id}
                    />
                    <Label
                      htmlFor={`bulk-target-${target.id}`}
                      className="font-normal"
                    >
                      {target.name}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
            {kind === "cycle" ? (
              <p className="text-muted-foreground text-xs">
                {t("bulk.cycleNote")}
              </p>
            ) : null}
            {add.isError ? (
              <Alert variant="error">
                <AlertDescription>{t("bulk.failed")}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {outcome ? t("common.close") : t("common.cancel")}
          </Button>
          {outcome ? null : (
            <Button
              disabled={!targetId || add.isPending}
              onClick={() => add.mutate()}
            >
              {t("bulk.confirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
