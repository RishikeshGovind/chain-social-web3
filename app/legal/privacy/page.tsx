import Link from "next/link";

const privacySections = [
  {
    title: "What ChainSocial processes",
    body:
      "ChainSocial processes wallet-linked account data, public social content, basic service metadata, and limited technical logs needed to operate the app and keep it secure.",
  },
  {
    title: "What is public",
    body:
      "Posts, profile information, and other public social actions may be visible broadly and may be stored or referenced on decentralized infrastructure. Once public content is published there, it may not be fully reversible.",
  },
  {
    title: "What stays app-managed",
    body:
      "Messages, bookmarks, lists, notifications, settings, and other utility features are handled by the app backend so they can stay fast, consistent, and account-linked across sessions.",
  },
  {
    title: "Your controls",
    body:
      "While signed in, you can request export or deletion of app-managed off-chain data through the privacy endpoints. Those requests do not guarantee removal of decentralized public records that have already been published.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <section className="rounded-[2.25rem] border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur sm:p-8">
          <p className="mb-3 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-200">
            Privacy Model
          </p>
          <h1 className="text-3xl font-black uppercase tracking-[-0.05em] text-white sm:text-5xl">
            Clear boundaries,
            <br />
            not vague promises.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-gray-300 sm:text-base">
            ChainSocial separates public social publishing from app-managed utility features. This page explains what becomes public, what stays in the app backend, and what control you keep over off-chain account data.
          </p>
          <p className="mt-4 text-xs uppercase tracking-[0.18em] text-gray-500">
            Last updated: March 2, 2026
          </p>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {privacySections.map((section) => (
            <article
              key={section.title}
              className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
            >
              <h2 className="text-xl font-semibold text-white">{section.title}</h2>
              <p className="mt-3 text-sm leading-7 text-gray-300">{section.body}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-[2rem] border border-white/10 bg-black/30 p-6">
          <h2 className="text-2xl font-semibold text-white">What this means in practice</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">Public posts</p>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                Treat published public content as durable and potentially widely accessible.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">Private utilities</p>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                Messages, bookmarks, lists, notifications, and settings are app-managed product features.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">Export / delete</p>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                Export and deletion requests apply to off-chain app data, not guaranteed removal of decentralized records.
              </p>
            </div>
          </div>
        </section>

        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link
            href="/legal/terms"
            className="rounded-full border border-white/10 px-5 py-2.5 text-gray-200 transition hover:bg-white/[0.06]"
          >
            Read terms
          </Link>
          <Link
            href="/legal/cookies"
            className="rounded-full border border-white/10 px-5 py-2.5 text-gray-200 transition hover:bg-white/[0.06]"
          >
            Storage policy
          </Link>
          <Link
            href="/feed"
            className="rounded-full bg-white px-5 py-2.5 font-semibold text-black transition hover:bg-gray-200"
          >
            Back to feed
          </Link>
        </div>
      </div>
    </div>
  );
}
