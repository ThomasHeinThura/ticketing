export type MockOidcBrowserProviderOptions = {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  subject?: string;
  redirectUri?: string;
  additionalRedirectUris?: string[];
  subjectByRedirectUri?: Record<string, string>;
  controlKey?: string;
  host?: "127.0.0.1" | "0.0.0.0";
  port?: number;
};

export function startMockOidcBrowserProvider(
  options?: MockOidcBrowserProviderOptions,
): Promise<{ origin: string; close(): Promise<void> }>;
