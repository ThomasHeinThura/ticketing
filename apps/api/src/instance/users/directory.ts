import { createHash } from "node:crypto";

export type UserDirectoryFilters = {
  q?: string;
  side?: "staff" | "customer";
  active?: boolean;
  organisationId?: string;
};

export type UserDirectoryCursor = {
  createdAt: Date;
  id: string;
};

type EncodedCursor = {
  version: 1;
  createdAt: string;
  id: string;
  query: string;
};

export function normalizeUserDirectoryFilters(
  filters: UserDirectoryFilters,
): UserDirectoryFilters {
  const q = filters.q?.trim();
  return {
    ...(q ? { q } : {}),
    ...(filters.side ? { side: filters.side } : {}),
    ...(filters.active !== undefined ? { active: filters.active } : {}),
    ...(filters.organisationId
      ? { organisationId: filters.organisationId }
      : {}),
  };
}

function queryFingerprint(filters: UserDirectoryFilters): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeUserDirectoryFilters(filters)))
    .digest("base64url");
}

export function encodeUserDirectoryCursor(
  cursor: UserDirectoryCursor,
  filters: UserDirectoryFilters,
): string {
  const encoded: EncodedCursor = {
    version: 1,
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
    query: queryFingerprint(filters),
  };
  return Buffer.from(JSON.stringify(encoded), "utf8").toString("base64url");
}

export function decodeUserDirectoryCursor(
  value: string,
  filters: UserDirectoryFilters,
): UserDirectoryCursor | null {
  if (!value || value.length > 2048 || !/^[\w-]+$/u.test(value)) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<EncodedCursor>;
    if (
      Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url") !==
      value
    ) {
      return null;
    }
    const keys = Object.keys(decoded).sort();
    if (keys.join(",") !== "createdAt,id,query,version") return null;
    if (
      decoded.version !== 1 ||
      typeof decoded.createdAt !== "string" ||
      typeof decoded.id !== "string" ||
      !decoded.id ||
      typeof decoded.query !== "string" ||
      decoded.query !== queryFingerprint(filters)
    ) {
      return null;
    }
    const createdAt = new Date(decoded.createdAt);
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== decoded.createdAt
    ) {
      return null;
    }
    return { createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

export function escapeIlikeSubstring(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

export function isCurrentlySuspended(
  banned: boolean | null,
  banExpires: Date | null,
  now: Date,
): boolean {
  return banned === true && (banExpires === null || banExpires > now);
}
