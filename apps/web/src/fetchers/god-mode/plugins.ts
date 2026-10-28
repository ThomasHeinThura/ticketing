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

export type SupportedPlugin = {
  id: string;
  name: string;
  kind: "notification";
  state: "unconfigured" | "enabled" | "disabled" | "invalid";
  source: "runtime" | "bootstrap" | "unconfigured";
  configVersion: number;
  credentialConfigured: boolean;
  settingsForm: PluginSettingsFormManifest;
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
