import Link from "next/link";
import AppShell from "@/components/AppShell";

const safetyPoints = [
  "Wallet login proves account ownership by signing a message. It does not move funds.",
  "ChainSocial never asks for your private key or seed phrase.",
  "Only approve signatures you expect, and double-check the site URL before signing.",
];

const moderationPoints = [
  "Public posts, replies, profiles, and messages can be reported in-product.",
  "Image uploads can be held for review before they become public, depending on moderation mode.",
  "Accounts that spread scams, explicit abuse, harassment, or malware can be hidden or restricted.",
];

export default function HelpPage() {
  return (
    <AppShell active="Help">
      <div className="w-full max-w-3xl text-white">
        <section className="animate-fade-up rounded-[2.25rem] border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur sm:p-8">
          <p className="mb-3 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-200">
            Help
          </p>
          <h1 className="text-3xl font-black uppercase leading-none tracking-[-0.05em] text-white sm:text-5xl">
            Wallet login should feel clear, not risky.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-300 sm:text-base">
            You sign a message to prove you control your wallet. That signature acts like a login,
            not a payment.
          </p>
        </section>

        <div className="mt-6 grid gap-4">
          {safetyPoints.map((point) => (
            <div
              key={point}
              className="animate-fade-up rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5 text-sm leading-6 text-gray-200 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur"
            >
              {point}
            </div>
          ))}
        </div>

        <section className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Safety and reporting</p>
          <div className="mt-4 grid gap-3">
            {moderationPoints.map((point) => (
              <div key={point} className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm leading-6 text-gray-200">
                {point}
              </div>
            ))}
          </div>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/feed"
            className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-gray-200"
          >
            Back to feed
          </Link>
          <Link
            href="/legal/privacy"
            className="rounded-full border border-white/10 px-5 py-2.5 text-sm text-gray-200 transition hover:bg-white/[0.06]"
          >
            Privacy details
          </Link>
          <Link
            href="/legal/community"
            className="rounded-full border border-white/10 px-5 py-2.5 text-sm text-gray-200 transition hover:bg-white/[0.06]"
          >
            Community rules
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
