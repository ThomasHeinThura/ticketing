import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { ensureIdentityAdminOk } from "./identity-admin-error";

/** The three local (non-OIDC) sign-in methods of one portal. */
export type LocalAuthMethodSet = {
  password: boolean;
  magicLink: boolean;
  emailOtp: boolean;
};

export type LocalAuthMethodsByPortal = {
  agent: LocalAuthMethodSet;
  customer: LocalAuthMethodSet;
};

export type LocalAuthMethodsRequest = LocalAuthMethodsByPortal & {
  /** The `revision` the switches were read at; a newer save answers 409. */
  expectedRevision: string;
};

export type LocalAuthMethods = LocalAuthMethodsByPortal & {
  /** Opaque revision of the stored rows. */
  revision: string;
  /** Whether an email provider is enabled; magic links and email codes need one. */
  emailProviderEnabled: boolean;
  /** The server environment switches email-code sign-in off on both hosts. */
  emailOtpDisabledByEnvironment: boolean;
};

const path = "instance/auth/local-methods";

export async function getLocalAuthMethods(): Promise<LocalAuthMethods> {
  const response = await apiFetch(getApiUrl(path), {
    credentials: "include",
    cache: "no-store",
  });
  await ensureIdentityAdminOk(response, "Unable to load sign-in methods");
  return (await response.json()) as LocalAuthMethods;
}

/**
 * Elevated: the single-use token is bound to the exact six flags in `request`, so the same object
 * is sent to the step-up challenge, the proof and this write.
 */
export async function updateLocalAuthMethods(
  request: LocalAuthMethodsRequest,
  token: string,
): Promise<LocalAuthMethods> {
  const response = await apiFetch(getApiUrl(path), {
    method: "PUT",
    credentials: "include",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-taskdesk-step-up-token": token,
    },
    body: JSON.stringify(request),
  });
  await ensureIdentityAdminOk(response, "Unable to save sign-in methods");
  return (await response.json()) as LocalAuthMethods;
}
