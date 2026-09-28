/**
 * A minimal magic-byte sniffer for `attachments.md`'s AT-2/AT-14 edge case: "Declared
 * MIME does not match magic bytes | Rejected at `complete`; the object is deleted." No
 * dependency is added for this (ponytail: this codebase has no `file-type`-style package
 * already installed, and the signature set below is a handful of comparisons, not a
 * library-sized problem) -- covers every allowed extension except plain text.
 *
 * Deliberately NOT exhaustive for exactly one family: plain-text formats (`txt`, `csv`,
 * `md`, `json`, `log`) have no reliable magic bytes at all, so those specific declared
 * MIME types are accepted without a byte check via the explicit
 * `NO_SIGNATURE_CHECK_MIME_TYPES` allowlist below (there is nothing meaningful to sniff)
 * -- flagged in the PR body as a real, disclosed limitation, not a silent gap. Every
 * other MIME type either has a real signature check or is rejected by default.
 */

type Signature = { bytes: number[]; offset?: number };

const SIGNATURES: Record<string, Signature[]> = {
  "image/png": [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  "image/jpeg": [{ bytes: [0xff, 0xd8, 0xff] }],
  "image/gif": [
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
  ],
  "image/webp": [{ bytes: [0x52, 0x49, 0x46, 0x46] }],
  "image/bmp": [{ bytes: [0x42, 0x4d] }],
  "image/tiff": [
    { bytes: [0x49, 0x49, 0x2a, 0x00] }, // little-endian ("II")
    { bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // big-endian ("MM")
  ],
  // ISO base media file format's "ftyp" box at a fixed offset -- same "confirms the
  // container family, not the exact subtype" heuristic already accepted for zip below.
  // Real HEIC/HEIF-specific brand codes (heic/heix/mif1/...) live right after this at
  // offset 8, but checking the box marker alone is enough to reject the disguised-
  // executable class this module exists to catch, without hard-coding every current and
  // future brand string.
  "image/heic": [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }],
  "image/heif": [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }],
  "application/pdf": [{ bytes: [0x25, 0x50, 0x44, 0x46] }],
  "application/rtf": [
    { bytes: [0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31] }, // "{\rtf1"
  ],
  // Old-format OLE Compound File Binary -- shared by legacy .doc/.xls/.ppt.
  "application/msword": [
    { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ],
  "application/vnd.ms-excel": [
    { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ],
  "application/vnd.ms-powerpoint": [
    { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ],
  // Office Open XML formats (docx/xlsx/pptx), OpenDocument formats (odt/ods/odp) and
  // plain zip are all a PK zip container; this only confirms "is a zip", not the
  // specific subtype.
  "application/zip": [{ bytes: [0x50, 0x4b, 0x03, 0x04] }],
};

const ZIP_BASED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/zip",
]);

// Plain-text formats (txt/csv/md/json/log) have no reliable magic bytes by design --
// this is the ONLY set still allowed through without a signature check; everything else
// with no registered signature is rejected (fail-closed), not silently allowed.
// (`.log` has no standard MIME registration of its own -- browsers and OSes declare it
// as `text/plain`, same as `.txt`, so no separate entry is needed for it.)
const NO_SIGNATURE_CHECK_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
]);

/**
 * B1 security-review fix (2026-09-27): the declared `contentType` was never checked
 * against the file's own EXTENSION at presign time -- so declaring any of the four
 * `NO_SIGNATURE_CHECK_MIME_TYPES` (which skip the magic-byte check entirely, by design,
 * since plain text has no reliable magic bytes) let a caller attach that no-check MIME
 * family to ANY allowed extension, including `.doc`/`.tiff`/etc, and have a disguised
 * executable pass straight through regardless of the real bytes. Every extension
 * `presign-attachment.ts`'s own `FALLBACK_ALLOWED_EXTENSIONS` names is mapped here to the
 * one (or few) MIME type(s) that extension may legitimately declare; a declared
 * `contentType` outside that set is rejected before a `pending` row is even created --
 * fail closed the same way `magicBytesMatchDeclaredMime`'s own default now does.
 */
export const EXTENSION_MIME_TYPES: Record<string, readonly string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  heic: ["image/heic"],
  heif: ["image/heif"],
  bmp: ["image/bmp"],
  tiff: ["image/tiff"],
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  odt: ["application/vnd.oasis.opendocument.text"],
  ods: ["application/vnd.oasis.opendocument.spreadsheet"],
  odp: ["application/vnd.oasis.opendocument.presentation"],
  txt: ["text/plain"],
  csv: ["text/csv"],
  md: ["text/markdown"],
  json: ["application/json"],
  log: ["text/plain"],
  rtf: ["application/rtf"],
};

/**
 * `true` only when `declaredMimeType` is one of the MIME types this extension is actually
 * allowed to declare. An extension with no entry here at all (reachable only if a God
 * Mode admin adds an extension this table does not know about to `attachment_allowed_
 * extensions`) fails closed -- `false`, not "skip the check" -- same reasoning as
 * `magicBytesMatchDeclaredMime`'s own unregistered-signature default.
 */
export function isMimeTypeAllowedForExtension(
  extension: string,
  declaredMimeType: string,
): boolean {
  const mime = declaredMimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  const allowed = EXTENSION_MIME_TYPES[extension.toLowerCase()];
  if (!allowed) return false;
  return allowed.includes(mime);
}

function matchesSignature(buffer: Buffer, signature: Signature): boolean {
  const offset = signature.offset ?? 0;
  if (buffer.length < offset + signature.bytes.length) return false;
  return signature.bytes.every(
    (byte, index) => buffer[offset + index] === byte,
  );
}

/**
 * `true` when `declaredMimeType` is one of the explicit no-signature plain-text types
 * (nothing meaningful to sniff, so nothing is rejected), or when the buffer's leading
 * bytes match one of the signatures known for it. `false` when the MIME either has a
 * known signature the bytes genuinely disagree with (the AT-14 rejection case), OR when
 * the MIME has no registered signature and isn't in the plain-text allowlist -- fail
 * closed rather than silently accept an unrecognized type.
 */
export function magicBytesMatchDeclaredMime(
  buffer: Buffer,
  declaredMimeType: string,
): boolean {
  const mime = declaredMimeType.toLowerCase().split(";")[0]?.trim() ?? "";

  if (NO_SIGNATURE_CHECK_MIME_TYPES.has(mime)) return true;

  if (ZIP_BASED_MIME_TYPES.has(mime)) {
    const zipSignatures = SIGNATURES["application/zip"];
    return zipSignatures
      ? zipSignatures.some((signature) => matchesSignature(buffer, signature))
      : false;
  }

  const signatures = SIGNATURES[mime];
  if (!signatures) return false;
  return signatures.some((signature) => matchesSignature(buffer, signature));
}
