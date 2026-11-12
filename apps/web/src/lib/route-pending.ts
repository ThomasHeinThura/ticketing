import { createElement } from "react";
import { PageLoading } from "@/components/page-loading";

export const routePendingOptions = {
  defaultPendingMs: 150,
  defaultPendingMinMs: 300,
  defaultPendingComponent: PageLoading,
};

export const portalRoutePendingOptions = {
  ...routePendingOptions,
  defaultPreloadStaleTime: 0,
  defaultPendingComponent: () => createElement(PageLoading, { portal: true }),
};
