# ChainSocial Compliance Checklist (Counsel / Auditor Ready)

Use this checklist before launch and at each major release.

## 1. Governance and Scope

- [ ] Data inventory maintained (all categories, systems, processors, regions).
- [ ] Data classification matrix approved: `docs/DATA_CLASSIFICATION_MATRIX.md`.
- [ ] Privacy owner, security owner, and escalation contacts assigned.
- [ ] Records of processing activities (RoPA) completed.

## 2. Legal Basis and User Transparency

- [ ] Privacy policy reflects actual processing and regions.
- [ ] Terms explain immutable/public nature of on-chain data.
- [ ] Consent/legal basis documented for analytics, anti-abuse, and notifications.
- [ ] User rights process defined (access, correction, deletion, portability, objection).

## 3. Cross-Border and Localization Controls

- [ ] Country transfer map documented (origin country -> processor country).
- [ ] Transfer mechanism documented (SCCs/contracts/localization requirements).
- [ ] Region/country restrictions configured using kill switches.
- [ ] Regulatory watch process in place (new blocking orders, localization updates).

## 4. Technical Enforcement (This Codebase)

- [ ] Region-aware middleware enabled: `middleware.ts`.
- [ ] Global read-only switch tested: `CHAINSOCIAL_GLOBAL_READ_ONLY=true`.
- [ ] Country blocks tested: `CHAINSOCIAL_BLOCKED_COUNTRIES`.
- [ ] Country write blocks tested: `CHAINSOCIAL_WRITE_BLOCKED_COUNTRIES`.
- [ ] Feature kill switches tested per module/country.
- [ ] Auth/session hardening validated (no unsigned token trust for actor identity).
- [ ] Upload validation and media abuse controls enabled.
- [ ] SSRF protections for metadata fetch verified.

## 5. Security and Access Controls

- [ ] Production secrets managed in provider secret manager (not in repo).
- [ ] Cookie/session settings reviewed (`httpOnly`, `secure`, `sameSite`).
- [ ] RBAC for infra dashboards and databases enforced (least privilege).
- [ ] Audit logging enabled for admin/compliance operations.
- [ ] Incident response and breach notification playbook approved.

## 6. Data Retention and Deletion

- [ ] Retention schedule defined by category (logs, abuse events, profile data, analytics).
- [ ] Automatic deletion/rotation implemented for short-lived data.
- [ ] DSAR deletion process documented for off-chain personal data.
- [ ] On-chain deletion limitation disclosures are explicit.

## 7. Vendor Risk Management

- [ ] DPA signed with each processor (hosting, DB, logging, messaging).
- [ ] Subprocessor list tracked and reviewed quarterly.
- [ ] Exit strategy/runbook tested (DB migration, storage migration, DNS failover).
- [ ] Backup and disaster recovery objectives documented (RPO/RTO).

## 8. Audit Evidence Pack

Collect and store evidence per release:

- [ ] Environment configuration snapshot (redacted).
- [ ] Test evidence for policy controls and kill switches.
- [ ] Pen test / security scan summary.
- [ ] Data flow diagram and updated architecture doc.
- [ ] Sign-off from legal, security, and engineering owners.

## 9. Recommended Configuration Baseline

For high-risk periods or pending legal review:

- [ ] `CHAINSOCIAL_GLOBAL_READ_ONLY=true`
- [ ] Disable risky modules by region (`*_COUNTRIES`).
- [ ] Keep personal profile fields off-chain.
- [ ] Restrict uploads if moderation tooling unavailable.

## 10. Re-Validation Triggers

Re-run this checklist when:

- [ ] entering a new country/market,
- [ ] adding a new data processor or region,
- [ ] changing on-chain data model,
- [ ] launching messaging or payments features,
- [ ] receiving regulatory inquiry or blocking notice.
