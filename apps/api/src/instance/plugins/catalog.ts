import { smtpSettingsFormManifest } from "../../notification-provider/schema";
import { getEmailProvider } from "../../notification-provider/service";

export type SupportedPlugin = {
  id: "notify.email";
  name: "Email";
  kind: "notification";
  state: "unconfigured" | "enabled" | "disabled" | "invalid";
  source: "runtime" | "bootstrap" | "unconfigured";
  configVersion: number;
  credentialConfigured: boolean;
  settingsForm: ReturnType<typeof smtpSettingsFormManifest>;
};

type EmailProviderSummary = Awaited<ReturnType<typeof getEmailProvider>>;

/**
 * This is the catalog of real, instance-level plugin settings currently backed by a
 * supported runtime and schema. Keep it explicit: the legacy event-hook registry is
 * intentionally empty and must not be mistaken for a configurable-plugin catalog.
 */
export function projectSupportedPlugins(
  email: EmailProviderSummary,
): SupportedPlugin[] {
  const state =
    email.config === null
      ? email.source === "unconfigured"
        ? "unconfigured"
        : "invalid"
      : email.enabled
        ? "enabled"
        : "disabled";

  return [
    {
      id: "notify.email",
      name: "Email",
      kind: "notification",
      state,
      source: email.source,
      configVersion: email.version,
      credentialConfigured: email.passwordConfigured,
      settingsForm: smtpSettingsFormManifest(),
    },
  ];
}

export async function listSupportedPlugins() {
  return projectSupportedPlugins(await getEmailProvider());
}
