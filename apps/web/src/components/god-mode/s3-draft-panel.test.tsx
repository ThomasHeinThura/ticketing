import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  test: vi.fn(),
  prove: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/god-mode/s3-draft", () => ({
  getS3Draft: mocks.get,
  saveS3Draft: mocks.save,
  testS3Draft: mocks.test,
}));
vi.mock("@/fetchers/god-mode/identity-step-up", () => ({
  proveIdentityOperation: mocks.prove,
}));
vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getCurrentFactorStatus: async () => ({
    availableMethods: ["password"],
    enabled: false,
    required: false,
  }),
}));

import { IdentityAdminError } from "@/fetchers/god-mode/identity-admin-error";
import { S3DraftPanel } from "./s3-draft-panel";

const data = {
  version: 3,
  config: {
    connector: "external",
    endpoint: "https://example.test",
    publicBaseUrl: "https://files.example.test",
    region: "test",
    bucket: "bucket",
    keyPrefix: "",
    forcePathStyle: true,
    maxImageUploadBytes: 10485760,
    presignTtlSeconds: 300,
  },
  credentialConfigured: true,
  accessKeyIdConfigured: true,
  secretAccessKeyConfigured: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(data);
  mocks.save.mockResolvedValue({ ...data, version: 4 });
  mocks.test.mockResolvedValue({
    status: "verified",
    cleanup: "confirmed",
    durationMs: 1,
    browserPathVerified: false,
  });
  mocks.prove.mockResolvedValue("proof-token");
});
afterEach(cleanup);
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <S3DraftPanel />
    </QueryClientProvider>,
  );
  return client;
}
async function factor() {
  fireEvent.change(await screen.findByLabelText("stepUp.password"), {
    target: { value: "fresh-factor" },
  });
}
describe("S3DraftPanel", () => {
  it("binds separate fresh proofs to save and test without caching credentials", async () => {
    const client = setup();
    await screen.findByText("draft.inactive");
    await factor();
    fireEvent.click(screen.getByRole("button", { name: "draft.save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const saved = mocks.save.mock.calls[0][0];
    expect(saved.credentials).toBeUndefined();
    expect(mocks.prove.mock.calls[0][0]).toEqual({
      operation: "storage_config_save",
      ...saved,
    });
    expect(screen.getByLabelText("stepUp.password")).toHaveValue("");
    await factor();
    fireEvent.click(screen.getByRole("button", { name: "draft.test" }));
    await waitFor(() => expect(mocks.test).toHaveBeenCalledTimes(1));
    expect(mocks.prove.mock.calls[1][0]).toEqual({
      operation: "storage_config_test",
      ...mocks.test.mock.calls[0][0],
    });
    expect(
      await screen.findByText(/draft.browserUnverified/),
    ).toBeInTheDocument();
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(
      "fresh-factor",
    );
  });
  it("blocks a stale draft until a successful explicit reload", async () => {
    mocks.save.mockRejectedValueOnce(
      new IdentityAdminError(409, "failed", "version_conflict", 4),
    );
    setup();
    await screen.findByText("draft.inactive");
    await factor();
    fireEvent.click(screen.getByRole("button", { name: "draft.save" }));
    await screen.findByText("draft.operationFailed");
    expect(screen.getByRole("button", { name: "draft.save" })).toBeDisabled();
    mocks.get.mockResolvedValue({ ...data, version: 4 });
    fireEvent.click(screen.getByRole("button", { name: "draft.reload" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "draft.save" })).toBeEnabled(),
    );
    await factor();
    fireEvent.click(screen.getByRole("button", { name: "draft.save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0].version).toBe(4);
  });
  it("requires both new credentials when the endpoint changes", async () => {
    setup();
    fireEvent.change(await screen.findByLabelText("draft.endpoint"), {
      target: { value: "https://other.example.test" },
    });
    expect(screen.getByText("draft.endpointCredentials")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "draft.save" })).toBeDisabled();
    expect(mocks.prove).not.toHaveBeenCalled();
  });
  it("sends replacement and explicit clearing without caching credential values", async () => {
    const client = setup();
    const access = await screen.findByLabelText(
      "draft.access — draft.configured",
    );
    fireEvent.click(access);
    fireEvent.keyDown(
      await screen.findByRole("option", { name: "draft.replace" }),
      { key: "Enter" },
    );
    fireEvent.change(screen.getByLabelText("draft.accessValue"), {
      target: { value: "new-access" },
    });
    fireEvent.click(screen.getByLabelText("draft.secret — draft.configured"));
    fireEvent.keyDown(
      await screen.findByRole("option", { name: "draft.clear" }),
      { key: "Enter" },
    );
    await factor();
    fireEvent.click(screen.getByRole("button", { name: "draft.save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].credentials).toEqual({
      accessKeyId: "new-access",
      secretAccessKey: null,
    });
    await waitFor(() =>
      expect(
        screen.queryByLabelText("draft.accessValue"),
      ).not.toBeInTheDocument(),
    );
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain("new-access");
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(
      "new-access",
    );
  });
  it("allows a first external draft without credential changes", async () => {
    mocks.get.mockResolvedValueOnce({
      ...data,
      version: 0,
      config: null,
      credentialConfigured: false,
      accessKeyIdConfigured: false,
      secretAccessKeyConfigured: false,
    });
    setup();
    await screen.findByText("draft.inactive");
    expect(
      screen.queryByText("draft.endpointCredentials"),
    ).not.toBeInTheDocument();
    await factor();
    fireEvent.click(screen.getByRole("button", { name: "draft.save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].credentials).toBeUndefined();
  });
  it("requires fresh credentials for an external to bundled connector change", async () => {
    setup();
    fireEvent.click(await screen.findByLabelText("draft.connector"));
    fireEvent.keyDown(
      await screen.findByRole("option", { name: "draft.bundled" }),
      { key: "Enter" },
    );
    expect(
      await screen.findByText("draft.endpointCredentials"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "draft.save" })).toBeDisabled();
  });
  it("keeps the form disabled while a save is in flight", async () => {
    let finish!: (value: typeof data) => void;
    mocks.save.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    setup();
    await screen.findByText("draft.inactive");
    await factor();
    fireEvent.click(screen.getByRole("button", { name: "draft.save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("draft.endpoint")).toBeDisabled();
    expect(screen.getByLabelText("draft.connector")).toBeDisabled();
    expect(screen.getByLabelText("draft.bucket")).toBeDisabled();
    finish(data);
    await waitFor(() =>
      expect(screen.getByLabelText("draft.bucket")).toBeEnabled(),
    );
  });
  it("treats an endpoint trailing slash as the same origin", async () => {
    setup();
    fireEvent.change(await screen.findByLabelText("draft.endpoint"), {
      target: { value: "https://example.test/" },
    });
    expect(
      screen.queryByText("draft.endpointCredentials"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "draft.save" })).toBeEnabled();
  });
});
