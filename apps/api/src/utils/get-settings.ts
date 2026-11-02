import { config } from "dotenv-mono";
import {
  agentLocalAuthMethods,
  isEmailOtpSignInDisabledByEnvironment,
} from "../auth";
import { isRuntimeSmtpConfigured } from "../notification-provider/runtime";
import { isGithubSsoConfigured } from "./github-sso-env";

config();

async function getSettings() {
  return {
    disableRegistration: process.env.DISABLE_REGISTRATION === "true",
    disablePasswordRegistration:
      process.env.DISABLE_PASSWORD_REGISTRATION === "true",
    // Off when the environment switches it off or God Mode turned staff email code off: the
    // staff sign-in page then shows the password form instead of an unmounted send-code form.
    disableEmailOtpSignIn:
      isEmailOtpSignInDisabledByEnvironment() ||
      !agentLocalAuthMethods().emailOtp,
    disableWorkspaceCreation: process.env.DISABLE_WORKSPACE_CREATION === "true",
    hasSmtp: await isRuntimeSmtpConfigured(),
    hasGithubSignIn: isGithubSsoConfigured(),
    hasGoogleSignIn:
      Boolean(process.env.GOOGLE_CLIENT_ID) &&
      Boolean(process.env.GOOGLE_CLIENT_SECRET),
    hasDiscordSignIn:
      Boolean(process.env.DISCORD_CLIENT_ID) &&
      Boolean(process.env.DISCORD_CLIENT_SECRET),
    hasCustomOAuth:
      Boolean(process.env.CUSTOM_OAUTH_CLIENT_ID) &&
      Boolean(process.env.CUSTOM_OAUTH_CLIENT_SECRET),
    disableLoginForm: process.env.DISABLE_LOGIN_FORM === "true",
    customOAuthAutoLogin: process.env.CUSTOM_OAUTH_AUTO_LOGIN === "true",
    customOAuthLogoutUrl: process.env.CUSTOM_OAUTH_LOGOUT_URL || null,
  };
}

export default getSettings;
