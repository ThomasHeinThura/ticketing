import { BlockList, isIP } from "node:net";

/**
 * AK-4: optional per-key IP allowlist of addresses and CIDR ranges (IPv4 and IPv6).
 * Entries are normalised before storage (`inet[]` rejects anything else); matching uses the
 * client address derived by `utils/resolve-client-ip.ts` — never a forwarding header read here.
 */

const MAX_ENTRIES = 50;

export class IpAllowlistError extends Error {
  constructor(readonly entry: string) {
    super(`invalid_ip_allowlist_entry: ${JSON.stringify(entry).slice(0, 80)}`);
    this.name = "IpAllowlistError";
  }
}

type ParsedEntry = { address: string; prefix: number; family: "ipv4" | "ipv6" };

function parseEntry(raw: string): ParsedEntry {
  const entry = raw.trim();
  const [address, prefixText, ...rest] = entry.split("/");
  const version = address ? isIP(address) : 0;
  if (rest.length > 0 || version === 0 || !address)
    throw new IpAllowlistError(entry);
  const family = version === 4 ? "ipv4" : "ipv6";
  const max = version === 4 ? 32 : 128;
  let prefix = max;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText)) throw new IpAllowlistError(entry);
    prefix = Number(prefixText);
    if (prefix > max) throw new IpAllowlistError(entry);
  }
  return { address, prefix, family };
}

/** Validates and normalises entries; an empty list means "no allowlist". */
export function normalizeIpAllowlist(
  entries: readonly string[] | undefined | null,
): string[] | null {
  if (!entries || entries.length === 0) return null;
  if (entries.length > MAX_ENTRIES)
    throw new IpAllowlistError("too many entries");
  return [
    ...new Set(
      entries.map((raw) => {
        const parsed = parseEntry(raw);
        return parsed.prefix === (parsed.family === "ipv4" ? 32 : 128)
          ? parsed.address
          : `${parsed.address}/${parsed.prefix}`;
      }),
    ),
  ];
}

/**
 * True when the client address is allowed. No allowlist means allowed; a missing or
 * unparsable client address with an allowlist present is refused (fail closed).
 */
export function isClientIpAllowed(
  allowlist: readonly string[] | null | undefined,
  clientIp: string | null | undefined,
): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  if (!clientIp) return false;
  const family = isIP(clientIp);
  if (family === 0) return false;
  const list = new BlockList();
  for (const stored of allowlist) {
    let parsed: ParsedEntry;
    try {
      parsed = parseEntry(stored);
    } catch {
      continue;
    }
    if (parsed.prefix === (parsed.family === "ipv4" ? 32 : 128))
      list.addAddress(parsed.address, parsed.family);
    else list.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }
  return list.check(clientIp, family === 4 ? "ipv4" : "ipv6");
}
