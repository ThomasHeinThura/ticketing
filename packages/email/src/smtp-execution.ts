import { createHash } from "node:crypto";
import net, { type Socket } from "node:net";
import tls from "node:tls";
import * as nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export type SmtpSocket = { socket: Socket; secured: boolean };
export type SmtpConfiguration = {
  options: SMTPTransport.Options;
  from: string;
  replyTo?: string;
  /** Provider policy supplies an IP-pinned, egress-checked connection. Bootstrap preserves its historical transport configuration. */
  connect?: (signal: AbortSignal) => Promise<SmtpSocket>;
};
export type RuntimeSmtpResolver = () => Promise<SmtpConfiguration | null>;
let runtimeResolver: RuntimeSmtpResolver | undefined;
let bootstrapResolver: (() => SmtpConfiguration | null) | undefined;
/** Internal initialization seam: the public entry installs the inherited bootstrap reader. */
export function setBootstrapSmtpConfigurationResolver(
  resolver: () => SmtpConfiguration | null,
): void {
  bootstrapResolver = resolver;
}
/** Install a resolver, not a cached configuration: runtime choices apply to every attempt. */
export function setRuntimeSmtpResolver(
  resolver: RuntimeSmtpResolver | undefined,
): void {
  runtimeResolver = resolver;
}
export function bootstrapSmtpConfiguration(): SmtpConfiguration | null {
  return bootstrapResolver?.() ?? null;
}
export async function resolveSmtpConfiguration(): Promise<SmtpConfiguration | null> {
  // A configured resolver's null/error is authoritative. Never catch and fall back to env.
  return runtimeResolver ? runtimeResolver() : bootstrapSmtpConfiguration();
}
/**
 * The server's own answer to a failed attempt, kept only in a sanitised form: the three-digit
 * reply code, the failing command's fixed verb and the reply text with addresses, host names,
 * IP addresses, key identifiers and long tokens removed. Free-form text is omitted entirely
 * when authentication is configured, because replies may echo credential fragments. It is
 * attached only when the caller asks for it (`includeReply`), which today is the God Mode test
 * send; delivery paths never carry it.
 */
export type SmtpReply = {
  code: number | null;
  command: string | null;
  text: string | null;
};

export class SmtpAttemptError extends Error {
  constructor(
    readonly kind:
      | "unavailable"
      | "aborted"
      | "deadline"
      | "failed"
      | "rejected",
    readonly ambiguous = false,
    readonly diagnostic?: "authentication" | "connection" | "tls",
    readonly reply?: SmtpReply,
  ) {
    super(`SMTP attempt ${kind}`);
  }
}

type SmtpDiagnostic = "authentication" | "connection" | "tls";

const SMTP_DIAGNOSTIC_BY_CODE: Readonly<Record<string, SmtpDiagnostic>> = {
  EAUTH: "authentication",
  ECONNABORTED: "connection",
  ECONNREFUSED: "connection",
  ECONNRESET: "connection",
  ECONNERR: "connection",
  ECONNECTION: "connection",
  EHOSTUNREACH: "connection",
  ENETUNREACH: "connection",
  ENOTFOUND: "connection",
  EAI_AGAIN: "connection",
  ETIMEDOUT: "connection",
  EPIPE: "connection",
  ESOCKET: "connection",
  // nodemailer's STARTTLS upgrade failure: the underlying certificate error is not kept.
  ETLS: "tls",
  CERT_HAS_EXPIRED: "tls",
  CERT_NOT_YET_VALID: "tls",
  CERT_REVOKED: "tls",
  CERT_UNTRUSTED: "tls",
  CERT_SIGNATURE_FAILURE: "tls",
  DEPTH_ZERO_SELF_SIGNED_CERT: "tls",
  ERR_SSL_CA_MD_TOO_WEAK: "tls",
  ERR_SSL_CERTIFICATE_VERIFY_FAILED: "tls",
  ERR_SSL_EE_KEY_TOO_SMALL: "tls",
  ERR_SSL_UNSUPPORTED_PROTOCOL: "tls",
  ERR_SSL_WRONG_VERSION_NUMBER: "tls",
  ERR_TLS_CERT_ALTNAME_FORMAT: "tls",
  ERR_TLS_CERT_ALTNAME_INVALID: "tls",
  ERR_TLS_DH_PARAM_SIZE: "tls",
  ERR_TLS_HANDSHAKE_TIMEOUT: "tls",
  SELF_SIGNED_CERT_IN_CHAIN: "tls",
  UNABLE_TO_GET_ISSUER_CERT: "tls",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "tls",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls",
};

/**
 * Retain only a bounded category here. The provider's reply text leaves this module only through
 * `sanitiseSmtpReplyText`, and only when the caller asked for it (`includeReply`).
 */
function smtpDiagnostic(error: unknown): SmtpDiagnostic | undefined {
  const codes: string[] = [];
  let current: unknown = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null || seen.has(current))
      break;
    seen.add(current);
    if ("code" in current && typeof current.code === "string")
      codes.push(current.code);
    if ("errno" in current && typeof current.errno === "string")
      codes.push(current.errno);
    current = "cause" in current ? current.cause : undefined;
  }
  if (codes.includes("EAUTH")) return "authentication";
  if (codes.some((code) => SMTP_DIAGNOSTIC_BY_CODE[code] === "tls"))
    return "tls";
  if (codes.some((code) => SMTP_DIAGNOSTIC_BY_CODE[code] === "connection"))
    return "connection";
  return undefined;
}

const REPLY_TEXT_LIMIT = 200;
const REMOVED = "[removed]";

function stripControlCharacters(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : char;
  }
  return out;
}

/**
 * Makes a provider reply safe to show to an instance administrator. Removes, in this order: the
 * configured credentials and addresses verbatim, e-mail addresses, IP addresses, host names, AWS
 * key identifiers and long token-like runs; then drops the leading three-digit code, collapses
 * whitespace and bounds the length. Enhanced status codes such as `5.7.8` are kept because they
 * contain only digits. Returns null when nothing readable remains.
 */
export function sanitiseSmtpReplyText(
  text: string,
  redact: readonly (string | undefined | null)[] = [],
): string | null {
  // Reject, rather than truncate through a credential or address.
  if (text.length > 2_000) return null;
  let result = stripControlCharacters(text);
  const secrets = redact
    .filter((value): value is string => typeof value === "string")
    .map(stripControlCharacters)
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const secret of secrets) result = result.split(secret).join(REMOVED);
  result = result
    .replace(/[^\s<>"'()@,;:]+@[^\s<>"'(),;]+/gu, REMOVED)
    .replace(/\[[0-9a-fA-F:.]+\]/gu, REMOVED)
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/gu, REMOVED)
    .replace(
      /(?<![\w:])(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}(?![\w:])/gu,
      REMOVED,
    )
    .replace(
      /(?<![\w:])(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})?::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})?(?![\w:])/gu,
      REMOVED,
    )
    .replace(/\b(?:AKIA|ASIA|AIDA|AROA|ANPA)[A-Z0-9]{12,}\b/gu, REMOVED)
    .replace(/[A-Za-z0-9+/_=-]{24,}/gu, REMOVED)
    .replace(
      /\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}\b/gu,
      REMOVED,
    )
    .replace(/^\s*\d{3}[\s-]+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!result) return null;
  return result.length > REPLY_TEXT_LIMIT
    ? `${result.slice(0, REPLY_TEXT_LIMIT - 1).trimEnd()}…`
    : result;
}

/** The reply a nodemailer error carries (`responseCode`, `response`, `command`), sanitised. */
function smtpReply(
  error: unknown,
  redact: readonly (string | undefined | null)[],
  hasAuthentication: boolean,
): SmtpReply | undefined {
  let current: unknown = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null || seen.has(current))
      return undefined;
    seen.add(current);
    const response =
      "response" in current && typeof current.response === "string"
        ? current.response
        : null;
    const numeric =
      "responseCode" in current && typeof current.responseCode === "number"
        ? current.responseCode
        : null;
    const code =
      numeric !== null && Number.isInteger(numeric)
        ? numeric
        : response
          ? Number(/^(\d{3})(?!\d)/u.exec(response.trim())?.[1] ?? Number.NaN)
          : Number.NaN;
    const command =
      "command" in current &&
      typeof current.command === "string" &&
      [
        "AUTH",
        "AUTH PLAIN",
        "AUTH LOGIN",
        "AUTH XOAUTH2",
        "STARTTLS",
        "MAIL FROM",
        "RCPT TO",
        "DATA",
      ].includes(current.command)
        ? current.command
        : null;
    if (response !== null || Number.isInteger(code)) {
      const validCode = Number.isInteger(code) && code >= 200 && code <= 599;
      return {
        code: validCode ? code : null,
        command,
        // A hostile server can echo any substring or encoding of an AUTH exchange. No
        // pattern-based redactor can prove such fragments absent, so omit its free text.
        text:
          response && !hasAuthentication
            ? sanitiseSmtpReplyText(response, redact)
            : null,
      };
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/** Opens one cancellable connection; secure sockets retain normal certificate validation. */
export async function openSmtpSocket(
  input: { host: string; port: number; secure: boolean; servername?: string },
  signal: AbortSignal,
): Promise<SmtpSocket> {
  if (signal.aborted) throw new SmtpAttemptError("aborted");
  return new Promise((resolve, reject) => {
    const socket = input.secure
      ? tls.connect({
          host: input.host,
          port: input.port,
          servername: input.servername ?? input.host,
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
        })
      : net.connect({ host: input.host, port: input.port });
    const abort = () => {
      socket.destroy();
      reject(new SmtpAttemptError("aborted"));
    };
    const error = (cause: Error) => {
      signal.removeEventListener("abort", abort);
      socket.destroy();
      reject(
        new SmtpAttemptError(
          "failed",
          false,
          smtpDiagnostic(cause) ?? "connection",
        ),
      );
    };
    socket.once("error", error);
    signal.addEventListener("abort", abort, { once: true });
    socket.once(input.secure ? "secureConnect" : "connect", () => {
      signal.removeEventListener("abort", abort);
      socket.removeListener("error", error);
      // The caller immediately attaches SMTPConnection's own error listener.
      socket.on("error", () => {});
      if (signal.aborted) {
        socket.destroy();
        reject(new SmtpAttemptError("aborted"));
        return;
      }
      resolve({ socket, secured: input.secure });
    });
  });
}

type Message = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  idempotencyKey?: string;
};
/** One socket/transport per attempt. Closing a global transporter does not cancel an active SMTP send. */
export async function executeSmtp(
  config: SmtpConfiguration,
  message: Message | null,
  input: {
    signal?: AbortSignal;
    deadlineMs?: number;
    /** Attach the sanitised server reply to a failure. Only the God Mode test send asks for it. */
    includeReply?: boolean;
  } = {},
): Promise<void> {
  if (
    [config.from, config.replyTo, message?.to, message?.subject].some(
      (value) => value !== undefined && /[\r\n\0]/u.test(value),
    )
  )
    throw new SmtpAttemptError("rejected");
  const deadlineMs = input.deadlineMs ?? 25_000;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs >= 30_000)
    throw new RangeError("SMTP deadline must be positive and below 30 seconds");
  const controller = new AbortController();
  let socket: Socket | undefined;
  let sending = false;
  let reason: "aborted" | "deadline" = "aborted";
  const abort = () => {
    controller.abort();
    socket?.destroy();
  };
  if (input.signal?.aborted) throw new SmtpAttemptError("aborted");
  input.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    reason = "deadline";
    abort();
  }, deadlineMs);
  let rejectAbort: ((error: Error) => void) | undefined;
  const rejectOnAbort = () =>
    rejectAbort?.(new SmtpAttemptError(reason, sending));
  controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  try {
    const work = async () => {
      const options: SMTPTransport.Options = {
        ...config.options,
        connectionTimeout: deadlineMs,
        greetingTimeout: deadlineMs,
        socketTimeout: deadlineMs,
        tls: {
          ...config.options.tls,
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
        },
        getSocket: (_options, callback) => {
          const connect =
            config.connect ??
            ((signal: AbortSignal) =>
              openSmtpSocket(
                {
                  host: config.options.host ?? "localhost",
                  port: Number(
                    config.options.port ?? (config.options.secure ? 465 : 587),
                  ),
                  secure: config.options.secure === true,
                },
                signal,
              ));
          connect(controller.signal).then(
            (result) => {
              socket = result.socket;
              if (controller.signal.aborted) {
                socket.destroy();
                callback(new SmtpAttemptError(reason));
                return;
              }
              callback(null, { connection: socket, secured: result.secured });
            },
            (error: unknown) =>
              callback(
                error instanceof SmtpAttemptError
                  ? error
                  : new SmtpAttemptError(
                      controller.signal.aborted ? reason : "failed",
                      false,
                      smtpDiagnostic(error),
                    ),
              ),
          );
        },
      };
      const transport = nodemailer.createTransport(options);
      try {
        if (!message) {
          await transport.verify();
          return;
        }
        sending = true;
        const result = await transport.sendMail({
          from: config.from,
          ...(config.replyTo ? { replyTo: config.replyTo } : {}),
          to: message.to,
          subject: message.subject,
          ...(message.html ? { html: message.html } : {}),
          ...(message.text ? { text: message.text } : {}),
          ...(message.idempotencyKey
            ? {
                messageId: `<${createHash("sha256").update(message.idempotencyKey).digest("hex")}@taskdesk.invalid>`,
              }
            : {}),
        });
        if (result.accepted && result.accepted.length === 0)
          throw new SmtpAttemptError("rejected");
      } finally {
        transport.close?.();
      }
    };
    await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
        if (controller.signal.aborted) rejectOnAbort();
      }),
    ]);
  } catch (error) {
    if (controller.signal.aborted) throw new SmtpAttemptError(reason, sending);
    if (error instanceof SmtpAttemptError) throw error;
    // Nodemailer phase timers can expire before the outer deadline timer.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ETIMEDOUT" &&
      "timeoutType" in error &&
      (error.timeoutType === "CONNECT_TIMEOUT" ||
        error.timeoutType === "GREETING_TIMEOUT" ||
        error.timeoutType === "UPGRADE_TIMEOUT" ||
        error.timeoutType === "SOCKET_TIMEOUT")
    )
      throw new SmtpAttemptError("deadline", sending);
    // Provider errors may embed credentials, addresses or full server replies. Only the bounded
    // category propagates, plus a sanitised reply when the caller asked for one (`includeReply`).
    const auth = config.options.auth;
    throw new SmtpAttemptError(
      "failed",
      sending,
      smtpDiagnostic(error),
      input.includeReply
        ? smtpReply(
            error,
            [
              auth && "user" in auth ? auth.user : undefined,
              auth && "pass" in auth ? auth.pass : undefined,
              config.options.host,
              config.from,
              config.replyTo,
              message?.to,
            ],
            Boolean(auth),
          )
        : undefined,
    );
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectOnAbort);
    socket?.destroy();
  }
}
