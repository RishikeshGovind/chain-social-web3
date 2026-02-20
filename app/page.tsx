export default function HomePage() {
  return (
    <div className="min-h-screen flex justify-center">
      <div className="w-full max-w-2xl px-6 py-12">
        <h1 className="text-4xl font-bold mb-4">
          Welcome to ChainSocial
        </h1>

        <p className="text-gray-400 mb-6">
          A decentralized social app built on Lens Protocol.
        </p>

        <a
          href="/feed"
          className="inline-block bg-white text-black px-6 py-2 rounded-lg"
        >
          Go to Feed
        </a>
      </div>
    </div>
  );
}