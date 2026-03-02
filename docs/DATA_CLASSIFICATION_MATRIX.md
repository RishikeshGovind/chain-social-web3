# ChainSocial Data Classification Matrix

Purpose: define what data may go on-chain, what must remain off-chain, and what must never be stored.

## Classification Rules

- `Public-Chain`: content safe to be public and immutable; no personal/sensitive data.
- `Public-Offchain`: public UX/state data served by app backends/indexers.
- `Restricted-Offchain`: account/session/compliance/abuse data requiring access controls and retention limits.
- `Prohibited`: data that must not be stored by ChainSocial systems.

## Matrix

| Data Element | Example | Classification | On-Chain Allowed | Off-Chain Storage | Retention | Controls |
|---|---|---|---|---|---|---|
| Publication hash / tx hash | Lens publication hash | Public-Chain | Yes | Optional cache | Permanent on chain | Integrity checks |
| Public post text | Feed post content | Public-Chain (if no PII) | Yes (or decentralized URI) | Yes (index/cache) | Business need | Automated PII scanning pre-publish |
| Post media URI | ipfs://... | Public-Chain (if no PII) | Yes | Yes | Business need | MIME checks, abuse scanning |
| Wallet address | 0xabc... | Public-Offchain | Yes (already public) | Yes | Business need | Pseudonymous handling |
| Profile display name | "alice.eth" | Public-Offchain | Prefer off-chain | Yes | User controlled | Moderation + profanity policy |
| Profile bio/location/website | free-form text | Restricted-Offchain | No | Yes | User controlled | PII detection + edit/delete support |
| Follow graph cache | follower/following counts | Public-Offchain | Optional | Yes | Business need | Access controls for write APIs |
| Likes/reposts cache | engagement state | Public-Offchain | Optional | Yes | Business need | Anti-abuse/rate limits |
| Session tokens | Lens access/refresh tokens | Restricted-Offchain | No | Cookie only (httpOnly) | Short-lived | Secure cookie flags + rotation |
| IP addresses / request logs | access logs | Restricted-Offchain | No | Yes | Short retention (e.g., 30-90d) | Legal basis + minimization |
| Device/browser fingerprint | UA, platform | Restricted-Offchain | No | Optional | Short retention | Purpose limitation |
| Abuse/risk signals | spam scores, block flags | Restricted-Offchain | No | Yes | Policy-based | Strict RBAC and audit trail |
| Legal requests / DSAR records | deletion request IDs | Restricted-Offchain | No | Yes | Legal requirement | Audit logs + chain of custody |
| Seed phrases/private keys | wallet secret | Prohibited | Never | Never | N/A | Explicitly reject in UI/API |
| Government IDs, bank details | KYC docs | Prohibited (unless separate legal KYC flow) | Never | Never in core app | N/A | Separate compliant provider only |

## On-Chain Publishing Guardrails

- Never publish direct personal identifiers (email, phone, legal name, precise address, government IDs).
- Block or warn on high-risk patterns before publish (email/phone/credit card/ID regex + ML moderation when available).
- Treat on-chain publication as irreversible from privacy perspective.

## Regional Compliance Behavior

- Region-aware middleware may block all traffic or write traffic by country.
- Feature kill switches can disable modules globally or per-country (`lens`, `posts`, `follows`, `media_uploads`, `messages`, `notifications`).
- During legal uncertainty, switch to read-only mode: `CHAINSOCIAL_GLOBAL_READ_ONLY=true`.

## Engineering Ownership

- Product: defines legal bases, consent language, retention schedule.
- Engineering: enforces technical controls and kill switches.
- Legal/Privacy: approves matrix updates per jurisdiction.
