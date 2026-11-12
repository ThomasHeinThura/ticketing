import { Skeleton } from "@taskdesk/ui";

export function PageLoading({ label }: { label?: string }) {
  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role="status"
      data-testid="page-loading"
    >
      <Skeleton className="h-8 w-64 motion-reduce:animate-none" />
      <Skeleton className="h-24 w-full motion-reduce:animate-none" />
    </div>
  );
}
