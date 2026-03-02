import "./globals.css";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Providers from "@/components/Providers";
import ConsentBanner from "@/components/ConsentBanner";

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
