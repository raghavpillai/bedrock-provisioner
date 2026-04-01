"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import {
  KeyRoundIcon,
  BoxesIcon,
  GaugeIcon,
  SettingsIcon,
  ShieldIcon,
  SearchIcon,
  BarChart3Icon,
  DollarSignIcon,
} from "lucide-react";

const pages = [
  { label: "Usage", href: "/analytics/usage", icon: BarChart3Icon },
  { label: "Cost", href: "/analytics/cost", icon: DollarSignIcon },
  { label: "API Keys", href: "/", icon: KeyRoundIcon },
  { label: "Models", href: "/models", icon: BoxesIcon },
  { label: "Quotas", href: "/quotas", icon: GaugeIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
  { label: "Admin", href: "/admin", icon: ShieldIcon },
];

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2">
        <CommandPrimitive
          className="rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <SearchIcon className="size-4 text-muted-foreground shrink-0" />
            <CommandPrimitive.Input
              placeholder="Type a command or search..."
              className="flex-1 h-11 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
              ESC
            </kbd>
          </div>
          <CommandPrimitive.List className="max-h-72 overflow-y-auto p-1">
            <CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </CommandPrimitive.Empty>
            <CommandPrimitive.Group
              heading="Pages"
              className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {pages.map((page) => (
                <CommandPrimitive.Item
                  key={page.href}
                  value={page.label}
                  onSelect={() => navigate(page.href)}
                  className="flex items-center gap-2 px-2 py-2 text-sm rounded-md cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <page.icon className="size-4 text-muted-foreground" />
                  {page.label}
                </CommandPrimitive.Item>
              ))}
            </CommandPrimitive.Group>
          </CommandPrimitive.List>
        </CommandPrimitive>
      </div>
    </>
  );
}
