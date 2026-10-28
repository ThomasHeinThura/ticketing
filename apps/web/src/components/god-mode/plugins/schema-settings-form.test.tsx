import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginSettingsFormField } from "@/fetchers/god-mode/plugins";
import {
  isSupportedPluginSettingsForm,
  type PluginSettingsFormManifest,
  SchemaSettingsForm,
} from "./schema-settings-form";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const fields: PluginSettingsFormField[] = [
  {
    key: "enabled",
    labelKey: "enabled",
    control: "switch",
    group: "provider",
    required: true,
    nullable: false,
    secret: false,
  },
  {
    key: "config.host",
    labelKey: "host",
    control: "text",
    group: "config",
    required: true,
    nullable: false,
    secret: false,
    minLength: 1,
    maxLength: 253,
  },
  {
    key: "config.port",
    labelKey: "port",
    control: "number",
    group: "config",
    required: true,
    nullable: false,
    secret: false,
    minimum: 1,
    maximum: 65535,
  },
  {
    key: "config.secure",
    labelKey: "secure",
    control: "checkbox",
    group: "config",
    required: true,
    nullable: false,
    secret: false,
  },
  {
    key: "password",
    labelKey: "password",
    control: "password",
    group: "secret",
    required: false,
    nullable: true,
    secret: true,
    maxLength: 16_384,
  },
];

const manifest: PluginSettingsFormManifest = {
  version: 1,
  available: true,
  fields,
};

describe("schema-generated plugin settings form", () => {
  it("renders supported schema fields with their server-derived constraints", () => {
    const onConfigChange = vi.fn();
    render(
      <SchemaSettingsForm
        manifest={manifest}
        enabled
        onEnabledChange={vi.fn()}
        config={{ host: "smtp.example.test", port: 587, secure: false }}
        onConfigChange={onConfigChange}
        requireConfig
        disabled={false}
        password=""
        onPasswordChange={vi.fn()}
        passwordConfigured
        passwordPreview="••••••••"
        clearPassword={false}
        onClearPasswordChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("switch", { name: "enabled" })).toBeChecked();
    expect(screen.getByLabelText("host")).toHaveAttribute("maxlength", "253");
    expect(screen.getByLabelText("port")).toHaveAttribute("min", "1");
    expect(screen.getByLabelText("port")).toHaveAttribute("max", "65535");
    expect(screen.getByRole("checkbox", { name: "secure" })).not.toBeChecked();
    expect(screen.getByLabelText("password")).toHaveAttribute(
      "placeholder",
      "••••••••",
    );
    expect(document.body).not.toHaveTextContent("smtp.example.test");
  });

  it("refuses an unsupported schema instead of rendering a partial editable form", () => {
    const unsupported = {
      version: 1,
      available: true,
      fields: [
        ...fields,
        {
          key: "config.secretBlob",
          labelKey: "secretBlob",
          control: "textarea",
          group: "config",
          required: false,
          nullable: true,
          secret: false,
        },
      ],
    } as unknown as PluginSettingsFormManifest;
    expect(isSupportedPluginSettingsForm(unsupported)).toBe(false);
    render(
      <SchemaSettingsForm
        manifest={unsupported}
        enabled
        onEnabledChange={vi.fn()}
        config={{ host: "smtp.example.test", port: 587, secure: false }}
        onConfigChange={vi.fn()}
        requireConfig
        disabled={false}
        password=""
        onPasswordChange={vi.fn()}
        passwordConfigured={false}
        passwordPreview={null}
        clearPassword={false}
        onClearPasswordChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("loadFailed");
    expect(screen.queryByLabelText("host")).not.toBeInTheDocument();
  });
});
