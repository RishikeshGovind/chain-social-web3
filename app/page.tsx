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

const launchPoints = [
  "No app password flow. You connect a wallet to enter.",
  "Your public posts are built for openness, while inbox and utility features stay fast and practical inside the app.",
  "The experience is designed to feel familiar even if you have never touched crypto before.",
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
                Private by default.
                <br />
                Open when you choose.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-gray-300 sm:text-lg">
                ChainSocial is a social product for people who want more control over identity, privacy, and ownership without giving up the features that make an app usable every day:
                messages, notifications, bookmarks, lists, and settings that persist with your account.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/feed"
                  className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-gray-200"
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

          <section className="grid gap-6 rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-6 lg:grid-cols-[0.9fr_1.1fr] lg:p-8">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">What to expect</p>
              <h2 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
                Built like a real launch product, not a demo page.
              </h2>
            </div>
            <div className="space-y-3">
              {launchPoints.map((point) => (
                <div
                  key={point}
                  className="rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-sm leading-6 text-gray-200"
                >
                  {point}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
