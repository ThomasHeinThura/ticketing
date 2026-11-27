import type { ReactNode } from "react";
import NamespaceBoundary from "@/components/common/namespace-boundary";
import WorkItemDetailLoading from "./work-item-detail-loading";

/** The shared namespace boundary with the work-item detail skeleton as its loading state. */
export default function WorkItemNamespaceBoundary({
  children,
  preload,
}: {
  children: ReactNode;
  preload?: () => Promise<unknown>;
}) {
  return (
    <NamespaceBoundary
      preload={preload}
      fallback={(visible) => <WorkItemDetailLoading visible={visible} />}
    >
      {children}
    </NamespaceBoundary>
  );
}
