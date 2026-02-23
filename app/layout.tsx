import "./globals.css";
import type { Metadata } from "next";

import Navbar from "@/components/Navbar";
import Providers from "@/components/Providers";
import ParticleBackground from "@/components/ParticleBackground";

export const metadata: Metadata = {
  title: "ChainSocial",
  description: "Decentralized Social Media on Lens Protocol",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-background text-text min-h-screen">
        <ParticleBackground />
        <Providers>
          <Navbar />
          <main className="w-full">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
