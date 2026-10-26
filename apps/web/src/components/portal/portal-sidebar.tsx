import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  BookOpen,
  ClipboardList,
  Home,
  LayoutGrid,
  LogOut,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { getPortalKb } from "@/fetchers/kb/portal";
import { getPortalReleases } from "@/fetchers/portal/releases";
import {
  getDefaultPortalTerm,
  usePortalTranslation,
} from "@/lib/i18n/portal-translation";
import { portalAuthClient } from "@/lib/portal-auth-client";
import { routes } from "@/lib/routes";

/** Customer navigation uses Kaneo's sidebar/inset composition, without agent imports. */
export default function PortalSidebar() {
  const { t, i18n } = usePortalTranslation("portal");
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The knowledge base entry only appears when the portal has something to show (KB flag on,
  // at least one published, customer-visible article within the organisation's reach).
  const knowledgeBase = useQuery({
    queryKey: ["portal", "kb-navigation"],
    queryFn: () => getPortalKb({ limit: 1 }),
    retry: false,
    staleTime: 60_000,
  });
  const releases = useQuery({
    queryKey: ["portal", "release-navigation"],
    queryFn: () => getPortalReleases({ limit: 1 }),
    retry: false,
    staleTime: 60_000,
  });
  const navigation = [
    { to: routes.portalHome.path, label: t("navigation.home"), icon: Home },
    {
      to: routes.portalCatalogue.path,
      label: t("navigation.catalogue"),
      icon: LayoutGrid,
    },
    ...((knowledgeBase.data?.total ?? 0) > 0
      ? [
          {
            to: routes.portalKb.path,
            label: t("navigation.knowledgeBase"),
            icon: BookOpen,
          },
        ]
      : []),
    {
      to: routes.portalRequests.path,
      label: t("navigation.requests"),
      icon: ClipboardList,
      title: getDefaultPortalTerm(i18n, "request", 2),
    },
    ...(releases.data?.data.length
      ? [
          {
            to: routes.portalReleases.path,
            label: t("navigation.releases"),
            icon: BookOpen,
          },
        ]
      : []),
    {
      to: routes.portalApprovals.path,
      label: t("navigation.approvals"),
      icon: ClipboardList,
    },
    {
      to: routes.portalAccount.path,
      label: t("navigation.account"),
      icon: UserRound,
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
              {navigation.map(({ to, label, icon: Icon, title }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    title={title}
                    isActive={
                      location.pathname === to ||
                      (to === routes.portalKb.path &&
                        location.pathname.startsWith(`${to}/`))
                    }
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
