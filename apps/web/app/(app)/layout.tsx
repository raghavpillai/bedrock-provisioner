import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandMenu } from "@/components/command-menu";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  return (
    <SidebarProvider className="bg-sidebar">
      <AppSidebar />
      <SidebarInset className="relative z-10 !w-auto my-2 mr-2 rounded-xl shadow-[0_-2px_16px_0px_rgba(0,0,0,0.15),-6px_0_16px_0px_rgba(0,0,0,0.15)] ring-1 ring-border/20 overflow-hidden">
        <div className="p-6 min-w-0">{children}</div>
      </SidebarInset>
      <CommandMenu />
    </SidebarProvider>
  );
}
