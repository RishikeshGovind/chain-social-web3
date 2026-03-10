"use client";
import { usePathname } from "next/navigation";
import Navbar from "@/components/Navbar";
import Providers from "@/components/Providers";
import ConsentBanner from "@/components/ConsentBanner";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <Providers>
      {pathname !== "/" && <Navbar />}
      <main className="w-full">
        {children}
      </main>
      <ConsentBanner />
    </Providers>
  );
}
