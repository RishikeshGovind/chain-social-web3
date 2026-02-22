export default function HomePage() {
  return (
    <div className="min-h-screen flex justify-center bg-black text-white">
      <div className="w-full max-w-2xl px-6 py-12">
        <h1 className="text-4xl font-bold mb-4 text-center">
          Welcome to ChainSocial
        </h1>

        <p className="text-lg text-gray-300 mb-6 text-center">
          The decentralized social network for everyone.<br />
          <span className="text-base text-gray-400">No sign-ups, no passwords, no ads. Just real people, real posts, and true ownership of your content.</span>
        </p>

        <div className="mb-8 space-y-4">
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h2 className="font-semibold text-xl mb-2">What is ChainSocial?</h2>
            <p className="text-gray-400">
              ChainSocial is a next-generation social app built on <span className="text-green-400">blockchain technology</span> using the Lens Protocol. Unlike traditional social networks, your posts, likes, and profile truly belong to <span className="text-green-400">you</span>—not a company.
            </p>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h2 className="font-semibold text-xl mb-2">How does it work?</h2>
            <ul className="list-disc pl-5 text-gray-400 space-y-1">
              <li>No email or password needed—just connect your crypto wallet to get started.</li>
              <li>Every post and profile is stored on a decentralized network, not on a company's server.</li>
              <li>You control your data and identity. You can even use your profile on other Lens-powered apps.</li>
              <li>Anyone can view the public feed. To post, simply connect your wallet and claim your Lens profile (free for new users).</li>
            </ul>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h2 className="font-semibold text-xl mb-2">Why is this different?</h2>
            <ul className="list-disc pl-5 text-gray-400 space-y-1">
              <li><span className="text-green-400">No ads, no tracking, no selling your data.</span></li>
              <li>Open-source and censorship-resistant: your voice can't be silenced by a company.</li>
              <li>Bring your friends—anyone can join, even if they've never used web3 before!</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-center">
          <a
            href="/feed"
            className="inline-block bg-white text-black px-6 py-2 rounded-lg font-semibold hover:bg-gray-200 transition"
          >
            Explore the Feed
          </a>
        </div>
      </div>
    </div>
  );
}