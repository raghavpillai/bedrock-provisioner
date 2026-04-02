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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="relative z-10 rounded-tl-xl rounded-tr-xl shadow-[0_-2px_16px_0px_rgba(0,0,0,0.12),-6px_0_16px_0px_rgba(0,0,0,0.12)]">
        <div className="p-6 min-w-0">{children}</div>
      </SidebarInset>
      <CommandMenu />
    </SidebarProvider>
  );
}
