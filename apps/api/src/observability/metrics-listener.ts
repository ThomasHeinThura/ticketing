import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

export const METRICS_LISTENER_MANIFEST = Object.freeze({
  port: 9464,
  method: "GET",
  path: "/metrics",
  policyKey: "GET /metrics",
});

export interface MetricsListenerOptions {
  /** Current 32-byte SHA-256 digest from the database; null means unconfigured. */
  readCurrentTokenDigest: () => Promise<Uint8Array | null>;
  /** Exposition is called only after an authorized request. */
  renderMetrics: () => Promise<string> | string;
  /** Explicit test-only port injection; production always binds 9464. */
  testPort?: number;
}

export interface MetricsListener {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const unauthorizedBody = "Unauthorized\n";
const unavailableBody = "Metrics unavailable\n";
const malformedBearer = /^Bearer ([A-Za-z0-9_-]{43})$/;

function send(
  response: ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function authorizationValue(request: IncomingMessage): string | undefined {
  const matches: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "authorization") {
      matches.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function tokenDigest(token: string): Buffer | undefined {
  const match = malformedBearer.exec(token);
  if (!match) return undefined;
  const encoded = match[1] ?? "";
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== encoded) {
    return undefined;
  }
  return createHash("sha256").update(decoded).digest();
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: MetricsListenerOptions,
  contentType: string,
): Promise<void> {
  if (request.url !== METRICS_LISTENER_MANIFEST.path) {
    send(response, 404, "Not found\n");
    return;
  }
  if (request.method !== METRICS_LISTENER_MANIFEST.method) {
    send(response, 405, "Method not allowed\n");
    return;
  }

  const authorization = authorizationValue(request);
  const candidateDigest = authorization
    ? tokenDigest(authorization)
    : undefined;
  if (!candidateDigest) {
    send(response, 401, unauthorizedBody);
    return;
  }

  let currentDigest: Uint8Array | null;
  try {
    currentDigest = await options.readCurrentTokenDigest();
  } catch {
    send(response, 503, unavailableBody);
    return;
  }
  if (currentDigest?.byteLength !== 32) {
    if (currentDigest) send(response, 503, unavailableBody);
    else send(response, 401, unauthorizedBody);
    return;
  }
  const expectedDigest = Buffer.from(currentDigest);
  if (!timingSafeEqual(candidateDigest, expectedDigest)) {
    send(response, 401, unauthorizedBody);
    return;
  }

  try {
    const exposition = await options.renderMetrics();
    send(response, 200, exposition, contentType);
  } catch {
    send(response, 500, unavailableBody);
  }
}

/** Side-effect-free construction of the dedicated internal metrics listener. */
export function createMetricsListener(
  options: MetricsListenerOptions,
  contentType = "text/plain; version=0.0.4; charset=utf-8",
): MetricsListener {
  if (
    options.testPort !== undefined &&
    (!Number.isInteger(options.testPort) ||
      options.testPort < 0 ||
      options.testPort > 65535)
  ) {
    throw new TypeError("Invalid test metrics listener port");
  }

  const port = options.testPort ?? METRICS_LISTENER_MANIFEST.port;
  let server: Server | undefined;
  let starting: Promise<void> | undefined;

  return {
    start() {
      if (server?.listening) return Promise.resolve();
      if (starting) return starting;

      const candidate = createServer(
        { joinDuplicateHeaders: true },
        (request, response) => {
          void handleRequest(request, response, options, contentType).catch(
            () => {
              if (!response.headersSent) send(response, 500, unavailableBody);
              else response.destroy();
            },
          );
        },
      );
      server = candidate;
      starting = new Promise<void>((resolve, reject) => {
        const onListening = () => {
          candidate.off("error", onError);
          resolve();
        };
        const onError = (error: Error) => {
          candidate.off("listening", onListening);
          candidate.close(() => undefined);
          server = undefined;
          starting = undefined;
          reject(error);
        };
        candidate.once("error", onError);
        candidate.once("listening", onListening);
        candidate.listen(port, "0.0.0.0");
      }).finally(() => {
        starting = undefined;
      });
      return starting;
    },
    async stop() {
      if (starting) {
        try {
          await starting;
        } catch {
          return;
        }
      }
      const current = server;
      if (!current?.listening) return;
      await new Promise<void>((resolve, reject) => {
        current.close((error) => (error ? reject(error) : resolve()));
      });
      server = undefined;
    },
  };
}
