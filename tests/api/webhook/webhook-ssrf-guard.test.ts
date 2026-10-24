import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertWebhookDestination,
  createGuardedLookup,
  isForbiddenWebhookAddress,
  parseWebhookUrl,
  type ResolvedAddress,
  resolvePermittedAddresses,
  sendWebhookRequest,
  WebhookDestinationError,
} from "../../../apps/api/src/webhook/safe-http";

const PROD = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
const DEV = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

const resolveTo =
  (...addresses: string[]) =>
  async (): Promise<ResolvedAddress[]> =>
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));

describe("WH-9 forbidden ranges", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "fe80::1",
    "fd00:ec2::254",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1",
  ])("refuses %s", (address) => {
    expect(isForbiddenWebhookAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])(
    "permits public %s",
    (address) => {
      expect(isForbiddenWebhookAddress(address)).toBe(false);
    },
  );
});

describe("WH-9 resolve-time check", () => {
  it("refuses a name that resolves to a private address", async () => {
    await expect(
      resolvePermittedAddresses(
        "intranet.example",
        resolveTo("10.0.0.5"),
        false,
      ),
    ).rejects.toMatchObject({ code: "destination_not_allowed" });
  });

  it("refuses when any one answer is forbidden", async () => {
    await expect(
      resolvePermittedAddresses(
        "mixed.example",
        resolveTo("93.184.216.34", "169.254.169.254"),
        false,
      ),
    ).rejects.toMatchObject({ code: "destination_not_allowed" });
  });

  it("refuses IP literals and localhost", async () => {
    for (const host of ["127.0.0.1", "[::1]", "169.254.169.254", "localhost"]) {
      await expect(
        resolvePermittedAddresses(host, resolveTo("93.184.216.34"), false),
      ).rejects.toBeInstanceOf(WebhookDestinationError);
    }
  });

  it("reports an unresolvable name distinctly", async () => {
    await expect(
      resolvePermittedAddresses(
        "nowhere.example",
        async () => {
          throw new Error("ENOTFOUND");
        },
        false,
      ),
    ).rejects.toMatchObject({ code: "unresolvable" });
  });
});

describe("WH-10 connect-time re-check", () => {
  function lookupOnce(
    lookup: ReturnType<typeof createGuardedLookup>,
    options: { all?: boolean } = {},
  ) {
    return new Promise<{ error: unknown; address: unknown }>((resolve) => {
      lookup("rebind.example", options, (error, address) =>
        resolve({ error, address }),
      );
    });
  }

  it("refuses when the answer changes between the save-time check and connect", async () => {
    const answers = [["93.184.216.34"], ["127.0.0.1"]];
    let call = 0;
    const resolver = async (): Promise<ResolvedAddress[]> => {
      const next = answers[Math.min(call++, answers.length - 1)] as string[];
      return next.map((address) => ({ address, family: 4 as const }));
    };
    // Save-time check sees the public address.
    await expect(
      assertWebhookDestination("https://rebind.example/hook", {
        resolver,
        env: PROD,
      }),
    ).resolves.toBeUndefined();
    // Connect-time lookup sees the rebound private address and refuses it.
    const lookup = createGuardedLookup(resolver, false);
    const { error } = await lookupOnce(lookup);
    expect(error).toMatchObject({
      code: "ENOTFOUND",
      webhookCode: "destination_not_allowed",
    });
  });

  it("returns only validated addresses, in the shape Node asks for", async () => {
    const lookup = createGuardedLookup(resolveTo("93.184.216.34"), false);
    expect((await lookupOnce(lookup, { all: true })).address).toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
    expect((await lookupOnce(lookup)).address).toBe("93.184.216.34");
  });
});

describe("WH-12 scheme and relaxation", () => {
  it("refuses plain http in production", () => {
    expect(() => parseWebhookUrl("http://example.com/hook", PROD)).toThrow(
      WebhookDestinationError,
    );
  });

  it("refuses plain http when NODE_ENV is anything but development", () => {
    for (const env of ["test", "staging", "", undefined]) {
      expect(() =>
        parseWebhookUrl("http://example.com/hook", { NODE_ENV: env } as never),
      ).toThrow(WebhookDestinationError);
    }
  });

  it("allows plain http only under NODE_ENV=development", () => {
    expect(parseWebhookUrl("http://example.com/hook", DEV).secure).toBe(false);
  });

  it("refuses credentials, other schemes and garbage", () => {
    for (const url of [
      "https://user:pass@example.com/",
      "ftp://example.com/",
      "file:///etc/passwd",
      "not a url",
      "javascript:alert(1)",
    ]) {
      expect(() => parseWebhookUrl(url, DEV), url).toThrow(
        WebhookDestinationError,
      );
    }
  });

  it("lets the development relaxation reach a private address, and production never", async () => {
    await expect(
      assertWebhookDestination("http://intranet.example/hook", {
        resolver: resolveTo("10.0.0.5"),
        env: DEV,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertWebhookDestination("https://intranet.example/hook", {
        resolver: resolveTo("10.0.0.5"),
        env: PROD,
      }),
    ).rejects.toMatchObject({ code: "destination_not_allowed" });
  });

  it("is not widened by the inherited private-destination override", async () => {
    const env = {
      NODE_ENV: "production",
      KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS: "true",
      TASKDESK_EGRESS_ALLOWLIST: "intranet.example",
    } as unknown as NodeJS.ProcessEnv;
    await expect(
      assertWebhookDestination("https://intranet.example/hook", {
        resolver: resolveTo("10.0.0.5"),
        env,
      }),
    ).rejects.toMatchObject({ code: "destination_not_allowed" });
  });
});

describe("sendWebhookRequest outcomes", () => {
  it("records a refused destination as a failure without throwing", async () => {
    const result = await sendWebhookRequest({
      url: "https://metadata.example/latest",
      headers: {},
      rawBody: "{}",
      resolver: resolveTo("169.254.169.254"),
      env: PROD,
    });
    expect(result).toMatchObject({
      success: false,
      statusCode: null,
      error: "destination_not_allowed",
    });
  });

  it("records plain http in production as a scheme failure", async () => {
    const result = await sendWebhookRequest({
      url: "http://example.com/hook",
      headers: {},
      rawBody: "{}",
      env: PROD,
    });
    expect(result).toMatchObject({
      success: false,
      error: "scheme_not_allowed",
    });
  });
});

describe("sendWebhookRequest against a local endpoint (development relaxation)", () => {
  let server: http.Server;
  let base = "";
  const seen: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  let listening = false;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        seen.push({
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        if (request.url === "/ok") {
          response.statusCode = 204;
          response.end();
        } else if (request.url === "/redirect") {
          response.statusCode = 302;
          response.setHeader("Location", "http://169.254.169.254/latest");
          response.end();
        } else if (request.url === "/slow") {
          // never answers within the test deadline
        } else {
          response.statusCode = 500;
          response.end("boom");
        }
      });
    });
    // Some sandboxes forbid binding a local port; the endpoint tests then skip (and are listed
    // as unrun by the implementer) instead of failing the suite.
    listening = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(0, "127.0.0.1", () => resolve(true));
    });
    if (listening)
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (!listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("delivers the raw body and headers, and treats 2xx as success", async (context) => {
    if (!listening) context.skip();
    const result = await sendWebhookRequest({
      url: `${base}/ok`,
      headers: { "X-TaskDesk-Event": "work_item.created" },
      rawBody: '{"a":1}',
      env: DEV,
    });
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(204);
    const last = seen[seen.length - 1];
    expect(last?.body).toBe('{"a":1}');
    expect(last?.headers["x-taskdesk-event"]).toBe("work_item.created");
  });

  it("does not follow a redirect and records it as a failure", async (context) => {
    if (!listening) context.skip();
    const before = seen.length;
    const result = await sendWebhookRequest({
      url: `${base}/redirect`,
      headers: {},
      rawBody: "{}",
      env: DEV,
    });
    expect(result).toMatchObject({
      success: false,
      statusCode: 302,
      error: "redirect_not_followed",
    });
    expect(seen.length).toBe(before + 1);
  });

  it("only treats 2xx as success", async (context) => {
    if (!listening) context.skip();
    const result = await sendWebhookRequest({
      url: `${base}/fail`,
      headers: {},
      rawBody: "{}",
      env: DEV,
    });
    expect(result).toMatchObject({
      success: false,
      statusCode: 500,
      error: "http_500",
      responseBody: "boom",
    });
  });

  it("enforces the whole-request deadline", async (context) => {
    if (!listening) context.skip();
    const result = await sendWebhookRequest({
      url: `${base}/slow`,
      headers: {},
      rawBody: "{}",
      timeoutMs: 150,
      env: DEV,
    });
    expect(result).toMatchObject({ success: false, error: "timeout" });
  });

  it("refuses the same loopback endpoint outside development", async (context) => {
    if (!listening) context.skip();
    const result = await sendWebhookRequest({
      url: `${base}/ok`,
      headers: {},
      rawBody: "{}",
      env: PROD,
    });
    expect(result.success).toBe(false);
  });
});
