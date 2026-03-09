"use client";

import { PrivyProvider } from "@privy-io/react-auth";

const privyAppId: string = (() => {
  const value = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  if (!value) {
    throw new Error("Missing NEXT_PUBLIC_PRIVY_APP_ID");
  }
  return value;
})();

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PrivyProvider
      appId={privyAppId}
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
