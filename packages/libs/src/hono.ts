/// <reference types="vite/types/importMeta.d.ts" />

import type { AppType } from "@taskdesk/api";
import { hc } from "hono/client";
import { resolveApiBaseUrl } from "./api-url";

const apiUrl = resolveApiBaseUrl(import.meta.env.VITE_API_URL);

// Generate once per tab load
export const windowId = Math.random().toString(36).substring(2, 11);

export function createApiFetch(fetchImpl: typeof fetch = fetch) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    headers.set("X-TaskDesk-Window-Id", windowId);

    return fetchImpl(input, {
      ...init,
      headers,
      credentials: "include",
    }).catch((error) => {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error(
          `Failed to connect to API server at ${apiUrl}. This might be due to CORS configuration issues or the server not running. Please check your environment variables and server status.`,
        );
      }
      throw error;
    });
  };
}

export const client = hc<AppType>(apiUrl, {
  fetch: createApiFetch(),
});
