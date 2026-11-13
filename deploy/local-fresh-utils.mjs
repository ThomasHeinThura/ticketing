import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";

export const COUNT_SQL =
  "SELECT count(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';\nSELECT format('SELECT %L AS table_name, count(*) AS row_count FROM %I.%I;', table_schema||'.'||table_name, table_schema, table_name) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name \\gexec";

const SERVICE_SHUTDOWN_ORDER = {
  traefik: 0,
  taskdesk: 1,
  mailpit: 2,
  migrate: 3,
  valkey: 4,
  postgres: 5,
};

export function orderContainersForShutdown(containers) {
  return [...containers]
    .sort((a, b) => {
      const sa =
        SERVICE_SHUTDOWN_ORDER[
          a.Config?.Labels?.["com.docker.compose.service"]
        ] ?? 3;
      const sb =
        SERVICE_SHUTDOWN_ORDER[
          b.Config?.Labels?.["com.docker.compose.service"]
        ] ?? 3;
      if (sa !== sb) return sa - sb;
      return String(a.Id).localeCompare(String(b.Id));
    })
    .map((c) => c.Id);
}

export function writeCommandOutputAtomically(file, cmd, bin, argv, input) {
  if (existsSync(file))
    throw new Error("Refusing to overwrite existing private output file.");
  const temp = `${file}.tmp`;
  if (existsSync(temp)) unlinkSync(temp);
  const fd = openSync(temp, "wx", 0o600);
  let closed = false;
  try {
    cmd(bin, argv, { input, stdio: ["pipe", fd, "pipe"] });
    fsyncSync(fd);
    closeSync(fd);
    closed = true;
    renameSync(temp, file);
    const dirFd = openSync(dirname(file), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch (error) {
    if (!closed) {
      try {
        closeSync(fd);
      } catch {}
    }
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
}

export function redactFreshText(value, { env = {}, checkout } = {}) {
  let result = String(value);
  result = result.replace(
    /postgres(?:ql)?:\/\/[^\s'"]+/gi,
    "<redacted-db-url>",
  );
  result = result.replace(
    /https?:\/\/[^\s/'":]+:[^\s/'"]+@[^\s'"]+/gi,
    "<redacted-url>",
  );
  result = result.replace(
    /(?:set-cookie|cookie)\s*:\s*[^\r\n]+/gi,
    "<redacted-cookie>",
  );
  result = result.replace(
    /\b(?:better-auth|__Secure-better-auth|taskdesk)[._-][A-Za-z0-9._-]*=[^\s;'"]+/gi,
    "<redacted-cookie>",
  );
  for (const [key, secretValue] of Object.entries(env)) {
    if (
      typeof secretValue === "string" &&
      secretValue.length >= 4 &&
      /(?:SECRET|PASSWORD|TOKEN|KEY|COOKIE|DATABASE_URL)/i.test(key)
    ) {
      result = result.replaceAll(secretValue, "<redacted-secret>");
    }
  }
  for (const [secretPath, label] of [
    [env.SIT_COMPOSE_ENV, "<private-compose-env>"],
    [env.SIT_PRIVATE_DIR, "<private-dir>"],
    [
      env.SIT_COMPOSE_ENV ? dirname(env.SIT_COMPOSE_ENV) : undefined,
      "<private-compose-dir>",
    ],
    [checkout, "<checkout>"],
    [env.NODE_EXTRA_CA_CERTS, "<private-ca-certificate>"],
  ]) {
    if (secretPath) result = result.replaceAll(secretPath, label);
  }
  result = result.replace(
    /(?<!\bunix:)(?:^|(?<=[\s'"=(:]))\/[^\s'"]+/g,
    "<private-path>",
  );
  return result;
}
