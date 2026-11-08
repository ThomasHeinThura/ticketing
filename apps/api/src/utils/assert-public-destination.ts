import { lookup } from "node:dns/promises";
import net from "node:net";

function isDisallowedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return true;
  }

  const [a, b, c] = parts as [number, number, number, number];

  return (
    a === 0 ||
    a === 10 ||
    a >= 224 ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF and TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    (a === 198 && (b === 18 || b === 19)) ||
    a === 127 ||
    // 100.64.0.0/10, RFC 6598. Several hosted Kubernetes offerings put pod
    // and service networks in here, where it reaches the same neighbours
    // 10/8 does on a plain VPC.
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

// Expands any valid IPv6 text form (compressed, zero-padded, mixed dotted tail)
// into eight 16-bit groups, so every spelling of one address is classified the
// same way. Returns null when the text cannot be parsed; callers deny those.
function ipv6Groups(ip: string): number[] | null {
  // Zone identifiers (fe80::1%eth0) only make sense for link-local targets.
  const text = ip.split("%")[0] ?? "";
  let tail: number[] = [];
  let head = text;
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1] !== undefined && dotted[2] !== undefined) {
    const parts = dotted[2].split(".");
    if (!parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part))) return null;
    const octets = parts.map((part) => Number.parseInt(part, 10));
    if (octets.some((octet) => octet > 255)) return null;
    const [o1, o2, o3, o4] = octets as [number, number, number, number];
    tail = [(o1 << 8) | o2, (o3 << 8) | o4];
    head = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }

  const halves = head.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const texts = part.split(":");
    if (!texts.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
    return texts.map((group) => Number.parseInt(group, 16));
  };
  const left = toGroups(halves[0] ?? "");
  const right = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (left === null || right === null) return null;

  const known = [...left, ...right, ...tail];
  if (halves.length === 1) {
    return known.length === 8 ? known : null;
  }
  const missing = 8 - known.length;
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right, ...tail];
}

function embeddedIpv4(groups: number[]): string {
  const [g6, g7] = [groups[6] ?? 0, groups[7] ?? 0];
  return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
}

function isDisallowedIpv6(ip: string): boolean {
  const groups = ipv6Groups(ip.toLowerCase());
  if (groups === null) return true;

  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;

  // ::ffff:0:0/96 (mapped) carries an IPv4 destination; so does the
  // ::ffff:0:0:0/96 translated range. Every other address in ::/96 is
  // unspecified, loopback or the deprecated compatible form: refuse it.
  if (groups.slice(0, 5).every((group) => group === 0)) {
    return groups[5] === 0xffff ? isDisallowedIpv4(embeddedIpv4(groups)) : true;
  }
  if (
    groups.slice(0, 4).every((group) => group === 0) &&
    groups[4] === 0xffff &&
    groups[5] === 0
  ) {
    return isDisallowedIpv4(embeddedIpv4(groups));
  }

  // Deny by default: only global unicast 2000::/3 can be a public destination.
  // That leaves out unique local, link local, site local, multicast, NAT64
  // (64:ff9b::/32) and the discard prefix.
  if ((first & 0xe000) !== 0x2000) return true;

  return (
    (first === 0x2001 && second < 0x200) || // 2001::/23 protocol assignments, Teredo
    (first === 0x2001 && second === 0xdb8) || // documentation
    first === 0x2002 || // 6to4 can tunnel to any embedded IPv4
    (first === 0x3fff && second < 0x1000) // documentation
  );
}

export function isDisallowedAddress(address: string): boolean {
  // URL.hostname keeps the brackets on IPv6 literals, and net.isIP rejects
  // those, which would let http://[::1] slip past the checks below.
  const bare = address.replace(/^\[|\]$/g, "");

  if (bare === "localhost") {
    return true;
  }

  const version = net.isIP(bare);
  if (version === 4) {
    return isDisallowedIpv4(bare);
  }

  if (version === 6) {
    return isDisallowedIpv6(bare);
  }

  return false;
}

function developmentRelaxationActive(): boolean {
  return process.env.NODE_ENV === "development";
}

function privateDestinationsAllowed(): boolean {
  return (
    developmentRelaxationActive() &&
    (process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS === "true" ||
      process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS === "1")
  );
}

/** The only URL schemes this codebase ever treats as a destination worth following --
 * exported so a caller that only needs the scheme check (no DNS/SSRF resolution, e.g. a
 * stored link that is never fetched server-side) can reuse the same allowlist rather
 * than duplicating it. */
export const ALLOWED_URL_PROTOCOLS = ["http:", "https:"] as const;

export async function assertPublicDestination(
  destinationUrl: string,
  label: string,
): Promise<void> {
  const url = new URL(destinationUrl);

  const relaxed = developmentRelaxationActive();
  if (url.username !== "" || url.password !== "") {
    throw new Error(`${label} URL must not contain credentials`);
  }
  if (!(ALLOWED_URL_PROTOCOLS as readonly string[]).includes(url.protocol)) {
    throw new Error(`${label} URL must use http or https`);
  }
  if (url.protocol !== "https:" && !(relaxed && url.protocol === "http:")) {
    throw new Error(`${label} URL must use https`);
  }

  if (privateDestinationsAllowed()) {
    return;
  }

  if (isDisallowedAddress(url.hostname)) {
    throw new Error(`${label} destination resolves to a non-routable address`);
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`${label} destination could not be resolved`);
  }

  if (addresses.some((entry) => isDisallowedAddress(entry.address))) {
    throw new Error(`${label} destination resolves to a non-routable address`);
  }
}

/**
 * Outbound webhook destination guard.
 *
 * This lived in `plugins/generic-webhook/config.ts` — a directory issue #6
 * deletes — while two retained modules imported it:
 * `notification-preferences/delivery.ts` and `.../service.ts`, which validate
 * user-supplied ntfy, Gotify and webhook URLs. Deleting the plugin directory
 * first would have broken the build, and the quickest way to make the build
 * green again is to drop the call — silently removing the only SSRF check on
 * those URLs. Moving it here first makes that mistake impossible.
 */
export async function assertPublicWebhookDestination(
  webhookUrl: string,
): Promise<void> {
  await assertPublicDestination(webhookUrl, "Generic webhook");
}
