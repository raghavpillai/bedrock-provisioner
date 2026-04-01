"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRegion } from "@/lib/region-context";
import { useSession, signOut } from "@/lib/auth-client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  KeyRoundIcon,
  BoxesIcon,
  GaugeIcon,
  SettingsIcon,
  ShieldIcon,
  LogOutIcon,
  ChevronsUpDownIcon,
  BarChart3Icon,
  DollarSignIcon,
} from "lucide-react";

const analyticsItems = [
  { href: "/analytics/usage", label: "Usage", icon: BarChart3Icon },
  { href: "/analytics/cost", label: "Cost", icon: DollarSignIcon },
];

const manageItems = [
  { href: "/", label: "API Keys", icon: KeyRoundIcon },
  { href: "/models", label: "Models", icon: BoxesIcon },
  { href: "/quotas", label: "Quotas", icon: GaugeIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/admin", label: "Admin", icon: ShieldIcon, adminOnly: true },
] as const;

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { region, setRegion, enabledRegions } = useRegion();
  const { data: session, isPending } = useSession();
  const { isMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Rockbed">
              <Link href="/" className="flex items-center gap-2 w-full">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-aws-orange text-aws-squid-ink font-bold text-sm shrink-0">
                  R
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Rockbed</span>
                  <span className="truncate text-xs opacity-60">
                    Bedrock Manager
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Analytics</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {analyticsItems.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton isActive={active} tooltip={item.label}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-2 w-full"
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {manageItems
                .filter(
                  (item) =>
                    !("adminOnly" in item && item.adminOnly) ||
                    session?.user?.role === "admin"
                )
                .map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton isActive={active} tooltip={item.label}>
                        <Link
                          href={item.href}
                          className="flex items-center gap-2 w-full"
                        >
                          <item.icon className="size-4 shrink-0" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Region + Collapse — pushed to bottom */}
        <SidebarGroup className="mt-auto group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Region</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="px-2 pb-1 flex items-end gap-1.5">
              <Select value={region} onValueChange={(v) => v && setRegion(v)}>
                <SelectTrigger className="w-full h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {enabledRegions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SidebarTrigger className="shrink-0 h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-md" />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {isPending ? (
              <div className="p-2">
                <Skeleton className="h-8 w-full" />
              </div>
            ) : session ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="w-full rounded-lg flex items-center gap-2 p-2 text-left hover:bg-sidebar-accent transition-colors">
                    <div className="flex items-center gap-2 w-full">
                      {session.user.image ? (
                        <img
                          src={session.user.image}
                          alt=""
                          className="size-8 rounded-lg shrink-0"
                        />
                      ) : (
                        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground text-xs font-bold shrink-0">
                          {(
                            session.user.name?.[0] ?? session.user.email[0]
                          ).toUpperCase()}
                        </div>
                      )}
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">
                          {session.user.name ?? session.user.email}
                        </span>
                        <span className="truncate text-xs opacity-60">
                          {session.user.email}
                        </span>
                      </div>
                      <ChevronsUpDownIcon className="ml-auto size-4" />
                    </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-56 rounded-lg"
                  side={isMobile ? "bottom" : "right"}
                  align="end"
                  sideOffset={4}
                >
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() =>
                      signOut({
                        fetchOptions: {
                          onSuccess: () => {
                            window.location.href = "/login";
                          },
                        },
                      })
                    }
                  >
                    <LogOutIcon className="size-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
