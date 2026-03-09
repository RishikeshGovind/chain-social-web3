import "./globals.css";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Providers from "@/components/Providers";
import ConsentBanner from "@/components/ConsentBanner";
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
        <Providers>
          <Navbar />
          <main className="w-full">
            {children}
          </main>
          <ConsentBanner />
        </Providers>
      </body>
    </html>
  );
}
