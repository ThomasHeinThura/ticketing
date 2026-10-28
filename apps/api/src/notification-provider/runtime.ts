import { lookup } from "node:dns/promises";
import {
  bootstrapSmtpConfiguration,
  openSmtpSocket,
  type SmtpConfiguration,
  setRuntimeSmtpResolver,
} from "@taskdesk/email/smtp-runtime";
import { decryptIdentityClientSecret } from "../identity/client-secret";
import { isDisallowedAddress } from "../utils/assert-public-destination";
import { readEmailProvider } from "./repository";
import {
  isLocalMailpitCaptureEnabled,
  isValidMailpitCaptureConfig,
  type SmtpConfig,
  smtpConfigurationSchema,
} from "./schema";

/** No configurable bypass: notification providers cannot reach private/metadata networks. */
export function runtimeSmtpConfiguration(
  config: SmtpConfig,
  password: string | null,
  network: {
    resolve: (
      host: string,
    ) => Promise<Array<{ address: string; family: number }>>;
    connect: typeof openSmtpSocket;
  } = {
    resolve: (host) => lookup(host, { all: true, verbatim: true }),
    connect: openSmtpSocket,
  },
): SmtpConfiguration {
  if (config.captureToMailpit === true) {
    if (
      !isLocalMailpitCaptureEnabled() ||
      !isValidMailpitCaptureConfig(config) ||
      password !== null
    )
      throw new Error("SMTP configuration unavailable");
    return {
      from: config.fromAddress,
      ...(config.replyTo ? { replyTo: config.replyTo } : {}),
      options: {
        host: "mailpit",
        port: 1025,
        secure: false,
        requireTLS: false,
        ignoreTLS: true,
      },
      connect: async (signal) => {
        if (signal.aborted) throw new Error("SMTP configuration unavailable");
        return network.connect(
          { host: "mailpit", port: 1025, secure: false },
          signal,
        );
      },
    };
  }
  if (config.username && !password)
    throw new Error("SMTP credentials unavailable");
  return {
    from: config.fromAddress,
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    options: {
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTLS,
      ...(config.username
        ? { auth: { user: config.username, pass: password ?? "" } }
        : {}),
      tls: {
        servername: config.host,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      },
    },
    connect: async (signal) => {
      if (signal.aborted || isDisallowedAddress(config.host))
        throw new Error("SMTP destination unavailable");
      const addresses = await network.resolve(config.host);
      if (
        signal.aborted ||
        !addresses.length ||
        addresses.some((row) => isDisallowedAddress(row.address))
      )
        throw new Error("SMTP destination unavailable");
      const selected = addresses[0];
      if (!selected) throw new Error("SMTP destination unavailable");
      // Connect directly to this checked IP; TLS validates the original DNS name.
      return network.connect(
        {
          host: selected.address,
          port: config.port,
          secure: config.secure,
          servername: config.host,
        },
        signal,
      );
    },
  };
}
export async function resolveRuntimeSmtp(): Promise<SmtpConfiguration | null> {
  try {
    const row = await readEmailProvider();
    if (!row) return bootstrapSmtpConfiguration();
    if (
      row.scope !== "instance" ||
      row.workspaceId !== null ||
      row.portalScope !== null
    )
      throw new Error("SMTP configuration unavailable");
    if (!row.enabled) return null;
    const config = smtpConfigurationSchema.parse(row.config);
    const password = row.secrets
      ? decryptIdentityClientSecret(row.id, row.secrets)
      : null;
    return runtimeSmtpConfiguration(config, password);
  } catch {
    throw new Error("SMTP configuration unavailable");
  }
}
export function installRuntimeSmtpResolver() {
  setRuntimeSmtpResolver(resolveRuntimeSmtp);
}

/** Availability is authoritative but contains no endpoint or secret details. Read failures
 * disable dependent actions; they never re-enable environment bootstrap delivery. */
export async function isRuntimeSmtpConfigured(): Promise<boolean> {
  try {
    return (await resolveRuntimeSmtp()) !== null;
  } catch {
    return false;
  }
}
