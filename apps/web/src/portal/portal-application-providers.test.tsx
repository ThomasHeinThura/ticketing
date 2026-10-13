import { useQueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import queryClient from "@/query-client";
import { PortalApplicationProviders } from "./portal-application-providers";

const observeClient = vi.fn();

function QueryClientConsumer() {
  observeClient(useQueryClient());
  return null;
}

describe("portal application providers", () => {
  afterEach(() => {
    cleanup();
    observeClient.mockClear();
  });

  it("provides the shared query client to portal route descendants", () => {
    render(
      <PortalApplicationProviders>
        <QueryClientConsumer />
      </PortalApplicationProviders>,
    );

    expect(observeClient).toHaveBeenCalledWith(queryClient);
  });
});
