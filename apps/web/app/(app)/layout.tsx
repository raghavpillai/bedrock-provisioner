import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandMenu } from "@/components/command-menu";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="shadow-[-6px_0_16px_0px_rgba(0,0,0,0.15)] relative z-10">
        <div className="p-6 min-w-0">{children}</div>
      </SidebarInset>
      <CommandMenu />
    </SidebarProvider>
  );
}
