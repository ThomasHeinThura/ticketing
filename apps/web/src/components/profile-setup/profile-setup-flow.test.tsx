import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProfileSetupFlow } from "./profile-setup-flow";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/common/logo", () => ({ Logo: () => null }));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { name: "Agent" } }),
}));
vi.mock("@/hooks/mutations/use-update-user-profile", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);
it("does not read computed styles while rendering the motion transition", () => {
  const computedStyle = vi.spyOn(window, "getComputedStyle");
  try {
    render(<ProfileSetupFlow />);
    expect(computedStyle).not.toHaveBeenCalled();
  } finally {
    computedStyle.mockRestore();
  }
});
