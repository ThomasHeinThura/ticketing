import { useLocation } from "@tanstack/react-router";
import { useSidebar } from "@taskdesk/ui";
import { useEffect } from "react";

/**
 * Closes the sheet sidebar (phones and tablets) once a page is chosen, so the new page is not
 * left behind the open sheet. The docked sidebar's state is not touched.
 */
export function CloseSidebarSheetOnNavigate() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    if (pathname) setOpenMobile(false);
  }, [pathname, setOpenMobile]);
  return null;
}
