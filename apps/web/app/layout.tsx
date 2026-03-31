import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RegionProvider } from "@/lib/region-context";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Rockbed",
  description: "Provision and manage AWS Bedrock API keys",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className="bg-background text-foreground antialiased min-h-screen">
        <RegionProvider>
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </RegionProvider>
      </body>
    </html>
  );
}
