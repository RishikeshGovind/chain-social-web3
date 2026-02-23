export default function HomePage() {
  return (
    <div className="min-h-screen flex justify-center bg-background text-text" style={{background: 'transparent'}}>
      <div className="w-full max-w-2xl px-8 py-16">
        <h1 className="text-5xl font-extrabold mb-8 text-center text-white drop-shadow-lg">
          Welcome to ChainSocial
        </h1>

        <p className="text-xl text-gray-200 mb-8 text-center">
          The decentralized social network for everyone.<br />
          <span className="text-base text-gray-400">No sign-ups, no passwords, no ads. Just real people, real posts, and true ownership of your content.</span>
        </p>

        <div className="mb-12 space-y-6">
          <div className="bg-card/80 rounded-2xl p-8 border border-border shadow-md">
            <h2 className="font-bold text-2xl mb-4 text-white">What is ChainSocial?</h2>
            <p className="text-gray-300 text-lg">
              ChainSocial is a next-generation social app built on <span className="text-green-400">blockchain technology</span> using the Lens Protocol. Unlike traditional social networks, your posts, likes, and profile truly belong to <span className="text-green-400">you</span>—not a company.
            </p>
          </div>
          <div className="bg-card/80 rounded-2xl p-8 border border-border shadow-md">
            <h2 className="font-bold text-2xl mb-4 text-white">How does it work?</h2>
            <ul className="list-disc pl-5 text-gray-300 text-lg space-y-2">
              <li>No email or password needed—just connect your crypto wallet to get started.</li>
              <li>Every post and profile is stored on a decentralized network, not on a company's server.</li>
              <li>You control your data and identity. You can even use your profile on other Lens-powered apps.</li>
              <li>Anyone can view the public feed. To post, simply connect your wallet and claim your Lens profile (free for new users).</li>
            </ul>
          </div>
          <div className="bg-card/80 rounded-2xl p-8 border border-border shadow-md">
            <h2 className="font-bold text-2xl mb-4 text-white">Why is this different?</h2>
            <ul className="list-disc pl-5 text-gray-300 text-lg space-y-2">
              <li><span className="text-primary font-semibold">No ads, no tracking, no selling your data.</span></li>
              <li>Open-source and censorship-resistant: your voice can't be silenced by a company.</li>
              <li>Bring your friends—anyone can join, even if they've never used web3 before!</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-center mt-8">
          <a
            href="/feed"
            className="inline-block bg-primary text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg hover:bg-secondary/80 focus:ring-2 focus:ring-primary focus:outline-none transition"
          >
            Explore the Feed
          </a>
        </div>
      </div>
    </div>
  );
}