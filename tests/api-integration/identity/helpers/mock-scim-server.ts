import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

export type ScimRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
};

export type ScimResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
};

export type MockScimServerOptions = {
  respond?: (request: ScimRequest) => ScimResponse | Promise<ScimResponse>;
};

export type MockScimServer = {
  baseUrl: string;
  requests: ScimRequest[];
  close(): Promise<void>;
};

export async function startMockScimServer(
  options: MockScimServerOptions = {},
): Promise<MockScimServer> {
  const requests: ScimRequest[] = [];
  const server: Server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const request: ScimRequest = {
      method: incoming.method ?? "GET",
      path: incoming.url ?? "/",
      headers: {
        ...incoming.headers,
        authorization:
          incoming.headers.authorization === undefined
            ? undefined
            : "[REDACTED]",
      },
      body: Buffer.concat(chunks).toString("utf8"),
    };
    requests.push(request);
    const result = (await options.respond?.(request)) ?? {
      status: 200,
      body: {},
    };
    const body =
      result.body === undefined
        ? ""
        : typeof result.body === "string"
          ? result.body
          : JSON.stringify(result.body);
    outgoing
      .writeHead(result.status ?? 200, {
        "content-type": "application/scim+json",
        ...result.headers,
      })
      .end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("mock SCIM server did not bind a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
