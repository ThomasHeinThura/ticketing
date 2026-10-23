import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@taskdesk/ui";
import { ClipboardList, Home, LayoutGrid, LogOut } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { portalAuthClient } from "@/lib/portal-auth-client";
import { routes } from "@/lib/routes";

/** Customer navigation uses Kaneo's sidebar/inset composition, without agent imports. */
export default function PortalSidebar() {
  const { t } = useTranslation("portal");
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const navigation = [
    { to: routes.portalHome.path, label: t("navigation.home"), icon: Home },
    {
      to: routes.portalCatalogue.path,
      label: t("navigation.catalogue"),
      icon: LayoutGrid,
    },
    {
      to: routes.portalRequests.path,
      label: t("navigation.requests"),
      icon: ClipboardList,
    },
    {
      to: routes.portalApprovals.path,
      label: t("navigation.approvals"),
      icon: ClipboardList,
    },
  ];
  async function signOut() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const result = await portalAuthClient.signOut();
      if (result.error) throw new Error("sign out refused");
      queryClient.clear();
      await navigate({
        to: routes.portalSignIn.path,
        search: { stage: "email", factor: "totp" },
      });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <Sidebar
      variant="inset"
      collapsible="offcanvas"
      className="border-none pt-1.5"
      closeLabel={t("common:actions.close")}
      mobileTitle={t("navigation.title")}
      mobileDescription={t("navigation.description")}
    >
      <SidebarHeader className="pt-1 pb-1.5">
        <Link
          to={routes.portalHome.path}
          className="px-2 py-2 font-medium text-sm"
        >
          {t("navigation.title")}
        </Link>
      </SidebarHeader>
      <SidebarContent className="overflow-hidden gap-1 py-1" nativeScroll>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    isActive={location.pathname === to}
                    render={
                      <Link
                        to={to}
                        aria-current={
                          location.pathname === to ? "page" : undefined
                        }
                      />
                    }
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Button
          variant="ghost"
          className="justify-start"
          disabled={pending}
          onClick={() => void signOut()}
        >
          <LogOut className="size-4" aria-hidden="true" />
          {t("navigation.signOut")}
        </Button>
        {failed ? (
          <Alert variant="error">
            <AlertDescription>{t("navigation.signOutFailed")}</AlertDescription>
          </Alert>
        ) : null}
      </SidebarFooter>
    </Sidebar>
  );
}
