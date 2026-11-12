import { afterEach, expect, it, vi } from "vitest";
import { portalAuthClient } from "./portal-auth-client";
import { signInRefusalKey } from "./sign-in-refusal";

afterEach(() => vi.unstubAllGlobals());

it("preserves the server refusal code for translated wrong-portal guidance", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "USE_AGENT_SIGN_IN",
          message: "Use agent sign-in",
        }),
        { status: 403 },
      ),
    ),
  );
  const result = await portalAuthClient.signIn.email({
    email: "staff@example.test",
    password: "test",
  });
  expect(result.error?.status).toBe(403);
  expect(signInRefusalKey(result.error)).toBe(
    "auth:wrongPortal.useAgentSignIn",
  );
});
