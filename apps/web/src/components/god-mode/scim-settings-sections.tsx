import {
  Button,
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type {
  ScimAdminRequest,
  ScimAdminSettings,
  ScimMatchAttribute,
  ScimProfileMapping,
} from "@/fetchers/god-mode/identity-connections";
import type { StepUpAction } from "@/hooks/use-step-up-action";
import {
  buildScimEnabledRequest,
  buildScimProfileRequest,
  buildScimSettingsRequest,
  canonicalMatchAttributes,
  OPTIONAL_MATCH_ATTRIBUTES,
  REQUIRED_MATCH_ATTRIBUTES,
  type ScimSettingsDraft,
} from "@/lib/identity-connection-form";

type Props = {
  settings: ScimAdminSettings;
  draft: ScimSettingsDraft;
  setDraft: (patch: Partial<ScimSettingsDraft>) => void;
  step: StepUpAction;
  run: (request: ScimAdminRequest, notice: string) => Promise<boolean>;
};

const PROFILE_OPTIONS = {
  name: ["displayName", "name.formatted"],
  email: ["emails.primary.value", "userName"],
  jobTitle: ["title", "unmapped"],
  locale: ["preferredLanguage", "locale", "unmapped"],
} as const;

export function ScimSettingsSection({
  settings,
  draft,
  setDraft,
  step,
  run,
}: Props) {
  const { t } = useTranslation("identityConnections");
  const request = buildScimSettingsRequest(settings, draft);

  function toggleOptional(name: ScimMatchAttribute, checked: boolean) {
    const optional = OPTIONAL_MATCH_ATTRIBUTES.filter((candidate) =>
      candidate === name ? checked : draft.matchAttributes.includes(candidate),
    );
    setDraft({ matchAttributes: canonicalMatchAttributes(optional) });
  }

  return (
    <section aria-labelledby="scim-settings-heading" className="space-y-4">
      <header className="space-y-1">
        <h3 className="font-semibold" id="scim-settings-heading">
          {t("scim.settings.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("scim.settings.description")}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">
          {settings.data.enabled
            ? t("scim.settings.stateEnabled")
            : t("scim.settings.stateDisabled")}
        </p>
        <Button
          disabled={step.busy}
          onClick={() =>
            void run(
              buildScimEnabledRequest(settings, !settings.data.enabled),
              settings.data.enabled ? "disabled" : "enabled",
            )
          }
          type="button"
          variant="outline"
        >
          {settings.data.enabled
            ? t("scim.settings.disable")
            : t("scim.settings.enable")}
        </Button>
      </div>
      {!settings.data.enabled ? (
        <p className="text-sm text-muted-foreground">
          {t("scim.settings.enableHelp")}
        </p>
      ) : null}

      <fieldset className="space-y-3" disabled={step.busy}>
        <legend className="font-medium">{t("scim.settings.resources")}</legend>
        <div className="flex items-start gap-3">
          <Checkbox checked disabled id="scim-resource-users" />
          <div className="space-y-0.5">
            <Label htmlFor="scim-resource-users">
              {t("scim.settings.users")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("scim.settings.usersRequired")}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            checked={draft.groups}
            id="scim-resource-groups"
            onCheckedChange={(checked) =>
              setDraft({ groups: checked === true })
            }
          />
          <Label htmlFor="scim-resource-groups">
            {t("scim.settings.groups")}
          </Label>
        </div>
      </fieldset>

      <div className="max-w-md space-y-2">
        <Label htmlFor="scim-lifecycle">{t("scim.settings.lifecycle")}</Label>
        <Select
          items={[
            {
              value: "end_memberships",
              label: t("scim.settings.endMemberships"),
            },
            {
              value: "keep_memberships",
              label: t("scim.settings.keepMemberships"),
            },
          ]}
          disabled={step.busy}
          onValueChange={(value) => {
            if (value === "end_memberships" || value === "keep_memberships")
              setDraft({ lifecyclePolicy: value });
          }}
          value={draft.lifecyclePolicy}
        >
          <SelectTrigger id="scim-lifecycle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="end_memberships">
              {t("scim.settings.endMemberships")}
            </SelectItem>
            <SelectItem value="keep_memberships">
              {t("scim.settings.keepMemberships")}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {t("scim.settings.lifecycleHelp")}
        </p>
      </div>

      <fieldset className="space-y-3" disabled={step.busy}>
        <legend className="font-medium">{t("scim.settings.match")}</legend>
        <p className="text-sm text-muted-foreground">
          {t("scim.settings.matchHelp")}
        </p>
        {REQUIRED_MATCH_ATTRIBUTES.map((name) => (
          <div className="flex items-start gap-3" key={name}>
            <Checkbox checked disabled id={`scim-match-${name}`} />
            <div className="space-y-0.5">
              <Label htmlFor={`scim-match-${name}`}>{name}</Label>
              <p className="text-sm text-muted-foreground">
                {t("scim.settings.matchRequired")}
              </p>
            </div>
          </div>
        ))}
        {OPTIONAL_MATCH_ATTRIBUTES.map((name) => (
          <div className="flex items-start gap-3" key={name}>
            <Checkbox
              checked={draft.matchAttributes.includes(name)}
              id={`scim-match-${name}`}
              onCheckedChange={(checked) =>
                toggleOptional(name, checked === true)
              }
            />
            <Label htmlFor={`scim-match-${name}`}>{name}</Label>
          </div>
        ))}
      </fieldset>

      <Button
        disabled={step.busy || request === null}
        onClick={() => request && void run(request, "settings")}
        type="button"
      >
        {step.busy ? t("common.saving") : t("scim.settings.save")}
      </Button>
    </section>
  );
}

export function ScimProfileMappingSection({
  settings,
  draft,
  setDraft,
  step,
  run,
}: Props) {
  const { t } = useTranslation("identityConnections");
  const request = buildScimProfileRequest(settings, draft);

  function setField<K extends Exclude<keyof ScimProfileMapping, "version">>(
    key: K,
    value: ScimProfileMapping[K],
  ) {
    setDraft({ profile: { ...draft.profile, [key]: value } });
  }

  const fields = ["name", "email", "jobTitle", "locale"] as const;
  return (
    <section aria-labelledby="scim-profile-heading" className="space-y-4">
      <header className="space-y-1">
        <h3 className="font-semibold" id="scim-profile-heading">
          {t("scim.profile.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("scim.profile.description")}
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div className="space-y-2" key={field}>
            <Label htmlFor={`scim-profile-${field}`}>
              {t(`scim.profile.${field}`)}
            </Label>
            <Select
              items={PROFILE_OPTIONS[field].map((option) => ({
                value: option,
                label:
                  option === "unmapped" ? t("scim.profile.unmapped") : option,
              }))}
              disabled={step.busy}
              onValueChange={(value) =>
                value &&
                setField(field, value as ScimProfileMapping[typeof field])
              }
              value={draft.profile[field]}
            >
              <SelectTrigger id={`scim-profile-${field}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROFILE_OPTIONS[field].map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "unmapped"
                      ? t("scim.profile.unmapped")
                      : option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <Button
        disabled={step.busy || request === null}
        onClick={() => request && void run(request, "profile")}
        type="button"
      >
        {step.busy ? t("common.saving") : t("scim.profile.save")}
      </Button>
    </section>
  );
}
