import Link from "next/link";

const featureCards = [
  {
    title: "Own Your Identity",
    body: "Sign in with your wallet instead of creating another password, and keep control of the identity you use to post.",
  },
  {
    title: "Get Real Privacy Wins",
    body: "No ads, no password database, and a clearer separation between your public social activity and app-managed account features.",
  },
  {
    title: "Use Real Product Features",
    body: "Notifications, messages, bookmarks, lists, and preferences are handled inside the app where they can stay fast and useful.",
  },
];

const whyChainsocialPoints = [
  {
    eyebrow: "No Passwords",
    title: "Wallet access instead of account sprawl",
    body: "You connect your wallet and sign in, without creating another password to remember or another password database to trust.",
  },
  {
    eyebrow: "Clear Boundaries",
    title: "Public where it should be, private where it matters",
    body: "Public posting stays open, while messages, bookmarks, lists, and settings remain fast, practical app features.",
  },
  {
    eyebrow: "Familiar UX",
    title: "Made for people new to web3",
    body: "The product is designed to feel like modern social software first, not like a crypto puzzle you have to learn before using it.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-hidden bg-black text-white">
      <div className="relative isolate">
        <div className="absolute inset-x-0 top-[-18rem] -z-10 flex justify-center blur-3xl">
          <div className="h-[34rem] w-[34rem] rounded-full bg-cyan-500/18" />
        </div>
        <div className="absolute right-[-8rem] top-40 -z-10 h-80 w-80 rounded-full bg-lime-400/10 blur-3xl" />
        <div className="absolute left-[-10rem] bottom-10 -z-10 h-72 w-72 rounded-full bg-white/5 blur-3xl" />

        <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pb-16 pt-14 lg:px-10 lg:pt-20">
          <section className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div className="max-w-3xl">
              <p className="mb-4 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-cyan-200">
                Launch Build
              </p>
              <h1 className="max-w-4xl text-5xl font-black uppercase leading-none tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
                Welcome to ChainSocial!!!
                <br />
                Social media, reimagined for you.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-gray-300 sm:text-lg">
                ChainSocial is a social product for people who want more control over identity, privacy, and ownership without giving up the features that make an app usable every day:
                messages, notifications, bookmarks, lists, and settings that persist with your account.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/feed"
                  className="rounded-full bg-gradient-to-r from-cyan-400 via-lime-400 to-yellow-300 px-8 py-4 text-lg font-bold text-black shadow-lg transition hover:scale-105 hover:shadow-xl animate-pulse focus:outline-none focus:ring-4 focus:ring-cyan-400"
                >
                  Enter the feed
                </Link>
                <Link
                  href="/legal/privacy"
                  className="rounded-full border border-gray-700 px-6 py-3 text-sm font-semibold text-gray-200 transition hover:border-gray-500 hover:text-white"
                >
                  Read privacy model
                </Link>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur">
              <div className="rounded-[1.5rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-400/12 via-white/5 to-lime-300/10 p-5">
                <div className="mb-6 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.24em] text-gray-300">Why it feels different</span>
                  <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-lime-200">
                    Live product
                  </span>
                </div>
                <div className="mb-4 rounded-xl border border-cyan-400/20 bg-black/30 p-4 text-sm font-semibold text-cyan-200">
                  The name <span className="font-bold text-white">ChainSocial</span> comes from our vision: all data is stored on the blockchain. Your posts, identity, and activity are transparently and securely recorded, giving you true ownership and control.
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Ownership</p>
                    <p className="mt-2 text-sm text-gray-200">Your account starts with your wallet, not with a company-owned username and password database.</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-lime-200">Privacy</p>
                    <p className="mt-2 text-sm text-gray-200">No ads, no vague claims, and clear product boundaries about what is public versus what the app stores for functionality.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2">
                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-4 text-center">
                      <p className="text-2xl font-bold text-white">1</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Wallet</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-4 text-center">
                      <p className="text-2xl font-bold text-white">2</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Posts</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-4 text-center">
                      <p className="text-2xl font-bold text-white">3</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Inbox</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            {featureCards.map((card) => (
              <article
                key={card.title}
                className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                <p className="mb-3 text-xs uppercase tracking-[0.24em] text-gray-400">Feature</p>
                <h2 className="text-2xl font-semibold text-white">{card.title}</h2>
                <p className="mt-3 text-sm leading-6 text-gray-300">{card.body}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-8 rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-6 lg:grid-cols-[0.92fr_1.08fr] lg:p-8">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">Why ChainSocial?</p>
              <h2 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
                A social product with clearer ownership, cleaner privacy boundaries, and a friendlier first run.
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-gray-300 sm:text-base">
                ChainSocial is built to feel approachable on day one while still giving you more control than traditional social apps.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-4">
                  <p className="text-2xl font-bold text-white">0</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Passwords</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-4">
                  <p className="text-2xl font-bold text-white">1</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Wallet identity</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-4">
                  <p className="text-2xl font-bold text-white">3</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Core advantages</p>
                </div>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-[1.8rem] border border-white/10 bg-black/30 p-4 sm:p-6">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.12),transparent_45%)]" />
              <div className="absolute left-1/2 top-36 hidden h-[18rem] w-[18rem] -translate-x-1/2 rounded-full border border-dashed border-white/10 lg:block" />
              <div className="absolute left-1/2 top-24 hidden h-[25rem] w-[25rem] -translate-x-1/2 rounded-full border border-dashed border-cyan-400/10 lg:block" />

              <div className="relative z-10 flex flex-col gap-5">
                <div className="mx-auto flex w-full max-w-sm flex-col items-center justify-center rounded-[1.75rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-400/16 via-white/[0.05] to-lime-300/10 px-6 py-7 text-center shadow-[0_25px_80px_rgba(6,182,212,0.12)]">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200">Why people stay</p>
                  <h3 className="mt-3 text-2xl font-semibold text-white">ChainSocial</h3>
                  <p className="mt-3 text-sm leading-6 text-gray-200">
                    Built to feel simpler, more trustworthy, and more useful from the first visit.
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {whyChainsocialPoints.map((point, index) => (
                    <article
                      key={point.title}
                      className={`rounded-[1.5rem] border border-white/10 bg-white/[0.05] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur transition hover:border-white/20 hover:bg-white/[0.07] ${
                        index === 2 ? "lg:col-span-2" : ""
                      }`}
                    >
                      <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">{point.eyebrow}</p>
                      <h4 className="mt-3 text-lg font-semibold text-white">{point.title}</h4>
                      <p className="mt-3 text-sm leading-6 text-gray-300">{point.body}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
