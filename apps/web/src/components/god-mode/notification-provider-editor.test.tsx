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
  useQuery: () => ({
    isPending: false,
    isError: false,
    data: {
      version: mocks.version,
      source: "runtime",
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
          },
    },
  }),
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
