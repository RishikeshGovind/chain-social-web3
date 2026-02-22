import Link from "next/link";

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-lg w-full">
        <h2 className="text-2xl font-semibold mb-4">Wallet Login Safety</h2>
        <p className="mb-4">Wallet login lets you securely access ChainSocial without passwords. You only sign a message to prove ownership—your funds are never at risk, and we never ask for private keys or transactions.</p>
        <ul className="mb-4 list-disc pl-6 text-gray-300">
          <li>Supported wallets: MetaMask, Coinbase, WalletConnect</li>
          <li>Signing is free and does not move funds</li>
          <li>Never share your private key or seed phrase</li>
        </ul>
        <Link href="/feed" className="text-blue-400 hover:underline">Back to Feed</Link>
      </div>
    </div>
  );
}
