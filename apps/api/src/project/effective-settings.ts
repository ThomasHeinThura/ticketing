export type SettingMode = "inherit" | "override";
export type SettingSource = "project" | "workspace" | "none";

export type EffectiveSetting = {
  mode: SettingMode;
  overrideId: string | null;
  effectiveId: string | null;
  source: SettingSource;
};

/** Resolve one project value without treating an explicit null override as inheritance. */
export function resolveProjectSetting(input: {
  mode: SettingMode;
  overrideId: string | null;
  workspaceDefaultId: string | null;
}): EffectiveSetting {
  if (input.mode === "override") {
    return {
      mode: input.mode,
      overrideId: input.overrideId,
      effectiveId: input.overrideId,
      source: input.overrideId === null ? "none" : "project",
    };
  }
  return {
    mode: input.mode,
    overrideId: input.overrideId,
    effectiveId: input.workspaceDefaultId,
    source: input.workspaceDefaultId === null ? "none" : "workspace",
  };
}

/** Preserve the historical null-SLA fallback to the workspace default. */
export function resolveProjectSlaPolicyId(input: {
  mode: SettingMode;
  overrideId: string | null;
  workspaceDefaultId: string | null;
}): string | null {
  return input.mode === "override"
    ? input.overrideId
    : input.workspaceDefaultId;
}

/** Resolve the project service calendar independently from a policy version's calendar. */
export function resolveProjectServiceCalendarId(input: {
  mode: SettingMode;
  overrideId: string | null;
  workspaceDefaultId: string | null;
}): string | null {
  return input.mode === "override"
    ? input.overrideId
    : input.workspaceDefaultId;
}
