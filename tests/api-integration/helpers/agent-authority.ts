/** Normalize an in-process Hono request to the authority used by the agent HTTP listener. */
export function withConfiguredAgentAuthority(
  input: string | Request,
  init: RequestInit | undefined,
  agentOrigin = process.env.TASKDESK_AGENT_URL,
): { input: string | Request; init: RequestInit | undefined } {
  if (typeof input !== "string") return { input, init };
  if (!agentOrigin) return { input, init };

  let configuredOrigin: URL;
  let requestUrl: URL;
  try {
    configuredOrigin = new URL(agentOrigin);
    requestUrl = input.startsWith("/")
      ? new URL(input, configuredOrigin)
      : new URL(input);
  } catch {
    return { input, init };
  }

  if (requestUrl.origin !== configuredOrigin.origin) return { input, init };

  const headers = new Headers(init?.headers);
  if (!headers.has("host")) headers.set("host", configuredOrigin.host);

  return {
    input: input.startsWith("/") ? requestUrl.toString() : input,
    init: { ...init, headers },
  };
}
