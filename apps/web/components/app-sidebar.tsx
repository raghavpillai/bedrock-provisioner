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
} from "lucide-react";

const navItems = [
  { href: "/", label: "API Keys", icon: KeyRoundIcon },
  { href: "/models", label: "Models", icon: BoxesIcon },
  { href: "/quotas", label: "Quotas", icon: GaugeIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/admin", label: "Admin", icon: ShieldIcon, adminOnly: true },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const { region, setRegion, enabledRegions } = useRegion();
  const { data: session, isPending } = useSession();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
            R
          </div>
          <span className="font-semibold text-sm tracking-tight">
            Rockbed
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems
                .filter((item) => !("adminOnly" in item && item.adminOnly) || session?.user?.role === "admin")
                .map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton isActive={active}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-2 w-full"
                      >
                        <item.icon className="size-4" />
                        {item.label}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 space-y-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
            Region
          </label>
          <Select value={region} onValueChange={setRegion}>
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
        </div>

        {isPending ? (
          <div className="rounded-md bg-sidebar-accent p-2.5 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ) : session ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full rounded-md bg-sidebar-accent p-2.5 flex items-center gap-2 hover:bg-sidebar-accent/80 transition-colors text-left">
              {session.user.image ? (
                <img
                  src={session.user.image}
                  alt=""
                  className="size-6 rounded-full shrink-0"
                />
              ) : (
                <div className="size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0">
                  {(session.user.name?.[0] ?? session.user.email[0]).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium truncate">
                  {session.user.name ?? session.user.email}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {session.user.email}
                </p>
              </div>
              <ChevronsUpDownIcon className="size-3.5 text-muted-foreground shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuItem
                className="gap-2"
                onClick={() => signOut({ fetchOptions: { onSuccess: () => window.location.href = "/login" } })}
              >
                <LogOutIcon className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </SidebarFooter>
    </Sidebar>
  );
}
