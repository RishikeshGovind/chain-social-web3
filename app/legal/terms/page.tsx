export default function TermsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10 text-gray-200">
      <h1 className="mb-4 text-3xl font-semibold text-white">Terms of Service</h1>
      <p className="mb-6 text-sm text-gray-400">Last updated: March 11, 2026</p>
      <p className="mb-4">
        By using ChainSocial, you agree not to publish unlawful, exploitative, infringing, abusive,
        or deceptive content.
      </p>
      <p className="mb-4">
        Prohibited uses include pornography involving exploitation, CSAM, harassment, hate speech,
        threats, impersonation, scams, malware distribution, and coordinated spam.
      </p>
      <p className="mb-4">
        You are responsible for content published from your wallet session. ChainSocial may review,
        quarantine, limit, hide, or remove content and may restrict accounts to protect users,
        comply with law, or preserve platform integrity.
      </p>
      <p className="mb-4">
        Where content is written to decentralized networks, complete removal may not be technically
        possible even after the app stops showing it.
      </p>
      <p className="mb-4">
        Additional conduct rules are published in the Community Standards page.
      </p>
      <a href="/legal/community" className="text-sm text-cyan-300 hover:underline">
        Read Community Standards
      </a>
    </div>
  );
}
