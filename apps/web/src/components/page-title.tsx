import { useEffect } from "react";

type PageTitleProps = {
  title: string;
  suffix?: string;
  hideAppName?: boolean;
  /**
   * A layout-level default. React runs child effects before parent effects, so a layout's title
   * would otherwise overwrite the page's own. A fallback only applies while no page title is
   * mounted.
   */
  fallback?: boolean;
};

let mountedPageTitles = 0;

export default function PageTitle({
  title,
  suffix = "TaskDesk",
  hideAppName = false,
  fallback = false,
}: PageTitleProps) {
  useEffect(() => {
    if (fallback) return;
    mountedPageTitles += 1;
    return () => {
      mountedPageTitles -= 1;
    };
  }, [fallback]);

  useEffect(() => {
    if (fallback && mountedPageTitles > 0) return;
    const formattedTitle = hideAppName
      ? title
      : suffix
        ? `${title} · ${suffix}`
        : title;
    document.title = formattedTitle;
  }, [title, suffix, hideAppName, fallback]);

  return null;
}
