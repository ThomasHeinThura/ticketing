import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mockFetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch: mockFetch }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => path,
}));

import { CustomerProjectAccess } from "./customer-project-access";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("grants and removes access through the project endpoint", async () => {
  let granted = false;
  mockFetch.mockImplementation(async (_path, options) => {
    if (options.method === "PUT") granted = true;
    if (options.method === "DELETE") granted = false;
    return {
      ok: true,
      json: async () => [
        { personId: "c1", name: "Customer", hasAccess: granted },
      ],
    };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CustomerProjectAccess projectId="p1" />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByText("customerInvitations:create.grantAccess"),
  );
  await waitFor(() =>
    expect(mockFetch).toHaveBeenCalledWith(
      "/projects/p1/customers/c1",
      expect.objectContaining({ method: "PUT" }),
    ),
  );
  fireEvent.click(
    await screen.findByText("customerInvitations:create.revokeAccess"),
  );
  await waitFor(() =>
    expect(mockFetch).toHaveBeenCalledWith(
      "/projects/p1/customers/c1",
      expect.objectContaining({ method: "DELETE" }),
    ),
  );
});
