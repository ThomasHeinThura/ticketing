import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  verify: vi.fn(),
  invalidate: vi.fn(),
  version: 3,
  unconfigured: false,
  localMailpitCaptureAvailable: true,
  persistedCaptureSelected: false,
  settingsForm: {
    version: 1 as const,
    available: true as const,
    fields: [
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
        key: "config.requireTLS",
        labelKey: "requireTLS",
        control: "checkbox",
        group: "config",
        required: true,
        nullable: false,
        secret: false,
      },
      {
        key: "config.captureToMailpit",
        labelKey: "captureToMailpit",
        control: "checkbox",
        group: "config",
        required: false,
        nullable: false,
        secret: false,
      },
      {
        key: "config.username",
        labelKey: "username",
        control: "text",
        group: "config",
        required: true,
        nullable: true,
        secret: false,
        minLength: 1,
      },
      {
        key: "config.fromAddress",
        labelKey: "fromAddress",
        control: "email",
        group: "config",
        required: true,
        nullable: false,
        secret: false,
        format: "email",
      },
      {
        key: "config.replyTo",
        labelKey: "replyTo",
        control: "email",
        group: "config",
        required: true,
        nullable: true,
        secret: false,
        format: "email",
      },
      {
        key: "password",
        labelKey: "password",
        control: "password",
        group: "secret",
        required: false,
        nullable: true,
        secret: true,
        minLength: 1,
        maxLength: 16384,
      },
    ],
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/god-mode/notification-provider", () => ({
  getEmailProvider: vi.fn(),
  saveEmailProvider: (value: unknown) => mocks.save(value),
  verifyEmailProvider: (value: unknown) => mocks.verify(value),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "god-mode"
      ? {
          isPending: false,
          isError: false,
          data: {
            plugins: [
              {
                id: "notify.email",
                settingsForm: mocks.settingsForm,
              },
            ],
          },
          refetch: vi.fn(),
        }
      : {
          isPending: false,
          isError: false,
          data: {
            version: mocks.version,
            source: "runtime",
            localMailpitCaptureAvailable: mocks.localMailpitCaptureAvailable,
            enabled: !mocks.unconfigured,
            passwordConfigured: true,
            passwordPreview: "••••••••",
            config: mocks.unconfigured
              ? null
              : {
                  host: "smtp.example.com",
                  port: 587,
                  secure: false,
                  requireTLS: true,
                  username: "service",
                  fromAddress: "service@example.com",
                  replyTo: null,
                  captureToMailpit: mocks.persistedCaptureSelected,
                },
          },
          refetch: vi.fn(),
        },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (value: unknown) => Promise<unknown>;
  }) => ({ isPending: false, mutateAsync: mutationFn }),
}));

import { NotificationProviderEditor } from "./notification-provider-editor";

afterEach(cleanup);
beforeEach(() => {
  mocks.unconfigured = false;
  mocks.localMailpitCaptureAvailable = true;
  mocks.persistedCaptureSelected = false;
  mocks.save.mockReset().mockResolvedValue({});
  mocks.verify.mockReset().mockResolvedValue({ verified: true });
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
});
describe("runtime email configuration", () => {
  it("keeps the existing secret when the password field is untouched", async () => {
    render(<NotificationProviderEditor />);
    expect(screen.getByLabelText("password")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      version: 3,
      enabled: true,
    });
    expect(mocks.save.mock.calls[0][0]).not.toHaveProperty("password");
  });
  it("can explicitly disable an unconfigured provider without inventing connection details", async () => {
    mocks.unconfigured = true;
    render(<NotificationProviderEditor />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({ version: 3, enabled: false }),
    );
  });

  it("sends explicit removal and clears the secret input", async () => {
    render(<NotificationProviderEditor />);
    fireEvent.change(screen.getByLabelText("password"), {
      target: { value: "synthetic-new-secret" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "clearPassword" }));
    expect(screen.getByLabelText("password")).toHaveValue("");
    expect(screen.getByLabelText("password")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({ password: null }),
      ),
    );
  });
  it("tests a draft without saving or enabling delivery", async () => {
    render(<NotificationProviderEditor />);
    fireEvent.click(screen.getByRole("button", { name: "test" }));
    await waitFor(() => expect(mocks.verify).toHaveBeenCalled());
    expect(mocks.verify.mock.calls[0][0]).not.toHaveProperty("enabled");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("verified");
  });
  it("selects the fixed Mailpit profile and explicitly clears any saved password", async () => {
    render(<NotificationProviderEditor />);
    fireEvent.click(screen.getByRole("checkbox", { name: "captureToMailpit" }));
    expect(screen.getByText("captureHelp")).toBeInTheDocument();
    expect(screen.queryByLabelText("password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      config: {
        captureToMailpit: true,
        host: "mailpit",
        port: 1025,
        secure: false,
        requireTLS: false,
        username: null,
      },
      password: null,
    });
  });
  it("restores the ordinary SMTP draft when Mailpit capture is turned back off", async () => {
    render(<NotificationProviderEditor />);
    fireEvent.click(screen.getByRole("checkbox", { name: "captureToMailpit" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "captureToMailpit" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      config: {
        captureToMailpit: false,
        host: "smtp.example.com",
        port: 587,
        requireTLS: true,
        username: "service",
      },
    });
  });
  it("fails closed when persisted capture is selected but unavailable", async () => {
    mocks.localMailpitCaptureAvailable = false;
    mocks.persistedCaptureSelected = true;
    render(<NotificationProviderEditor />);
    expect(await screen.findByText("captureUnavailable")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "captureToMailpit" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "test" })).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not report failed writes as saved and clears entered passwords", async () => {
    mocks.save.mockRejectedValue(
      new Error("private diagnostic must not be shown"),
    );
    render(<NotificationProviderEditor />);
    fireEvent.change(screen.getByLabelText("password"), {
      target: { value: "synthetic-new-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "operationFailed",
    );
    expect(screen.getByLabelText("password")).toHaveValue("");
    expect(screen.queryByText(/private diagnostic/)).not.toBeInTheDocument();
  });
});
