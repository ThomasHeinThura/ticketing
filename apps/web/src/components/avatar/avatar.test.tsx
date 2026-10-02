import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avatar, AvatarFallback, AvatarImage } from "./index";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("avatar application adapter", () => {
  it("resolves uploaded avatar URLs while preserving the shared image API", () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    vi.stubGlobal(
      "Image",
      class {
        complete = true;
        naturalWidth = 64;
        src = "";
      },
    );

    render(
      <Avatar>
        <AvatarImage alt="Thomas Hein Thura" src="/api/user/avatar/abc123" />
        <AvatarFallback>TH</AvatarFallback>
      </Avatar>,
    );

    expect(
      screen.getByRole("img", { name: "Thomas Hein Thura" }),
    ).toHaveAttribute("src", "https://api.example.com/api/user/avatar/abc123");
  });
});
