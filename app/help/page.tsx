import Link from "next/link";

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-black/80 text-white flex flex-col items-center justify-center p-10" style={{background: 'transparent'}}>
      <div className="bg-card/80 border border-border rounded-2xl p-10 max-w-xl w-full shadow-lg">
        <h2 className="text-3xl font-bold mb-8 text-center text-white drop-shadow">Wallet Login Safety</h2>
        <p className="mb-6 text-lg text-gray-200 text-center">Wallet login lets you securely access ChainSocial without passwords. You only sign a message to prove ownership—your funds are never at risk, and we never ask for private keys or transactions.</p>
        <ul className="mb-8 list-disc pl-8 text-gray-300 text-lg space-y-2">
          <li>Supported wallets: MetaMask, Coinbase, WalletConnect</li>
          <li>Signing is free and does not move funds</li>
          <li>Never share your private key or seed phrase</li>
        </ul>
        <Link
          href="/feed"
          className="inline-block bg-primary text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg hover:bg-secondary/80 focus:ring-2 focus:ring-primary focus:outline-none transition text-center"
        >
          Back to Feed
        </Link>
      </div>
    </div>
  );
}
