import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { ArrowLeft, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  addTeamMember,
  removeTeamMember,
  requestTeamDeletion,
  type TeamDetail,
  type TeamMember,
  updateTeam,
  updateTeamMember,
} from "@/fetchers/team";
import { teamsKey, useTeam } from "@/hooks/queries/team/use-teams";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";

function useTeamMutation<TInput>(
  team: TeamDetail,
  fn: (input: TInput) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["team", team.id] }),
        queryClient.invalidateQueries({
          queryKey: teamsKey(team.workspaceId),
        }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
}

export function TeamSettingsCard({ team }: { team: TeamDetail }) {
  const { t } = useTranslation();
  const [name, setName] = useState(team.name);
  const [capacity, setCapacity] = useState(
    team.capacityDaysPerWeek === null ? "" : String(team.capacityDaysPerWeek),
  );
  const [isCab, setIsCab] = useState(team.isCab);
  const save = useTeamMutation(team, () =>
    updateTeam(team.id, {
      name: name.trim(),
      capacityDaysPerWeek: capacity === "" ? null : Number(capacity),
      isCab,
    }),
  );
  const capacityValid =
    capacity === "" ||
    (Number.isFinite(Number(capacity)) &&
      Number(capacity) >= 0 &&
      Number(capacity) <= 7);
  const dirty =
    name.trim() !== team.name ||
    (capacity === "" ? null : Number(capacity)) !== team.capacityDaysPerWeek ||
    isCab !== team.isCab;
  const disabled = !team.canManageTeam || save.isPending;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("teams:detail.settingsTitle")}</CardTitle>
        <CardDescription>
          {team.canManageTeam
            ? t("teams:detail.settingsDescription")
            : t("teams:detail.settingsReadOnly")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && name.trim() && capacityValid) save.mutate(undefined);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="team-detail-name">{t("teams:fields.name")}</Label>
            <Input
              id="team-detail-name"
              required
              maxLength={120}
              value={name}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-detail-capacity">
              {t("teams:fields.capacity")}
            </Label>
            <Input
              id="team-detail-capacity"
              type="number"
              min={0}
              max={7}
              step={0.5}
              value={capacity}
              disabled={disabled}
              onChange={(event) => setCapacity(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {t("teams:fields.capacityHelp")}
            </p>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="team-detail-cab">{t("teams:fields.cab")}</Label>
              <p className="max-w-md text-muted-foreground text-xs">
                {t("teams:fields.cabHelp")}
              </p>
            </div>
            <Switch
              id="team-detail-cab"
              checked={isCab}
              disabled={disabled}
              onCheckedChange={(checked) => {
                // A refusal belongs to the value that was tried (e.g. CAB needing a member).
                save.reset();
                setIsCab(checked);
              }}
            />
          </div>
          {save.error ? (
            <Alert variant="error">
              <AlertDescription>{save.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {team.canManageTeam ? (
            <Button
              type="submit"
              disabled={disabled || !dirty || !name.trim() || !capacityValid}
            >
              {t("teams:detail.save")}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function RosterRow({ team, member }: { team: TeamDetail; member: TeamMember }) {
  const { t } = useTranslation();
  const setLead = useTeamMutation(team, (isLead: boolean) =>
    updateTeamMember(team.id, member.personId, { isLead }),
  );
  const remove = useTeamMutation(team, () =>
    removeTeamMember(team.id, member.personId),
  );
  const busy = setLead.isPending || remove.isPending;
  return (
    <TableRow>
      <TableCell className="font-medium">
        {member.name ?? member.personId}
        {member.active ? null : (
          <Badge variant="outline" className="ms-2">
            {t("teams:roster.inactive")}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {team.canEditRoster ? (
          <Switch
            checked={member.isLead}
            disabled={busy}
            aria-label={t("teams:roster.leadFor", {
              name: member.name ?? member.personId,
            })}
            onCheckedChange={(checked) => setLead.mutate(checked)}
          />
        ) : member.isLead ? (
          <Badge variant="secondary">{t("teams:roster.lead")}</Badge>
        ) : null}
      </TableCell>
      {team.canEditRoster ? (
        <TableCell className="text-end">
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={t("teams:roster.remove", {
              name: member.name ?? member.personId,
            })}
            onClick={() => remove.mutate(undefined)}
          >
            <Trash2 />
          </Button>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function AddMember({ team }: { team: TeamDetail }) {
  const { t } = useTranslation();
  const [personId, setPersonId] = useState<string | null>(null);
  const add = useTeamMutation(team, (id: string) =>
    addTeamMember(team.id, { personId: id }),
  );
  const chosen = team.candidates.find((c) => c.personId === personId);
  if (!team.canEditRoster) return null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1 space-y-2">
        <Label htmlFor="team-add-member">{t("teams:roster.add")}</Label>
        <Select
          value={personId}
          disabled={add.isPending || team.candidates.length === 0}
          onValueChange={setPersonId}
        >
          <SelectTrigger id="team-add-member">
            <SelectValue>
              {chosen?.name ??
                (team.candidates.length === 0
                  ? t("teams:roster.noCandidates")
                  : t("teams:roster.choose"))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {team.candidates.map((candidate) => (
              <SelectItem key={candidate.personId} value={candidate.personId}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        disabled={!personId || add.isPending}
        onClick={() => {
          if (personId)
            add.mutate(personId, { onSuccess: () => setPersonId(null) });
        }}
      >
        {t("teams:roster.addAction")}
      </Button>
    </div>
  );
}

function RosterCard({
  team,
  showInactive,
  onShowInactiveChange,
}: {
  team: TeamDetail;
  showInactive: boolean;
  onShowInactiveChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("teams:roster.title")}</CardTitle>
        <CardDescription>{t("teams:roster.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AddMember team={team} />
        {team.members.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("teams:roster.empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("teams:roster.person")}</TableHead>
                <TableHead>{t("teams:roster.lead")}</TableHead>
                {team.canEditRoster ? (
                  <TableHead className="text-end">
                    <span className="sr-only">{t("teams:roster.actions")}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.members.map((member) => (
                <RosterRow key={member.personId} team={team} member={member} />
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center gap-2">
          <Switch
            id="team-show-inactive"
            checked={showInactive}
            onCheckedChange={onShowInactiveChange}
          />
          <Label htmlFor="team-show-inactive" className="font-normal text-sm">
            {t("teams:roster.showInactive")}
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteCard({ team }: { team: TeamDetail }) {
  const { t } = useTranslation();
  const openPendingAction = useOpenPendingAction();
  const request = useMutation({
    mutationFn: () => requestTeamDeletion(team.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(error.message),
  });
  if (!team.canManageTeam) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("teams:delete.title")}</CardTitle>
        <CardDescription>{t("teams:delete.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {team.deletionBlockers.length > 0 ? (
          <Alert variant="info">
            <AlertTitle>{t("teams:delete.blockedTitle")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc ps-5">
                {team.deletionBlockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        <Button
          variant="destructive"
          disabled={team.deletionBlockers.length > 0 || request.isPending}
          onClick={() => request.mutate()}
        >
          {t("teams:delete.action")}
        </Button>
      </CardContent>
    </Card>
  );
}

/** `docs/screens.md` "Team detail": roster, leads, capacity, CAB flag. */
export function TeamDetailView({
  teamId,
  showInactive,
}: {
  teamId: string;
  showInactive: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const team = useTeam(teamId, showInactive);
  return (
    <>
      <PageTitle title={team.data?.name ?? t("teams:detail.pageTitle")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="space-y-2">
          <Button
            render={<Link to={routes.workspaceTeams.path} />}
            variant="ghost"
            size="sm"
          >
            <ArrowLeft aria-hidden="true" />
            {t("teams:detail.allTeams")}
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {team.data?.name ?? t("teams:detail.pageTitle")}
            </h1>
            {team.data?.isCab ? (
              <Badge variant="info">{t("teams:badges.cab")}</Badge>
            ) : null}
          </div>
        </div>
        {team.isLoading ? (
          <div role="status" aria-label={t("teams:detail.loading")}>
            <Skeleton className="h-48 w-full" />
          </div>
        ) : team.isError || !team.data ? (
          <Alert variant="error">
            <AlertTitle>{t("teams:detail.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {t("teams:detail.loadErrorDescription")}
              <Button className="w-fit" onClick={() => void team.refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("common:actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <TeamSettingsCard
              key={`${team.data.id}:${team.data.name}:${team.data.capacityDaysPerWeek}:${team.data.isCab}`}
              team={team.data}
            />
            <RosterCard
              team={team.data}
              showInactive={showInactive}
              onShowInactiveChange={(value) =>
                void navigate({
                  to: routes.workspaceTeamDetail.path,
                  params: { id: teamId },
                  search: value ? { inactive: true } : {},
                  replace: true,
                })
              }
            />
            <DeleteCard team={team.data} />
          </>
        )}
      </div>
    </>
  );
}
