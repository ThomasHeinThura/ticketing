import { isIP } from "node:net";

/** Nonsecret origins only; never a signed URL, endpoint path or credential. */
export function browserStorageOrigins(config: {
  endpoint: string;
  bucket: string;
  forcePathStyle: boolean;
}): string[] {
  const endpoint = new URL(config.endpoint);
  if (
    !["https:", "http:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("Storage browser origin is invalid");
  }
  const origins = [endpoint.origin];
  // The SDK may choose path addressing for IPs or dotted HTTPS buckets. Keep
  // the endpoint plus only the configured bucket's possible virtual host.
  if (
    !config.forcePathStyle &&
    !isIP(endpoint.hostname.replace(/^\[|\]$/g, "")) &&
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)
  ) {
    const virtualHost = new URL(endpoint.origin);
    virtualHost.hostname = `${config.bucket}.${endpoint.hostname}`;
    origins.push(virtualHost.origin);
  }
  return [...new Set(origins)];
}
