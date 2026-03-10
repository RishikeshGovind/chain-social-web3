import "./globals.css";
import type { Metadata } from "next";

import ClientLayout from "./ClientLayout";
import { ensureRuntimeConfig } from "@/lib/server/runtime-config";

export const metadata: Metadata = {
  title: "ChainSocial",
  description: "Decentralized Social Media on Lens Protocol",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
    ensureRuntimeConfig();
    return (
      <html lang="en">
        <body className="bg-black text-white min-h-screen">
          <ClientLayout>
            {children}
          </ClientLayout>
        </body>
      </html>
    );
}
