import { useQuery } from "@tanstack/react-query";
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
  Input,
  Label,
  LoadingStatus,
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
  Textarea,
  useDelayedPending,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getInstanceUsers } from "@/fetchers/god-mode/instance-users";
import type {
  LegalHoldActor,
  LegalHoldItem,
  LegalHoldScope,
  LegalHoldStatusFilter,
} from "@/fetchers/god-mode/legal-holds";
import { getOrganisations } from "@/fetchers/god-mode/organisations";
import {
  useLegalHolds,
  useLiftLegalHold,
  usePlaceLegalHold,
} from "@/hooks/queries/god-mode/use-legal-holds";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

function formatActor(actor: LegalHoldActor): string {
  if (actor.name && actor.email) return `${actor.name} (${actor.email})`;
  return actor.name ?? actor.email ?? actor.id;
}

function PlaceLegalHoldDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("godModeHealth");
  const placeMutation = usePlaceLegalHold();
  const [scope, setScope] = useState<LegalHoldScope>("organisation");
  const [scopeId, setScopeId] = useState("");
  const [reason, setReason] = useState("");

  const organisationsQuery = useQuery({
    queryKey: ["god-mode", "organisations", "legal-hold-picker"],
    queryFn: getOrganisations,
    enabled: scope === "organisation",
    retry: false,
  });

  const usersQuery = useQuery({
    queryKey: ["god-mode", "users", "legal-hold-picker"],
    queryFn: () => getInstanceUsers({ limit: 50 }),
    enabled: scope === "person",
    retry: false,
  });

  const trimmedScopeId = scopeId.trim();
  const trimmedReason = reason.trim();
  const canSubmit =
    trimmedScopeId.length > 0 &&
    trimmedReason.length > 0 &&
    !placeMutation.isPending;

  const errorMessage = (() => {
    if (!placeMutation.error) return null;
    if (placeMutation.error instanceof HttpError) {
      if (placeMutation.error.status === 404) {
        return t("legalHolds.place.errorNotFound");
      }
      if (placeMutation.error.status === 409) {
        return t("legalHolds.place.errorConflict");
      }
    }
    return t("legalHolds.place.errorGeneric");
  })();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await placeMutation.mutateAsync({
        scope,
        scopeId: trimmedScopeId,
        reason: trimmedReason,
      });
      onClose();
    } catch {
      // Mutation state renders the error alert inside the dialog.
    }
  };

  const organisationOptions = organisationsQuery.data?.data ?? [];
  const userOptions = usersQuery.data?.data ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !placeMutation.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("legalHolds.place.close")}>
        <DialogHeader>
          <DialogTitle>{t("legalHolds.place.title")}</DialogTitle>
          <DialogDescription>
            {t("legalHolds.place.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <div className="space-y-1.5">
            <Label htmlFor="legal-hold-scope">
              {t("legalHolds.place.scopeLabel")}
            </Label>
            <Select
              items={{
                organisation: t("legalHolds.scopes.organisation"),
                person: t("legalHolds.scopes.person"),
              }}
              value={scope}
              onValueChange={(value) => {
                if (value === "organisation" || value === "person") {
                  setScope(value);
                  setScopeId("");
                  placeMutation.reset();
                }
              }}
            >
              <SelectTrigger id="legal-hold-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="organisation">
                  {t("legalHolds.scopes.organisation")}
                </SelectItem>
                <SelectItem value="person">
                  {t("legalHolds.scopes.person")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scope === "organisation" && organisationOptions.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="legal-hold-org-picker">
                {t("legalHolds.place.pickOrganisation")}
              </Label>
              <Select
                items={organisationOptions.map((org) => ({
                  value: org.id,
                  label: `${org.name} (${org.key})`,
                }))}
                value={scopeId}
                onValueChange={(value) => {
                  if (typeof value === "string") {
                    setScopeId(value);
                    placeMutation.reset();
                  }
                }}
              >
                <SelectTrigger id="legal-hold-org-picker">
                  <SelectValue
                    placeholder={t("legalHolds.place.pickPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {organisationOptions.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {`${org.name} (${org.key})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {scope === "person" && userOptions.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="legal-hold-person-picker">
                {t("legalHolds.place.pickPerson")}
              </Label>
              <Select
                items={userOptions.map((user) => ({
                  value: user.person?.id ?? user.id,
                  label: `${user.name || user.email} (${user.email})`,
                }))}
                value={scopeId}
                onValueChange={(value) => {
                  if (typeof value === "string") {
                    setScopeId(value);
                    placeMutation.reset();
                  }
                }}
              >
                <SelectTrigger id="legal-hold-person-picker">
                  <SelectValue
                    placeholder={t("legalHolds.place.pickPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {userOptions.map((user) => {
                    const targetId = user.person?.id ?? user.id;
                    return (
                      <SelectItem key={user.id} value={targetId}>
                        {`${user.name || user.email} (${user.email})`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="legal-hold-scope-id">
              {scope === "organisation"
                ? t("legalHolds.place.organisationIdLabel")
                : t("legalHolds.place.personIdLabel")}
            </Label>
            <Input
              id="legal-hold-scope-id"
              value={scopeId}
              placeholder={
                scope === "organisation"
                  ? t("legalHolds.place.organisationIdPlaceholder")
                  : t("legalHolds.place.personIdPlaceholder")
              }
              onChange={(event) => {
                setScopeId(event.target.value);
                if (placeMutation.error) placeMutation.reset();
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="legal-hold-reason">
              {t("legalHolds.place.reasonLabel")}
            </Label>
            <Textarea
              id="legal-hold-reason"
              rows={3}
              maxLength={2000}
              value={reason}
              placeholder={t("legalHolds.place.reasonPlaceholder")}
              onChange={(event) => {
                setReason(event.target.value);
                if (placeMutation.error) placeMutation.reset();
              }}
            />
          </div>

          {errorMessage ? (
            <Alert variant="error">
              <AlertTitle>{t("legalHolds.place.errorTitle")}</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={placeMutation.isPending}
            onClick={onClose}
          >
            {t("legalHolds.place.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {t("legalHolds.place.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LiftLegalHoldDialog({
  hold,
  onClose,
}: {
  hold: LegalHoldItem;
  onClose: () => void;
}) {
  const { t } = useTranslation("godModeHealth");
  const liftMutation = useLiftLegalHold();
  const [reason, setReason] = useState("");

  const errorMessage = (() => {
    if (!liftMutation.error) return null;
    if (
      liftMutation.error instanceof HttpError &&
      liftMutation.error.status === 409
    ) {
      return t("legalHolds.lift.errorAlreadyLifted");
    }
    return t("legalHolds.lift.errorGeneric");
  })();

  const handleConfirm = async () => {
    try {
      await liftMutation.mutateAsync({
        id: hold.id,
        reason: reason.trim() || undefined,
      });
      onClose();
    } catch {
      // Mutation state renders the error alert inside the dialog.
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !liftMutation.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("legalHolds.lift.close")}>
        <DialogHeader>
          <DialogTitle>{t("legalHolds.lift.title")}</DialogTitle>
          <DialogDescription>
            {t("legalHolds.lift.description", { target: hold.targetLabel })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium text-foreground">{hold.targetLabel}</p>
            <p className="text-muted-foreground text-xs">{hold.reason}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="legal-hold-lift-reason">
              {t("legalHolds.lift.reasonLabel")}
            </Label>
            <Textarea
              id="legal-hold-lift-reason"
              rows={2}
              maxLength={2000}
              value={reason}
              placeholder={t("legalHolds.lift.reasonPlaceholder")}
              onChange={(event) => {
                setReason(event.target.value);
                if (liftMutation.error) liftMutation.reset();
              }}
            />
          </div>
          {errorMessage ? (
            <Alert variant="error">
              <AlertTitle>{t("legalHolds.lift.errorTitle")}</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={liftMutation.isPending}
            onClick={onClose}
          >
            {t("legalHolds.lift.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={liftMutation.isPending}
            onClick={() => void handleConfirm()}
          >
            {t("legalHolds.lift.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LegalHoldsPanel() {
  const { t } = useTranslation("godModeHealth");
  const [statusFilter, setStatusFilter] =
    useState<LegalHoldStatusFilter>("all");
  const [placing, setPlacing] = useState(false);
  const [liftingHold, setLiftingHold] = useState<LegalHoldItem | null>(null);

  const query = useLegalHolds({ status: statusFilter });
  const placeholderVisible = useDelayedPending(query.isPending, {
    releaseNow:
      query.isSuccess &&
      Array.isArray(query.data?.holds) &&
      query.data.holds.length === 0,
  });

  if (
    !query.isError &&
    (query.isPending || (placeholderVisible && query.data))
  ) {
    return (
      <LoadingStatus
        visible={placeholderVisible}
        label={t("common:empty.loading")}
      >
        <Skeleton
          className="h-44 w-full"
          style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
        />
      </LoadingStatus>
    );
  }

  if (query.isError) {
    return (
      <Alert variant="error">
        <AlertTitle>{t("legalHolds.loadErrorTitle")}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{t("legalHolds.loadErrorDescription")}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const holds = Array.isArray(query.data?.holds) ? query.data.holds : [];
  const activeCount =
    typeof query.data?.activeCount === "number"
      ? query.data.activeCount
      : holds.length;

  return (
    <Card id="legal-holds-section">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <CardTitle>{t("legalHolds.title")}</CardTitle>
            <Badge variant={activeCount > 0 ? "warning" : "secondary"}>
              {t("legalHolds.activeBadge", { count: activeCount })}
            </Badge>
          </div>
          <CardDescription>{t("legalHolds.description")}</CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Select
            items={{
              all: t("legalHolds.filters.all"),
              active: t("legalHolds.filters.active"),
              lifted: t("legalHolds.filters.lifted"),
            }}
            value={statusFilter}
            onValueChange={(value) => {
              if (value === "all" || value === "active" || value === "lifted") {
                setStatusFilter(value);
              }
            }}
          >
            <SelectTrigger
              aria-label={t("legalHolds.filterLabel")}
              size="sm"
              className="w-36"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("legalHolds.filters.all")}</SelectItem>
              <SelectItem value="active">
                {t("legalHolds.filters.active")}
              </SelectItem>
              <SelectItem value="lifted">
                {t("legalHolds.filters.lifted")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setPlacing(true)}>
            {t("legalHolds.placeAction")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {holds.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyTitle>{t("legalHolds.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("legalHolds.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Frame className="min-w-0 overflow-x-auto">
            <Table scrollLabel={t("legalHolds.tableLabel")} scrollFade>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("legalHolds.columns.target")}</TableHead>
                  <TableHead>{t("legalHolds.columns.scope")}</TableHead>
                  <TableHead>{t("legalHolds.columns.reason")}</TableHead>
                  <TableHead>{t("legalHolds.columns.placed")}</TableHead>
                  <TableHead>{t("legalHolds.columns.status")}</TableHead>
                  <TableHead className="text-right">
                    {t("legalHolds.columns.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holds.map((hold) => (
                  <TableRow key={hold.id}>
                    <TableCell className="align-top">
                      <div className="space-y-0.5">
                        <p className="font-medium text-foreground">
                          {hold.targetLabel}
                        </p>
                        {hold.targetSecondaryLabel ? (
                          <p className="text-muted-foreground text-xs">
                            {hold.targetSecondaryLabel}
                          </p>
                        ) : null}
                        <p className="font-mono text-muted-foreground text-xs">
                          {hold.scopeId}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="outline">
                        {hold.scope === "organisation"
                          ? t("legalHolds.scopes.organisation")
                          : t("legalHolds.scopes.person")}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal align-top text-sm">
                      {hold.reason}
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      <div className="space-y-0.5">
                        <p className="text-foreground">
                          {formatDateTime(hold.placedAt)}
                        </p>
                        <p className="text-muted-foreground">
                          {formatActor(hold.placedBy)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="space-y-1">
                        <Badge
                          variant={
                            hold.status === "active" ? "warning" : "secondary"
                          }
                        >
                          {hold.status === "active"
                            ? t("legalHolds.statuses.active")
                            : t("legalHolds.statuses.lifted")}
                        </Badge>
                        {hold.liftedAt ? (
                          <div className="space-y-0.5 text-muted-foreground text-xs">
                            <p>{formatDateTime(hold.liftedAt)}</p>
                            {hold.liftedBy ? (
                              <p>{formatActor(hold.liftedBy)}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {hold.status === "active" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLiftingHold(hold)}
                        >
                          {t("legalHolds.liftAction")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        )}
      </CardContent>
      {placing ? (
        <PlaceLegalHoldDialog onClose={() => setPlacing(false)} />
      ) : null}
      {liftingHold ? (
        <LiftLegalHoldDialog
          hold={liftingHold}
          onClose={() => setLiftingHold(null)}
        />
      ) : null}
    </Card>
  );
}
