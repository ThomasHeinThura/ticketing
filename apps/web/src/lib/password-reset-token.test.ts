import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capturePasswordResetToken,
  clearPasswordResetToken,
  readPasswordResetToken,
} from "./password-reset-token";

afterEach(() => {
  clearPasswordResetToken();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe.each(["/auth/reset-password", "/reset-password"])(
  "%s token capture",
  (path) => {
    it("replaces the history entry and preserves unrelated URL state", () => {
      window.history.replaceState(
        { key: "value" },
        "",
        `${path}?other=1#token=secret&section=keep`,
      );
      capturePasswordResetToken();
      expect(readPasswordResetToken()).toBe("secret");
      expect(window.location.pathname).toBe(path);
      expect(window.location.search).toBe("?other=1");
      expect(window.location.hash).toBe("#section=keep");
      expect(window.history.state).toEqual({ key: "value" });
      clearPasswordResetToken();
      expect(readPasswordResetToken()).toBe("");
    });
    it("discards duplicate token parameters", () => {
      window.history.replaceState({}, "", `${path}#token=first&token=second`);
      capturePasswordResetToken();
      expect(readPasswordResetToken()).toBe("");
      expect(window.location.search).toBe("");
    });
    it("removes legacy query tokens and rejects mixed duplicates", () => {
      window.history.replaceState({}, "", `${path}?token=old#section`);
      capturePasswordResetToken();
      expect(readPasswordResetToken()).toBe("old");
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("#section");
      clearPasswordResetToken();
      window.history.replaceState({}, "", `${path}?token=old#token=new`);
      capturePasswordResetToken();
      expect(readPasswordResetToken()).toBe("");
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("");
    });
    it("fails closed when the URL cannot be replaced", () => {
      window.history.replaceState({}, "", `${path}#token=secret`);
      vi.spyOn(window.history, "replaceState").mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(() => capturePasswordResetToken()).toThrow("blocked");
      expect(readPasswordResetToken()).toBe("");
    });
  },
);
