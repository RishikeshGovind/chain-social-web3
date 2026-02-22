"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["wallet"], // Only wallet connect
        appearance: {
          theme: "dark",
          accentColor: "#ffffff",
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
