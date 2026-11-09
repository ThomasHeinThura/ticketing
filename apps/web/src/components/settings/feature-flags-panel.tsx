import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INSTANCE_ONLY_FEATURES } from "@taskdesk/permissions";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { Lock, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";
import {
  type FeatureChange,
  FeatureConflictError,
  type FeatureLevel,
  type FeatureRow,
  getFeatures,
  patchFeatures,
} from "@/fetchers/feature-flags";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

/**
 * The feature switches of one level (`ST-1`, `ST-2`, `ST-4`, `ST-5`). Instance administrators
 * set the value and the lock; a workspace or project either inherits the value or overrides
 * it, and the panel says which. Each toggle is a change that takes effect immediately.
 */
export function FeatureFlagsPanel({ target }: { target: FeatureLevel }) {
  const { t } = useTranslation("featureFlags");
  const queryClient = useQueryClient();
  const queryKey = ["feature-flags", target] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => getFeatures(target),
    retry: false,
  });
  const save = useMutation({
    mutationFn: (change: FeatureChange) => patchFeatures(target, [change]),
    onSuccess: (features) => {
      queryClient.setQueryData(queryKey, features);
      // The effective values every screen reads: the workspace's (navigation, Knowledge base,
      // Triage, Reports) and each project's (Pages, agile tabs). An instance or workspace change
      // reaches every workspace and project below it, so both are refreshed by prefix.
      void queryClient.invalidateQueries({ queryKey: ["features"] });
      void queryClient.invalidateQueries({ queryKey: ["agile", "features"] });
    },
    onError: (error) => {
      if (error instanceof FeatureConflictError)
        void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  // The server decides who may read or change features (`workspace:manage_settings`, or
  // `project:manage_settings` at the project, including a project-only grant), so a refusal says
  // so instead of reading as a failed load.
  if (query.error instanceof HttpError && query.error.status === 403)
    return (
      <Alert variant="info">
        <AlertTitle>{t("forbiddenTitle")}</AlertTitle>
        <AlertDescription>{t("forbidden")}</AlertDescription>
      </Alert>
    );
  if (query.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("unavailable")}</AlertTitle>
        <AlertDescription>{t("loadFailed")}</AlertDescription>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("retry")}
        </Button>
      </Alert>
    );

  const conflict =
    save.error instanceof FeatureConflictError ? save.error : null;
  // P4R2-M2: instance-only flags (SCIM, MCP) have no workspace or project level; the API leaves
  // them out of the lower-level lists and refuses such writes, and the panel never offers them.
  const rows =
    target.level === "instance"
      ? query.data
      : query.data.filter(
          (row) =>
            !(INSTANCE_ONLY_FEATURES as ReadonlySet<string>).has(row.key),
        );

  return (
    <div className="space-y-4">
      {conflict ? (
        <Alert variant="warning" role="alert">
          <AlertTitle>
            {t(
              conflict.code === "feature_locked"
                ? "lockedConflictTitle"
                : "versionConflictTitle",
            )}
          </AlertTitle>
          <AlertDescription>
            {t(
              conflict.code === "feature_locked"
                ? "lockedConflict"
                : "versionConflict",
            )}
          </AlertDescription>
        </Alert>
      ) : save.isError ? (
        <Alert variant="error" role="alert">
          <AlertDescription>{t("saveFailed")}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        {/* S11: header and rows share the card's density padding so their edges line up. */}
        <CardHeader className="td-density-card">
          <CardTitle>{t(`${target.level}.title`)}</CardTitle>
          <CardDescription>{t(`${target.level}.description`)}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <FeatureRowItem
                key={row.key}
                row={row}
                level={target.level}
                busy={save.isPending}
                onChange={(change) => save.mutate(change)}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureRowItem({
  row,
  level,
  busy,
  onChange,
}: {
  row: FeatureRow;
  level: FeatureLevel["level"];
  busy: boolean;
  onChange: (change: FeatureChange) => void;
}) {
  const { t } = useTranslation("featureFlags");
  const toggleId = `feature-${row.key}`;
  const lockId = `feature-lock-${row.key}`;
  // Base UI puts `id` on the hidden input, so the visible switch is named by aria-labelledby.
  const nameId = `feature-name-${row.key}`;
  const lockLabelId = `feature-lock-label-${row.key}`;
  const lockedBelow = level !== "instance" && row.locked;
  const overridden = level !== "instance" && row.override != null;
  const lastChanged = row.updatedAt
    ? t("lastChanged", {
        who: row.updatedBy?.name ?? t("system"),
        when: formatDateTime(row.updatedAt),
      })
    : null;

  return (
    <li className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Label id={nameId} htmlFor={toggleId} className="font-medium text-sm">
            {t(`flags.${row.key}.name`)}
          </Label>
          {lockedBelow ? (
            <Badge variant="warning" size="sm">
              <Lock aria-hidden="true" />
              {t("lockedByInstance")}
            </Badge>
          ) : null}
          {/* S11: inheriting is the default, so only an override is badged; its reset sits
              beside the badge as a quiet icon button instead of next to the switch. */}
          {overridden && !lockedBelow ? (
            <>
              <Badge variant="outline" size="sm">
                {t("overridden")}
              </Badge>
              <ActionTooltip label={t("useInherited")}>
                <Button
                  aria-label={t("useInherited")}
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  disabled={busy}
                  onClick={() =>
                    onChange({
                      key: row.key,
                      enabled: null,
                      expectedVersion: row.version,
                    })
                  }
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              </ActionTooltip>
            </>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {t(`flags.${row.key}.description`)}
        </p>
        {lastChanged ? (
          <p className="text-muted-foreground text-xs">{lastChanged}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-4">
        {level === "instance" ? (
          <div className="flex items-center gap-2">
            <Switch
              id={lockId}
              aria-labelledby={`${lockLabelId} ${nameId}`}
              checked={row.locked}
              disabled={busy}
              onCheckedChange={(locked) =>
                onChange({
                  key: row.key,
                  locked,
                  expectedVersion: row.version,
                })
              }
            />
            <Label
              id={lockLabelId}
              htmlFor={lockId}
              className="text-muted-foreground text-xs"
            >
              {t("lock")}
            </Label>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Switch
            id={toggleId}
            aria-labelledby={nameId}
            checked={row.enabled}
            disabled={busy || lockedBelow}
            onCheckedChange={(enabled) =>
              onChange({ key: row.key, enabled, expectedVersion: row.version })
            }
          />
          <Label
            htmlFor={toggleId}
            aria-hidden="true"
            className="text-muted-foreground text-xs"
          >
            {t(row.enabled ? "stateOn" : "stateOff")}
          </Label>
        </div>
      </div>
    </li>
  );
}
