import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type {
  SavedViewVisibility,
  ShareableViewTeam,
} from "@/fetchers/saved-views";

const VISIBILITIES: readonly SavedViewVisibility[] = [
  "private",
  "team",
  "workspace",
];

/** Which audiences the caller may choose (`SV-15`, `SV-16`, `SV-18`). The server still decides. */
export function availableVisibilities({
  canShare,
  canManageSettings,
  current,
}: {
  canShare: boolean;
  canManageSettings: boolean;
  /** The view's stored audience stays selectable, so an edit never silently hides it. */
  current?: SavedViewVisibility;
}): SavedViewVisibility[] {
  return VISIBILITIES.filter(
    (visibility) =>
      visibility === "private" ||
      visibility === current ||
      (visibility === "team" && canShare) ||
      (visibility === "workspace" && canManageSettings),
  );
}

/**
 * Visibility and, for a team view, the team audience. Private is the default and sharing is a
 * deliberate act (`SV-16`): a team or workspace choice is offered only to a caller holding the
 * capability that creates it, and a team audience needs one of the caller's own teams.
 * Team-lead editing and ownership transfer are held for a later release and are not offered.
 */
export function SavedViewAudienceFields({
  visibility,
  teamId,
  onVisibilityChange,
  onTeamChange,
  canShare,
  canManageSettings,
  currentVisibility,
  teams,
  disabled = false,
}: {
  visibility: SavedViewVisibility;
  teamId: string;
  onVisibilityChange: (visibility: SavedViewVisibility) => void;
  onTeamChange: (teamId: string) => void;
  canShare: boolean;
  canManageSettings: boolean;
  currentVisibility?: SavedViewVisibility;
  teams: {
    data: ShareableViewTeam[] | undefined;
    isLoading: boolean;
    isError: boolean;
  };
  disabled?: boolean;
}) {
  const { t } = useTranslation("savedViews");
  const options = availableVisibilities({
    canShare,
    canManageSettings,
    current: currentVisibility,
  });
  return (
    <>
      <div className="grid gap-1 text-sm">
        <span>{t("visibility.label")}</span>
        <Select
          value={visibility}
          disabled={disabled}
          items={options.map((value) => ({
            value,
            label: t(`visibility.${value}`),
          }))}
          onValueChange={(value) => {
            if (
              value === "private" ||
              value === "team" ||
              value === "workspace"
            )
              onVisibilityChange(value);
          }}
        >
          <SelectTrigger aria-label={t("visibility.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {options.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`visibility.${value}`)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {visibility === "team" ? (
        <div className="grid gap-1 text-sm">
          <span>{t("team.label")}</span>
          <Select
            value={teamId || undefined}
            disabled={disabled || !canShare || teams.isLoading || teams.isError}
            items={(teams.data ?? []).map((team) => ({
              value: team.id,
              label: team.name,
            }))}
            onValueChange={(value) => onTeamChange(value ?? "")}
          >
            <SelectTrigger aria-label={t("team.label")}>
              <SelectValue placeholder={t("team.placeholder")} />
            </SelectTrigger>
            <SelectPopup>
              {(teams.data ?? []).map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {teams.isError ? (
            <p role="alert" className="text-destructive">
              {t("team.loadError")}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
