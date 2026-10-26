import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Frame,
  FramePanel,
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listAllWebhookRotationTargets,
  listWebhookSecurityPosture,
  rotateAllWebhookSecrets,
  type WebhookRotationTarget,
  type WebhookSecretReplacement,
  webhookSecretRotationSetDigest,
} from "@/fetchers/god-mode/webhook-security-posture";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { FailureAlert, StepUpFields } from "./step-up-fields";

export function WebhookSecurityPosturePanel() {
  const { t } = useTranslation("godModeWebhooks");
  const [rotationOpen, setRotationOpen] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["god-mode", "webhook-security-posture"],
    queryFn: ({ pageParam }) =>
      listWebhookSecurityPosture({ limit: 50, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    retry: false,
  });
  const entries = query.data?.pages.flatMap((page) => page.data) ?? [];

  if (query.isPending) return <Skeleton className="h-72 w-full" />;
  if (query.error instanceof HttpError && query.error.status === 403)
    return (
      <Alert variant="info">
        <AlertTitle>{t("forbiddenTitle")}</AlertTitle>
        <AlertDescription>{t("forbiddenDescription")}</AlertDescription>
      </Alert>
    );
  if (query.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("loadErrorTitle")}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{t("loadErrorDescription")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("refresh")}
          </Button>
        </AlertDescription>
      </Alert>
    );

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRotationOpen(true)}
        >
          {t("rotateAllAction")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("refresh")}
        </Button>
      </div>
      {entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("empty")}</EmptyTitle>
            <EmptyDescription>{t("description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("webhook")}</TableHead>
                <TableHead>{t("workspace")}</TableHead>
                <TableHead>{t("owner")}</TableHead>
                <TableHead>{t("reach")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("events")}</TableHead>
                <TableHead>{t("secretRotated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="min-w-36 font-medium">
                    <span className="break-words">{entry.name}</span>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {entry.id}
                    </p>
                  </TableCell>
                  <TableCell className="min-w-36">
                    <span className="break-words">
                      {entry.workspaceName || t("unknownWorkspace")}
                    </span>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {entry.workspaceId}
                    </p>
                  </TableCell>
                  <TableCell>{entry.ownerName ?? t("unknownOwner")}</TableCell>
                  <TableCell>
                    <Badge variant="warning">
                      {entry.receivesEverythingBecause === "instance_admin"
                        ? t("instanceAdmin")
                        : t("seesAll")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={entry.active ? "success" : "outline"}>
                      {entry.active ? t("active") : t("paused")}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64 break-words text-xs">
                    {entry.events.join(", ")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.secretRotatedAt
                      ? formatDateTime(entry.secretRotatedAt)
                      : t("neverRotated")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      )}
      {query.hasNextPage ? (
        <FramePanel className="flex justify-center p-3">
          <Button
            size="sm"
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
          </Button>
        </FramePanel>
      ) : null}
      {rotationOpen ? (
        <WebhookRotationDialog onClose={() => setRotationOpen(false)} />
      ) : null}
    </div>
  );
}

function WebhookRotationDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("godModeWebhooks");
  const queryClient = useQueryClient();
  const stepUp = useStepUpAction();
  const [targets, setTargets] = useState<WebhookRotationTarget[]>([]);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rotatedCount, setRotatedCount] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setStale(false);
    setFailed(false);
    setSecrets({});
    try {
      setTargets(await listAllWebhookRotationTargets());
    } catch {
      setLoadFailed(true);
      setTargets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const replacements: WebhookSecretReplacement[] = targets.map((target) => ({
    webhookId: target.id,
    expectedVersion: target.version,
    secret: secrets[target.id] ?? "",
  }));
  const values = replacements.map(({ secret }) => secret);
  const validSecrets =
    replacements.length > 0 &&
    values.every((secret) => secret.length >= 24 && secret.length <= 256) &&
    new Set(values).size === values.length;

  const submit = async () => {
    if (!validSecrets || stepUp.busy) return;
    setFailed(false);
    try {
      const replacementSetDigest =
        await webhookSecretRotationSetDigest(replacements);
      const result = await stepUp.run(
        { operation: "webhook_rotate_all", replacementSetDigest },
        (token) => rotateAllWebhookSecrets(replacements, token),
        { writeErrors: "rethrow" },
      );
      if (!result.ok) {
        setSecrets({});
        return;
      }
      setSecrets({});
      setRotatedCount(result.value.rotatedCount);
      await queryClient.invalidateQueries({
        queryKey: ["god-mode", "webhook-security-posture"],
      });
    } catch (error) {
      setSecrets({});
      if (error instanceof HttpError && error.status === 409) {
        setStale(true);
        return;
      }
      setFailed(true);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !stepUp.busy) onClose();
      }}
    >
      <DialogContent closeLabel={t("rotateAllClose")}>
        <DialogHeader>
          <DialogTitle>{t("rotateAllTitle")}</DialogTitle>
          <DialogDescription>{t("rotateAllDescription")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("rotateAllLoading")}
            </p>
          ) : loadFailed ? (
            <Alert variant="error">
              <AlertTitle>{t("rotateAllFailed")}</AlertTitle>
            </Alert>
          ) : rotatedCount !== null ? (
            <Alert variant="success">
              <AlertDescription>
                {t("rotateAllSuccess", { count: rotatedCount })}
              </AlertDescription>
            </Alert>
          ) : targets.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("rotateAllEmpty")}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="space-y-3">
                {targets.map((target, index) => {
                  const id = `webhook-rotation-secret-${index}`;
                  return (
                    <div key={target.id} className="space-y-1.5">
                      <Label htmlFor={id}>
                        {t("rotateAllSecretLabel", { name: target.name })}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {target.workspaceName} · {target.id}
                      </p>
                      <Input
                        autoComplete="new-password"
                        disabled={stepUp.busy}
                        id={id}
                        onChange={(event) => {
                          setSecrets((current) => ({
                            ...current,
                            [target.id]: event.currentTarget.value,
                          }));
                        }}
                        type="password"
                        value={secrets[target.id] ?? ""}
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-muted-foreground text-sm">
                {t("rotateAllSecretHint")}
              </p>
              {stale ? (
                <Alert variant="warning">
                  <AlertDescription>{t("rotateAllStale")}</AlertDescription>
                </Alert>
              ) : null}
              {failed ? (
                <Alert variant="error">
                  <AlertTitle>{t("rotateAllFailed")}</AlertTitle>
                </Alert>
              ) : null}
              <FailureAlert
                failure={stepUp.failure}
                title={t("rotateAllStepUpFailure")}
              />
              <StepUpFields action={stepUp} idPrefix="webhook-rotate-all" />
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={stepUp.busy} onClick={onClose}>
            {rotatedCount === null ? t("rotateAllCancel") : t("rotateAllClose")}
          </Button>
          {rotatedCount === null &&
          !loading &&
          !loadFailed &&
          targets.length > 0 ? (
            <Button
              disabled={stepUp.busy || !validSecrets || !stepUp.canRun}
              onClick={() => void submit()}
            >
              {t("rotateAllSubmit")}
            </Button>
          ) : null}
          {loadFailed ? (
            <Button disabled={loading} onClick={() => void reload()}>
              {t("rotateAllReload")}
            </Button>
          ) : null}
          {stale ? (
            <Button disabled={loading} onClick={() => void reload()}>
              {t("rotateAllReload")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
