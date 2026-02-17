import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Welcome to ChainSocial</h2>
      <p className="text-gray-400">
        A decentralized social app built on Lens Protocol.
      </p>
      <Link
        href="/feed"
        className="inline-block bg-white text-black px-4 py-2 rounded-lg font-medium"
      >
        Go to Feed
      </Link>
    </div>
  );
}
