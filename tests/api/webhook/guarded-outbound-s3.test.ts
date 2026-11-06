import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AddressResolver,
  isForbiddenBundledAddress,
  sendGuardedOutboundRequest,
  sendWebhookRequest,
} from "../../../apps/api/src/webhook/safe-http";

const publicResolver: AddressResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

type MockOptions = {
  path: string;
  method: string;
  headers: Record<string, string>;
  lookup: (
    hostname: string,
    options: { all: boolean },
    callback: (error: Error | null, address: string) => void,
  ) => void;
};

function mockTransport(
  transport: typeof http | typeof https,
  config: {
    status?: number;
    chunks?: Buffer[];
    remoteAddress?: string;
    incomplete?: boolean;
    pending?: boolean;
    hang?: boolean;
  } = {},
) {
  const requests: Array<{
    options: MockOptions;
    body: unknown;
    request: { destroyed: boolean };
  }> = [];
  const spy = vi.spyOn(transport, "request").mockImplementation(((
    options: MockOptions,
    callback: (response: unknown) => void,
  ) => {
    const request = new EventEmitter() as EventEmitter & {
      destroyed: boolean;
      end(body?: unknown): void;
      destroy(): void;
    };
    request.destroyed = false;
    request.destroy = () => {
      request.destroyed = true;
    };
    request.end = (body) => {
      requests.push({ options, body, request });
      options.lookup("storage.example.test", { all: false }, (error) => {
        if (error) {
          request.emit("error", error);
          return;
        }
        const socket = new EventEmitter() as EventEmitter & {
          remoteAddress: string;
        };
        socket.remoteAddress = config.remoteAddress ?? "93.184.216.34";
        request.emit("socket", socket);
        socket.emit("connect");
        if (request.destroyed || config.pending) return;
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          destroy(): void;
        };
        response.statusCode = config.status ?? 200;
        response.headers = { "content-type": "application/octet-stream" };
        response.destroy = () => response.emit("close");
        callback(response);
        for (const chunk of config.chunks ?? []) response.emit("data", chunk);
        if (config.hang) return;
        if (config.incomplete) response.emit("close");
        else {
          response.emit("end");
          response.emit("close");
        }
      });
    };
    return request as unknown as http.ClientRequest;
  }) as unknown as typeof http.request);
  return { requests, spy };
}

const strict = {
  origin: "https://storage.example.test:8443",
  path: "/bucket/a%2Fb?partNumber=1&x=a%2Bb",
  method: "PUT",
  headers: {
    host: "storage.example.test:8443",
    "content-length": "3",
    authorization: "synthetic-signed-header",
    "if-none-match": "*",
  },
  body: Buffer.from("abc"),
  policy: "strict-public-https" as const,
  timeoutMs: 1_000,
  maxResponseBytes: 32,
  resolver: publicResolver,
};

afterEach(() => vi.restoreAllMocks());

describe("guarded strict outbound transport", () => {
  it("sends the exact signed path, query, headers and body after both DNS checks", async () => {
    const resolver = vi.fn(publicResolver);
    const { requests } = mockTransport(https, { chunks: [Buffer.from("ok")] });
    const result = await sendGuardedOutboundRequest({ ...strict, resolver });
    expect(result).toMatchObject({ statusCode: 200, body: Buffer.from("ok") });
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.options.path).toBe(strict.path);
    expect(requests[0]?.options.method).toBe(strict.method);
    expect(requests[0]?.options.headers).toEqual(strict.headers);
    expect(requests[0]?.body).toEqual(strict.body);
  });

  it("rejects unsafe origins, host/port mismatch and altered body length before DNS", async () => {
    const resolver = vi.fn(publicResolver);
    const { spy } = mockTransport(https);
    const variants = [
      { origin: "http://storage.example.test:8443" },
      {
        origin: "https://127.0.0.1:8443",
        headers: { ...strict.headers, host: "127.0.0.1:8443" },
      },
      { origin: "https://user:password@storage.example.test:8443" },
      { origin: "https://storage.example.test:8443/path" },
      { headers: { ...strict.headers, host: "storage.example.test" } },
      { headers: { ...strict.headers, "content-length": "4" } },
      { path: "/bucket/object#fragment" },
    ];
    for (const variant of variants)
      await expect(
        sendGuardedOutboundRequest({ ...strict, ...variant, resolver }),
      ).rejects.toThrow();
    expect(resolver).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("denies mixed DNS answers and a private answer on connect-time re-resolution", async () => {
    const { spy } = mockTransport(https);
    const mixed: AddressResolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
    await expect(
      sendGuardedOutboundRequest({ ...strict, resolver: mixed }),
    ).rejects.toThrow("non-routable address");
    expect(spy).not.toHaveBeenCalled();
    const resolver = vi
      .fn<AddressResolver>()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      sendGuardedOutboundRequest({ ...strict, resolver }),
    ).rejects.toThrow();
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("rejects a forbidden connected socket, redirects, oversized and incomplete responses", async () => {
    for (const configuration of [
      { remoteAddress: "::ffff:127.0.0.1" },
      { status: 302 },
      { chunks: [Buffer.alloc(33)] },
      { incomplete: true },
    ]) {
      const { spy } = mockTransport(https, configuration);
      await expect(sendGuardedOutboundRequest(strict)).rejects.toThrow();
      spy.mockRestore();
    }
  });

  it("enforces timeout and cancellation while DNS remains unresolved", async () => {
    const { spy } = mockTransport(https);
    const resolver: AddressResolver = () => new Promise(() => {});
    await expect(
      sendGuardedOutboundRequest({ ...strict, resolver, timeoutMs: 20 }),
    ).rejects.toThrow();
    const abort = new AbortController();
    const pending = sendGuardedOutboundRequest({
      ...strict,
      resolver,
      signal: abort.signal,
    });
    abort.abort();
    await expect(pending).rejects.toThrow("outbound_request_aborted");
    expect(spy).not.toHaveBeenCalled();
  });

  it("aborts an in-flight request without reporting a successful response", async () => {
    const { requests } = mockTransport(https, { pending: true });
    const abort = new AbortController();
    const pending = sendGuardedOutboundRequest({
      ...strict,
      signal: abort.signal,
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    abort.abort();
    await expect(pending).rejects.toThrow("outbound_request_aborted");
    expect(requests[0]?.request.destroyed).toBe(true);
  });
});

describe("fixed bundled storage transport", () => {
  it("permits only the fixed service origin, and rejects arbitrary private hosts", async () => {
    const { requests } = mockTransport(http, { remoteAddress: "10.0.0.5" });
    const bundled = {
      ...strict,
      origin: "http://seaweedfs:8333",
      headers: { ...strict.headers, host: "seaweedfs:8333" },
      policy: "bundled-seaweedfs" as const,
      resolver: async () => [{ address: "10.0.0.5", family: 4 as const }],
    };
    await expect(sendGuardedOutboundRequest(bundled)).resolves.toMatchObject({
      statusCode: 200,
    });
    expect(requests).toHaveLength(1);
    await expect(
      sendGuardedOutboundRequest({
        ...bundled,
        origin: "http://other:8333",
        headers: { ...bundled.headers, host: "other:8333" },
      }),
    ).rejects.toThrow();
    await expect(
      sendGuardedOutboundRequest({
        ...bundled,
        origin: "http://127.0.0.1:8333",
        headers: { ...bundled.headers, host: "127.0.0.1:8333" },
      }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
});

describe("bundled storage address rule", () => {
  const bundled = {
    ...strict,
    origin: "http://seaweedfs:8333",
    headers: { ...strict.headers, host: "seaweedfs:8333" },
    policy: "bundled-seaweedfs" as const,
  };
  const resolving =
    (address: string, family: 4 | 6 = 4): AddressResolver =>
    async () => [{ address, family }];

  it.each(["10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.5"])(
    "allows private IPv4 %s",
    async (address) => {
      mockTransport(http, { remoteAddress: address });
      await expect(
        sendGuardedOutboundRequest({
          ...bundled,
          resolver: resolving(address),
        }),
      ).resolves.toMatchObject({ statusCode: 200 });
    },
  );

  it("allows a unique-local IPv6 address and an IPv4-mapped private socket", async () => {
    mockTransport(http, { remoteAddress: "::ffff:10.0.0.5" });
    await expect(
      sendGuardedOutboundRequest({
        ...bundled,
        resolver: resolving("fd12:3456::7", 6),
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
  });

  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "172.32.0.1",
    "172.15.0.1",
    "100.64.0.1",
    "93.184.216.34",
    "8.8.8.8",
  ])("refuses IPv4 %s before any socket", async (address) => {
    const { spy } = mockTransport(http);
    await expect(
      sendGuardedOutboundRequest({ ...bundled, resolver: resolving(address) }),
    ).rejects.toThrow("non-routable address");
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(["::1", "::", "fe80::1", "ff02::1", "fd00:ec2::254", "2606:4700::1"])(
    "refuses IPv6 %s before any socket",
    async (address) => {
      const { spy } = mockTransport(http);
      await expect(
        sendGuardedOutboundRequest({
          ...bundled,
          resolver: resolving(address, 6),
        }),
      ).rejects.toThrow("non-routable address");
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("refuses when any answer is forbidden and holds in development", async () => {
    const { spy } = mockTransport(http);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      await expect(
        sendGuardedOutboundRequest({
          ...bundled,
          resolver: async () => [
            { address: "10.0.0.5", family: 4 },
            { address: "169.254.169.254", family: 4 },
          ],
        }),
      ).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a rebound answer at connect time and a forbidden connected socket", async () => {
    mockTransport(http);
    const resolver = vi
      .fn<AddressResolver>()
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    await expect(
      sendGuardedOutboundRequest({ ...bundled, resolver }),
    ).rejects.toThrow();
    vi.restoreAllMocks();
    mockTransport(http, { remoteAddress: "127.0.0.1" });
    await expect(
      sendGuardedOutboundRequest({
        ...bundled,
        resolver: resolving("10.0.0.5"),
      }),
    ).rejects.toThrow();
  });

  it("classifies addresses", () => {
    expect(isForbiddenBundledAddress("10.0.0.1")).toBe(false);
    expect(isForbiddenBundledAddress("[fc00::1]")).toBe(false);
    expect(isForbiddenBundledAddress("fd00:ec2:0:0:0:0:0:254")).toBe(true);
    expect(isForbiddenBundledAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isForbiddenBundledAddress("not-an-ip")).toBe(true);
    expect(isForbiddenBundledAddress("::ffff:7f00:1")).toBe(true);
    expect(isForbiddenBundledAddress("::ffff:a9fe:a9fe")).toBe(true);
    expect(isForbiddenBundledAddress("::ffff:a00:5")).toBe(true);
    expect(isForbiddenBundledAddress("fe80::1%eth0")).toBe(true);
    expect(isForbiddenBundledAddress("fd00::1%25eth0")).toBe(true);
  });

  it("leaves strict-public-https unchanged: a private answer is still refused", async () => {
    const { spy } = mockTransport(https);
    await expect(
      sendGuardedOutboundRequest({
        ...strict,
        resolver: resolving("10.0.0.5"),
      }),
    ).rejects.toThrow("non-routable address");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("webhook wrapper on the shared mocked transport", () => {
  it.each([
    { status: 204, expected: { success: true, error: null } },
    {
      status: 302,
      expected: { success: false, error: "redirect_not_followed" },
    },
    { status: 500, expected: { success: false, error: "http_500" } },
  ])("preserves status handling for $status", async ({ status, expected }) => {
    const { requests } = mockTransport(http, {
      status,
      chunks: [Buffer.from("ok")],
    });
    const result = await sendWebhookRequest({
      url: "http://storage.example.test/hook?q=1",
      headers: { "x-test": "value" },
      rawBody: "{}",
      resolver: publicResolver,
      env: { NODE_ENV: "development" },
    });
    expect(result).toMatchObject({
      statusCode: status,
      responseBody: "ok",
      ...expected,
    });
    expect(requests[0]?.options.path).toBe("/hook?q=1");
    expect(requests[0]?.body).toEqual(Buffer.from("{}"));
  });

  it("preserves bounded response truncation and timeout labeling", async () => {
    let mock = mockTransport(http, { chunks: [Buffer.alloc(3_000, 0x61)] });
    const input = {
      url: "http://storage.example.test/hook",
      headers: {},
      rawBody: "{}",
      resolver: publicResolver,
      env: { NODE_ENV: "development" },
    };
    const result = await sendWebhookRequest(input);
    expect(result.success).toBe(true);
    expect(result.responseBody).toHaveLength(2_048);
    mock.spy.mockRestore();
    mock = mockTransport(http, { pending: true });
    await expect(
      sendWebhookRequest({ ...input, timeoutMs: 20 }),
    ).resolves.toMatchObject({ success: false, error: "timeout" });
    mock.spy.mockRestore();
  });

  it("finishes with the received status when the body is slow (truncate), but reject mode fails", async () => {
    const mock = mockTransport(http, {
      status: 200,
      chunks: [Buffer.from("par")],
      hang: true,
    });
    await expect(
      sendWebhookRequest({
        url: "http://storage.example.test/hook",
        headers: {},
        rawBody: "{}",
        resolver: publicResolver,
        env: { NODE_ENV: "development" },
        timeoutMs: 30,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      success: true,
      error: null,
      responseBody: "par",
    });
    mock.spy.mockRestore();
    mockTransport(https, { chunks: [Buffer.from("par")], hang: true });
    await expect(
      sendGuardedOutboundRequest({ ...strict, timeoutMs: 30 }),
    ).rejects.toThrow("webhook_timeout");
  });
});
