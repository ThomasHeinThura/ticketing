import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  test: vi.fn(),
  apiFetch: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    instance: {
      "notification-providers": {
        email: { $get: mocks.get, test: { $post: mocks.test } },
      },
    },
  },
  apiFetch: mocks.apiFetch,
}));
vi.mock("../get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.example.test/api/${path}`,
}));

import { IdentityAdminError } from "./identity-admin-error";
import {
  saveEmailProvider,
  sendEmailProviderTest,
} from "./notification-provider";

const input = {
  version: 3,
  enabled: true,
  config: {
    provider: "ses" as const,
    region: "eu-west-1" as const,
    host: "email-smtp.eu-west-1.amazonaws.com",
    port: 587,
    secure: false,
    requireTLS: true,
    username: "synthetic-ses-user",
    fromAddress: "noreply@example.test",
    replyTo: null,
  },
  password: "synthetic-ses-password",
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.test.mockReset();
  mocks.apiFetch.mockReset();
});

describe("saving the email provider", () => {
  it("sends the exact body that was proven, with the single-use proof in the header", async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ version: 4 }), { status: 200 }),
    );
    await expect(saveEmailProvider(input, "proof-token")).resolves.toEqual({
      version: 4,
    });
    const [url, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.example.test/api/instance/notification-providers/email",
    );
    expect(init).toMatchObject({ method: "PATCH", credentials: "include" });
    expect(init.headers).toMatchObject({
      "x-taskdesk-step-up-token": "proof-token",
    });
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it.each([
    [403, "step_up_unavailable", "step_up"],
    [409, "version_conflict", "conflict"],
    [429, "", "rate_limited"],
  ] as const)(
    "reports %i as the %s failure kind",
    async (status, text, kind) => {
      mocks.apiFetch.mockResolvedValue(new Response(text, { status }));
      const failure = await saveEmailProvider(input, "proof-token").catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(IdentityAdminError);
      expect((failure as IdentityAdminError).kind).toBe(kind);
    },
  );
});

describe("sending a test email", () => {
  const request = {
    version: 3,
    config: input.config,
    recipient: "admin@example.test",
  };

  it("returns a delivery failure as an answer, not an exception", async () => {
    const answer = {
      ok: false,
      testedAt: "2026-11-12T10:00:00.000Z",
      category: "authentication",
      smtpCode: 535,
      providerText: "5.7.8 Authentication Credentials Invalid",
      persisted: false,
    };
    mocks.test.mockResolvedValue(
      new Response(JSON.stringify(answer), { status: 200 }),
    );
    await expect(sendEmailProviderTest(request)).resolves.toEqual(answer);
    expect(mocks.test).toHaveBeenCalledWith({ json: request });
  });

  it("throws for a refused request", async () => {
    mocks.test.mockResolvedValue(new Response("", { status: 429 }));
    await expect(sendEmailProviderTest(request)).rejects.toMatchObject({
      status: 429,
    });
  });
});
