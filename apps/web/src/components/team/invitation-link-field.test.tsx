import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InvitationLinkField from "./invitation-link-field";

const httpError = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

const copyToClipboard = vi.fn();
const copyWorkspaceInvitationLink = vi.fn();
const success = vi.fn();
const error = vi.fn();

vi.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

vi.mock("@/fetchers/workspace/copy-workspace-invitation-link", () => ({
  copyWorkspaceInvitationLink: (...args: unknown[]) =>
    copyWorkspaceInvitationLink(...args),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InvitationLinkField", () => {
  it("keeps the input blank until the server approves the copy request, then reveals and copies the server-returned link", async () => {
    const serverLink =
      "https://agent.example.test/invitation/accept/inv-1?from=server";
    copyWorkspaceInvitationLink.mockResolvedValue({
      link: serverLink,
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    copyToClipboard.mockResolvedValue(true);

    render(<InvitationLinkField workspaceId="ws-1" invitationId="inv-1" />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toHaveValue("");
    expect(copyWorkspaceInvitationLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(copyWorkspaceInvitationLink).toHaveBeenCalledWith("ws-1", "inv-1"),
    );
    await waitFor(() =>
      expect(copyToClipboard).toHaveBeenCalledWith(serverLink),
    );
    expect(input).toHaveValue(serverLink);
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:invitations.linkCopied"),
    );
    expect(screen.getByRole("button")).toHaveTextContent(
      "team:invitations.linkCopied",
    );
  });

  it("reveals and selects the server-returned link in the input when automatic clipboard write fails", async () => {
    const serverLink = "https://agent.example.test/invitation/accept/inv-2";
    copyWorkspaceInvitationLink.mockResolvedValue({
      link: serverLink,
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    copyToClipboard.mockResolvedValue(false);

    render(<InvitationLinkField workspaceId="ws-1" invitationId="inv-2" />);

    fireEvent.click(screen.getByRole("button"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("team:invitations.copyFailed"),
    );
    expect(input).toHaveValue(serverLink);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(serverLink.length);
  });

  it.each([
    [
      "403 forbidden",
      httpError("Insufficient permissions", 403),
      "team:invitations.copyErrorForbidden",
    ],
    [
      "409 expired or inactive",
      httpError("Invitation expired", 409),
      "team:invitations.copyErrorInactive",
    ],
    [
      "429 rate limited",
      httpError("Too many requests", 429),
      "team:invitations.copyErrorRateLimited",
    ],
    [
      "500 audit or server failure",
      httpError("Audit write failed", 500),
      "team:invitations.copyRequestFailed",
    ],
  ])(
    "copies nothing, reveals nothing, and shows a translated error on %s",
    async (_label, rejection, expectedKey) => {
      copyWorkspaceInvitationLink.mockRejectedValue(rejection);

      render(<InvitationLinkField workspaceId="ws-1" invitationId="inv-err" />);

      fireEvent.click(screen.getByRole("button"));

      await waitFor(() => expect(error).toHaveBeenCalledWith(expectedKey));
      expect(copyToClipboard).not.toHaveBeenCalled();
      expect(success).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox")).toHaveValue("");
    },
  );

  it("clears a previously revealed link when a later server check is refused", async () => {
    copyWorkspaceInvitationLink
      .mockResolvedValueOnce({
        link: "https://agent.example.test/invitation/accept/inv-1",
      })
      .mockRejectedValueOnce(httpError("Forbidden", 403));
    copyToClipboard.mockResolvedValue(true);
    render(<InvitationLinkField workspaceId="ws-1" invitationId="inv-1" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("textbox")).not.toHaveValue(""),
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("team:invitations.copyErrorForbidden"),
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
  });
});
