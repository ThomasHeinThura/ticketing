import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";

/**
 * A project renamed since the link was made (#1200): replace the old key with the current one,
 * keeping the rest of the path, the search and the fragment. Renders nothing; loaded lazily so
 * the resolver stays out of the work list's first paint.
 */
export default function ProjectKeyRedirect({
  projectKey,
}: {
  projectKey: string;
}) {
  const { pathname, searchStr, hash } = useLocation();
  const router = useRouter();
  const { currentKey } = useProjectByKey(projectKey);
  useEffect(() => {
    if (!currentKey || currentKey === projectKey) return;
    const [, agent, projects, , ...rest] = pathname.split("/");
    router.history.replace(
      `/${[agent, projects, encodeURIComponent(currentKey), ...rest].join("/")}${searchStr}${hash ? `#${hash}` : ""}`,
    );
  }, [currentKey, projectKey, pathname, searchStr, hash, router]);
  return null;
}
