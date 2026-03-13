import Link from "next/link";

const rules = [
  {
    title: "No sexual exploitation or explicit abuse",
    body: "Do not post pornography involving non-consenting people, minors, exploitative material, or links that direct people to it.",
  },
  {
    title: "No scams, malware, or impersonation",
    body: "Do not use ChainSocial to phish, spread malicious files, impersonate individuals or brands, or trick users into unsafe transactions.",
  },
  {
    title: "No targeted harassment or hateful abuse",
    body: "Do not threaten, dox, stalk, or target people with hateful or degrading abuse based on protected characteristics.",
  },
  {
    title: "No spam or manipulation",
    body: "Do not flood feeds, automate abusive posting, or use mass-produced accounts to manipulate discovery or messaging.",
  },
];

export default function CommunityStandardsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10 text-gray-200">
      <p className="mb-3 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-200">
        Community Standards
      </p>
      <h1 className="text-4xl font-black uppercase tracking-[-0.05em] text-white">
        Public content needs public rules.
      </h1>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-gray-300">
        ChainSocial is built for open identity and public expression, but not for abuse. Content
        and accounts can be reported, hidden, quarantined, or removed when they create legal,
        safety, or platform-integrity risk.
      </p>

      <div className="mt-8 grid gap-4">
        {rules.map((rule) => (
          <section key={rule.title} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-lg font-semibold text-white">{rule.title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-300">{rule.body}</p>
          </section>
        ))}
      </div>

      <section className="mt-8 rounded-[1.75rem] border border-white/10 bg-black/30 p-5">
        <h2 className="text-lg font-semibold text-white">How enforcement works</h2>
        <p className="mt-2 text-sm leading-6 text-gray-300">
          Reported content enters a moderation queue. Operators may quarantine uploads, hide posts
          or replies, restrict accounts, or preserve internal audit records for legal and abuse
          review. Public content stored on decentralized infrastructure may remain technically
          durable even after the app removes visibility.
        </p>
      </section>

      <div className="mt-8 flex flex-wrap gap-3 text-sm">
        <Link href="/legal/terms" className="rounded-full border border-white/10 px-4 py-2 hover:bg-white/[0.06]">
          Terms
        </Link>
        <Link href="/legal/privacy" className="rounded-full border border-white/10 px-4 py-2 hover:bg-white/[0.06]">
          Privacy
        </Link>
        <Link href="/help" className="rounded-full border border-white/10 px-4 py-2 hover:bg-white/[0.06]">
          Help
        </Link>
      </div>
    </div>
  );
}
