/**
 * Issue #28 (attachments.md, AT-2/AT-14) -- `magic-bytes.ts`'s signature checks. A
 * required-review finding (2026-09-27) live-reproduced a fail-open default: any MIME
 * type without a registered signature was accepted unconditionally, so a declared MIME
 * with no signature (e.g. `application/msword`, `application/octet-stream`,
 * `image/tiff`) let a disguised executable through. These tests cover: a real signature
 * for each newly-added type, a mismatched/garbage signature rejected for each, the
 * disguised-executable regression, and the disclosed no-signature-check exception for
 * plain-text MIME types.
 */
import { describe, expect, it } from "vitest";
import { magicBytesMatchDeclaredMime } from "../../../apps/api/src/attachment/magic-bytes";

const GARBAGE = Buffer.from("this is definitely not the right format");
// Windows PE header ("MZ") -- the disguised-executable attack the review reproduced.
const PE_HEADER = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

const TIFF_LE = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0]);
const TIFF_BE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0]);
const OLE_HEADER = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0,
]);
const RTF_HEADER = Buffer.from("{\\rtf1\\ansi", "ascii");
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const HEIC_HEADER = Buffer.concat([
  Buffer.alloc(4),
  Buffer.from("ftyp", "ascii"),
  Buffer.from("heic", "ascii"),
]);
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe("magicBytesMatchDeclaredMime", () => {
  it("PNG: real signature passes, garbage bytes rejected (control case)", () => {
    expect(magicBytesMatchDeclaredMime(PNG_HEADER, "image/png")).toBe(true);
    expect(magicBytesMatchDeclaredMime(GARBAGE, "image/png")).toBe(false);
  });

  it("TIFF: little-endian and big-endian signatures pass, garbage rejected", () => {
    expect(magicBytesMatchDeclaredMime(TIFF_LE, "image/tiff")).toBe(true);
    expect(magicBytesMatchDeclaredMime(TIFF_BE, "image/tiff")).toBe(true);
    expect(magicBytesMatchDeclaredMime(GARBAGE, "image/tiff")).toBe(false);
  });

  it("legacy OLE-based doc/xls/ppt: real signature passes, garbage rejected", () => {
    for (const mime of [
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
    ]) {
      expect(magicBytesMatchDeclaredMime(OLE_HEADER, mime)).toBe(true);
      expect(magicBytesMatchDeclaredMime(GARBAGE, mime)).toBe(false);
    }
  });

  it("RTF: real signature passes, garbage rejected", () => {
    expect(magicBytesMatchDeclaredMime(RTF_HEADER, "application/rtf")).toBe(
      true,
    );
    expect(magicBytesMatchDeclaredMime(GARBAGE, "application/rtf")).toBe(false);
  });

  it("OpenDocument formats (odt/ods/odp): zip signature passes, garbage rejected", () => {
    for (const mime of [
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.oasis.opendocument.presentation",
    ]) {
      expect(magicBytesMatchDeclaredMime(ZIP_HEADER, mime)).toBe(true);
      expect(magicBytesMatchDeclaredMime(GARBAGE, mime)).toBe(false);
    }
  });

  it("HEIC/HEIF: real ISO-BMFF ftyp box passes, garbage rejected", () => {
    for (const mime of ["image/heic", "image/heif"]) {
      expect(magicBytesMatchDeclaredMime(HEIC_HEADER, mime)).toBe(true);
      expect(magicBytesMatchDeclaredMime(GARBAGE, mime)).toBe(false);
    }
  });

  it("plain-text MIME types (disclosed exception): accepted without any signature check", () => {
    for (const mime of [
      "text/plain",
      "text/csv",
      "text/markdown",
      "application/json",
    ]) {
      expect(magicBytesMatchDeclaredMime(GARBAGE, mime)).toBe(true);
      expect(magicBytesMatchDeclaredMime(PE_HEADER, mime)).toBe(true);
    }
  });

  it("disguised-executable regression: a PE header declared as a previously-vulnerable MIME is now rejected", () => {
    for (const mime of [
      "application/msword",
      "application/octet-stream",
      "image/tiff",
      "application/rtf",
      "application/vnd.oasis.opendocument.text",
      "image/heic",
    ]) {
      expect(magicBytesMatchDeclaredMime(PE_HEADER, mime)).toBe(false);
    }
  });

  it("fail-closed default: an unrecognized MIME with no registered signature is rejected, not silently allowed", () => {
    expect(
      magicBytesMatchDeclaredMime(PNG_HEADER, "application/octet-stream"),
    ).toBe(false);
    expect(
      magicBytesMatchDeclaredMime(GARBAGE, "application/x-totally-unknown"),
    ).toBe(false);
  });
});
