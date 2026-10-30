import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type ParsedLocation,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as AuthenticatedRoute } from "../_layout/_authenticated";
import { Route as GodModeLayoutRoute } from "../_layout/_authenticated/god-mode";
import { Route as LegacyGodModeRoute } from "../agent/god-mode/$";
import { Route as TwoFactorRoute } from "../auth/two-factor";
import { Route as GodModeSignInRoute } from "./sign-in";

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
  isAdmin: false,
  factors: { required: false, enabled: false },
  config: {
    hasGoogleSignIn: true,
    hasGithubSignIn: true,
    hasDiscordSignIn: true,
    hasCustomOAuth: true,
    customOAuthAutoLogin: true,
    hasSmtp: true,
    disableEmailOtpSignIn: false,
    disableLoginForm: false,
    disableRegistration: false,
    disablePasswordRegistration: false,
  },
  signInEmail: vi.fn(),
  signInSocial: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: async () => ({ data: mocks.session, error: null }),
    getLastUsedLoginMethod: () => null,
    signIn: { email: mocks.signInEmail, social: mocks.signInSocial },
    twoFactor: { verifyTotp: mocks.verifyTotp, verifyBackupCode: vi.fn() },
  },
}));

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: mocks.config, isLoading: false }),
}));

vi.mock("@/hooks/use-instance-admin-signal", () => ({
  useInstanceAdminSignal: () => mocks.isAdmin,
}));

vi.mock("@/components/settings/settings-shell", () => ({
  SettingsShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="settings-shell">{children}</div>
  ),
}));

vi.mock("@/components/settings/instance-settings-frame", () => ({
  InstanceSettingsFrame: ({ children }: { children: ReactNode }) => (
    <div data-testid="instance-frame">{children}</div>
  ),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US", resolvedLanguage: "en-US" },
  }),
}));

type BorrowedBeforeLoad = (context: {
  location: ParsedLocation;
  search: unknown;
}) => unknown;

/** Runs a real route's `beforeLoad` inside this test tree, whose root has no app context. */
function borrowBeforeLoad(beforeLoad: unknown) {
  if (typeof beforeLoad !== "function") throw new Error("missing beforeLoad");
  return (context: { location: ParsedLocation; search: unknown }) =>
    (beforeLoad as BorrowedBeforeLoad)(context);
}

function createTree() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const signIn = createRoute({
    getParentRoute: () => rootRoute,
    path: "/god-mode/sign-in",
    validateSearch: GodModeSignInRoute.options.validateSearch,
    beforeLoad: borrowBeforeLoad(GodModeSignInRoute.options.beforeLoad),
    component: GodModeSignInRoute.options.component,
  });
  const legacy = createRoute({
    getParentRoute: () => rootRoute,
    path: "/agent/god-mode/$",
    beforeLoad: borrowBeforeLoad(LegacyGodModeRoute.options.beforeLoad),
  });
  const normalSignIn = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth/sign-in",
    component: () => <h1>Normal sign-in</h1>,
  });
  const twoFactor = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth/two-factor",
    validateSearch: TwoFactorRoute.options.validateSearch,
    component: TwoFactorRoute.options.component,
  });
  const authenticated = createRoute({
    getParentRoute: () => rootRoute,
    id: "_authenticated",
    beforeLoad: borrowBeforeLoad(AuthenticatedRoute.options.beforeLoad),
    component: () => <Outlet />,
  });
  const godMode = createRoute({
    getParentRoute: () => authenticated,
    path: "/god-mode",
    component: GodModeLayoutRoute.options.component,
  });
  const godModeHome = createRoute({
    getParentRoute: () => godMode,
    path: "/",
    component: () => <h2>God Mode home</h2>,
  });
  const godModeUsers = createRoute({
    getParentRoute: () => godMode,
    path: "/users",
    component: () => <h2>Instance users</h2>,
  });
  const dashboard = createRoute({
    getParentRoute: () => authenticated,
    path: "/dashboard",
    component: () => <h2>Dashboard</h2>,
  });
  const security = createRoute({
    getParentRoute: () => authenticated,
    path: "/dashboard/settings/account/security",
    component: () => <h2>Account security</h2>,
  });
  return rootRoute.addChildren([
    signIn,
    legacy,
    normalSignIn,
    twoFactor,
    authenticated.addChildren([
      godMode.addChildren([godModeHome, godModeUsers]),
      dashboard,
      security,
    ]),
  ]);
}

async function open(path: string) {
  const router = createRouter({
    routeTree: createTree(),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const queryClient = new QueryClient();
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await router.load();
  });
  return router;
}

function currentHref(router: Awaited<ReturnType<typeof open>>) {
  return router.state.location.href;
}

beforeEach(() => {
  mocks.session = null;
  mocks.isAdmin = false;
  mocks.factors = { required: false, enabled: false };
  mocks.config.disableLoginForm = false;
  mocks.signInEmail.mockReset();
  mocks.signInSocial.mockReset();
  mocks.verifyTotp.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(mocks.factors), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("God Mode guard (L-03 option A)", () => {
  it("sends a signed-out visitor to the God Mode sign-in with the page as a safe redirect", async () => {
    const router = await open("/god-mode/users?q=Ada");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/god-mode/sign-in"),
    );
    expect(router.state.location.search).toEqual({
      redirect: "/god-mode/users?q=Ada",
    });
    expect(
      await screen.findByText("auth:godModeSignIn.title"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Normal sign-in")).toBeNull();
  });

  it("treats God Mode case-insensitively and leaves other pages on the normal sign-in", async () => {
    const upper = await open("/GOD-MODE/users");
    await waitFor(() =>
      expect(upper.state.location.pathname).toBe("/god-mode/sign-in"),
    );
    const dashboard = await open("/dashboard");
    await waitFor(() =>
      expect(dashboard.state.location.pathname).toBe("/auth/sign-in"),
    );
  });

  it("still requires MFA enrolment before God Mode opens", async () => {
    mocks.session = { user: { id: "admin", role: "admin" } };
    mocks.isAdmin = true;
    mocks.factors = { required: true, enabled: false };
    const router = await open("/god-mode/users");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        "/dashboard/settings/account/security",
      ),
    );
  });

  it("shows the access-denied screen to a signed-in non-admin", async () => {
    mocks.session = { user: { id: "member", role: "user" } };
    const router = await open("/god-mode/users");
    expect(currentHref(router)).toBe("/god-mode/users");
    expect(
      await screen.findByText("list.deniedTitle", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Instance users")).toBeNull();
  });

  it("opens the page for an instance admin", async () => {
    mocks.session = { user: { id: "admin", role: "admin" } };
    mocks.isAdmin = true;
    await open("/god-mode/users");
    expect(await screen.findByText("Instance users")).toBeInTheDocument();
    expect(screen.getByTestId("instance-frame")).toBeInTheDocument();
  });
});

describe("God Mode sign-in page", () => {
  it("offers only the password form, even with every SSO, social and email-code option configured", async () => {
    await open("/god-mode/sign-in");
    expect(
      await screen.findByText("auth:godModeSignIn.title"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("auth:forms.password")).toBeInTheDocument();
    for (const key of [
      "auth:signIn.continueWithGoogle",
      "auth:signIn.continueWithGithub",
      "auth:signIn.continueWithDiscord",
      "auth:signIn.continueWithOidc",
      "auth:signIn.toggleLink",
      "auth:signIn.invitationAlert",
    ])
      expect(screen.queryByText(key)).toBeNull();
    // No email-code form and no automatic OIDC sign-in.
    expect(screen.queryByText(/otpSignIn/u)).toBeNull();
    expect(mocks.signInSocial).not.toHaveBeenCalled();
  });

  it("shows why it cannot sign in when the instance turns local sign-in off", async () => {
    mocks.config.disableLoginForm = true;
    await open("/god-mode/sign-in");
    expect(
      await screen.findByText("auth:godModeSignIn.passwordDisabled"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("auth:forms.password")).toBeNull();
  });

  it("sends a signed-in visitor straight to the safe God Mode target", async () => {
    mocks.session = { user: { id: "admin", role: "admin" } };
    mocks.isAdmin = true;
    const router = await open(
      "/god-mode/sign-in?redirect=%2Fgod-mode%2Fusers%3Fq%3DAda",
    );
    await waitFor(() =>
      expect(currentHref(router)).toBe("/god-mode/users?q=Ada"),
    );
    expect(await screen.findByText("Instance users")).toBeInTheDocument();
  });

  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "/%09/evil.com",
    "/dashboard",
    "/god-mode/sign-in",
  ])("never follows the unsafe or non-God-Mode redirect %s", async (target) => {
    mocks.session = { user: { id: "admin", role: "admin" } };
    mocks.isAdmin = true;
    const router = await open(
      `/god-mode/sign-in?redirect=${encodeURIComponent(target)}`,
    );
    await waitFor(() => expect(currentHref(router)).toBe("/god-mode"));
  });

  it("signs in with the password and returns to the God Mode page", async () => {
    mocks.signInEmail.mockImplementation(async () => {
      mocks.session = { user: { id: "admin", role: "admin" } };
      mocks.isAdmin = true;
      return { data: { user: {} }, error: null };
    });
    const router = await open("/god-mode/sign-in?redirect=%2Fgod-mode%2Fusers");
    fireEvent.change(await screen.findByLabelText("auth:forms.email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("auth:forms.password"), {
      target: { value: "secret-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:signInForm.signIn" }),
    );
    await waitFor(() => expect(currentHref(router)).toBe("/god-mode/users"), {
      timeout: 3000,
    });
    expect(mocks.signInEmail).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "secret-password",
    });
  });

  it("passes the safe target through the existing two-factor step", async () => {
    mocks.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    });
    mocks.verifyTotp.mockImplementation(async () => {
      mocks.session = { user: { id: "admin", role: "admin" } };
      mocks.isAdmin = true;
      return { data: {}, error: null };
    });
    const router = await open("/god-mode/sign-in?redirect=%2Fgod-mode%2Fusers");
    fireEvent.change(await screen.findByLabelText("auth:forms.email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("auth:forms.password"), {
      target: { value: "secret-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:signInForm.signIn" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/auth/two-factor"),
    );
    expect(router.state.location.search).toEqual({
      redirect: "/god-mode/users",
    });
    fireEvent.change(
      screen.getByLabelText("auth:twoFactor.authenticatorCode"),
      { target: { value: "123456" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "auth:twoFactor.verify" }),
    );
    await waitFor(() => expect(currentHref(router)).toBe("/god-mode/users"));
  });
});

describe("two-factor step without a God Mode target", () => {
  it.each([undefined, "//evil.com", "/\\evil.com"])(
    "keeps its default destination for redirect %j",
    async (target) => {
      mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
      mocks.session = { user: { id: "u", role: "user" } };
      const router = await open(
        target === undefined
          ? "/auth/two-factor"
          : `/auth/two-factor?redirect=${encodeURIComponent(target)}`,
      );
      fireEvent.change(
        await screen.findByLabelText("auth:twoFactor.authenticatorCode"),
        { target: { value: "123456" } },
      );
      fireEvent.click(
        screen.getByRole("button", { name: "auth:twoFactor.verify" }),
      );
      await waitFor(() => expect(currentHref(router)).toBe("/dashboard"));
    },
  );
});

describe("old /agent/god-mode links (L-03)", () => {
  it.each([
    ["/agent/god-mode", "/god-mode"],
    ["/agent/god-mode/", "/god-mode"],
    ["/Agent/God-Mode/users?q=Ada#row", "/god-mode/users?q=Ada#row"],
  ])("redirects %s to %s", async (from, to) => {
    mocks.session = { user: { id: "admin", role: "admin" } };
    mocks.isAdmin = true;
    const router = await open(from);
    await waitFor(() => expect(currentHref(router)).toBe(to));
  });

  it("sends a signed-out visitor with an old link to the God Mode sign-in", async () => {
    const router = await open("/agent/god-mode/users");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/god-mode/sign-in"),
    );
    expect(router.state.location.search).toEqual({
      redirect: "/god-mode/users",
    });
  });
});
