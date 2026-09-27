/**
 * A minimal magic-byte sniffer for `attachments.md`'s AT-2/AT-14 edge case: "Declared
 * MIME does not match magic bytes | Rejected at `complete`; the object is deleted." No
 * dependency is added for this (ponytail: this codebase has no `file-type`-style package
 * already installed, and the signature set below is a handful of comparisons, not a
 * library-sized problem) -- covers the formats with a strong, well-known signature.
 *
 * Deliberately NOT exhaustive: plain-text formats (`txt`, `csv`, `md`, `json`, `log`)
 * have no reliable magic bytes at all, so a declared MIME in that family is accepted
 * without a byte check here (there is nothing meaningful to sniff) -- flagged in the PR
 * body as a real, disclosed limitation, not a silent gap.
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
  "application/pdf": [{ bytes: [0x25, 0x50, 0x44, 0x46] }],
  // Office Open XML formats (docx/xlsx/pptx) and plain zip are all a PK zip container;
  // this only confirms "is a zip", not the specific office subtype.
  "application/zip": [{ bytes: [0x50, 0x4b, 0x03, 0x04] }],
};

const ZIP_BASED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
]);

function matchesSignature(buffer: Buffer, signature: Signature): boolean {
  const offset = signature.offset ?? 0;
  if (buffer.length < offset + signature.bytes.length) return false;
  return signature.bytes.every(
    (byte, index) => buffer[offset + index] === byte,
  );
}

/**
 * `true` when `declaredMimeType` has no known signature here (nothing to check, so
 * nothing is rejected), or when the buffer's leading bytes match one of the
 * signatures known for it. `false` -- the AT-14 rejection case -- only when the MIME
 * IS one this module knows how to sniff and the bytes genuinely disagree.
 */
export function magicBytesMatchDeclaredMime(
  buffer: Buffer,
  declaredMimeType: string,
): boolean {
  const mime = declaredMimeType.toLowerCase().split(";")[0]?.trim() ?? "";

  if (ZIP_BASED_MIME_TYPES.has(mime)) {
    const zipSignatures = SIGNATURES["application/zip"];
    return zipSignatures
      ? zipSignatures.some((signature) => matchesSignature(buffer, signature))
      : true;
  }

  const signatures = SIGNATURES[mime];
  if (!signatures) return true;
  return signatures.some((signature) => matchesSignature(buffer, signature));
}
