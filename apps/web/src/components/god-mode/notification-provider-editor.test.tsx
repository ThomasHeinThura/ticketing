import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sesRegions = [
  { region: "eu-west-1", host: "email-smtp.eu-west-1.amazonaws.com" },
  { region: "us-east-1", host: "email-smtp.us-east-1.amazonaws.com" },
];
const sesConfig = {
  provider: "ses",
  region: "eu-west-1",
  host: "email-smtp.eu-west-1.amazonaws.com",
  port: 587,
  secure: false,
  requireTLS: true,
  username: "synthetic-ses-user",
  fromAddress: "noreply@example.com",
  replyTo: null,
};
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  verify: vi.fn(),
  invalidate: vi.fn(),
  stepBinding: vi.fn(),
  stepFailure: null as null | { kind: string },
  version: 3,
  unconfigured: false,
  savedConfig: null as null | Record<string, unknown>,
  testStatus: {
    state: "never",
    testedAt: null,
    smtpCode: null,
    category: null,
  } as Record<string, unknown>,
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
        key: "config.provider",
        labelKey: "provider",
        control: "text",
        group: "config",
        required: false,
        nullable: false,
        secret: false,
      },
      {
        key: "config.region",
        labelKey: "region",
        control: "text",
        group: "config",
        required: false,
        nullable: true,
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
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { email: "admin@example.com" } }),
}));
vi.mock("@/hooks/use-step-up-action", () => ({
  useStepUpAction: () => ({
    busy: false,
    failure: mocks.stepFailure,
    method: "password",
    setMethod: vi.fn(),
    secret: "",
    setSecret: vi.fn(),
    availableMethods: ["password"],
    canRun: true,
    clearFailure: vi.fn(),
    run: async (
      binding: unknown,
      execute: (token: string) => Promise<unknown>,
    ) => {
      mocks.stepBinding(binding);
      try {
        return { ok: true, value: await execute("step-up-token") };
      } catch {
        return { ok: false };
      }
    },
  }),
}));
vi.mock("./step-up-fields", () => ({
  StepUpFields: () => <div data-testid="step-up-fields" />,
  FailureAlert: ({
    failure,
    title,
  }: {
    failure: { kind: string } | null;
    title: string;
  }) =>
    failure ? (
      <div data-testid="step-up-failure">{`${title}:${failure.kind}`}</div>
    ) : null,
}));
vi.mock("@/fetchers/god-mode/notification-provider", () => ({
  getEmailProvider: vi.fn(),
  saveEmailProvider: (value: unknown, token: string) =>
    mocks.save(value, token),
  sendEmailProviderTest: (value: unknown) => mocks.verify(value),
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
            testStatus: mocks.testStatus,
            sesRegions,
            config: mocks.unconfigured
              ? null
              : (mocks.savedConfig ?? {
                  host: "smtp.example.com",
                  port: 587,
                  secure: false,
                  requireTLS: true,
                  username: "service",
                  fromAddress: "service@example.com",
                  replyTo: null,
                  captureToMailpit: mocks.persistedCaptureSelected,
                }),
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
  mocks.version = 3;
  mocks.unconfigured = false;
  mocks.localMailpitCaptureAvailable = true;
  mocks.persistedCaptureSelected = false;
  mocks.savedConfig = null;
  mocks.stepFailure = null;
  mocks.testStatus = {
    state: "never",
    testedAt: null,
    smtpCode: null,
    category: null,
  };
  mocks.stepBinding.mockReset();
  mocks.save.mockReset().mockResolvedValue({});
  mocks.verify.mockReset().mockResolvedValue({
    ok: true,
    testedAt: "2026-11-12T10:00:00.000Z",
    recipientDomain: "example.com",
    persisted: false,
  });
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
  it("saves only through a step-up proof bound to exactly the request it sends", async () => {
    render(<NotificationProviderEditor />);
    expect(screen.getByTestId("step-up-fields")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("password"), {
      target: { value: "synthetic-new-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const [request, token] = mocks.save.mock.calls[0];
    expect(token).toBe("step-up-token");
    expect(mocks.stepBinding).toHaveBeenCalledWith({
      operation: "notification_provider_save",
      request,
    });
    expect(request).toMatchObject({ password: "synthetic-new-secret" });
  });
  it("can explicitly disable an unconfigured provider without inventing connection details", async () => {
    mocks.unconfigured = true;
    render(<NotificationProviderEditor />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        { version: 3, enabled: false },
        "step-up-token",
      ),
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
        "step-up-token",
      ),
    );
  });
  it("sends a real test email with the unsaved values, without saving or enabling delivery", async () => {
    render(<NotificationProviderEditor />);
    fireEvent.change(screen.getByLabelText("host"), {
      target: { value: "smtp.draft.example.com" },
    });
    fireEvent.change(screen.getByLabelText("password"), {
      target: { value: "new-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "testSend.button" }));
    await waitFor(() => expect(mocks.verify).toHaveBeenCalled());
    expect(mocks.verify.mock.calls[0][0]).toMatchObject({
      version: 3,
      recipient: "admin@example.com",
      config: { host: "smtp.draft.example.com" },
    });
    expect(mocks.verify.mock.calls[0][0]).not.toHaveProperty("enabled");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.stepBinding).not.toHaveBeenCalled();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("status.verified");
    expect(status).toHaveTextContent("testSend.sent");
    // The values were not the saved ones, so the result is shown but not recorded.
    expect(status).toHaveTextContent("testSend.notSaved");
    expect(mocks.invalidate).not.toHaveBeenCalled();
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
    expect(
      screen.getByRole("button", { name: "testSend.button" }),
    ).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not report failed writes as saved, shows the failure and clears entered passwords", async () => {
    mocks.stepFailure = { kind: "unavailable" };
    mocks.save.mockRejectedValue(
      new Error("private diagnostic must not be shown"),
    );
    render(<NotificationProviderEditor />);
    expect(screen.getByTestId("step-up-failure")).toHaveTextContent(
      "operationFailed:unavailable",
    );
    fireEvent.change(screen.getByLabelText("password"), {
      target: { value: "synthetic-new-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText("password")).toHaveValue(""),
    );
    expect(screen.queryByText("saved")).not.toBeInTheDocument();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(screen.queryByText(/private diagnostic/)).not.toBeInTheDocument();
  });
});

describe("test status under the title", () => {
  it.each([
    [
      "never",
      { state: "never", testedAt: null, smtpCode: null, category: null },
      "status.never",
    ],
    [
      "verified",
      {
        state: "verified",
        testedAt: "2026-11-12T10:00:00.000Z",
        smtpCode: null,
        category: null,
      },
      "status.verified",
    ],
    [
      "failed",
      {
        state: "failed",
        testedAt: "2026-11-12T10:00:00.000Z",
        smtpCode: 535,
        category: "authentication",
      },
      "status.failed",
    ],
    [
      "stale",
      { state: "stale", testedAt: null, smtpCode: null, category: null },
      "status.stale",
    ],
  ])("shows %s", (_state, status, label) => {
    mocks.testStatus = status;
    render(<NotificationProviderEditor />);
    const line = screen.getByTestId("email-test-status");
    expect(line).toHaveTextContent(label);
    if (status.testedAt) expect(line).toHaveTextContent("status.lastTested");
    else expect(line).not.toHaveTextContent("status.lastTested");
  });

  it("names the failure and its SMTP code in the last result", () => {
    mocks.testStatus = {
      state: "failed",
      testedAt: "2026-11-12T10:00:00.000Z",
      smtpCode: 535,
      category: "authentication",
    };
    render(<NotificationProviderEditor />);
    expect(screen.getByTestId("email-test-status")).toHaveTextContent(
      "failureShort.authentication",
    );
    expect(screen.getByTestId("email-test-status")).toHaveTextContent("535");
  });
});

describe("sending a test email", () => {
  it("requires a fresh password before testing a changed host", () => {
    render(<NotificationProviderEditor />);
    fireEvent.change(screen.getByLabelText("host"), {
      target: { value: "other.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "testSend.button" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "testDestinationPasswordRequired",
    );
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each(["host", "password"])(
    "marks verification stale after editing %s and removes the old result",
    async (field) => {
      mocks.testStatus = {
        state: "verified",
        testedAt: "2026-11-12T10:00:00.000Z",
        smtpCode: null,
        category: null,
      };
      render(<NotificationProviderEditor />);
      fireEvent.click(screen.getByRole("button", { name: "testSend.button" }));
      expect(await screen.findByText("testSend.sent")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(field), {
        target: { value: "changed-value" },
      });
      expect(screen.getByTestId("email-test-status")).toHaveTextContent(
        "status.stale",
      );
      expect(screen.getByTestId("email-test-status")).not.toHaveTextContent(
        "status.lastTested",
      );
      expect(screen.queryByText("testSend.sent")).not.toBeInTheDocument();
    },
  );

  it("marks verification stale when the SES region changes", async () => {
    mocks.savedConfig = sesConfig;
    mocks.testStatus = {
      state: "verified",
      testedAt: "2026-11-12T10:00:00.000Z",
      smtpCode: null,
      category: null,
    };
    render(<NotificationProviderEditor />);
    fireEvent.click(screen.getByLabelText("ses.regionLabel"));
    fireEvent.keyDown(
      await screen.findByRole("option", { name: /us-east-1/ }),
      { key: "Enter" },
    );
    expect(screen.getByTestId("email-test-status")).toHaveTextContent(
      "status.stale",
    );
    expect(screen.getByLabelText("host")).toHaveValue(
      "email-smtp.us-east-1.amazonaws.com",
    );
  });

  it("shows the server's stale status after saving changed settings", async () => {
    mocks.testStatus = {
      state: "verified",
      testedAt: "2026-11-12T10:00:00.000Z",
      smtpCode: null,
      category: null,
    };
    const { rerender } = render(<NotificationProviderEditor />);
    fireEvent.change(screen.getByLabelText("host"), {
      target: { value: "changed.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    mocks.version += 1;
    mocks.testStatus = {
      state: "stale",
      testedAt: null,
      smtpCode: null,
      category: null,
    };
    rerender(<NotificationProviderEditor />);
    expect(screen.getByTestId("email-test-status")).toHaveTextContent(
      "status.stale",
    );
    expect(screen.getByTestId("email-test-status")).not.toHaveTextContent(
      "status.lastTested",
    );
  });
  it("shows the failure category, the SMTP code and the provider text", async () => {
    mocks.verify.mockResolvedValue({
      ok: false,
      testedAt: "2026-11-12T10:00:00.000Z",
      category: "authentication",
      smtpCode: 535,
      providerText: "5.7.8 Authentication Credentials Invalid",
      persisted: false,
    });
    render(<NotificationProviderEditor />);
    fireEvent.click(screen.getByRole("button", { name: "testSend.button" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("testSend.failedTitle");
    expect(alert).toHaveTextContent("failure.authentication");
    const reply = screen.getByTestId("email-test-reply");
    expect(reply).toHaveTextContent("535");
    expect(reply).toHaveTextContent("5.7.8 Authentication Credentials Invalid");
  });

  it("refreshes the saved status only when the result was recorded", async () => {
    mocks.verify.mockResolvedValue({
      ok: true,
      testedAt: "2026-11-12T10:00:00.000Z",
      recipientDomain: "example.com",
      persisted: true,
    });
    render(<NotificationProviderEditor />);
    fireEvent.click(screen.getByRole("button", { name: "testSend.button" }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "testSend.notSaved",
    );
  });

  it("defaults the recipient to the signed-in administrator and lets them type another", async () => {
    render(<NotificationProviderEditor />);
    const recipient = screen.getByLabelText("testSend.recipientLabel");
    expect(recipient).toHaveValue("admin@example.com");
    fireEvent.change(recipient, { target: { value: "someone@else.example" } });
    fireEvent.click(screen.getByRole("button", { name: "testSend.button" }));
    await waitFor(() => expect(mocks.verify).toHaveBeenCalled());
    expect(mocks.verify.mock.calls[0][0]).toMatchObject({
      recipient: "someone@else.example",
    });
  });

  it("does not send without a plausible recipient", async () => {
    render(<NotificationProviderEditor />);
    fireEvent.change(screen.getByLabelText("testSend.recipientLabel"), {
      target: { value: "not-an-address" },
    });
    fireEvent.click(screen.getByRole("button", { name: "testSend.button" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "testSend.recipientRequired",
    );
    expect(mocks.verify).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("testSend.recipientLabel"), {
      target: { value: "" },
    });
    expect(
      screen.getByRole("button", { name: "testSend.button" }),
    ).toBeDisabled();
  });

  it.each([
    [409, "conflict"],
    [429, "rateLimited"],
    [500, "operationFailed"],
  ])(
    "explains a refused request (%i) and clears the typed password",
    async (status, message) => {
      const { HttpError } = await import("@/lib/http-error");
      mocks.verify.mockRejectedValue(new HttpError(status, "refused"));
      render(<NotificationProviderEditor />);
      fireEvent.change(screen.getByLabelText("password"), {
        target: { value: "synthetic-new-secret" },
      });
      fireEvent.click(screen.getByRole("button", { name: "testSend.button" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByLabelText("password")).toHaveValue("");
    },
  );
});

describe("Amazon SES", () => {
  beforeEach(() => {
    mocks.savedConfig = sesConfig;
  });

  it("shows the region's host, port and STARTTLS read-only, with SES labels and help", () => {
    render(<NotificationProviderEditor />);
    expect(
      screen.getByRole("radio", { name: "providerChoice.ses" }),
    ).toBeChecked();
    expect(screen.getByLabelText("host")).toHaveValue(
      "email-smtp.eu-west-1.amazonaws.com",
    );
    expect(screen.getByLabelText("host")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("port")).toHaveValue(587);
    expect(screen.getByLabelText("port")).toHaveAttribute("readonly");
    expect(screen.getByRole("checkbox", { name: "secure" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: "requireTLS" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("checkbox", { name: "requireTLS" })).toBeChecked();
    expect(screen.getByLabelText("ses.username")).toHaveValue(
      "synthetic-ses-user",
    );
    expect(screen.getByLabelText("ses.password")).toBeInTheDocument();
    expect(screen.queryByLabelText("username")).not.toBeInTheDocument();
    expect(screen.getByText("ses.credentialsHelp")).toBeInTheDocument();
    expect(screen.getByText("ses.fromHelp")).toBeInTheDocument();
    expect(screen.getByLabelText("ses.regionLabel")).toBeInTheDocument();
  });

  it("keeps the local capture option out of Amazon SES", () => {
    render(<NotificationProviderEditor />);
    expect(
      screen.queryByRole("checkbox", { name: "captureToMailpit" }),
    ).not.toBeInTheDocument();
  });

  it("warns about the sandbox until the warning is dismissed", () => {
    render(<NotificationProviderEditor />);
    expect(screen.getByText("ses.sandboxTitle")).toBeInTheDocument();
    expect(screen.getByText("ses.sandboxBody")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ses.dismiss" }));
    expect(screen.queryByText("ses.sandboxTitle")).not.toBeInTheDocument();
  });

  it("saves the provider and region with the fixed connection, and uses SES wording for failures", async () => {
    mocks.verify.mockResolvedValue({
      ok: false,
      testedAt: "2026-11-12T10:00:00.000Z",
      category: "message_rejected",
      smtpCode: 554,
      providerText: "Message rejected: Email address is not verified.",
      persisted: false,
    });
    render(<NotificationProviderEditor />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      version: 3,
      config: {
        provider: "ses",
        region: "eu-west-1",
        host: "email-smtp.eu-west-1.amazonaws.com",
        port: 587,
        secure: false,
        requireTLS: true,
        username: "synthetic-ses-user",
      },
    });
    expect(mocks.save.mock.calls[0][0]).not.toHaveProperty("password");
    fireEvent.click(screen.getByRole("button", { name: "testSend.button" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "failureSes.message_rejected",
    );
  });

  it("offers Amazon SES as a choice and asks for a region before anything can be saved", async () => {
    mocks.savedConfig = null;
    mocks.unconfigured = true;
    render(<NotificationProviderEditor />);
    expect(screen.queryByLabelText("ses.regionLabel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "providerChoice.ses" }));
    expect(await screen.findByLabelText("ses.regionLabel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "testSend.button" }),
    ).toBeDisabled();
  });

  it("never reuses the password saved for the other provider", async () => {
    render(<NotificationProviderEditor />);
    fireEvent.click(screen.getByRole("radio", { name: "providerChoice.smtp" }));
    expect(screen.getByLabelText("password")).toBeRequired();
    fireEvent.change(screen.getByLabelText("host"), {
      target: { value: "smtp.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "testSend.button" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "credentialsRequired",
    );
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
