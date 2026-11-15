import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";

export type PluginSettingsFormField = {
  key: string;
  labelKey: string;
  control: "text" | "email" | "number" | "checkbox" | "switch" | "password";
  group: "provider" | "config" | "secret";
  required: boolean;
  nullable: boolean;
  secret: boolean;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type PluginSettingsFormManifest =
  | { version: 1; available: true; fields: PluginSettingsFormField[] }
  | { version: 1; available: false };

export type SupportedPluginKind =
  | "notification"
  | "storage"
  | "identity"
  | "observability";

export type SubprocessorCategory =
  | "outbound_email"
  | "object_storage"
  | "identity_provider"
  | "telemetry";

export type SupportedPluginConfigPath =
  | "/god-mode/notifications"
  | "/god-mode/storage"
  | "/god-mode/authentication"
  | "/god-mode/observability";

export type SupportedPlugin = {
  id: string;
  name: string;
  kind: SupportedPluginKind;
  category?: SubprocessorCategory;
  state: "unconfigured" | "enabled" | "disabled" | "invalid";
  source: "runtime" | "bootstrap" | "unconfigured";
  configVersion: number;
  credentialConfigured: boolean;
  dataProcessed?: string;
  destinationSummary?: string;
  configPath?: SupportedPluginConfigPath;
  settingsForm?: PluginSettingsFormManifest;
};

export type SupportedPlugins = {
  checkedAt: string;
  plugins: SupportedPlugin[];
};

export async function listSupportedPlugins(): Promise<SupportedPlugins> {
  const response = await apiFetch(getApiUrl("instance/plugins"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(response.status, "Supported plugins request failed");
  return (await response.json()) as SupportedPlugins;
}
