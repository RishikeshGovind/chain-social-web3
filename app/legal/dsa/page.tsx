export default function DsaPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 text-gray-200">
      <h1 className="mb-4 text-3xl font-semibold text-white">EU Platform Transparency</h1>
      <p className="mb-6 text-sm text-gray-400">Last updated: March 2, 2026</p>

      <div className="mb-6 rounded border border-yellow-600 bg-yellow-900/30 p-4 text-yellow-200">
        <strong>Notice:</strong> This page is under development and does not yet meet Digital Services
        Act (DSA) transparency requirements. Do not launch into EU or other regulated markets until
        this page includes the required legal contact, designated point of contact for authorities,
        notice-and-action procedures, and annual transparency report.
      </div>

      <h2 className="mb-2 text-xl font-medium text-white">Required Before EU Launch</h2>
      <ul className="mb-4 list-disc space-y-1 pl-5 text-sm">
        <li>Legal entity name, registration, and contact details</li>
        <li>Designated point of contact for Member State authorities</li>
        <li>Legal representative in the EU (if not established in the EU)</li>
        <li>Notice-and-action mechanism description and access</li>
        <li>Content moderation policies and complaint-handling procedures</li>
        <li>Annual transparency report on content moderation decisions</li>
        <li>Trusted flagger and out-of-court dispute settlement information</li>
      </ul>

      <p className="text-sm text-gray-400">
        See <code>docs/COMPLIANCE_CHECKLIST.md</code> for the full internal readiness checklist.
      </p>
    </div>
  );
}
