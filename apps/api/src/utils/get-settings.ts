import { config } from "dotenv-mono";
import {
  agentLocalAuthMethods,
  isEmailOtpSignInDisabledByEnvironment,
} from "../auth";
import { isCandidateReadOnlyActive } from "../candidate-read-only";
import { isRuntimeSmtpConfigured } from "../notification-provider/runtime";
import { isGithubSsoConfigured } from "./github-sso-env";

config();

async function getSettings() {
  const candidateReadOnly = isCandidateReadOnlyActive();
  return {
    disableRegistration:
      candidateReadOnly || process.env.DISABLE_REGISTRATION === "true",
    disablePasswordRegistration:
      candidateReadOnly || process.env.DISABLE_PASSWORD_REGISTRATION === "true",
    // Off when the environment switches it off or God Mode turned staff email code off: the
    // staff sign-in page then shows the password form instead of an unmounted send-code form.
    disableEmailOtpSignIn:
      candidateReadOnly ||
      isEmailOtpSignInDisabledByEnvironment() ||
      !agentLocalAuthMethods().emailOtp,
    disableWorkspaceCreation:
      candidateReadOnly || process.env.DISABLE_WORKSPACE_CREATION === "true",
    hasSmtp: await isRuntimeSmtpConfigured(),
    hasGithubSignIn: !candidateReadOnly && isGithubSsoConfigured(),
    hasGoogleSignIn:
      !candidateReadOnly &&
      Boolean(process.env.GOOGLE_CLIENT_ID) &&
      Boolean(process.env.GOOGLE_CLIENT_SECRET),
    hasDiscordSignIn:
      !candidateReadOnly &&
      Boolean(process.env.DISCORD_CLIENT_ID) &&
      Boolean(process.env.DISCORD_CLIENT_SECRET),
    hasCustomOAuth:
      !candidateReadOnly &&
      Boolean(process.env.CUSTOM_OAUTH_CLIENT_ID) &&
      Boolean(process.env.CUSTOM_OAUTH_CLIENT_SECRET),
    disableLoginForm: process.env.DISABLE_LOGIN_FORM === "true",
    customOAuthAutoLogin:
      !candidateReadOnly && process.env.CUSTOM_OAUTH_AUTO_LOGIN === "true",
    customOAuthLogoutUrl: process.env.CUSTOM_OAUTH_LOGOUT_URL || null,
  };
}

export default getSettings;
